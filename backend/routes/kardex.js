const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { assertPeriodoAbierto } = require('../services/cierrePeriodo');

router.use(authMiddleware);

// Ocultos temporalmente del Kardex a pedido del usuario (2026-09): categorías completas
// que todavía no se van a usar, más DIESEL B5 S50 UV (DBS-BS-DIE-001) que aunque es
// categoría COMBUSTIBLES (no incluida abajo) se pidió mantener oculto también.
// Quitar este filtro cuando corresponda volver a mostrarlos.
// Saldo corrido recalculado en el orden en que se MUESTRA el Kardex (fecha, entradas antes que
// salidas, id). El saldo guardado en cada fila se calculó al registrarla, así que con movimientos
// de fecha atrasada (p. ej. una recepción del 30/01 registrada después de una salida de octubre)
// no sigue el orden por fecha. Por almacén y producto: cantidad y valor acumulados; el costo
// unitario del saldo sale de valor / cantidad.
const ORDEN_KARDEX = `fecha, (movimiento = 'entrada') DESC, (tipo_documento = 'SALDO_INICIAL') DESC, id`;
const SALDO_RECALCULADO = `(
  SELECT id,
         SUM(CASE movimiento WHEN 'entrada' THEN cantidad ELSE -cantidad END) OVER (PARTITION BY almacen_id, producto_id ORDER BY ${ORDEN_KARDEX}) AS saldo_cant_calc,
         SUM(CASE movimiento WHEN 'entrada' THEN valor_total ELSE -valor_total END) OVER (PARTITION BY almacen_id, producto_id ORDER BY ${ORDEN_KARDEX}) AS saldo_valor_calc
  FROM maquicombus_kardex
) sc`;
const COLS_SALDO = `sc.saldo_cant_calc AS saldo_cantidad,
              sc.saldo_valor_calc AS saldo_valor,
              CASE WHEN sc.saldo_cant_calc > 0.00005 THEN sc.saldo_valor_calc / sc.saldo_cant_calc ELSE 0 END AS saldo_costo_unitario`;

const CATEGORIAS_OCULTAS_KARDEX =['ACTIVO', 'AGREGADOS', 'EQUIPO ELECTRONICO', 'MOBILIARIO'];
const PRODUCTOS_OCULTOS_KARDEX = [79]; // DIESEL B5 S50 UV

