const router = require('../router').Router();

// El selector de factura de diésel puede devolver "si-<id kardex>" para una factura que viene
// de un Saldo Inicial. Devuelve ese id de kardex o null si es una factura normal.
const siKardexId = (v) => { const m = /^si-(\d+)$/i.exec(String(v ?? '')); return m ? parseInt(m[1]) : null; };
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { assertPeriodoAbierto } = require('../services/cierrePeriodo');
const { registrarAuditoria, getClientIP } = require('../middleware/audit');

router.use(authMiddleware);

// Contraseña de confirmación requerida para revertir una salida (misma clave usada
// para otras operaciones sensibles del sistema, p.ej. Trans-Almacenes y Cierre de Período).
const PASSWORD_CONFIRMACION_REVERSION_SALIDA = '@ayala.com';

async function generarNumero() {
  const year = new Date().getFullYear();
  const [[{ max }]] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(numero, 10) AS UNSIGNED)) as max FROM maquicombus_salidas WHERE numero LIKE ?`,
    [`SAL-${year}-%`]
  );
  return `SAL-${year}-${String((max || 0) + 1).padStart(5, '0')}`;
}

// Orden de salida de reserva: correlativo automático alfanumérico OSR-AAAA-00001.
async function generarNumeroOrdenReserva(db) {
  const year = new Date().getFullYear();
  const [[{ max }]] = await db.query(
    `SELECT MAX(CAST(SUBSTRING(orden_salida_reserva, 10) AS UNSIGNED)) as max FROM maquicombus_salidas WHERE orden_salida_reserva LIKE ?`,
    [`OSR-${year}-%`]
  );
  return `OSR-${year}-${String((max || 0) + 1).padStart(5, '0')}`;
}

// Vale de diésel: correlativo propio por línea (no por año), tipo SAL1-00000001.
async function generarNumeroValeDiesel(conn) {
  const [[{ max }]] = await conn.query(
    `SELECT MAX(CAST(SUBSTRING(vale_diesel_numero, 6) AS UNSIGNED)) as max FROM maquicombus_salida_detalles WHERE vale_diesel_numero LIKE 'SAL1-%'`
  );
  return `SAL1-${String((max || 0) + 1).padStart(8, '0')}`;
}

// Resuelve un centro de costo a partir del texto ingresado libremente en la salida:
// si ya existe uno con ese código o nombre lo reutiliza, si no lo crea al vuelo.
async function resolverCentroCosto(conn, textoIngresado, cache) {
  const texto = (textoIngresado || '').trim();
  if (!texto) return null;
  const key = texto.toUpperCase();
  if (cache.has(key)) return cache.get(key);

  const [[existente]] = await conn.query(
    'SELECT id FROM maquicombus_centros_costo WHERE UPPER(codigo) = ? OR UPPER(nombre) = ? LIMIT 1',
    [key, key]
  );
  if (existente) {
    cache.set(key, existente.id);
    return existente.id;
  }

  try {
    const [result] = await conn.query(
      'INSERT INTO maquicombus_centros_costo (codigo, nombre) VALUES (?, ?)',
      [texto.slice(0, 20), texto]
    );
    cache.set(key, result.insertId);
    return result.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [[row]] = await conn.query('SELECT id FROM maquicombus_centros_costo WHERE UPPER(codigo) = ? OR UPPER(nombre) = ? LIMIT 1', [key, key]);
      if (row) { cache.set(key, row.id); return row.id; }
    }
    throw err;
  }
}

router.get('/', async (req, res) => {
  try {
    const { search, almacen_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params = [];
    if (search)     { where += ' AND (s.numero LIKE ? OR s.solicitante LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (almacen_id) { where += ' AND s.almacen_id = ?'; params.push(almacen_id); }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM maquicombus_salidas s ${where}`, params);
    const [rows] = await pool.query(
      `SELECT s.*, a.nombre as almacen_nombre, cc.nombre as centro_costo_nombre,
              u.nombre as usuario_nombre, ua.nombre as anulada_por_nombre
       FROM maquicombus_salidas s
       JOIN maquicombus_almacenes a ON s.almacen_id = a.id
       LEFT JOIN maquicombus_centros_costo cc ON s.centro_costo_id = cc.id
       LEFT JOIN maquicombus_usuarios u ON s.usuario_id = u.id
       LEFT JOIN maquicombus_usuarios ua ON s.anulada_por = ua.id
       ${where} ORDER BY s.fecha DESC, s.id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener erp_salidas' });
  }
});

// GET /api/salidas/siguiente-numero (vista previa, no reserva el número)
router.get('/siguiente-numero', async (req, res) => {
  try {
    res.json({ numero: await generarNumero(), orden_reserva: await generarNumeroOrdenReserva(pool) });
  } catch (err) {
    res.status(500).json({ error: 'Error al calcular el siguiente número' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, a.nombre as almacen_nombre, cc.nombre as centro_costo_nombre,
              ua.nombre as anulada_por_nombre
       FROM maquicombus_salidas s
       JOIN maquicombus_almacenes a ON s.almacen_id = a.id
       LEFT JOIN maquicombus_centros_costo cc ON s.centro_costo_id = cc.id
       LEFT JOIN maquicombus_usuarios ua ON s.anulada_por = ua.id
       WHERE s.id = ?`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Salida no encontrada' });
    const [detalles] = await pool.query(
      `SELECT sd.*, p.sku, p.descripcion as producto_descripcion, um.codigo as unidad,
              cc.codigo as centro_costo_codigo, cc.nombre as centro_costo_nombre,
              pl.placa,
              pv.placa as placa_vehiculo,
              f.serie as factura_serie, f.numero as factura_numero,
              oc.numero as oc_numero, rv.nro_factura as reserva_factura,
              COALESCE(
                (SELECT ksel.nro_factura FROM maquicombus_kardex ksel WHERE ksel.id = sd.saldo_inicial_kardex_id),
                (SELECT ksi.nro_factura FROM maquicombus_kardex ksi
                  WHERE ksi.tipo_documento = 'SALDO_INICIAL' AND ksi.producto_id = sd.producto_id
                    AND ksi.almacen_id = (SELECT almacen_id FROM maquicombus_salidas WHERE id = sd.salida_id) AND ksi.nro_factura IS NOT NULL
                  ORDER BY ksi.id LIMIT 1)
              ) as saldo_inicial_factura
       FROM maquicombus_salida_detalles sd
       LEFT JOIN maquicombus_reservas rv ON sd.reserva_id = rv.id
       JOIN maquicombus_productos p ON sd.producto_id = p.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       LEFT JOIN maquicombus_centros_costo cc ON sd.centro_costo_id = cc.id
       LEFT JOIN maquicombus_equipos_placas pl ON sd.placa_id = pl.id
       LEFT JOIN maquicombus_equipos_placas pv ON sd.placa_vehiculo_id = pv.id
       LEFT JOIN maquicombus_facturas f ON sd.factura_id = f.id
       LEFT JOIN maquicombus_ordenes_compra oc ON f.orden_compra_id = oc.id
       WHERE sd.salida_id = ?`, [req.params.id]
    );
    res.json({ ...rows[0], detalles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la salida' });
  }
});

