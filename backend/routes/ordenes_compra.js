const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware, requirePrincipalAccess } = require('../middleware/auth');
const { RUCS_PERMITIDOS, ANIO_OC } = require('../config/proveedoresPermitidos');
const { sincronizarOrdenesCompraLegacy, sincronizarCentrosCostoDesdeSalidas } = require('../services/syncOrdenesCompraLegacy');

router.use(authMiddleware);

// POST /api/ordenes-compra/sincronizar
// Trae proveedores/órdenes nuevas o actualizadas desde el sistema anterior.
router.post('/sincronizar', requirePrincipalAccess, async (req, res) => {
  try {
    const resumen = await sincronizarOrdenesCompraLegacy(pool);
    res.json(resumen);
  } catch (err) {
    console.error('[OC/sincronizar]', err);
    res.status(500).json({ error: 'Error al sincronizar órdenes de compra' });
  }
});

// POST /api/ordenes-compra/sincronizar-centros
// Llena el centro_costo vacío de detalles_orden_compra (legado) con el centro de costo
// más reciente que tuvo cada producto en sus salidas del ERP.
router.post('/sincronizar-centros', requirePrincipalAccess, async (req, res) => {
  try {
    const actualizados = await sincronizarCentrosCostoDesdeSalidas(pool);
    res.json({ actualizados });
  } catch (err) {
    console.error('[OC/sincronizar-centros]', err);
    res.status(500).json({ error: 'Error al sincronizar centros de costo' });
  }
});

async function generarNumero() {
  const year = new Date().getFullYear();
  const [[{ max }]] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(numero, 10) AS UNSIGNED)) as max FROM maquicombus_ordenes_compra WHERE numero LIKE ?`,
    [`OC-${year}-%`]
  );
  return `OC-${year}-${String((max || 0) + 1).padStart(5, '0')}`;
}

// GET /api/ordenes-compra/servicio-comparacion
// Lectura directa (sin sincronizar) de la tabla legada "ordenes_servicio", para
// incluirlas en el comparador de Control de Facturas junto a las órdenes de compra.
// El sistema anterior guarda las órdenes de servicio en una tabla aparte de las de
// compra, así que un pago puede existir solo aquí y no en erp_ordenes_compra.
router.get('/servicio-comparacion', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT os.numero_orden AS numero, os.nro_factura, os.fecha_orden AS fecha,
              os.total, os.estado, p.ruc AS cliente_ruc, p.nombre_proveedor AS cliente_nombre
       FROM ordenes_servicio os
       LEFT JOIN proveedores p ON os.id_proveedor = p.id_proveedor
       WHERE os.deleted_at IS NULL AND p.ruc IN (?) AND YEAR(os.fecha_orden) = ?`,
      [RUCS_PERMITIDOS, ANIO_OC]
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error('[OC/servicio-comparacion]', err.message);
    res.status(500).json({ error: 'Error al obtener órdenes de servicio' });
  }
});