// GET /api/erp_kardex - con filtros
router.get('/', async (req, res) => {
  try {
    const { search, producto_id, almacen_id, tipo_documento, centro_costo_id, fecha_desde, fecha_hasta, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = `WHERE COALESCE(NULLIF(p.familia,''), '') NOT IN (${CATEGORIAS_OCULTAS_KARDEX.map(() => '?').join(',')})
                 AND k.producto_id NOT IN (${PRODUCTOS_OCULTOS_KARDEX.map(() => '?').join(',')})`;
    const params = [...CATEGORIAS_OCULTAS_KARDEX, ...PRODUCTOS_OCULTOS_KARDEX];
    if (search) {
      where += ' AND (p.sku LIKE ? OR p.descripcion LIKE ? OR k.numero_documento LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (producto_id) { where += ' AND k.producto_id = ?'; params.push(producto_id); }
    if (almacen_id) {
      where += ' AND k.almacen_id = ?'; params.push(almacen_id);
    } else if (!tipo_documento) {
      // Sin filtro de almacén ni tipo: ocultar TRANSFERENCIA_IN para no duplicar.
      where += " AND k.tipo_documento != 'TRANSFERENCIA_IN'";
    }
    if (tipo_documento) { where += ' AND k.tipo_documento = ?'; params.push(tipo_documento); }
    if (centro_costo_id) { where += ' AND k.centro_costo_id = ?'; params.push(centro_costo_id); }
    if (fecha_desde) { where += ' AND k.fecha >= ?'; params.push(fecha_desde); }
    if (fecha_hasta) { where += ' AND k.fecha <= ?'; params.push(fecha_hasta); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM maquicombus_kardex k JOIN maquicombus_productos p ON k.producto_id = p.id ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT k.*, p.sku, p.descripcion as producto_descripcion, um.codigo as unidad,
              COALESCE(NULLIF(p.familia, ''), 'SIN CATEGORÍA') as categoria,
              a.nombre as almacen_nombre, a.tipo as almacen_tipo,
              (SELECT GROUP_CONCAT(DISTINCT cc.nombre ORDER BY cc.nombre SEPARATOR ', ')
               FROM maquicombus_orden_compra_detalles ocd
               JOIN maquicombus_ordenes_compra oc_cc ON oc_cc.id = ocd.orden_compra_id
               JOIN maquicombus_centros_costo cc ON cc.id = oc_cc.centro_costo_id
               WHERE ocd.producto_id = k.producto_id) as centro_costo_nombre,
              COALESCE(
                k.nro_factura,
                CASE WHEN k.tipo_documento IN ('RECEPCION','SALDO_INICIAL') THEN oc.nro_factura ELSE NULL END,
                CASE WHEN k.tipo_documento IN ('SALIDA_CONSUMO','SALIDA_RESERVA') THEN
                  COALESCE(
                    rvs.nro_factura,
                    CASE WHEN fs.id IS NOT NULL THEN CONCAT(fs.serie, '-', fs.numero) END,
                    -- Salida sin factura propia: la del saldo inicial de ese producto/almacén
                    (SELECT ksi.nro_factura FROM maquicombus_kardex ksi
                      WHERE ksi.tipo_documento = 'SALDO_INICIAL' AND ksi.producto_id = k.producto_id
                        AND ksi.almacen_id = k.almacen_id AND ksi.nro_factura IS NOT NULL
                      ORDER BY ksi.id LIMIT 1)
                  )
                END
              ) as nro_factura,
              CASE WHEN k.tipo_documento IN ('TRANSFERENCIA_OUT','TRANSFERENCIA_IN')
                   THEN ad.nombre ELSE NULL END as almacen_destino_nombre,
              CASE WHEN k.tipo_documento IN ('TRANSFERENCIA_OUT','TRANSFERENCIA_IN')
                   THEN ad.tipo ELSE NULL END as almacen_destino_tipo,
              -- A dónde va una salida: vehículo/equipo, o si no el centro de costo
              CASE WHEN k.tipo_documento IN ('SALIDA_CONSUMO','SALIDA_RESERVA')
                   THEN COALESCE(pv.placa, pl.placa, ccs.nombre) ELSE NULL END as salida_destino,
              ${COLS_SALDO}
       FROM maquicombus_kardex k
       JOIN ${SALDO_RECALCULADO} ON sc.id = k.id
       JOIN maquicombus_productos p ON k.producto_id = p.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       JOIN maquicombus_almacenes a ON k.almacen_id = a.id
       LEFT JOIN maquicombus_recepciones rec ON (k.tipo_documento IN ('RECEPCION','SALDO_INICIAL') AND k.referencia_id = rec.id)
       LEFT JOIN maquicombus_ordenes_compra oc ON rec.orden_compra_id = oc.id
       LEFT JOIN maquicombus_transferencias trf ON (k.tipo_documento IN ('TRANSFERENCIA_OUT','TRANSFERENCIA_IN') AND k.referencia_id = trf.id)
       LEFT JOIN maquicombus_almacenes ad ON (
         k.tipo_documento = 'TRANSFERENCIA_OUT' AND trf.almacen_destino_id = ad.id
         OR k.tipo_documento = 'TRANSFERENCIA_IN'  AND trf.almacen_origen_id  = ad.id
       )
       LEFT JOIN (
         SELECT salida_id, producto_id, MIN(placa_vehiculo_id) AS placa_vehiculo_id, MIN(placa_id) AS placa_id, MIN(centro_costo_id) AS centro_costo_id,
                MIN(factura_id) AS factura_id, MIN(reserva_id) AS reserva_id
         FROM maquicombus_salida_detalles GROUP BY salida_id, producto_id
       ) sd ON (k.tipo_documento IN ('SALIDA_CONSUMO','SALIDA_RESERVA') AND sd.salida_id = k.referencia_id AND sd.producto_id = k.producto_id)
       LEFT JOIN maquicombus_reservas rvs ON rvs.id = sd.reserva_id
       LEFT JOIN maquicombus_facturas fs ON fs.id = sd.factura_id
       LEFT JOIN maquicombus_equipos_placas pv ON sd.placa_vehiculo_id = pv.id
       LEFT JOIN maquicombus_equipos_placas pl ON sd.placa_id = pl.id
       LEFT JOIN maquicombus_centros_costo ccs ON sd.centro_costo_id = ccs.id
       ${where}
       ORDER BY k.fecha ASC,
         (k.movimiento = 'entrada') DESC,
         (k.tipo_documento = 'SALDO_INICIAL') DESC,
         k.id ASC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener erp_kardex' });
  }
});

// GET /api/erp_kardex/producto/:id/almacen/:almacenId - erp_kardex de un producto en un almacén
router.get('/producto/:id/almacen/:almacenId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT k.*, p.sku, p.descripcion as producto_descripcion, a.nombre as almacen_nombre,
              ${COLS_SALDO}
       FROM maquicombus_kardex k
       JOIN ${SALDO_RECALCULADO} ON sc.id = k.id
       JOIN maquicombus_productos p ON k.producto_id = p.id
       JOIN maquicombus_almacenes a ON k.almacen_id = a.id
       WHERE k.producto_id = ? AND k.almacen_id = ?
       ORDER BY k.fecha ASC, (k.movimiento = 'entrada') DESC, k.id ASC`,
      [req.params.id, req.params.almacenId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener erp_kardex' });
  }
});

// POST /api/kardex/saldo-inicial/importar-directo — importa tal cual viene del Excel sin validación
router.post('/saldo-inicial/importar-directo', async (req, res) => {
  const { registros, archivo_nombre } = req.body;
  if (!registros?.length) return res.status(400).json({ error: 'Sin registros para importar' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let importados = 0;

    for (const r of registros) {
      const fecha = r.fecha || null;
      const cantidad  = parseFloat(r.cantidad  || 0) || 0;
      const costo     = parseFloat(r.costo_unitario || 0) || 0;
      const total     = parseFloat(r.costo_total_archivo || (cantidad * costo)) || 0;

      await conn.query(
        `INSERT INTO maquicombus_saldos_iniciales
           (numeracion, codigo_producto, descripcion_producto, almacen, fecha, documento, ruc, cantidad, costo_unitario, costo_total, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.numeracion     || null,
          r.sku            || null,
          r.producto_archivo || null,
          r.almacen        || null,
          fecha,
          r.documento      || null,
          r.ruc            || null,
          cantidad,
          costo,
          total,
          req.user.id,
        ]
      );
      importados++;
    }

    await conn.query(
      'INSERT INTO maquicombus_importaciones_saldo (usuario_id, archivo_nombre, total, importados, omitidos, errores) VALUES (?, ?, ?, ?, 0, 0)',
      [req.user.id, archivo_nombre || 'sin nombre', registros.length, importados]
    );

    await conn.commit();
    res.json({ importados, total: registros.length, mensaje: `${importados} registros importados correctamente` });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error en la importación: ' + err.message });
  } finally {
    conn.release();
  }
});