router.post('/', async (req, res) => {
  const { almacen_id, fecha, motivo, solicitante, observaciones, detalles } = req.body;
  const esReserva = req.body.tipo_salida === 'reserva';
  let ordenSalidaReserva = null; // se autogenera dentro de la transacción
  if (!almacen_id || !fecha || !detalles?.length)
    return res.status(400).json({ error: 'Almacén, fecha y al menos un producto son requeridos' });
  if (esReserva && detalles.some(d => d.producto_id && d.cantidad && d.es_diesel && (!d.horometro || !d.fecha_abastecimiento || !d.placa_vehiculo_id)))
    return res.status(400).json({ error: 'Para abastecer un vehículo se requiere horómetro, fecha de abastecimiento y vehículo' });
  if (esReserva && detalles.some(d => d.producto_id && d.cantidad && !d.reserva_id))
    return res.status(400).json({ error: 'Cada producto de una salida de RESERVA debe indicar la reserva (factura) de la que sale' });
  if (detalles.some(d => d.producto_id && d.cantidad && !d.centro_costo_codigo?.trim()))
    return res.status(400).json({ error: 'El centro de costo es requerido para cada producto' });
  if (!esReserva && detalles.some(d => d.producto_id && d.cantidad && d.es_diesel &&
      (!d.horometro || !d.fecha_abastecimiento || !d.placa_vehiculo_id || !d.factura_id)))
    return res.status(400).json({ error: 'Para diésel se requiere horómetro, fecha de abastecimiento, vehículo y factura' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assertPeriodoAbierto(conn, fecha);
    const numero = await generarNumero();
    if (esReserva) ordenSalidaReserva = await generarNumeroOrdenReserva(conn);
    const centrosCostoCache = new Map();
    const consumoFacturaEnCurso = new Map();

    const [result] = await conn.query(
      `INSERT INTO maquicombus_salidas (numero, almacen_id, fecha, motivo, solicitante, observaciones, usuario_id, tipo_salida, orden_salida_reserva)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero, almacen_id, fecha, motivo || null, solicitante || null, observaciones || null, req.user.id, esReserva ? 'reserva' : 'consumo', esReserva ? ordenSalidaReserva : null]
    );

    for (const d of detalles) {
      if (!d.producto_id || !d.cantidad) continue;
      const cant = parseFloat(d.cantidad);
      const centroCostoId = await resolverCentroCosto(conn, d.centro_costo_codigo, centrosCostoCache);

      let placa = null;
      if (d.placa_id) {
        const [[pl]] = await conn.query('SELECT * FROM maquicombus_equipos_placas WHERE id = ?', [d.placa_id]);
        if (!pl) {
          await conn.rollback();
          return res.status(400).json({ error: 'La placa/código seleccionada no existe' });
        }
        if (pl.estado !== 'disponible') {
          await conn.rollback();
          return res.status(400).json({ error: `La placa/código "${pl.placa}" no está disponible` });
        }
        placa = pl;
      }

      // FOR UPDATE bloquea la fila para que dos salidas concurrentes del mismo producto/almacén
      // no lean el mismo stock "viejo" y una termine pisando el descuento de la otra.
      const [[inv]] = await conn.query(
        'SELECT stock_fisico, stock_reservado, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ? FOR UPDATE',
        [d.producto_id, almacen_id]
      );
      if (!inv) {
        await conn.rollback();
        const [[prod]] = await conn.query('SELECT descripcion FROM maquicombus_productos WHERE id = ?', [d.producto_id]);
        return res.status(400).json({ error: `No hay inventario registrado para "${prod?.descripcion || 'producto'}" en este almacén` });
      }

      let valeDieselNumero = null;
      if (esReserva) {
        // Salida de RESERVA: sale del saldo de la reserva (factura) elegida, no del stock de consumo.
        const [[rv]] = await conn.query('SELECT * FROM maquicombus_reservas WHERE id = ? FOR UPDATE', [d.reserva_id]);
        if (!rv || String(rv.producto_id) !== String(d.producto_id) || String(rv.almacen_id) !== String(almacen_id)) {
          await conn.rollback();
          return res.status(400).json({ error: 'La reserva seleccionada no corresponde al producto/almacén de la salida' });
        }
        const saldoReserva = parseFloat(rv.cantidad) - parseFloat(rv.cantidad_salida);
        if (saldoReserva < cant) {
          await conn.rollback();
          return res.status(400).json({ error: `Saldo insuficiente en la reserva de la factura ${rv.nro_factura || rv.id} (disponible: ${saldoReserva.toFixed(2)})` });
        }
        if (parseFloat(inv.stock_fisico) < cant) {
          await conn.rollback();
          return res.status(400).json({ error: 'Stock físico insuficiente en el almacén para esta reserva' });
        }
        await conn.query('UPDATE maquicombus_reservas SET cantidad_salida = cantidad_salida + ? WHERE id = ?', [cant, d.reserva_id]);
        if (d.es_diesel) {
          const [[vehiculo]] = await conn.query('SELECT id FROM maquicombus_equipos_placas WHERE id = ?', [d.placa_vehiculo_id]);
          if (!vehiculo) {
            await conn.rollback();
            return res.status(400).json({ error: 'El vehículo/placa seleccionado no existe' });
          }
          valeDieselNumero = await generarNumeroValeDiesel(conn);
        }
      } else if (d.es_diesel && siKardexId(d.factura_id)) {
        // Factura que proviene de un Saldo Inicial (no existe como factura/OC): el saldo es
        // lo ingresado en el saldo inicial menos lo ya despachado contra ese saldo.
        const kid = siKardexId(d.factura_id);
        const [[si]] = await conn.query(
          "SELECT id, cantidad, producto_id, almacen_id FROM maquicombus_kardex WHERE id = ? AND tipo_documento = 'SALDO_INICIAL'", [kid]
        );
        if (!si || String(si.producto_id) !== String(d.producto_id) || String(si.almacen_id) !== String(almacen_id)) {
          await conn.rollback();
          return res.status(400).json({ error: 'La factura del saldo inicial no corresponde al producto/almacén de la salida' });
        }
        const [[{ despachado }]] = await conn.query(
          'SELECT COALESCE(SUM(cantidad), 0) AS despachado FROM maquicombus_salida_detalles WHERE es_diesel = 1 AND saldo_inicial_kardex_id = ?', [kid]
        );
        const yaConsumidoEnEstaSalida = consumoFacturaEnCurso.get(d.factura_id) || 0;
        const saldoDisponible = parseFloat(si.cantidad) - parseFloat(despachado) - yaConsumidoEnEstaSalida;
        if (saldoDisponible < cant) {
          await conn.rollback();
          return res.status(400).json({ error: `Saldo insuficiente en la factura del saldo inicial (disponible: ${saldoDisponible.toFixed(2)})` });
        }
        consumoFacturaEnCurso.set(d.factura_id, yaConsumidoEnEstaSalida + cant);
        const [[vehiculo]] = await conn.query('SELECT id FROM maquicombus_equipos_placas WHERE id = ?', [d.placa_vehiculo_id]);
        if (!vehiculo) {
          await conn.rollback();
          return res.status(400).json({ error: 'El vehículo/placa seleccionado para el diésel no existe' });
        }
        const dispAlmacen = parseFloat(inv.stock_fisico) - parseFloat(inv.stock_reservado || 0);
        if (dispAlmacen < cant) {
          await conn.rollback();
          return res.status(400).json({ error: `Stock insuficiente en el almacén (disponible en este almacén: ${dispAlmacen.toFixed(2)})` });
        }
        valeDieselNumero = await generarNumeroValeDiesel(conn);
      } else if (d.es_diesel) {
        const [[factura]] = await conn.query(
          `SELECT f.id, COALESCE(oc.es_reserva, 0) AS es_reserva FROM maquicombus_facturas f
           LEFT JOIN maquicombus_ordenes_compra oc ON f.orden_compra_id = oc.id WHERE f.id = ?`, [d.factura_id]
        );
        if (factura && factura.es_reserva) {
          await conn.rollback();
          return res.status(400).json({ error: 'Esa factura es de RESERVA: use una salida de tipo RESERVA' });
        }
        if (!factura) {
          await conn.rollback();
          return res.status(400).json({ error: 'La factura seleccionada para el diésel no existe' });
        }
        const [[vehiculo]] = await conn.query('SELECT id FROM maquicombus_equipos_placas WHERE id = ?', [d.placa_vehiculo_id]);
        if (!vehiculo) {
          await conn.rollback();
          return res.status(400).json({ error: 'El vehículo/placa seleccionado para el diésel no existe' });
        }

        // Para diésel el disponible se valida contra el saldo de la factura elegida
        // (lo recibido en su OC menos lo ya despachado en vales que la referencian),
        // no contra el stock general del almacén.
        const [[saldoFactura]] = await conn.query(
          `SELECT
             COALESCE(ocd.cantidad_recibida, 0) as cantidad_recibida,
             COALESCE(desp.despachado, 0) as despachado
           FROM maquicombus_facturas f
           LEFT JOIN (
             SELECT orden_compra_id, SUM(cantidad_recibida) as cantidad_recibida
             FROM maquicombus_orden_compra_detalles WHERE producto_id = ? GROUP BY orden_compra_id
           ) ocd ON ocd.orden_compra_id = f.orden_compra_id
           LEFT JOIN (
             SELECT factura_id, SUM(cantidad) as despachado
             FROM maquicombus_salida_detalles WHERE es_diesel = 1 AND producto_id = ? GROUP BY factura_id
           ) desp ON desp.factura_id = f.id
           WHERE f.id = ?`,
          [d.producto_id, d.producto_id, d.factura_id]
        );
        const yaConsumidoEnEstaSalida = consumoFacturaEnCurso.get(d.factura_id) || 0;
        const saldoDisponible = parseFloat(saldoFactura?.cantidad_recibida || 0) - parseFloat(saldoFactura?.despachado || 0) - yaConsumidoEnEstaSalida;
        if (saldoDisponible < cant) {
          await conn.rollback();
          const [[prod]] = await conn.query('SELECT descripcion FROM maquicombus_productos WHERE id = ?', [d.producto_id]);
          return res.status(400).json({ error: `Saldo insuficiente en la factura seleccionada para "${prod?.descripcion || 'producto'}" (disponible: ${saldoDisponible.toFixed(2)})` });
        }
        consumoFacturaEnCurso.set(d.factura_id, yaConsumidoEnEstaSalida + cant);

        // El diésel de consumo sale del stock del almacén elegido, sin tocar lo reservado.
        const dispAlmacen = parseFloat(inv.stock_fisico) - parseFloat(inv.stock_reservado || 0);
        if (dispAlmacen < cant) {
          await conn.rollback();
          const [[prod]] = await conn.query('SELECT descripcion FROM maquicombus_productos WHERE id = ?', [d.producto_id]);
          return res.status(400).json({ error: `Stock insuficiente en el almacén para "${prod?.descripcion || 'producto'}" (disponible en este almacén: ${dispAlmacen.toFixed(2)})` });
        }

        valeDieselNumero = await generarNumeroValeDiesel(conn);
      } else {
        const disponible = parseFloat(inv.stock_fisico) - parseFloat(inv.stock_reservado || 0);
        if (disponible < cant) {
          await conn.rollback();
          const [[prod]] = await conn.query('SELECT descripcion FROM maquicombus_productos WHERE id = ?', [d.producto_id]);
          return res.status(400).json({ error: `Stock insuficiente para "${prod?.descripcion || 'producto'}" (disponible: ${disponible.toFixed(2)})` });
        }
      }

      const cu = parseFloat(inv.costo_promedio);
      const newStock = parseFloat(inv.stock_fisico) - cant;

      await conn.query(
        `UPDATE maquicombus_inventario SET stock_fisico = ?${esReserva ? ', stock_reservado = GREATEST(stock_reservado - ?, 0)' : ''} WHERE producto_id = ? AND almacen_id = ?`,
        esReserva ? [newStock, cant, d.producto_id, almacen_id] : [newStock, d.producto_id, almacen_id]
      );

      await conn.query(
        `INSERT INTO maquicombus_salida_detalles
          (salida_id, producto_id, centro_costo_id, placa_id, cantidad, costo_unitario, valor_total,
           es_diesel, vale_diesel_numero, factura_id, placa_vehiculo_id, horometro, fecha_abastecimiento, reserva_id, saldo_inicial_kardex_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, d.producto_id, centroCostoId, d.placa_id || null, cant, cu, cant * cu,
         !!d.es_diesel, valeDieselNumero, (d.es_diesel && !esReserva && !siKardexId(d.factura_id)) ? d.factura_id : null, d.es_diesel ? d.placa_vehiculo_id : null,
         d.es_diesel ? d.horometro : null, d.es_diesel ? d.fecha_abastecimiento : null, esReserva ? d.reserva_id : null,
         (d.es_diesel && !esReserva) ? siKardexId(d.factura_id) : null]
      );

      if (placa) {
        await conn.query("UPDATE maquicombus_equipos_placas SET estado = 'en_uso' WHERE id = ?", [placa.id]);
      }

      await conn.query(
        `INSERT INTO maquicombus_kardex (producto_id, almacen_id, centro_costo_id, fecha, tipo_documento, numero_documento,
          referencia_id, movimiento, cantidad, costo_unitario, valor_total,
          saldo_cantidad, saldo_valor, saldo_costo_unitario, usuario_id, tipo_stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'salida', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.producto_id, almacen_id, centroCostoId, fecha, esReserva ? 'SALIDA_RESERVA' : 'SALIDA_CONSUMO', numero, result.insertId,
         cant, cu, cant * cu, newStock, newStock * cu, newStock > 0 ? cu : 0, req.user.id, esReserva ? 'reserva' : 'consumo']
      );
    }

    await conn.commit();
    const [newRow] = await pool.query(
      `SELECT s.*, a.nombre as almacen_nombre FROM maquicombus_salidas s JOIN maquicombus_almacenes a ON s.almacen_id = a.id WHERE s.id = ?`,
      [result.insertId]
    );
    res.status(201).json(newRow[0]);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al registrar salida' });
  } finally {
    conn.release();
  }
});

// Revierte una salida ya emitida: restaura el stock, libera placas/equipos y quita el
// rastro en Kardex, dejando el inventario tal como estaba antes de emitirla. A diferencia
// de antes, la salida y sus detalles YA NO se borran: se marcan como anuladas para que
// queden visibles (resaltadas) en el listado, con quién y cuándo la revirtió, y puedan
// des-anularse (ver POST /:id/anular-reversion) si la reversión fue un error.
router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (req.body.password !== PASSWORD_CONFIRMACION_REVERSION_SALIDA) {
      await conn.rollback();
      return res.status(403).json({ error: 'Contraseña de confirmación incorrecta' });
    }

    const [[sal]] = await conn.query(
      `SELECT s.*, a.nombre AS almacen_nombre, cc.nombre AS centro_costo_nombre
       FROM maquicombus_salidas s
       JOIN maquicombus_almacenes a ON s.almacen_id = a.id
       LEFT JOIN maquicombus_centros_costo cc ON s.centro_costo_id = cc.id
       WHERE s.id = ?`, [req.params.id]
    );
    if (!sal) { await conn.rollback(); return res.status(404).json({ error: 'Salida no encontrada' }); }
    if (sal.anulada) { await conn.rollback(); return res.status(400).json({ error: 'La salida ya fue revertida' }); }
    await assertPeriodoAbierto(conn, sal.fecha);

    const { rol, almacen_id: userAlmacenId } = req.user;
    const esPropioAlmacen = userAlmacenId && String(userAlmacenId) === String(sal.almacen_id);
    if (rol !== 'admin' && rol !== 'gerente' && !esPropioAlmacen) {
      await conn.rollback();
      return res.status(403).json({ error: 'No puedes revertir una salida de otro almacén' });
    }

    // Detalles con datos descriptivos (sku, producto, centro de costo, unidad) para dejar
    // una foto completa en la auditoría.
    const [detalles] = await conn.query(
      `SELECT sd.*, p.sku, p.descripcion AS producto_descripcion, um.codigo AS unidad,
              cc.nombre AS centro_costo_nombre, pl.placa
       FROM maquicombus_salida_detalles sd
       JOIN maquicombus_productos p ON sd.producto_id = p.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       LEFT JOIN maquicombus_centros_costo cc ON sd.centro_costo_id = cc.id
       LEFT JOIN maquicombus_equipos_placas pl ON sd.placa_id = pl.id
       WHERE sd.salida_id = ?`, [req.params.id]
    );

    for (const d of detalles) {
      await conn.query(
        'UPDATE maquicombus_inventario SET stock_fisico = stock_fisico + ? WHERE producto_id = ? AND almacen_id = ?',
        [d.cantidad, d.producto_id, sal.almacen_id]
      );
      if (d.reserva_id) {
        await conn.query('UPDATE maquicombus_inventario SET stock_reservado = stock_reservado + ? WHERE producto_id = ? AND almacen_id = ?', [d.cantidad, d.producto_id, sal.almacen_id]);
        await conn.query('UPDATE maquicombus_reservas SET cantidad_salida = GREATEST(cantidad_salida - ?, 0) WHERE id = ?', [d.cantidad, d.reserva_id]);
      }
      if (d.placa_id) {
        await conn.query("UPDATE maquicombus_equipos_placas SET estado = 'disponible' WHERE id = ?", [d.placa_id]);
      }
    }

    await conn.query("DELETE FROM maquicombus_kardex WHERE referencia_id = ? AND tipo_documento IN ('SALIDA_CONSUMO','SALIDA_RESERVA')", [req.params.id]);
    await conn.query(
      'UPDATE maquicombus_salidas SET anulada = TRUE, anulada_en = NOW(), anulada_por = ? WHERE id = ?',
      [req.user.id, req.params.id]
    );

    await conn.commit();

    await registrarAuditoria({
      usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req),
      modulo: 'salidas', accion: 'revertir', tabla: 'maquicombus_salidas', registroId: sal.id,
      valorAnterior: { salida: sal, detalles },
    });

    res.json({ message: 'Salida revertida: stock restaurado a su estado anterior' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al revertir la salida' });
  } finally {
    conn.release();
  }
});

// Anula la reversión de una salida (deshace el DELETE anterior): vuelve a descontar el
// stock, vuelve a poner en uso las placas/equipos, recrea el movimiento en Kardex y quita
// la marca de anulada, dejando la salida activa otra vez.
router.post('/:id/anular-reversion', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (req.body.password !== PASSWORD_CONFIRMACION_REVERSION_SALIDA) {
      await conn.rollback();
      return res.status(403).json({ error: 'Contraseña de confirmación incorrecta' });
    }

    const [[sal]] = await conn.query('SELECT * FROM maquicombus_salidas WHERE id = ?', [req.params.id]);
    if (!sal) { await conn.rollback(); return res.status(404).json({ error: 'Salida no encontrada' }); }
    if (!sal.anulada) { await conn.rollback(); return res.status(400).json({ error: 'La salida no está revertida' }); }
    await assertPeriodoAbierto(conn, sal.fecha);

    const { rol, almacen_id: userAlmacenId } = req.user;
    const esPropioAlmacen = userAlmacenId && String(userAlmacenId) === String(sal.almacen_id);
    if (rol !== 'admin' && rol !== 'gerente' && !esPropioAlmacen) {
      await conn.rollback();
      return res.status(403).json({ error: 'No puedes anular la reversión de una salida de otro almacén' });
    }

    const [detalles] = await conn.query(
      `SELECT sd.*, p.descripcion AS producto_descripcion
       FROM maquicombus_salida_detalles sd
       JOIN maquicombus_productos p ON sd.producto_id = p.id
       WHERE sd.salida_id = ?`, [req.params.id]
    );

    for (const d of detalles) {
      // FOR UPDATE evita que otra salida concurrente descuente sobre el mismo stock
      // que aquí se vuelve a comprometer.
      const [[inv]] = await conn.query(
        'SELECT stock_fisico, stock_reservado FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ? FOR UPDATE',
        [d.producto_id, sal.almacen_id]
      );
      // Las salidas de reserva salen del stock reservado (ya comprometido), no del disponible.
      const disponible = inv ? parseFloat(inv.stock_fisico) - (d.reserva_id ? 0 : parseFloat(inv.stock_reservado || 0)) : 0;
      if (!inv || disponible < parseFloat(d.cantidad)) {
        await conn.rollback();
        return res.status(400).json({ error: `Stock insuficiente para anular la reversión de "${d.producto_descripcion}" (disponible: ${disponible.toFixed(2)})` });
      }
      if (d.placa_id) {
        const [[pl]] = await conn.query('SELECT estado FROM maquicombus_equipos_placas WHERE id = ?', [d.placa_id]);
        if (pl && pl.estado !== 'disponible') {
          await conn.rollback();
          return res.status(400).json({ error: 'La placa/código de esta salida ya no está disponible (fue usada en otro movimiento)' });
        }
      }
    }

    for (const d of detalles) {
      const [[inv]] = await conn.query(
        'SELECT stock_fisico FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?',
        [d.producto_id, sal.almacen_id]
      );
      const newStock = parseFloat(inv.stock_fisico) - parseFloat(d.cantidad);
      await conn.query(
        'UPDATE maquicombus_inventario SET stock_fisico = ? WHERE producto_id = ? AND almacen_id = ?',
        [newStock, d.producto_id, sal.almacen_id]
      );
      if (d.reserva_id) {
        await conn.query('UPDATE maquicombus_inventario SET stock_reservado = GREATEST(stock_reservado - ?, 0) WHERE producto_id = ? AND almacen_id = ?', [d.cantidad, d.producto_id, sal.almacen_id]);
        await conn.query('UPDATE maquicombus_reservas SET cantidad_salida = cantidad_salida + ? WHERE id = ?', [d.cantidad, d.reserva_id]);
      }
      if (d.placa_id) {
        await conn.query("UPDATE maquicombus_equipos_placas SET estado = 'en_uso' WHERE id = ?", [d.placa_id]);
      }
      const cu = parseFloat(d.costo_unitario);
      await conn.query(
        `INSERT INTO maquicombus_kardex (producto_id, almacen_id, centro_costo_id, fecha, tipo_documento, numero_documento,
          referencia_id, movimiento, cantidad, costo_unitario, valor_total,
          saldo_cantidad, saldo_valor, saldo_costo_unitario, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'salida', ?, ?, ?, ?, ?, ?, ?)`,
        [d.producto_id, sal.almacen_id, d.centro_costo_id, sal.fecha, d.reserva_id ? 'SALIDA_RESERVA' : 'SALIDA_CONSUMO', sal.numero, sal.id,
         d.cantidad, cu, d.cantidad * cu, newStock, newStock * cu, newStock > 0 ? cu : 0, req.user.id]
      );
    }

    await conn.query(
      'UPDATE maquicombus_salidas SET anulada = FALSE, anulada_en = NULL, anulada_por = NULL WHERE id = ?',
      [req.params.id]
    );

    await conn.commit();

    await registrarAuditoria({
      usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req),
      modulo: 'salidas', accion: 'anular_reversion', tabla: 'maquicombus_salidas', registroId: sal.id,
      valorAnterior: { salida: sal, detalles },
    });

    res.json({ message: 'Reversión anulada: la salida vuelve a estar activa' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al anular la reversión' });
  } finally {
    conn.release();
  }
});

module.exports = router;
