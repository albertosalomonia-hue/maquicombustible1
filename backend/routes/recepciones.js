const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware, requirePrincipalAccess } = require('../middleware/auth');
const { assertPeriodoAbierto } = require('../services/cierrePeriodo');

router.use(authMiddleware);

async function generarNumero() {
  const year = new Date().getFullYear();
  const [[{ max }]] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(numero, 10) AS UNSIGNED)) as max FROM maquicombus_recepciones WHERE numero LIKE ?`,
    [`REC-${year}-%`]
  );
  return `REC-${year}-${String((max || 0) + 1).padStart(5, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { search, estado, fecha_desde, fecha_hasta, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      // Se busca por palabras (separadas por espacios o guiones) en vez de exigir el
      // texto completo tal cual en un solo campo, y se incluye la factura y el
      // proveedor de la OC vinculada (antes solo buscaba por N° de recepción, N° de
      // OC y producto).
      const palabras = String(search).trim().split(/[\s-]+/).filter(Boolean);
      if (palabras.length) {
        where += ' AND ' + palabras.map(() => `(
          r.numero LIKE ? OR oc.numero LIKE ? OR oc.nro_factura LIKE ? OR
          cl.razon_social LIKE ? OR cl.numero_documento LIKE ? OR EXISTS (
            SELECT 1 FROM maquicombus_recepcion_detalles rd
            JOIN maquicombus_productos p ON rd.producto_id = p.id
            WHERE rd.recepcion_id = r.id AND (p.descripcion LIKE ? OR p.sku LIKE ?)
          )
        )`).join(' AND ');
        palabras.forEach(p => { const like = `%${p}%`; params.push(like, like, like, like, like, like, like); });
      }
    }
    if (estado) { where += ' AND r.estado = ?'; params.push(estado); }
    if (fecha_desde) { where += ' AND r.fecha >= ?'; params.push(fecha_desde); }
    if (fecha_hasta) { where += ' AND r.fecha <= ?'; params.push(fecha_hasta); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM maquicombus_recepciones r
       JOIN maquicombus_ordenes_compra oc ON r.orden_compra_id = oc.id
       LEFT JOIN maquicombus_clientes cl ON oc.cliente_id = cl.id
       ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT r.*, oc.numero as oc_numero, oc.id_source as oc_id_source,
              oc.nro_factura as oc_nro_factura, oc.url_factura as oc_url_factura, oc.es_reserva as oc_es_reserva,
              a.nombre as almacen_nombre, a.tipo as almacen_tipo, u.nombre as usuario_nombre,
              (SELECT COALESCE(SUM(rd.cantidad_recibida - rd.cantidad_transferida), 0) <= 0.01
               FROM maquicombus_recepcion_detalles rd WHERE rd.recepcion_id = r.id) as totalmente_transferida
       FROM maquicombus_recepciones r
       JOIN maquicombus_ordenes_compra oc ON r.orden_compra_id = oc.id
       LEFT JOIN maquicombus_clientes cl ON oc.cliente_id = cl.id
       JOIN maquicombus_almacenes a ON r.almacen_destino_id = a.id
       LEFT JOIN maquicombus_usuarios u ON r.usuario_id = u.id
       ${where} ORDER BY r.fecha DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener erp_recepciones' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, oc.numero as oc_numero, oc.nro_factura as oc_nro_factura,
              cc.nombre as centro_costo_nombre, a.nombre as almacen_nombre
       FROM maquicombus_recepciones r
       JOIN maquicombus_ordenes_compra oc ON r.orden_compra_id = oc.id
       LEFT JOIN maquicombus_centros_costo cc ON oc.centro_costo_id = cc.id
       JOIN maquicombus_almacenes a ON r.almacen_destino_id = a.id
       WHERE r.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Recepción no encontrada' });

    // El centro de costo viene de la línea de OC exacta que originó esta recepción
    // (rd.orden_detalle_id), con la OC de la recepción como respaldo si esa línea no
    // quedó enlazada. Antes se calculaba agregando TODAS las OC que alguna vez pidieron
    // el mismo producto, mostrando una mezcla incorrecta.
    const [detalles] = await pool.query(
      `SELECT rd.*, p.sku, p.descripcion as producto_descripcion, um.codigo as unidad,
              COALESCE(cc_linea.nombre, cc_oc.nombre) as centro_costo_nombre
       FROM maquicombus_recepcion_detalles rd
       JOIN maquicombus_productos p ON rd.producto_id = p.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       JOIN maquicombus_recepciones r ON rd.recepcion_id = r.id
       JOIN maquicombus_ordenes_compra oc ON r.orden_compra_id = oc.id
       LEFT JOIN maquicombus_centros_costo cc_oc ON oc.centro_costo_id = cc_oc.id
       LEFT JOIN maquicombus_orden_compra_detalles ocd ON rd.orden_detalle_id = ocd.id
       LEFT JOIN maquicombus_centros_costo cc_linea ON ocd.centro_costo_id = cc_linea.id
       WHERE rd.recepcion_id = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], detalles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la recepción' });
  }
});

// Crea una recepción completa (detalles, inventario, kardex, estado de OC, factura) dentro
// de la transacción `conn` ya abierta por el llamador. Reutilizada por el endpoint individual
// y por la recepción masiva.
async function crearRecepcion(conn, { orden_compra_id, factura_id, almacen_destino_id, fecha, tipo, observaciones, detalles, usuario_id, es_reserva }) {
  await assertPeriodoAbierto(conn, fecha);

  // La ENTRADA va al almacén elegido (central o auxiliar), que debe existir y estar activo.
  const [erp_almacenes] = await conn.query('SELECT tipo, estado FROM maquicombus_almacenes WHERE id = ?', [almacen_destino_id]);
  if (!erp_almacenes.length || erp_almacenes[0].estado !== 'activo') {
    const err = new Error('El almacén seleccionado no existe o no está activo');
    err.status = 400;
    throw err;
  }

  // Despacho: la ENTRADA es de RESERVA o de CONSUMO según la factura (se elige al recepcionar).
  if (typeof es_reserva !== 'boolean') {
    const err = new Error('Seleccione si la entrada es de CONSUMO o de RESERVA');
    err.status = 400;
    throw err;
  }
  const esReserva = es_reserva;

  // La OC "OC-2026-00001" se registra en el Kardex como SALDO_INICIAL en vez de RECEPCION
  const [[ocInfo]] = await conn.query('SELECT numero, nro_factura, es_reserva FROM maquicombus_ordenes_compra WHERE id = ? FOR UPDATE', [orden_compra_id]);
  const tipoDocKardex = ocInfo?.numero === 'OC-2026-00001' ? 'SALDO_INICIAL' : 'RECEPCION';

  // Una misma factura no puede mezclar entradas de CONSUMO y de RESERVA.
  const [[prev]] = await conn.query("SELECT COUNT(*) AS n FROM maquicombus_recepciones WHERE orden_compra_id = ? AND estado <> 'anulada'", [orden_compra_id]);
  if (prev.n > 0 && !!Number(ocInfo.es_reserva) !== esReserva) {
    const err = new Error(`Esta factura ya se recepcionó como ${Number(ocInfo.es_reserva) ? 'RESERVA' : 'CONSUMO'}: no puede mezclarse con ${esReserva ? 'RESERVA' : 'CONSUMO'}`);
    err.status = 400;
    throw err;
  }
  await conn.query('UPDATE maquicombus_ordenes_compra SET es_reserva = ? WHERE id = ?', [esReserva ? 1 : 0, orden_compra_id]);

  const numero = await generarNumero();
  const [result] = await conn.query(
    `INSERT INTO maquicombus_recepciones (numero, orden_compra_id, factura_id, almacen_destino_id, fecha, tipo, observaciones, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [numero, orden_compra_id, factura_id || null, almacen_destino_id, fecha, tipo || 'total', observaciones || null, usuario_id]
  );

  // Una misma línea de OC (orden_detalle_id) no puede recepcionarse dos veces dentro del
  // mismo documento: si llega repetida (p.ej. por líneas de OC que aún estén duplicadas),
  // se conserva una sola vez en vez de duplicar el Kardex y el inventario.
  const detallesUnicos = [];
  const vistos = new Set();
  for (const d of detalles) {
    const clave = d.orden_detalle_id ? `od:${d.orden_detalle_id}` : `p:${d.producto_id}:${d.cantidad_recibida}:${d.precio_unitario}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    detallesUnicos.push(d);
  }

  // Líneas del mismo producto (y mismo lote/serie/vencimiento) dentro de la OC se SUMAN en una sola
  // línea de recepción: los galones pasan como un total, con precio promedio ponderado (el valor
  // total no cambia). Cada línea de OC conserva su propia cantidad recibida (`ordenes`).
  const agrupados = new Map();
  for (const d of detallesUnicos) {
    const clave = [d.producto_id, d.lote || '', d.fecha_vencimiento || '', d.serie_producto || ''].join('|');
    const cant = parseFloat(d.cantidad_recibida) || 0;
    const precio = parseFloat(d.precio_unitario) || 0;
    const g = agrupados.get(clave);
    if (!g) {
      agrupados.set(clave, { ...d, cantidad_recibida: cant, _valor: cant * precio, _precio0: precio, ordenes: d.orden_detalle_id ? [{ id: d.orden_detalle_id, cantidad: cant }] : [] });
    } else {
      g.cantidad_recibida += cant;
      g._valor += cant * precio;
      if (d.orden_detalle_id) g.ordenes.push({ id: d.orden_detalle_id, cantidad: cant });
    }
  }
  const detallesAgrupados = [...agrupados.values()].map(g => {
    const total = +g.cantidad_recibida.toFixed(4);
    return { ...g, cantidad_recibida: total, precio_unitario: total > 0 ? +(g._valor / total).toFixed(4) : g._precio0 };
  });

  for (const d of detallesAgrupados) {
    const [detIns] = await conn.query(
      `INSERT INTO maquicombus_recepcion_detalles (recepcion_id, producto_id, orden_detalle_id, cantidad_recibida, precio_unitario, lote, serie_producto, fecha_vencimiento, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [result.insertId, d.producto_id, d.orden_detalle_id || null, d.cantidad_recibida, d.precio_unitario, d.lote || null, d.serie_producto || null, d.fecha_vencimiento || null, d.observaciones || null]
    );

    // Actualizar erp_inventario (costo promedio ponderado). FOR UPDATE bloquea la fila
    // para que dos recepciones concurrentes del mismo producto/almacén (p.ej. doble envío
    // del formulario) no lean el mismo stock "viejo" y una termine pisando el resultado
    // de la otra en vez de sumarse (lost update).
    const [[inv]] = await conn.query(
      'SELECT stock_fisico, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ? FOR UPDATE',
      [d.producto_id, almacen_destino_id]
    );

    if (inv) {
      const newStock = parseFloat(inv.stock_fisico) + parseFloat(d.cantidad_recibida);
      const newCosto = ((parseFloat(inv.stock_fisico) * parseFloat(inv.costo_promedio)) + (parseFloat(d.cantidad_recibida) * parseFloat(d.precio_unitario))) / newStock;
      await conn.query(
        'UPDATE maquicombus_inventario SET stock_fisico = ?, costo_promedio = ? WHERE producto_id = ? AND almacen_id = ?',
        [newStock, newCosto, d.producto_id, almacen_destino_id]
      );
    } else {
      await conn.query(
        'INSERT INTO maquicombus_inventario (producto_id, almacen_id, stock_fisico, costo_promedio) VALUES (?, ?, ?, ?)',
        [d.producto_id, almacen_destino_id, d.cantidad_recibida, d.precio_unitario]
      );
    }

    // Registrar en Kardex
    const [[saldo]] = await conn.query(
      'SELECT stock_fisico as qty, (stock_fisico * costo_promedio) as val FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?',
      [d.producto_id, almacen_destino_id]
    );
    const [[cp]] = await conn.query('SELECT costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?', [d.producto_id, almacen_destino_id]);

    await conn.query(
      `INSERT INTO maquicombus_kardex (producto_id, almacen_id, fecha, tipo_documento, numero_documento, referencia_id, movimiento, cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario, nro_factura, usuario_id, tipo_stock)
       VALUES (?, ?, ?, ?, ?, ?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.producto_id, almacen_destino_id, fecha, tipoDocKardex, numero, result.insertId, d.cantidad_recibida, d.precio_unitario, parseFloat(d.cantidad_recibida) * parseFloat(d.precio_unitario), saldo.qty, saldo.val, cp.costo_promedio, ocInfo.nro_factura || null, usuario_id, esReserva ? 'reserva' : 'consumo']
    );

    // ENTRADA de RESERVA: el stock queda en el almacén pero comprometido (stock_reservado) y asociado
    // a su factura; solo sale con una salida de RESERVA (o se mueve con Trans-Almacenes).
    if (esReserva) {
      await conn.query(
        'UPDATE maquicombus_inventario SET stock_reservado = stock_reservado + ? WHERE producto_id = ? AND almacen_id = ?',
        [d.cantidad_recibida, d.producto_id, almacen_destino_id]
      );
      await conn.query(
        `INSERT INTO maquicombus_reservas (transferencia_id, transferencia_detalle_id, recepcion_detalle_id, producto_id, almacen_id, nro_factura, fecha, cantidad, costo_unitario)
         VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        [detIns.insertId, d.producto_id, almacen_destino_id, ocInfo.nro_factura || null, fecha, d.cantidad_recibida, d.precio_unitario]
      );
    }

    // Actualizar cantidad recibida en cada línea de OC que alimentó esta línea de recepción
    for (const o of d.ordenes) {
      await conn.query(
        'UPDATE maquicombus_orden_compra_detalles SET cantidad_recibida = cantidad_recibida + ? WHERE id = ?',
        [o.cantidad, o.id]
      );
    }
  }

  // Actualizar estado de OC
  const [[ocStats]] = await conn.query(
    `SELECT SUM(cantidad_pedida) as pedido, SUM(cantidad_recibida) as recibido
     FROM maquicombus_orden_compra_detalles WHERE orden_compra_id = ?`,
    [orden_compra_id]
  );
  let ocEstado = 'parcialmente_recibida';
  if (parseFloat(ocStats.recibido) >= parseFloat(ocStats.pedido)) ocEstado = 'completada';
  await conn.query(`UPDATE maquicombus_ordenes_compra SET estado = ? WHERE id = ?`, [ocEstado, orden_compra_id]);

  await conn.query("UPDATE maquicombus_recepciones SET estado = 'completada' WHERE id = ?", [result.insertId]);

  // Auto-crear factura si la OC tiene nro_factura y no existe aún para esta OC
  const [[oc]] = await conn.query(
    'SELECT cliente_id, nro_factura, subtotal, igv, total FROM maquicombus_ordenes_compra WHERE id = ?',
    [orden_compra_id]
  );
  if (oc?.nro_factura) {
    const [[facturaExist]] = await conn.query(
      'SELECT id FROM maquicombus_facturas WHERE orden_compra_id = ? LIMIT 1',
      [orden_compra_id]
    );
    if (!facturaExist) {
      const dashIdx = oc.nro_factura.indexOf('-');
      const serie  = dashIdx > -1 ? oc.nro_factura.substring(0, dashIdx).trim() : 'F001';
      const numeroFactura = dashIdx > -1 ? oc.nro_factura.substring(dashIdx + 1).trim() : oc.nro_factura.trim();
      await conn.query(
        `INSERT IGNORE INTO maquicombus_facturas (serie, numero, fecha, cliente_id, orden_compra_id, subtotal, igv, total, tipo, estado, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'factura', 'registrada', ?)`,
        [serie, numeroFactura, fecha, oc.cliente_id, orden_compra_id, oc.subtotal, oc.igv, oc.total, usuario_id]
      );
    }
  }

  return result.insertId;
}

router.post('/', requirePrincipalAccess, async (req, res) => {
  const { orden_compra_id, factura_id, almacen_destino_id, fecha, tipo, observaciones, detalles, es_reserva } = req.body;
  if (!orden_compra_id || !almacen_destino_id || !fecha || !detalles?.length) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const recepcionId = await crearRecepcion(conn, {
      orden_compra_id, factura_id, almacen_destino_id, fecha, tipo, observaciones, detalles, usuario_id: req.user.id, es_reserva,
    });
    await conn.commit();
    const [newRow] = await pool.query('SELECT * FROM maquicombus_recepciones WHERE id = ?', [recepcionId]);
    res.status(201).json(newRow[0]);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al registrar recepción' });
  } finally {
    conn.release();
  }
});

// POST /api/recepciones/masiva
// Recepciona automáticamente TODAS las órdenes pendientes de Almacén Central,
// usando la cantidad pendiente completa y el precio ya pactado en cada línea.
router.post('/masiva', requirePrincipalAccess, async (req, res) => {
  try {
    const [[almacenCentral]] = await pool.query(
      "SELECT id FROM maquicombus_almacenes WHERE tipo = 'central' AND estado = 'activo' ORDER BY id LIMIT 1"
    );
    if (!almacenCentral) return res.status(400).json({ error: 'No hay un Almacén Central activo configurado' });

    const [pendientes] = await pool.query(
      `SELECT id, numero, es_reserva FROM maquicombus_ordenes_compra
       WHERE almacen_central = 'SI' AND estado NOT IN ('completada', 'anulada')`
    );

    const hoy = new Date().toISOString().slice(0, 10);
    let ok = 0, sinPendientes = 0, errores = 0;
    const detalleErrores = [];

    for (const oc of pendientes) {
      const [lineasPendientes] = await pool.query(
        `SELECT id, producto_id, cantidad_pedida, cantidad_recibida, precio_unitario
         FROM maquicombus_orden_compra_detalles
         WHERE orden_compra_id = ? AND cantidad_recibida < cantidad_pedida`,
        [oc.id]
      );
      if (!lineasPendientes.length) { sinPendientes++; continue; }

      const detalles = lineasPendientes.map(l => ({
        producto_id: l.producto_id,
        orden_detalle_id: l.id,
        cantidad_recibida: parseFloat(l.cantidad_pedida) - parseFloat(l.cantidad_recibida),
        precio_unitario: l.precio_unitario,
      }));

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await crearRecepcion(conn, {
          orden_compra_id: oc.id,
          almacen_destino_id: almacenCentral.id,
          fecha: hoy,
          tipo: 'total',
          observaciones: 'Recepción masiva',
          detalles,
          usuario_id: req.user.id,
          es_reserva: !!Number(oc.es_reserva), // la masiva respeta lo ya marcado en la OC
        });
        await conn.commit();
        ok++;
      } catch (err) {
        await conn.rollback();
        errores++;
        detalleErrores.push(`OC ${oc.numero}: ${err.message}`);
      } finally {
        conn.release();
      }
    }

    res.json({ total: pendientes.length, ok, sinPendientes, errores, detalleErrores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar la recepción masiva' });
  }
});

// PUT /api/recepciones/:id/fecha — cambia la fecha de una recepción ya registrada y la de su
// movimiento en el Kardex (RECEPCION / SALDO_INICIAL). No toca el stock ni otros documentos.
router.put('/:id/fecha', requirePrincipalAccess, async (req, res) => {
  const { fecha } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') || Number.isNaN(Date.parse(fecha))) {
    return res.status(400).json({ error: 'Fecha no válida' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[rec]] = await conn.query('SELECT id, fecha FROM maquicombus_recepciones WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!rec) { await conn.rollback(); return res.status(404).json({ error: 'Recepción no encontrada' }); }
    // Ni la fecha actual ni la nueva pueden caer en un período cerrado.
    await assertPeriodoAbierto(conn, rec.fecha);
    await assertPeriodoAbierto(conn, fecha);
    await conn.query('UPDATE maquicombus_recepciones SET fecha = ? WHERE id = ?', [fecha, rec.id]);
    await conn.query(
      "UPDATE maquicombus_kardex SET fecha = ? WHERE referencia_id = ? AND tipo_documento IN ('RECEPCION', 'SALDO_INICIAL')",
      [fecha, rec.id]
    );
    await conn.commit();
    res.json({ message: 'Fecha actualizada', fecha });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al actualizar la fecha' });
  } finally {
    conn.release();
  }
});

router.delete('/:id', requirePrincipalAccess, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Obtener recepción
    const [[rec]] = await conn.query(
      'SELECT * FROM maquicombus_recepciones WHERE id = ?', [req.params.id]
    );
    if (!rec) { await conn.rollback(); return res.status(404).json({ error: 'Recepción no encontrada' }); }
    await assertPeriodoAbierto(conn, rec.fecha);

    // Obtener detalles para revertir inventario y kardex
    const [detalles] = await conn.query(
      'SELECT * FROM maquicombus_recepcion_detalles WHERE recepcion_id = ?', [req.params.id]
    );

    // Una entrada de RESERVA solo se puede eliminar si su reserva sigue intacta (sin salidas ni
    // transferencias que ya hayan movido parte del saldo).
    for (const d of detalles) {
      const [reservas] = await conn.query('SELECT id, cantidad, cantidad_salida FROM maquicombus_reservas WHERE recepcion_detalle_id = ? AND transferencia_id IS NULL FOR UPDATE', [d.id]);
      for (const rv of reservas) {
        if (parseFloat(rv.cantidad_salida) > 0 || Math.abs(parseFloat(rv.cantidad) - parseFloat(d.cantidad_recibida)) > 0.0001) {
          await conn.rollback();
          return res.status(409).json({ error: 'No se puede eliminar: la reserva de esta entrada ya tiene salidas o transferencias' });
        }
      }
    }

    for (const d of detalles) {
      // Revertir cantidad_recibida en las líneas de OC del producto. Una línea de recepción puede
      // agrupar varias líneas de OC del mismo producto, así que el total se descuenta repartido.
      if (d.orden_detalle_id) {
        const [lineasOC] = await conn.query(
          'SELECT id, cantidad_recibida FROM maquicombus_orden_compra_detalles WHERE orden_compra_id = ? AND producto_id = ? ORDER BY id',
          [rec.orden_compra_id, d.producto_id]
        );
        let porRevertir = parseFloat(d.cantidad_recibida);
        for (const l of lineasOC) {
          if (porRevertir <= 0) break;
          const quitar = Math.min(porRevertir, parseFloat(l.cantidad_recibida));
          if (quitar <= 0) continue;
          await conn.query('UPDATE maquicombus_orden_compra_detalles SET cantidad_recibida = GREATEST(0, cantidad_recibida - ?) WHERE id = ?', [quitar, l.id]);
          porRevertir -= quitar;
        }
      }
      // Revertir stock en inventario (y el reservado, si la entrada fue de RESERVA)
      await conn.query(
        'UPDATE maquicombus_inventario SET stock_fisico = GREATEST(0, stock_fisico - ?) WHERE producto_id = ? AND almacen_id = ?',
        [d.cantidad_recibida, d.producto_id, rec.almacen_destino_id]
      );
      const [delRes] = await conn.query('DELETE FROM maquicombus_reservas WHERE recepcion_detalle_id = ? AND transferencia_id IS NULL', [d.id]);
      if (delRes.affectedRows) {
        await conn.query(
          'UPDATE maquicombus_inventario SET stock_reservado = GREATEST(0, stock_reservado - ?) WHERE producto_id = ? AND almacen_id = ?',
          [d.cantidad_recibida, d.producto_id, rec.almacen_destino_id]
        );
      }
      // Eliminar kardex de esta recepción (RECEPCION normal o SALDO_INICIAL para OC-2026-00001)
      await conn.query(
        "DELETE FROM maquicombus_kardex WHERE referencia_id = ? AND tipo_documento IN ('RECEPCION', 'SALDO_INICIAL')",
        [rec.id]
      );
    }

    // Recalcular estado de la OC
    const [[ocStats]] = await conn.query(
      'SELECT SUM(cantidad_pedida) as pedido, SUM(cantidad_recibida) as recibido FROM maquicombus_orden_compra_detalles WHERE orden_compra_id = ?',
      [rec.orden_compra_id]
    );
    const recibido = parseFloat(ocStats.recibido || 0);
    const pedido   = parseFloat(ocStats.pedido   || 0);
    const nuevoEstadoOC = recibido <= 0 ? 'emitida' : recibido >= pedido ? 'completada' : 'parcialmente_recibida';
    await conn.query('UPDATE maquicombus_ordenes_compra SET estado = ? WHERE id = ?', [nuevoEstadoOC, rec.orden_compra_id]);

    // Eliminar detalles y recepción
    await conn.query('DELETE FROM maquicombus_recepcion_detalles WHERE recepcion_id = ?', [req.params.id]);
    await conn.query('DELETE FROM maquicombus_recepciones WHERE id = ?', [req.params.id]);

    // La recepción crea automáticamente la factura de la orden (ver crearRecepcion): si ya no queda
    // ninguna recepción de esa orden, esa factura se elimina también, salvo que una salida de
    // diésel ya la use (entonces se conserva para no dejar la salida sin su factura).
    const [[restantes]] = await conn.query('SELECT COUNT(*) AS n FROM maquicombus_recepciones WHERE orden_compra_id = ?', [rec.orden_compra_id]);
    if (restantes.n === 0) {
      await conn.query(
        `DELETE FROM maquicombus_facturas
         WHERE orden_compra_id = ?
           AND id NOT IN (SELECT factura_id FROM maquicombus_salida_detalles WHERE factura_id IS NOT NULL)`,
        [rec.orden_compra_id]
      );
    }

    await conn.commit();
    res.json({ message: 'Recepción eliminada y stock revertido', estado_oc: nuevoEstadoOC });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al eliminar recepción' });
  } finally {
    conn.release();
  }
});

module.exports = router;