// GET /api/kardex/saldo-inicial/lista — listar registros importados directamente
router.get('/saldo-inicial/lista', async (req, res) => {
  try {
    const { page = 1, limit = 500 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM maquicombus_saldos_iniciales');
    const [rows] = await pool.query(
      'SELECT * FROM maquicombus_saldos_iniciales ORDER BY id ASC LIMIT ? OFFSET ?',
      [parseInt(limit), offset]
    );
    res.json({ data: rows, total });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener saldos iniciales' });
  }
});

// DELETE /api/kardex/saldo-inicial/lista/:id
router.delete('/saldo-inicial/lista/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[s]] = await conn.query('SELECT * FROM maquicombus_saldos_iniciales WHERE id = ?', [req.params.id]);
    if (s?.numeracion) {
      // Saldo manual: tiene línea en el Kardex (mismo número SI-AAAA-NNNNN) que debe salir junto con su stock.
      const [[k]] = await conn.query(
        "SELECT * FROM maquicombus_kardex WHERE tipo_documento = 'SALDO_INICIAL' AND numero_documento = ? AND cierre_periodo_id IS NULL",
        [s.numeracion]
      );
      if (k) {
        await conn.query(
          'UPDATE maquicombus_inventario SET stock_fisico = GREATEST(0, stock_fisico - ?) WHERE producto_id = ? AND almacen_id = ?',
          [k.cantidad, k.producto_id, k.almacen_id]
        );
        await conn.query('DELETE FROM maquicombus_kardex WHERE id = ?', [k.id]);
      }
    }
    await conn.query('DELETE FROM maquicombus_saldos_iniciales WHERE id = ?', [req.params.id]);
    await conn.commit();
    res.json({ message: 'Eliminado' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar' });
  } finally {
    conn.release();
  }
});

// POST /api/kardex/saldo-inicial/importar — importación masiva desde Excel
router.post('/saldo-inicial/importar', async (req, res) => {
  const { registros, archivo_nombre } = req.body;
  if (!registros?.length) return res.status(400).json({ error: 'Sin registros para importar' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const resultados = [];
    let importados = 0, omitidos = 0, errores = 0;

    for (const r of registros) {
      const skuTrim = String(r.sku || '').trim();
      const almTrim = String(r.almacen || '').trim();
      const prodArchivo = String(r.producto_archivo || '').trim();

      if (!skuTrim || !almTrim || !r.fecha || !r.cantidad) {
        resultados.push({ ...r, estado: 'error', mensaje: 'Fila incompleta (Código Producto, Almacén, Fecha y Cantidad son obligatorios)' });
        errores++; continue;
      }

      // Buscar producto: por ID numérico (PROD00040 → id=40), luego por SKU, luego por descripción
      let prod = null;
      const prodNumMatch = skuTrim.match(/^PROD0*(\d+)$/i);
      if (prodNumMatch) {
        [[prod]] = await conn.query(
          "SELECT id, descripcion FROM maquicombus_productos WHERE id = ? AND estado = 'activo'",
          [parseInt(prodNumMatch[1])]
        );
      }
      if (!prod) {
        [[prod]] = await conn.query(
          "SELECT id, descripcion FROM maquicombus_productos WHERE sku = ? AND estado = 'activo'",
          [skuTrim]
        );
      }
      if (!prod && prodArchivo) {
        [[prod]] = await conn.query(
          "SELECT id, descripcion FROM maquicombus_productos WHERE descripcion = ? AND estado = 'activo'",
          [prodArchivo]
        );
      }
      if (!prod) {
        resultados.push({ ...r, producto_archivo: prodArchivo, estado: 'error', mensaje: `Producto "${skuTrim}" no encontrado (probado por ID, SKU y descripción)` });
        errores++; continue;
      }

      // Buscar almacén por nombre (insensible a mayúsculas/tildes) o código
      const [[alm]] = await conn.query(
        `SELECT id, nombre FROM maquicombus_almacenes
         WHERE (nombre = ? OR codigo = ?
           OR UPPER(nombre) = UPPER(?)
           OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(nombre),'Á','A'),'É','E'),'Í','I'),'Ó','O'),'Ú','U') = UPPER(?)
         ) AND estado = 'activo'`,
        [almTrim, almTrim, almTrim, almTrim]
      );
      if (!alm) {
        resultados.push({ ...r, estado: 'error', mensaje: `Almacén "${almTrim}" no encontrado` });
        errores++; continue;
      }

      // Verificar duplicado
      const [[existe]] = await conn.query(
        "SELECT id FROM maquicombus_kardex WHERE tipo_documento = 'SALDO_INICIAL' AND producto_id = ? AND almacen_id = ?",
        [prod.id, alm.id]
      );
      if (existe) {
        resultados.push({ ...r, producto: prod.descripcion, producto_archivo: prodArchivo, almacen_nombre: alm.nombre, estado: 'omitido', mensaje: 'Ya existe saldo inicial para este producto/almacén' });
        omitidos++; continue;
      }

      const cantNum  = parseFloat(r.cantidad);
      const costoNum = parseFloat(r.costo_unitario);
      const valorTot = cantNum * costoNum;

      // Inventario
      const [[inv]] = await conn.query(
        'SELECT id FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?',
        [prod.id, alm.id]
      );
      if (inv) {
        await conn.query(
          'UPDATE maquicombus_inventario SET stock_fisico = stock_fisico + ?, costo_promedio = ? WHERE producto_id = ? AND almacen_id = ?',
          [cantNum, costoNum, prod.id, alm.id]
        );
      } else {
        await conn.query(
          'INSERT INTO maquicombus_inventario (producto_id, almacen_id, stock_fisico, costo_promedio) VALUES (?, ?, ?, ?)',
          [prod.id, alm.id, cantNum, costoNum]
        );
      }

      const [[saldo]] = await conn.query(
        'SELECT stock_fisico, (stock_fisico * costo_promedio) as val, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?',
        [prod.id, alm.id]
      );

      const year = new Date(r.fecha).getFullYear();
      const [[{ max }]] = await conn.query(
        "SELECT MAX(CAST(SUBSTRING(numero_documento, 9) AS UNSIGNED)) as max FROM maquicombus_kardex WHERE numero_documento LIKE ?",
        [`SI-${year}-%`]
      );
      const numDoc = `SI-${year}-${String((max || 0) + 1).padStart(5, '0')}`;

      await conn.query(
        `INSERT INTO maquicombus_kardex (producto_id, almacen_id, fecha, tipo_documento, numero_documento, movimiento, cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario, usuario_id)
         VALUES (?, ?, ?, 'SALDO_INICIAL', ?, 'entrada', ?, ?, ?, ?, ?, ?, ?)`,
        [prod.id, alm.id, r.fecha, numDoc, cantNum, costoNum, valorTot, saldo.stock_fisico, saldo.val, saldo.costo_promedio, req.user.id]
      );

      resultados.push({ ...r, producto: prod.descripcion, producto_archivo: prodArchivo, almacen_nombre: alm.nombre, numero: numDoc, estado: 'importado', mensaje: numDoc });
      importados++;
    }

    await conn.query(
      'INSERT INTO maquicombus_importaciones_saldo (usuario_id, archivo_nombre, total, importados, omitidos, errores) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, archivo_nombre || 'sin nombre', registros.length, importados, omitidos, errores]
    );

    await conn.commit();
    res.json({ importados, omitidos, errores, total: registros.length, resultados });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error en la importación: ' + err.message });
  } finally {
    conn.release();
  }
});

// POST /api/kardex/saldo-inicial
router.post('/saldo-inicial', async (req, res) => {
  const { producto_id, almacen_id, fecha, cantidad, costo_unitario, nro_factura } = req.body;
  if (!producto_id || !almacen_id || !fecha || !cantidad || !costo_unitario) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const cantNum  = parseFloat(cantidad);
    const costoNum = parseFloat(costo_unitario);
    const valorTot = cantNum * costoNum;

    // Verificar si ya existe un saldo inicial para este producto+almacén
    const [[existe]] = await conn.query(
      "SELECT id FROM maquicombus_kardex WHERE tipo_documento = 'SALDO_INICIAL' AND producto_id = ? AND almacen_id = ?",
      [producto_id, almacen_id]
    );
    if (existe) {
      await conn.rollback();
      return res.status(409).json({ error: 'Ya existe un saldo inicial para este producto en ese almacén. Elimínelo antes de crear uno nuevo.' });
    }

    // Insertar/actualizar inventario
    const [[inv]] = await conn.query(
      'SELECT id FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?',
      [producto_id, almacen_id]
    );
    if (inv) {
      await conn.query(
        'UPDATE maquicombus_inventario SET stock_fisico = stock_fisico + ?, costo_promedio = ? WHERE producto_id = ? AND almacen_id = ?',
        [cantNum, costoNum, producto_id, almacen_id]
      );
    } else {
      await conn.query(
        'INSERT INTO maquicombus_inventario (producto_id, almacen_id, stock_fisico, costo_promedio) VALUES (?, ?, ?, ?)',
        [producto_id, almacen_id, cantNum, costoNum]
      );
    }

    // Leer saldo actualizado
    const [[saldo]] = await conn.query(
      'SELECT stock_fisico, (stock_fisico * costo_promedio) as val, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?',
      [producto_id, almacen_id]
    );

    const year = new Date(fecha).getFullYear();
    const [[{ max }]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(numero_documento, 9) AS UNSIGNED)) as max FROM maquicombus_kardex WHERE numero_documento LIKE ?`,
      [`SI-${year}-%`]
    );
    const numDoc = `SI-${year}-${String((max || 0) + 1).padStart(5, '0')}`;

    const nroFact = String(nro_factura || '').trim() || null;
    await conn.query(
      `INSERT INTO maquicombus_kardex (producto_id, almacen_id, fecha, tipo_documento, numero_documento, movimiento, cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario, usuario_id, nro_factura)
       VALUES (?, ?, ?, 'SALDO_INICIAL', ?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [producto_id, almacen_id, fecha, numDoc, cantNum, costoNum, valorTot, saldo.stock_fisico, saldo.val, saldo.costo_promedio, req.user.id, nroFact]
    );

    // Registrar también en el listado de Saldos Iniciales
    const [[prodInfo]] = await conn.query('SELECT sku, descripcion FROM maquicombus_productos WHERE id = ?', [producto_id]);
    const [[almInfo]]  = await conn.query('SELECT nombre FROM maquicombus_almacenes WHERE id = ?', [almacen_id]);
    await conn.query(
      `INSERT INTO maquicombus_saldos_iniciales
         (numeracion, codigo_producto, sku, descripcion_producto, almacen, fecha, documento, cantidad, costo_unitario, costo_total, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numDoc,
        `PROD${String(producto_id).padStart(5, '0')}`,
        prodInfo?.sku || null,
        prodInfo?.descripcion || null,
        almInfo?.nombre || null,
        fecha,
        nroFact,
        cantNum, costoNum, valorTot, req.user.id,
      ]
    );

    await conn.commit();
    res.status(201).json({ message: 'Saldo inicial registrado', numero: numDoc });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al registrar saldo inicial' });
  } finally {
    conn.release();
  }
});

// POST /api/erp_kardex/ajuste - ajuste manual de erp_inventario
router.post('/ajuste', async (req, res) => {
  const { producto_id, almacen_id, tipo, cantidad, costo_unitario, motivo } = req.body;
  if (!producto_id || !almacen_id || !tipo || !cantidad) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assertPeriodoAbierto(conn, new Date().toISOString().slice(0, 10));

    const [[inv]] = await conn.query(
      'SELECT stock_fisico, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?',
      [producto_id, almacen_id]
    );

    const stockActual = inv ? parseFloat(inv.stock_fisico) : 0;
    const costoActual = inv ? parseFloat(inv.costo_promedio) : (parseFloat(costo_unitario) || 0);
    const cantidadNum = parseFloat(cantidad);
    const costoNum = parseFloat(costo_unitario) || costoActual;

    let newStock;
    let movimiento;
    let tipoDoc;
    if (tipo === 'positivo') {
      newStock = stockActual + cantidadNum;
      movimiento = 'entrada';
      tipoDoc = 'AJUSTE_POS';
    } else {
      if (stockActual < cantidadNum) {
        await conn.rollback();
        return res.status(400).json({ error: 'Stock insuficiente para ajuste negativo' });
      }
      newStock = stockActual - cantidadNum;
      movimiento = 'salida';
      tipoDoc = 'AJUSTE_NEG';
    }

    const newCosto = newStock > 0
      ? tipo === 'positivo'
        ? ((stockActual * costoActual) + (cantidadNum * costoNum)) / newStock
        : costoActual
      : 0;

    if (inv) {
      await conn.query('UPDATE maquicombus_inventario SET stock_fisico = ?, costo_promedio = ? WHERE producto_id = ? AND almacen_id = ?', [newStock, newCosto, producto_id, almacen_id]);
    } else {
      await conn.query('INSERT INTO maquicombus_inventario (producto_id, almacen_id, stock_fisico, costo_promedio) VALUES (?, ?, ?, ?)', [producto_id, almacen_id, newStock, newCosto]);
    }

    const year = new Date().getFullYear();
    const [[{ max }]] = await conn.query(`SELECT MAX(CAST(SUBSTRING(numero_documento, 10) AS UNSIGNED)) as max FROM maquicombus_kardex WHERE numero_documento LIKE ?`, [`AJU-${year}-%`]);
    const numDoc = `AJU-${year}-${String((max || 0) + 1).padStart(5, '0')}`;

    await conn.query(
      `INSERT INTO maquicombus_kardex (producto_id, almacen_id, fecha, tipo_documento, numero_documento, movimiento, cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario, usuario_id)
       VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [producto_id, almacen_id, tipoDoc, `${numDoc} - ${motivo || 'Ajuste manual'}`, movimiento, cantidadNum, costoNum, cantidadNum * costoNum, newStock, newStock * newCosto, newCosto, req.user.id]
    );

    await conn.commit();
    res.json({ message: 'Ajuste registrado', stock_nuevo: newStock });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al registrar ajuste' });
  } finally {
    conn.release();
  }
});