// GET /api/ordenes-compra/siguiente-numero (vista previa, no reserva el número)
router.get('/siguiente-numero', async (req, res) => {
  try {
    const numero = await generarNumero();
    res.json({ numero });
  } catch (err) {
    res.status(500).json({ error: 'Error al calcular el siguiente número' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { search, estado, estado_excluir, almacen_central, fecha_desde, fecha_hasta, sin_recepcionar, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1 AND cl.numero_documento IN (?) AND YEAR(oc.fecha) = ?';
    const params = [RUCS_PERMITIDOS, ANIO_OC];
    if (search) {
      // Se busca por palabras (separadas por espacios o guiones) en vez de exigir el
      // texto completo tal cual en un solo campo: serie y número de factura suelen
      // escribirse pegados ("F001-3143") aunque estén mezclados con espacios en el
      // dato real, así que cada palabra debe poder matchear en cualquier campo
      // (AND entre palabras, OR entre campos).
      const palabras = String(search).trim().split(/[\s-]+/).filter(Boolean);
      if (palabras.length) {
        where += ' AND ' + palabras.map(() => '(oc.numero LIKE ? OR cl.razon_social LIKE ? OR oc.nro_factura LIKE ? OR cl.numero_documento LIKE ?)').join(' AND ');
        palabras.forEach(p => { const like = `%${p}%`; params.push(like, like, like, like); });
      }
    }
    if (estado)      { where += ' AND oc.estado = ?';         params.push(estado); }
    if (estado_excluir) {
      const lista = String(estado_excluir).split(',').map(s => s.trim()).filter(Boolean);
      if (lista.length) { where += ` AND oc.estado NOT IN (${lista.map(() => '?').join(',')})`; params.push(...lista); }
    }
    if (almacen_central) { where += ' AND oc.almacen_central = ?'; params.push(almacen_central); }
    if (fecha_desde) { where += ' AND oc.fecha >= ?';         params.push(fecha_desde); }
    if (fecha_hasta) { where += ' AND oc.fecha <= ?';         params.push(fecha_hasta); }
    if (sin_recepcionar === '1') {
      // "Sin recepcionar" = queda algo pendiente por recibir, no "nunca se recepcionó nada".
      // Antes usaba NOT EXISTS sobre erp_recepciones, así que una OC con recepción PARCIAL
      // (algunas líneas recibidas, otras no) desaparecía del filtro apenas se recibía la
      // primera línea, ocultando las líneas que todavía faltaban.
      where += ` AND EXISTS (
        SELECT 1 FROM maquicombus_orden_compra_detalles ocd
        WHERE ocd.orden_compra_id = oc.id AND ocd.cantidad_recibida < ocd.cantidad_pedida
      )`;
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM maquicombus_ordenes_compra oc LEFT JOIN maquicombus_clientes cl ON oc.cliente_id = cl.id ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT oc.id, oc.numero, oc.fecha, oc.fecha_entrega, oc.estado, oc.moneda, oc.tipo_cambio,
              oc.subtotal, oc.igv, oc.total, oc.observaciones, oc.nro_factura, oc.almacen_central,
              oc.url_factura, oc.url_pdf, oc.id_source, oc.es_reserva,
              cl.razon_social as cliente_nombre, cl.numero_documento as cliente_ruc, cc.nombre as centro_costo_nombre,
              q.numero as cotizacion_numero, pg.numero as pago_numero,
              (SELECT COUNT(*) FROM maquicombus_recepciones r WHERE r.orden_compra_id = oc.id) as tiene_recepcion
       FROM maquicombus_ordenes_compra oc
       LEFT JOIN maquicombus_clientes cl ON oc.cliente_id = cl.id
       LEFT JOIN maquicombus_centros_costo cc ON oc.centro_costo_id = cc.id
       LEFT JOIN maquicombus_cotizaciones q ON oc.cotizacion_id = q.id
       LEFT JOIN maquicombus_pagos pg ON oc.pago_id = pg.id
       ${where} ORDER BY oc.fecha DESC, oc.id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[OC/list]', err.message);
    res.status(500).json({ error: 'Error al obtener órdenes de compra' });
  }
});

// PUT /api/ordenes-compra/:id/reserva  { es_reserva: true|false }
// Marca la orden (y su factura) como RESERVA: solo aparece en transferencias a reserva y en
// salidas de reserva. No se puede cambiar si ya se transfirió algo de sus lotes.
router.put('/:id/reserva', requirePrincipalAccess, async (req, res) => {
  try {
    const esReserva = req.body.es_reserva ? 1 : 0;
    const [[oc]] = await pool.query('SELECT id, numero FROM maquicombus_ordenes_compra WHERE id = ?', [req.params.id]);
    if (!oc) return res.status(404).json({ error: 'Orden no encontrada' });
    const [[{ usados }]] = await pool.query(
      `SELECT COUNT(*) AS usados
       FROM maquicombus_recepcion_detalles rd
       JOIN maquicombus_recepciones r ON rd.recepcion_id = r.id
       WHERE r.orden_compra_id = ? AND rd.cantidad_transferida > 0`,
      [req.params.id]
    );
    if (parseInt(usados) > 0) {
      return res.status(409).json({ error: 'No se puede cambiar: ya se transfirió combustible de esta orden' });
    }
    await pool.query('UPDATE maquicombus_ordenes_compra SET es_reserva = ? WHERE id = ?', [esReserva, req.params.id]);
    res.json({ id: oc.id, numero: oc.numero, es_reserva: esReserva });
  } catch (err) {
    console.error('[OC/reserva]', err.message);
    res.status(500).json({ error: 'Error al actualizar la marca de reserva' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [[oc]] = await pool.query(
      `SELECT
         oc.id, oc.numero, oc.cotizacion_id, oc.pago_id, oc.cliente_id, oc.centro_costo_id,
         oc.proyecto, oc.estado, oc.moneda, oc.tipo_cambio,
         oc.subtotal, oc.igv, oc.total, oc.observaciones,
         oc.nro_factura, oc.almacen_central, oc.es_reserva,
         oc.url_factura, oc.url_pdf, oc.id_source,
         DATE_FORMAT(oc.fecha, '%Y-%m-%d')          AS fecha,
         DATE_FORMAT(oc.fecha_entrega, '%Y-%m-%d')  AS fecha_entrega,
         cl.razon_social AS cliente_nombre,
         cl.numero_documento AS cliente_ruc,
         cl.telefono AS cliente_telefono,
         cc.nombre AS centro_costo_nombre
       FROM maquicombus_ordenes_compra oc
       LEFT JOIN maquicombus_clientes cl ON oc.cliente_id = cl.id
       LEFT JOIN maquicombus_centros_costo cc ON oc.centro_costo_id = cc.id
       WHERE oc.id = ?`,
      [req.params.id]
    );
    if (!oc) return res.status(404).json({ error: 'Orden de compra no encontrada' });

    const [detalles] = await pool.query(
      `SELECT
         od.id, od.producto_id, od.descripcion,
         od.cantidad_pedida, od.cantidad_recibida,
         od.precio_unitario, od.descuento_pct, od.igv_pct, od.subtotal,
         od.centro_costo_id,
         p.sku, p.descripcion AS producto_descripcion,
         um.codigo AS unidad,
         cc.nombre as centro_costo_nombre
       FROM maquicombus_orden_compra_detalles od
       LEFT JOIN maquicombus_productos p ON od.producto_id = p.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       LEFT JOIN maquicombus_centros_costo cc ON od.centro_costo_id = cc.id
       WHERE od.orden_compra_id = ?
       ORDER BY od.id`,
      [req.params.id]
    );
    res.json({ ...oc, detalles });
  } catch (err) {
    console.error('[OC/:id]', err.message);
    res.status(500).json({ error: 'Error al obtener detalle de orden de compra' });
  }
});

// POST: crear OC desde cotización aprobada
router.post('/', requirePrincipalAccess, async (req, res) => {
  const { cotizacion_id, pago_id, fecha_entrega, observaciones } = req.body;
  if (!cotizacion_id) return res.status(400).json({ error: 'cotizacion_id es requerido' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [cots] = await conn.query(
      `SELECT q.*, cl.razon_social as cliente_nombre FROM maquicombus_cotizaciones q JOIN maquicombus_clientes cl ON q.cliente_id = cl.id WHERE q.id = ? AND q.estado = 'aprobada'`,
      [cotizacion_id]
    );
    if (!cots.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'La cotización no existe o no está aprobada' });
    }
    const cot = cots[0];
    const numero = await generarNumero();

    const [result] = await conn.query(
      `INSERT INTO maquicombus_ordenes_compra (numero, cotizacion_id, pago_id, cliente_id, centro_costo_id, proyecto, fecha, fecha_entrega, moneda, tipo_cambio, subtotal, igv, total, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero, cotizacion_id, pago_id || null, cot.cliente_id, cot.centro_costo_id, cot.proyecto, fecha_entrega || null, cot.moneda, cot.tipo_cambio, cot.subtotal, cot.igv, cot.total, observaciones || null, req.user.id]
    );

    const [detalles] = await conn.query(
      'SELECT * FROM maquicombus_cotizacion_detalles WHERE cotizacion_id = ?', [cotizacion_id]
    );
    for (const d of detalles) {
      await conn.query(
        `INSERT INTO maquicombus_orden_compra_detalles (orden_compra_id, producto_id, descripcion, cantidad_pedida, precio_unitario, descuento_pct, igv_pct, subtotal, centro_costo_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, d.producto_id, d.descripcion, d.cantidad, d.precio_unitario, d.descuento_pct, d.igv_pct, d.subtotal, cot.centro_costo_id]
      );
    }

    // Marcar cotización como convertida
    await conn.query(`UPDATE maquicombus_cotizaciones SET estado = 'convertida' WHERE id = ?`, [cotizacion_id]);

    await conn.commit();
    const [newRow] = await pool.query('SELECT * FROM maquicombus_ordenes_compra WHERE id = ?', [result.insertId]);
    res.status(201).json(newRow[0]);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al crear orden de compra' });
  } finally {
    conn.release();
  }
});

// POST: crear OC manualmente (sin cotización previa)
router.post('/manual', requirePrincipalAccess, async (req, res) => {
  const { cliente_id, centro_costo_id, fecha, fecha_entrega, moneda, tipo_cambio,
          almacen_central, nro_factura, observaciones, detalles } = req.body;
  if (!cliente_id || !fecha || !detalles?.length) {
    return res.status(400).json({ error: 'Proveedor, fecha y al menos un ítem son requeridos' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const numero = await generarNumero();

    let subtotal = 0, igv = 0, total = 0;
    for (const d of detalles) {
      const sub = parseFloat(d.cantidad_pedida || 0) * parseFloat(d.precio_unitario || 0) * (1 - (parseFloat(d.descuento_pct) || 0) / 100);
      const igvLinea = sub * (parseFloat(d.igv_pct) || 18) / 100;
      subtotal += sub; igv += igvLinea; total += sub + igvLinea;
    }

    const [result] = await conn.query(
      `INSERT INTO maquicombus_ordenes_compra
        (numero, cliente_id, centro_costo_id, fecha, fecha_entrega, moneda, tipo_cambio,
         subtotal, igv, total, estado, observaciones, usuario_id, almacen_central, nro_factura)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?, ?, ?)`,
      [numero, cliente_id, centro_costo_id || null, fecha, fecha_entrega || null,
       moneda || 'PEN', parseFloat(tipo_cambio) || 1, subtotal, igv, total,
       observaciones || null, req.user.id, almacen_central === 'SI' ? 'SI' : 'NO', nro_factura || null]
    );

    for (const d of detalles) {
      const sub = parseFloat(d.cantidad_pedida || 0) * parseFloat(d.precio_unitario || 0) * (1 - (parseFloat(d.descuento_pct) || 0) / 100);
      await conn.query(
        `INSERT INTO maquicombus_orden_compra_detalles (orden_compra_id, producto_id, descripcion, cantidad_pedida, precio_unitario, descuento_pct, igv_pct, subtotal, centro_costo_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, d.producto_id, d.descripcion || null, d.cantidad_pedida, d.precio_unitario, d.descuento_pct || 0, d.igv_pct || 18, sub, centro_costo_id || null]
      );
    }

    await conn.commit();
    const [newRow] = await pool.query('SELECT * FROM maquicombus_ordenes_compra WHERE id = ?', [result.insertId]);
    res.status(201).json(newRow[0]);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al crear orden de compra' });
  } finally {
    conn.release();
  }
});

router.put('/:id/factura', async (req, res) => {
  const { nro_factura } = req.body
  if (!nro_factura?.trim()) return res.status(400).json({ error: 'El número de factura es requerido' })
  const nro = nro_factura.trim()
  try {
    const [[oc]] = await pool.query(
      'SELECT cliente_id, subtotal, igv, total, fecha FROM maquicombus_ordenes_compra WHERE id = ?',
      [req.params.id]
    )
    await pool.query(
      "UPDATE maquicombus_ordenes_compra SET nro_factura = ?, estado = 'completada' WHERE id = ?",
      [nro, req.params.id]
    )
    // Auto-crear factura si no existe aún
    const [[facturaExist]] = await pool.query(
      'SELECT id FROM maquicombus_facturas WHERE orden_compra_id = ? LIMIT 1',
      [req.params.id]
    )
    if (!facturaExist && oc) {
      const dashIdx = nro.indexOf('-')
      const serie  = dashIdx > -1 ? nro.substring(0, dashIdx).trim() : 'F001'
      const numero = dashIdx > -1 ? nro.substring(dashIdx + 1).trim() : nro
      await pool.query(
        `INSERT IGNORE INTO maquicombus_facturas (serie, numero, fecha, cliente_id, orden_compra_id, subtotal, igv, total, tipo, estado, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'factura', 'registrada', ?)`,
        [serie, numero, oc.fecha, oc.cliente_id, req.params.id, oc.subtotal, oc.igv, oc.total, req.user.id]
      )
    }
    res.json({ message: 'Factura registrada', estado: 'completada' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error al registrar factura' })
  }
})

router.put('/:id/estado', async (req, res) => {
  const { estado } = req.body;
  try {
    await pool.query('UPDATE maquicombus_ordenes_compra SET estado = ? WHERE id = ?', [estado, req.params.id]);
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// PUT /api/ordenes-compra/:id/recepcionar
// Body: { items: [{ detalle_id, cantidad_recibida }], nro_factura? }
router.put('/:id/recepcionar', async (req, res) => {
  const { items, nro_factura } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Se requiere al menos un ítem para recepcionar' });
  }

  const ALMACEN_CENTRAL_ID = 1;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Actualizar nro_factura si viene
    if (nro_factura !== undefined) {
      await conn.query('UPDATE maquicombus_ordenes_compra SET nro_factura = ? WHERE id = ?', [nro_factura || null, req.params.id]);
    }

    for (const item of items) {
      const cantRec = parseFloat(item.cantidad_recibida) || 0;
      if (cantRec <= 0) continue;

      // Obtener detalle actual
      const [[det]] = await conn.query(
        'SELECT * FROM maquicombus_orden_compra_detalles WHERE id = ? AND orden_compra_id = ?',
        [item.detalle_id, req.params.id]
      );
      if (!det) continue;

      // Actualizar cantidad_recibida en detalle
      await conn.query(
        'UPDATE maquicombus_orden_compra_detalles SET cantidad_recibida = ? WHERE id = ?',
        [cantRec, item.detalle_id]
      );

      // Actualizar stock en almacén central (UPSERT)
      const costo = parseFloat(det.precio_unitario) || 0;
      await conn.query(`
        INSERT INTO maquicombus_inventario (producto_id, almacen_id, stock_fisico, stock_reservado, costo_promedio)
        VALUES (?, ?, ?, 0, ?)
        ON DUPLICATE KEY UPDATE
          costo_promedio = ((costo_promedio * stock_fisico) + (? * ?)) / (stock_fisico + ?),
          stock_fisico   = stock_fisico + ?
      `, [det.producto_id, ALMACEN_CENTRAL_ID, cantRec, costo, costo, cantRec, cantRec, cantRec]);
    }

    // Determinar nuevo estado de la OC
    const [detalles] = await conn.query(
      'SELECT cantidad_pedida, cantidad_recibida FROM maquicombus_orden_compra_detalles WHERE orden_compra_id = ?',
      [req.params.id]
    );
    const todoCompleto = detalles.every(d => parseFloat(d.cantidad_recibida) >= parseFloat(d.cantidad_pedida));
    const algoRecibido = detalles.some(d => parseFloat(d.cantidad_recibida) > 0);
    const nuevoEstado = todoCompleto ? 'completada' : algoRecibido ? 'parcialmente_recibida' : 'aprobada';
    await conn.query('UPDATE maquicombus_ordenes_compra SET estado = ? WHERE id = ?', [nuevoEstado, req.params.id]);

    await conn.commit();
    res.json({ message: 'Recepción registrada', estado: nuevoEstado });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al registrar recepción' });
  } finally {
    conn.release();
  }
});

module.exports = router;