// DELETE /api/kardex/:id — elimina un registro SALDO_INICIAL y revierte inventario
router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[k]] = await conn.query('SELECT * FROM maquicombus_kardex WHERE id = ?', [req.params.id]);
    if (!k) { await conn.rollback(); return res.status(404).json({ error: 'Registro no encontrado' }); }
    if (k.tipo_documento !== 'SALDO_INICIAL') {
      await conn.rollback();
      return res.status(409).json({ error: 'Solo se pueden eliminar registros de tipo SALDO_INICIAL' });
    }
    if (k.cierre_periodo_id) {
      await conn.rollback();
      return res.status(409).json({ error: 'Este saldo inicial fue generado automáticamente al cerrar un período y no se puede eliminar directamente. Para revertirlo, reabra ese período de cierre.' });
    }

    // Revertir inventario
    await conn.query(
      'UPDATE maquicombus_inventario SET stock_fisico = GREATEST(0, stock_fisico - ?) WHERE producto_id = ? AND almacen_id = ?',
      [k.cantidad, k.producto_id, k.almacen_id]
    );

    await conn.query('DELETE FROM maquicombus_kardex WHERE id = ?', [req.params.id]);
    await conn.commit();
    res.json({ message: 'Saldo inicial eliminado' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar' });
  } finally {
    conn.release();
  }
});

module.exports = router;
