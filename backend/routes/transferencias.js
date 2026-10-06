const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { assertPeriodoAbierto } = require('../services/cierrePeriodo');
const { registrarAuditoria, getClientIP } = require('../middleware/audit');

router.use(authMiddleware);

async function generarNumero() {
  const year = new Date().getFullYear();
  const [[{ max }]] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(numero, 10) AS UNSIGNED)) as max FROM maquicombus_transferencias WHERE numero LIKE ?`,
    [`TRF-${year}-%`]
  );
  return `TRF-${year}-${String((max || 0) + 1).padStart(5, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { search, estado, almacen_id, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params = [];
    if (search) { where += ' AND t.numero LIKE ?'; params.push(`%${search}%`); }
    if (estado) { where += ' AND t.estado = ?'; params.push(estado); }
    if (almacen_id) { where += ' AND (t.almacen_origen_id = ? OR t.almacen_destino_id = ?)'; params.push(almacen_id, almacen_id); }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM maquicombus_transferencias t ${where}`, params);
    const [rows] = await pool.query(
      `SELECT t.*, ao.nombre as origen_nombre, ao.tipo as origen_tipo,
              ad.nombre as destino_nombre, ad.tipo as destino_tipo,
              u.nombre as usuario_nombre
       FROM maquicombus_transferencias t
       JOIN maquicombus_almacenes ao ON t.almacen_origen_id = ao.id
       JOIN maquicombus_almacenes ad ON t.almacen_destino_id = ad.id
       LEFT JOIN maquicombus_usuarios u ON t.usuario_id = u.id
       ${where} ORDER BY t.fecha DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener erp_transferencias' });
  }
});

// GET /api/transferencias/reserva/lotes?almacen_id=X
// Lotes (líneas de recepción con factura) con saldo pendiente de transferir en ese almacén,
// para asociar una reserva a su factura.
router.get('/reserva/lotes', async (req, res) => {
  try {
    const { almacen_id } = req.query;
    if (!almacen_id) return res.status(400).json({ error: 'almacen_id requerido' });
    const [rows] = await pool.query(
      `SELECT rd.id AS recepcion_detalle_id, rd.producto_id, oc.nro_factura, oc.es_reserva, r.fecha AS fecha_recepcion,
              oc.numero AS oc_numero, (rd.cantidad_recibida - rd.cantidad_transferida) AS pendiente
       FROM maquicombus_recepcion_detalles rd
       JOIN maquicombus_recepciones r ON rd.recepcion_id = r.id
       JOIN maquicombus_ordenes_compra oc ON r.orden_compra_id = oc.id
       WHERE r.almacen_destino_id = ? AND r.estado <> 'anulada'
         AND (rd.cantidad_recibida - rd.cantidad_transferida) > 0.01
       ORDER BY r.fecha DESC, rd.id DESC`,
      [almacen_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los lotes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.*, ao.nombre as origen_nombre, ad.nombre as destino_nombre
       FROM maquicombus_transferencias t
       JOIN maquicombus_almacenes ao ON t.almacen_origen_id = ao.id
       JOIN maquicombus_almacenes ad ON t.almacen_destino_id = ad.id
       WHERE t.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrada' });
    // El centro de costo se rastrea a través del lote de origen (recepcion_detalle_id ->
    // línea exacta de OC de esa recepción), no agregando todas las OC que alguna vez pidieron
    // el mismo producto (mostraba una mezcla incorrecta). Si el lote no tiene trazabilidad
    // (remanente sin lote identificable), queda sin centro de costo en vez de uno erróneo.
    const [detalles] = await pool.query(
      `SELECT td.*, p.sku, p.descripcion as producto_descripcion, um.codigo as unidad,
              COALESCE(cc_linea.nombre, cc_oc.nombre) as centro_costo_nombre
       FROM maquicombus_transferencia_detalles td
       JOIN maquicombus_productos p ON td.producto_id = p.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       LEFT JOIN maquicombus_recepcion_detalles rd ON td.recepcion_detalle_id = rd.id
       LEFT JOIN maquicombus_recepciones r ON rd.recepcion_id = r.id
       LEFT JOIN maquicombus_ordenes_compra oc ON r.orden_compra_id = oc.id
       LEFT JOIN maquicombus_centros_costo cc_oc ON oc.centro_costo_id = cc_oc.id
       LEFT JOIN maquicombus_orden_compra_detalles ocd ON rd.orden_detalle_id = ocd.id
       LEFT JOIN maquicombus_centros_costo cc_linea ON ocd.centro_costo_id = cc_linea.id
       WHERE td.transferencia_id = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], detalles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la transferencia' });
  }
});

router.post('/', async (req, res) => {
  const { almacen_origen_id, almacen_destino_id, fecha, responsable_id, observaciones, detalles } = req.body;
  const esReserva = req.body.es_reserva === true || req.body.es_reserva === 1 || req.body.es_reserva === '1';
  if (!almacen_origen_id || !almacen_destino_id || !fecha || !detalles?.length) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  // Una reserva siempre está asociada a una factura (lote recibido), por completo o por saldo.
  if (esReserva && detalles.some(d => !d.recepcion_detalle_id)) {
    return res.status(400).json({ error: 'Cada línea de una reserva debe estar asociada a una factura (lote de recepción)' });
  }
  const tipoStock = esReserva ? 'reserva' : 'consumo';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assertPeriodoAbierto(conn, fecha);

    // Validar flujo: Principal->Central o Central->Auxiliar
    const [[origen]] = await conn.query('SELECT tipo FROM maquicombus_almacenes WHERE id = ?', [almacen_origen_id]);
    const [[destino]] = await conn.query('SELECT tipo FROM maquicombus_almacenes WHERE id = ?', [almacen_destino_id]);

    if (origen.tipo === 'auxiliar') {
      await conn.rollback();
      return res.status(400).json({ error: 'Un almacén auxiliar no puede ser origen de transferencia' });
    }
    if (false) {
      // regla eliminada: ya no existe tipo 'principal'
    }
    if (origen.tipo === 'central' && destino.tipo !== 'auxiliar') {
      await conn.rollback();
      return res.status(400).json({ error: 'El Almacén Central solo puede transferir a Almacenes Auxiliares' });
    }

    const numero = await generarNumero();
    const [result] = await conn.query(
      `INSERT INTO maquicombus_transferencias (numero, almacen_origen_id, almacen_destino_id, fecha, responsable_id, observaciones, usuario_id, es_reserva)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero, almacen_origen_id, almacen_destino_id, fecha, responsable_id || null, observaciones || null, req.user.id, esReserva ? 1 : 0]
    );

    for (const d of detalles) {
      // Verificar stock disponible. FOR UPDATE bloquea la fila para que dos transferencias
      // concurrentes del mismo producto/almacén no lean el mismo stock "viejo" y una termine
      // pisando el descuento de la otra (lost update).
      const [[inv]] = await conn.query(
        'SELECT stock_fisico, stock_reservado, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ? FOR UPDATE',
        [d.producto_id, almacen_origen_id]
      );
      if (!inv || (parseFloat(inv.stock_fisico) - parseFloat(inv.stock_reservado)) < parseFloat(d.cantidad)) {
        await conn.rollback();
        return res.status(400).json({ error: `Stock insuficiente para el producto ID ${d.producto_id}` });
      }

      const costoUnitario = parseFloat(inv.costo_promedio);

      // Si la línea viene de un ítem específico de Recepciones, se arrastra su lote de
      // origen (factura y fecha de recepción) para no perder la trazabilidad al llegar al destino.
      let nroFactura = null, fechaOrigen = null;
      if (d.recepcion_detalle_id) {
        const [[lote]] = await conn.query(
          `SELECT rd.id, rd.producto_id, r.fecha as fecha_recepcion, oc.nro_factura, oc.es_reserva
           FROM maquicombus_recepcion_detalles rd
           JOIN maquicombus_recepciones r ON rd.recepcion_id = r.id
           JOIN maquicombus_ordenes_compra oc ON r.orden_compra_id = oc.id
           WHERE rd.id = ? FOR UPDATE`,
          [d.recepcion_detalle_id]
        );
        if (lote && esReserva && !lote.es_reserva) {
          await conn.rollback();
          return res.status(400).json({ error: `La orden de la factura ${lote.nro_factura || ''} no está marcada como RESERVA` });
        }
        if (lote && !esReserva && lote.es_reserva) {
          await conn.rollback();
          return res.status(400).json({ error: `La factura ${lote.nro_factura || ''} es de RESERVA: use el interruptor "Enviar a RESERVA"` });
        }
        if (esReserva && !(lote && String(lote.producto_id) === String(d.producto_id))) {
          await conn.rollback();
          return res.status(400).json({ error: 'La factura (lote) seleccionada no corresponde al producto de la reserva' });
        }
        if (lote && esReserva) {
          // La cantidad puede ser parcial, pero no mayor al saldo pendiente del lote.
          const [[saldo]] = await conn.query('SELECT (cantidad_recibida - cantidad_transferida) AS pendiente FROM maquicombus_recepcion_detalles WHERE id = ?', [d.recepcion_detalle_id]);
          if (saldo && parseFloat(d.cantidad) > parseFloat(saldo.pendiente) + 0.0001) {
            await conn.rollback();
            return res.status(400).json({ error: `La cantidad supera el saldo de la factura ${lote.nro_factura || ''} (saldo: ${parseFloat(saldo.pendiente)})` });
          }
        }
        if (lote && String(lote.producto_id) === String(d.producto_id)) {
          nroFactura = lote.nro_factura;
          fechaOrigen = lote.fecha_recepcion;
          // LEAST(cantidad_recibida, ...) evita que un doble envío (o dos transferencias
          // casi simultáneas apuntando al mismo lote) deje cantidad_transferida por encima
          // de lo realmente recibido en esa línea.
          await conn.query(
            'UPDATE maquicombus_recepcion_detalles SET cantidad_transferida = LEAST(cantidad_recibida, cantidad_transferida + ?) WHERE id = ?',
            [d.cantidad, d.recepcion_detalle_id]
          );
        }
      }

      const [detResult] = await conn.query(
        `INSERT INTO maquicombus_transferencia_detalles
           (transferencia_id, producto_id, cantidad, costo_unitario, recepcion_detalle_id, nro_factura, fecha_origen)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, d.producto_id, d.cantidad, costoUnitario, d.recepcion_detalle_id || null, nroFactura, fechaOrigen]
      );
      const transferenciaDetalleId = detResult.insertId;
      // Kardex y reserva se fechan con la fecha que indicó el usuario. La fecha de recepción del
      // lote queda solo como trazabilidad en transferencia_detalles.fecha_origen.
      const fechaKardex = fecha;

      // Reducir stock en origen
      await conn.query(
        'UPDATE maquicombus_inventario SET stock_fisico = stock_fisico - ? WHERE producto_id = ? AND almacen_id = ?',
        [d.cantidad, d.producto_id, almacen_origen_id]
      );

      // Aumentar stock en destino (mismo bloqueo que en origen, por la misma razón)
      const [[invDest]] = await conn.query(
        'SELECT stock_fisico, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ? FOR UPDATE',
        [d.producto_id, almacen_destino_id]
      );
      if (invDest) {
        const newStock = parseFloat(invDest.stock_fisico) + parseFloat(d.cantidad);
        const newCosto = ((parseFloat(invDest.stock_fisico) * parseFloat(invDest.costo_promedio)) + (parseFloat(d.cantidad) * costoUnitario)) / newStock;
        await conn.query(
          'UPDATE maquicombus_inventario SET stock_fisico = ?, costo_promedio = ? WHERE producto_id = ? AND almacen_id = ?',
          [newStock, newCosto, d.producto_id, almacen_destino_id]
        );
      } else {
        await conn.query(
          'INSERT INTO maquicombus_inventario (producto_id, almacen_id, stock_fisico, costo_promedio) VALUES (?, ?, ?, ?)',
          [d.producto_id, almacen_destino_id, d.cantidad, costoUnitario]
        );
      }

      // Kardex salida origen
      const [[saldoOrig]] = await conn.query('SELECT stock_fisico, (stock_fisico * costo_promedio) as val, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?', [d.producto_id, almacen_origen_id]);
      await conn.query(
        `INSERT INTO maquicombus_kardex (producto_id, almacen_id, fecha, tipo_documento, numero_documento, referencia_id, movimiento, cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario, nro_factura, transferencia_detalle_id, usuario_id, tipo_stock)
         VALUES (?, ?, ?, 'TRANSFERENCIA_OUT', ?, ?, 'salida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.producto_id, almacen_origen_id, fechaKardex, numero, result.insertId, d.cantidad, costoUnitario, parseFloat(d.cantidad) * costoUnitario, saldoOrig.stock_fisico, saldoOrig.val, saldoOrig.costo_promedio, nroFactura, transferenciaDetalleId, req.user.id, tipoStock]
      );

      // Kardex entrada destino
      const [[saldoDest]] = await conn.query('SELECT stock_fisico, (stock_fisico * costo_promedio) as val, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?', [d.producto_id, almacen_destino_id]);
      await conn.query(
        `INSERT INTO maquicombus_kardex (producto_id, almacen_id, fecha, tipo_documento, numero_documento, referencia_id, movimiento, cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario, nro_factura, transferencia_detalle_id, usuario_id, tipo_stock)
         VALUES (?, ?, ?, 'TRANSFERENCIA_IN', ?, ?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.producto_id, almacen_destino_id, fechaKardex, numero, result.insertId, d.cantidad, costoUnitario, parseFloat(d.cantidad) * costoUnitario, saldoDest.stock_fisico, saldoDest.val, saldoDest.costo_promedio, nroFactura, transferenciaDetalleId, req.user.id, tipoStock]
      );

      // Reserva: el stock queda físicamente en el destino pero comprometido (stock_reservado),
      // así no está disponible para salidas de CONSUMO; solo se libera con una salida de RESERVA.
      if (esReserva) {
        await conn.query(
          'UPDATE maquicombus_inventario SET stock_reservado = stock_reservado + ? WHERE producto_id = ? AND almacen_id = ?',
          [d.cantidad, d.producto_id, almacen_destino_id]
        );
        await conn.query(
          `INSERT INTO maquicombus_reservas (transferencia_id, transferencia_detalle_id, recepcion_detalle_id, producto_id, almacen_id, nro_factura, fecha, cantidad, costo_unitario)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [result.insertId, transferenciaDetalleId, d.recepcion_detalle_id, d.producto_id, almacen_destino_id, nroFactura, fechaKardex, d.cantidad, costoUnitario]
        );
      }
    }

    await conn.query("UPDATE maquicombus_transferencias SET estado = 'completada' WHERE id = ?", [result.insertId]);
    await conn.commit();
    const [newRow] = await pool.query('SELECT * FROM maquicombus_transferencias WHERE id = ?', [result.insertId]);
    res.status(201).json(newRow[0]);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al registrar transferencia' });
  } finally {
    conn.release();
  }
});

// Genera el código correlativo para Trans-Almacenes (serie propia, distinta de TRF-).
async function generarNumeroTransAlmacen() {
  const year = new Date().getFullYear();
  const [[{ max }]] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(numero, 11) AS UNSIGNED)) as max FROM maquicombus_transferencias WHERE numero LIKE ?`,
    [`TALM-${year}-%`]
  );
  return `TALM-${year}-${String((max || 0) + 1).padStart(5, '0')}`;
}

const PASSWORD_CONFIRMACION_TRANS_ALMACENES = '@ayala.com';

// POST /api/transferencias/entre-almacenes
// Trans-Almacenes: transferencia libre entre CUALQUIER par de almacenes activos (no solo
// Central -> Auxiliar como la transferencia normal), protegida con una contraseña de
// confirmación para evitar movimientos accidentales entre almacenes ya en operación.
router.post('/entre-almacenes', async (req, res) => {
  const { almacen_origen_id, almacen_destino_id, fecha, observaciones, detalles, password } = req.body;
  if (!almacen_origen_id || !almacen_destino_id || !fecha || !detalles?.length) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  if (String(almacen_origen_id) === String(almacen_destino_id)) {
    return res.status(400).json({ error: 'El almacén de origen y destino no pueden ser el mismo' });
  }
  // Verificación de contraseña desactivada temporalmente (por el momento).
  // Para reactivar, descomentar el bloque siguiente.
  // if (password !== PASSWORD_CONFIRMACION_TRANS_ALMACENES) {
  //   return res.status(403).json({ error: 'Contraseña de confirmación incorrecta' });
  // }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assertPeriodoAbierto(conn, fecha);

    const [[origen]] = await conn.query('SELECT tipo, nombre, estado FROM maquicombus_almacenes WHERE id = ?', [almacen_origen_id]);
    const [[destino]] = await conn.query('SELECT tipo, nombre, estado FROM maquicombus_almacenes WHERE id = ?', [almacen_destino_id]);
    if (!origen || !destino) {
      await conn.rollback();
      return res.status(400).json({ error: 'Almacén de origen o destino no válido' });
    }
    if (origen.estado !== 'activo' || destino.estado !== 'activo') {
      await conn.rollback();
      return res.status(400).json({ error: 'El almacén de origen y destino deben estar activos' });
    }

    const numero = await generarNumeroTransAlmacen();
    const [result] = await conn.query(
      `INSERT INTO maquicombus_transferencias (numero, almacen_origen_id, almacen_destino_id, fecha, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [numero, almacen_origen_id, almacen_destino_id, fecha, observaciones || null, req.user.id]
    );

    for (const d of detalles) {
      const [[inv]] = await conn.query(
        'SELECT stock_fisico, stock_reservado, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ? FOR UPDATE',
        [d.producto_id, almacen_origen_id]
      );
      // Línea de stock RESERVADO: se mueve parte (o todo) el saldo de una reserva concreta
      // (factura). El resto del saldo queda en el origen. El destino recibe una reserva propia.
      let reservaOrigen = null;
      if (d.reserva_id) {
        [[reservaOrigen]] = await conn.query('SELECT * FROM maquicombus_reservas WHERE id = ? FOR UPDATE', [d.reserva_id]);
        if (!reservaOrigen || String(reservaOrigen.almacen_id) !== String(almacen_origen_id) || String(reservaOrigen.producto_id) !== String(d.producto_id)) {
          await conn.rollback();
          return res.status(400).json({ error: 'La reserva seleccionada no corresponde al producto/almacén de origen' });
        }
        const saldoReserva = parseFloat(reservaOrigen.cantidad) - parseFloat(reservaOrigen.cantidad_salida);
        if (saldoReserva + 0.0001 < parseFloat(d.cantidad)) {
          await conn.rollback();
          return res.status(400).json({ error: `Saldo insuficiente en la reserva de la factura ${reservaOrigen.nro_factura || reservaOrigen.id} (saldo: ${saldoReserva})` });
        }
        if (!inv || parseFloat(inv.stock_fisico) < parseFloat(d.cantidad)) {
          await conn.rollback();
          return res.status(400).json({ error: `Stock físico insuficiente para el producto ID ${d.producto_id}` });
        }
      } else if (!inv || (parseFloat(inv.stock_fisico) - parseFloat(inv.stock_reservado)) < parseFloat(d.cantidad)) {
        await conn.rollback();
        return res.status(400).json({ error: `Stock insuficiente para el producto ID ${d.producto_id}` });
      }
      const tipoStock = reservaOrigen ? 'reserva' : 'consumo';
      const nroFactura = reservaOrigen ? reservaOrigen.nro_factura : null;

      const costoUnitario = parseFloat(inv.costo_promedio);

      const [detResult] = await conn.query(
        `INSERT INTO maquicombus_transferencia_detalles (transferencia_id, producto_id, cantidad, costo_unitario, recepcion_detalle_id, nro_factura)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [result.insertId, d.producto_id, d.cantidad, costoUnitario, reservaOrigen?.recepcion_detalle_id || null, nroFactura]
      );
      const transferenciaDetalleId = detResult.insertId;

      await conn.query(
        `UPDATE maquicombus_inventario SET stock_fisico = stock_fisico - ?${reservaOrigen ? ', stock_reservado = GREATEST(stock_reservado - ?, 0)' : ''} WHERE producto_id = ? AND almacen_id = ?`,
        reservaOrigen ? [d.cantidad, d.cantidad, d.producto_id, almacen_origen_id] : [d.cantidad, d.producto_id, almacen_origen_id]
      );
      if (reservaOrigen) {
        await conn.query('UPDATE maquicombus_reservas SET cantidad = cantidad - ? WHERE id = ?', [d.cantidad, reservaOrigen.id]);
      }

      const [[invDest]] = await conn.query(
        'SELECT stock_fisico, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ? FOR UPDATE',
        [d.producto_id, almacen_destino_id]
      );
      if (invDest) {
        const newStock = parseFloat(invDest.stock_fisico) + parseFloat(d.cantidad);
        const newCosto = ((parseFloat(invDest.stock_fisico) * parseFloat(invDest.costo_promedio)) + (parseFloat(d.cantidad) * costoUnitario)) / newStock;
        await conn.query(
          'UPDATE maquicombus_inventario SET stock_fisico = ?, costo_promedio = ? WHERE producto_id = ? AND almacen_id = ?',
          [newStock, newCosto, d.producto_id, almacen_destino_id]
        );
      } else {
        await conn.query(
          'INSERT INTO maquicombus_inventario (producto_id, almacen_id, stock_fisico, costo_promedio) VALUES (?, ?, ?, ?)',
          [d.producto_id, almacen_destino_id, d.cantidad, costoUnitario]
        );
      }

      const [[saldoOrig]] = await conn.query('SELECT stock_fisico, (stock_fisico * costo_promedio) as val, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?', [d.producto_id, almacen_origen_id]);
      await conn.query(
        `INSERT INTO maquicombus_kardex (producto_id, almacen_id, fecha, tipo_documento, numero_documento, referencia_id, movimiento, cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario, nro_factura, transferencia_detalle_id, usuario_id, tipo_stock)
         VALUES (?, ?, ?, 'TRANSFERENCIA_OUT', ?, ?, 'salida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.producto_id, almacen_origen_id, fecha, numero, result.insertId, d.cantidad, costoUnitario, parseFloat(d.cantidad) * costoUnitario, saldoOrig.stock_fisico, saldoOrig.val, saldoOrig.costo_promedio, nroFactura, transferenciaDetalleId, req.user.id, tipoStock]
      );

      const [[saldoDest]] = await conn.query('SELECT stock_fisico, (stock_fisico * costo_promedio) as val, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?', [d.producto_id, almacen_destino_id]);
      await conn.query(
        `INSERT INTO maquicombus_kardex (producto_id, almacen_id, fecha, tipo_documento, numero_documento, referencia_id, movimiento, cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario, nro_factura, transferencia_detalle_id, usuario_id, tipo_stock)
         VALUES (?, ?, ?, 'TRANSFERENCIA_IN', ?, ?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.producto_id, almacen_destino_id, fecha, numero, result.insertId, d.cantidad, costoUnitario, parseFloat(d.cantidad) * costoUnitario, saldoDest.stock_fisico, saldoDest.val, saldoDest.costo_promedio, nroFactura, transferenciaDetalleId, req.user.id, tipoStock]
      );

      // El stock reservado sigue reservado en el destino, asociado a la misma factura.
      if (reservaOrigen) {
        await conn.query(
          'UPDATE maquicombus_inventario SET stock_reservado = stock_reservado + ? WHERE producto_id = ? AND almacen_id = ?',
          [d.cantidad, d.producto_id, almacen_destino_id]
        );
        await conn.query(
          `INSERT INTO maquicombus_reservas (transferencia_id, transferencia_detalle_id, recepcion_detalle_id, producto_id, almacen_id, nro_factura, fecha, cantidad, costo_unitario)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [result.insertId, transferenciaDetalleId, reservaOrigen.recepcion_detalle_id, d.producto_id, almacen_destino_id, reservaOrigen.nro_factura, fecha, d.cantidad, costoUnitario]
        );
      }
    }

    await conn.query("UPDATE maquicombus_transferencias SET estado = 'completada' WHERE id = ?", [result.insertId]);
    await conn.commit();
    const [newRow] = await pool.query('SELECT * FROM maquicombus_transferencias WHERE id = ?', [result.insertId]);
    res.status(201).json(newRow[0]);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al registrar la transferencia entre almacenes' });
  } finally {
    conn.release();
  }
});

// DELETE /api/transferencias/:id — revierte una transferencia completada (normal TRF-, entre
// almacenes TALM- o de reserva): devuelve el stock al origen, lo quita del destino, elimina
// sus líneas de Kardex y la reserva creada en el destino, y deja la transferencia 'anulada'.
// Se bloquea si el destino ya consumió lo recibido (salidas contra esa reserva o stock
// insuficiente), para no dejar saldos negativos.
router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (req.body?.password !== PASSWORD_CONFIRMACION_TRANS_ALMACENES) {
      await conn.rollback();
      return res.status(403).json({ error: 'Contraseña de confirmación incorrecta' });
    }

    const [[trf]] = await conn.query('SELECT * FROM maquicombus_transferencias WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!trf) { await conn.rollback(); return res.status(404).json({ error: 'Transferencia no encontrada' }); }
    if (trf.estado === 'anulada') { await conn.rollback(); return res.status(400).json({ error: 'La transferencia ya fue revertida' }); }
    if (trf.estado !== 'completada') { await conn.rollback(); return res.status(400).json({ error: 'Solo se pueden revertir transferencias completadas' }); }
    await assertPeriodoAbierto(conn, trf.fecha);

    const { rol, almacen_id: userAlmacenId, almacen_tipo: userAlmacenTipo } = req.user;
    const esPrincipal = !userAlmacenId || userAlmacenTipo === 'central';
    const esPropioAlmacen = userAlmacenId && [trf.almacen_origen_id, trf.almacen_destino_id].some(a => String(a) === String(userAlmacenId));
    if (rol !== 'admin' && rol !== 'gerente' && !esPrincipal && !esPropioAlmacen) {
      await conn.rollback();
      return res.status(403).json({ error: 'No puedes revertir una transferencia de otros almacenes' });
    }

    const [detalles] = await conn.query('SELECT * FROM maquicombus_transferencia_detalles WHERE transferencia_id = ?', [trf.id]);
    // Las transferencias TALM- no incrementan cantidad_transferida del lote de recepción.
    const esTrfNormal = String(trf.numero).startsWith('TRF-');

    for (const d of detalles) {
      const cant = parseFloat(d.cantidad);

      // Reserva creada en el destino por esta línea (si la hubo).
      const [reservasDest] = await conn.query(
        'SELECT * FROM maquicombus_reservas WHERE transferencia_detalle_id = ? FOR UPDATE', [d.id]
      );
      const esReservaLinea = reservasDest.length > 0;
      for (const rv of reservasDest) {
        if (parseFloat(rv.cantidad_salida) > 0.0001) {
          await conn.rollback();
          return res.status(400).json({ error: `No se puede revertir: la reserva de la factura ${rv.nro_factura || rv.id} ya tiene salidas (${parseFloat(rv.cantidad_salida)}). Revierta primero esas salidas.` });
        }
      }

      const [[invDest]] = await conn.query(
        'SELECT stock_fisico, stock_reservado FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ? FOR UPDATE',
        [d.producto_id, trf.almacen_destino_id]
      );
      const fisicoDest = invDest ? parseFloat(invDest.stock_fisico) : 0;
      const reservadoDest = invDest ? parseFloat(invDest.stock_reservado) : 0;
      const libreDest = esReservaLinea ? fisicoDest : fisicoDest - reservadoDest;
      if (libreDest + 0.0001 < cant || (esReservaLinea && reservadoDest + 0.0001 < cant)) {
        await conn.rollback();
        return res.status(400).json({ error: `No se puede revertir: el almacén destino ya no tiene ${cant} del producto ID ${d.producto_id} disponibles` });
      }

      // Destino: quitar lo recibido (y su reserva).
      await conn.query(
        `UPDATE maquicombus_inventario SET stock_fisico = stock_fisico - ?${esReservaLinea ? ', stock_reservado = GREATEST(stock_reservado - ?, 0)' : ''} WHERE producto_id = ? AND almacen_id = ?`,
        esReservaLinea ? [cant, cant, d.producto_id, trf.almacen_destino_id] : [cant, d.producto_id, trf.almacen_destino_id]
      );
      await conn.query('DELETE FROM maquicombus_reservas WHERE transferencia_detalle_id = ?', [d.id]);

      // Origen: devolver el stock. Si salió de una reserva (TALM- de reserva), se restituye
      // también el stock reservado y el saldo de la reserva de origen (misma factura/lote).
      const [[outK]] = await conn.query(
        "SELECT tipo_stock FROM maquicombus_kardex WHERE transferencia_detalle_id = ? AND tipo_documento = 'TRANSFERENCIA_OUT' LIMIT 1", [d.id]
      );
      const salioDeReserva = !esTrfNormal && outK?.tipo_stock === 'reserva';
      let reservaOrigen = null;
      if (salioDeReserva) {
        [[reservaOrigen]] = await conn.query(
          `SELECT id FROM maquicombus_reservas
           WHERE almacen_id = ? AND producto_id = ? AND recepcion_detalle_id <=> ? AND nro_factura <=> ? AND NOT (transferencia_detalle_id <=> ?)
           ORDER BY id LIMIT 1 FOR UPDATE`,
          [trf.almacen_origen_id, d.producto_id, d.recepcion_detalle_id || null, d.nro_factura || null, d.id]
        );
        if (!reservaOrigen) {
          await conn.rollback();
          return res.status(400).json({ error: `No se encontró la reserva de origen (factura ${d.nro_factura || '—'}) para restituir el saldo` });
        }
        await conn.query('UPDATE maquicombus_reservas SET cantidad = cantidad + ? WHERE id = ?', [cant, reservaOrigen.id]);
      }
      await conn.query(
        `UPDATE maquicombus_inventario SET stock_fisico = stock_fisico + ?${salioDeReserva ? ', stock_reservado = stock_reservado + ?' : ''} WHERE producto_id = ? AND almacen_id = ?`,
        salioDeReserva ? [cant, cant, d.producto_id, trf.almacen_origen_id] : [cant, d.producto_id, trf.almacen_origen_id]
      );

      // Lote de recepción: vuelve a quedar pendiente de transferir.
      if (esTrfNormal && d.recepcion_detalle_id) {
        await conn.query(
          'UPDATE maquicombus_recepcion_detalles SET cantidad_transferida = GREATEST(cantidad_transferida - ?, 0) WHERE id = ?',
          [cant, d.recepcion_detalle_id]
        );
      }
    }

    await conn.query(
      "DELETE FROM maquicombus_kardex WHERE referencia_id = ? AND tipo_documento IN ('TRANSFERENCIA_OUT','TRANSFERENCIA_IN')", [trf.id]
    );
    await conn.query("UPDATE maquicombus_transferencias SET estado = 'anulada' WHERE id = ?", [trf.id]);

    await conn.commit();

    await registrarAuditoria({
      usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req),
      modulo: 'transferencias', accion: 'revertir', tabla: 'maquicombus_transferencias', registroId: trf.id,
      valorAnterior: { transferencia: trf, detalles },
    });

    res.json({ message: 'Transferencia revertida: stock devuelto al almacén de origen' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al revertir la transferencia' });
  } finally {
    conn.release();
  }
});

// GET /api/transferencias/bloque/stock/:producto_id
// Stock disponible del producto en el Almacén Central, para armar la Transferencia por Bloque.
router.get('/bloque/stock/:producto_id', async (req, res) => {
  try {
    const [[central]] = await pool.query(
      "SELECT id, nombre FROM maquicombus_almacenes WHERE tipo = 'central' AND estado = 'activo' ORDER BY id LIMIT 1"
    );
    if (!central) return res.status(400).json({ error: 'No hay un Almacén Central activo configurado' });

    const [[inv]] = await pool.query(
      'SELECT stock_fisico, stock_reservado FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?',
      [req.params.producto_id, central.id]
    );
    const disponible = inv ? parseFloat(inv.stock_fisico) - parseFloat(inv.stock_reservado) : 0;

    const [[prod]] = await pool.query(
      'SELECT bloqueado_transferencia FROM maquicombus_productos WHERE id = ?',
      [req.params.producto_id]
    );

    res.json({
      almacen_central_id: central.id,
      almacen_central_nombre: central.nombre,
      disponible,
      bloqueado: !!prod?.bloqueado_transferencia,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el stock del producto' });
  }
});

// GET /api/transferencias/bloque/bloqueados
// Lista de productos bloqueados para transferencia individual desde Recepciones.
router.get('/bloque/bloqueados', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.sku, p.descripcion, p.bloqueado_transferencia_fecha, u.nombre as usuario_nombre
       FROM maquicombus_productos p
       LEFT JOIN maquicombus_usuarios u ON p.bloqueado_transferencia_usuario_id = u.id
       WHERE p.bloqueado_transferencia = 1
       ORDER BY p.bloqueado_transferencia_fecha DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener productos bloqueados' });
  }
});

// PUT /api/transferencias/bloque/:producto_id/desbloquear
router.put('/bloque/:producto_id/desbloquear', async (req, res) => {
  try {
    await pool.query(
      'UPDATE maquicombus_productos SET bloqueado_transferencia = 0, bloqueado_transferencia_fecha = NULL, bloqueado_transferencia_usuario_id = NULL WHERE id = ?',
      [req.params.producto_id]
    );
    res.json({ message: 'Producto desbloqueado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al desbloquear el producto' });
  }
});

// POST /api/transferencias/bloque
// Transfiere TODO el stock disponible de un producto en el Almacén Central hacia un
// Almacén Auxiliar en una sola operación, y bloquea el producto para transferencias
// individuales desde Recepciones (agrupación en un solo "contenedor" de transferencia).
router.post('/bloque', async (req, res) => {
  const { producto_id, almacen_destino_id, fecha, observaciones } = req.body;
  if (!producto_id || !almacen_destino_id || !fecha) {
    return res.status(400).json({ error: 'Producto, almacén destino y fecha son requeridos' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assertPeriodoAbierto(conn, fecha);

    const [[central]] = await conn.query(
      "SELECT id FROM maquicombus_almacenes WHERE tipo = 'central' AND estado = 'activo' ORDER BY id LIMIT 1"
    );
    if (!central) {
      await conn.rollback();
      return res.status(400).json({ error: 'No hay un Almacén Central activo configurado' });
    }

    const [[destino]] = await conn.query('SELECT tipo FROM maquicombus_almacenes WHERE id = ?', [almacen_destino_id]);
    if (!destino || destino.tipo !== 'auxiliar') {
      await conn.rollback();
      return res.status(400).json({ error: 'El destino debe ser un Almacén Auxiliar' });
    }

    const [[inv]] = await conn.query(
      'SELECT stock_fisico, stock_reservado, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ? FOR UPDATE',
      [producto_id, central.id]
    );
    const disponible = inv ? parseFloat(inv.stock_fisico) - parseFloat(inv.stock_reservado) : 0;
    if (disponible <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'El producto no tiene stock disponible en el Almacén Central' });
    }

    const numero = await generarNumero();
    const [result] = await conn.query(
      `INSERT INTO maquicombus_transferencias (numero, almacen_origen_id, almacen_destino_id, fecha, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [numero, central.id, almacen_destino_id, fecha, observaciones || 'Transferencia por bloque', req.user.id]
    );

    const costoUnitario = parseFloat(inv.costo_promedio);

    // No se agrupa en una sola línea: se arma un listado FIFO con cada lote de recepción
    // que compone el stock disponible (cantidad, costo unitario y factura de origen propios
    // de cada uno), hasta cubrir el total transferido.
    const [lotes] = await conn.query(
      `SELECT rd.id, (rd.cantidad_recibida - rd.cantidad_transferida) as pendiente,
              rd.precio_unitario, r.fecha as fecha_origen, oc.nro_factura
       FROM maquicombus_recepcion_detalles rd
       JOIN maquicombus_recepciones r ON rd.recepcion_id = r.id
       JOIN maquicombus_ordenes_compra oc ON r.orden_compra_id = oc.id
       WHERE rd.producto_id = ? AND r.almacen_destino_id = ? AND (rd.cantidad_recibida - rd.cantidad_transferida) > 0.0001
       ORDER BY r.fecha ASC, rd.id ASC
       FOR UPDATE`,
      [producto_id, central.id]
    );

    let restante = disponible;
    const lineas = [];
    for (const lote of lotes) {
      if (restante <= 0.0001) break;
      const tomar = Math.min(parseFloat(lote.pendiente), restante);
      if (tomar <= 0.0001) continue;
      lineas.push({
        cantidad: tomar,
        costo_unitario: parseFloat(lote.precio_unitario),
        nro_factura: lote.nro_factura,
        fecha_origen: lote.fecha_origen,
        recepcion_detalle_id: lote.id,
      });
      await conn.query(
        'UPDATE maquicombus_recepcion_detalles SET cantidad_transferida = LEAST(cantidad_recibida, cantidad_transferida + ?) WHERE id = ?',
        [tomar, lote.id]
      );
      restante -= tomar;
    }
    // Remanente sin lote identificable (ej. saldos iniciales importados sin recepción registrada):
    // se lista igual, con el costo promedio actual, para que la cantidad total siempre cuadre con el stock real.
    if (restante > 0.0001) {
      lineas.push({ cantidad: restante, costo_unitario: costoUnitario, nro_factura: null, fecha_origen: null, recepcion_detalle_id: null });
    }

    for (const linea of lineas) {
      const [detResult] = await conn.query(
        `INSERT INTO maquicombus_transferencia_detalles
           (transferencia_id, producto_id, cantidad, costo_unitario, recepcion_detalle_id, nro_factura, fecha_origen)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, producto_id, linea.cantidad, linea.costo_unitario, linea.recepcion_detalle_id, linea.nro_factura, linea.fecha_origen]
      );
      linea.detalle_id = detResult.insertId;
    }

    // Inventario: se descuenta/aumenta el total de una vez (el saldo final es el mismo
    // sin importar en cuántas líneas se registre el detalle).
    await conn.query(
      'UPDATE maquicombus_inventario SET stock_fisico = stock_fisico - ? WHERE producto_id = ? AND almacen_id = ?',
      [disponible, producto_id, central.id]
    );
    const [[invDestInicial]] = await conn.query(
      'SELECT stock_fisico, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ? FOR UPDATE',
      [producto_id, almacen_destino_id]
    );
    if (!invDestInicial) {
      await conn.query(
        'INSERT INTO maquicombus_inventario (producto_id, almacen_id, stock_fisico, costo_promedio) VALUES (?, ?, 0, 0)',
        [producto_id, almacen_destino_id]
      );
    }

    // Kardex: no se agrupa en un solo movimiento — se registra una línea de salida (origen)
    // y una de entrada (destino) POR CADA lote/factura, en el mismo orden FIFO ya usado
    // para armar `lineas`, para que el saldo corrido quede coherente.
    let saldoOrigCant = parseFloat(inv.stock_fisico); // saldo del origen antes de esta transferencia
    let saldoOrigVal = saldoOrigCant * costoUnitario;
    let saldoDestCant = parseFloat(invDestInicial?.stock_fisico || 0);
    let saldoDestVal = saldoDestCant * parseFloat(invDestInicial?.costo_promedio || 0);

    for (const linea of lineas) {
      // Cada línea se fecha con la fecha que indicó el usuario; la del lote queda como trazabilidad.
      const fechaLinea = fecha;

      // Salida origen (a costo propio del lote, para que el monto de esta línea coincida
      // exactamente con el que se ve en el detalle de la transferencia)
      saldoOrigCant -= linea.cantidad;
      saldoOrigVal -= linea.cantidad * linea.costo_unitario;
      const saldoOrigCostoProm = saldoOrigCant > 0.0001 ? saldoOrigVal / saldoOrigCant : 0;
      await conn.query(
        `INSERT INTO maquicombus_kardex (producto_id, almacen_id, fecha, tipo_documento, numero_documento, referencia_id, movimiento, cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario, nro_factura, transferencia_detalle_id, usuario_id)
         VALUES (?, ?, ?, 'TRANSFERENCIA_OUT', ?, ?, 'salida', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [producto_id, central.id, fechaLinea, numero, result.insertId, linea.cantidad, linea.costo_unitario, linea.cantidad * linea.costo_unitario, saldoOrigCant, saldoOrigVal, saldoOrigCostoProm, linea.nro_factura, linea.detalle_id, req.user.id]
      );

      // Entrada destino (mismo costo del lote)
      saldoDestVal += linea.cantidad * linea.costo_unitario;
      saldoDestCant += linea.cantidad;
      const saldoDestCostoProm = saldoDestCant > 0.0001 ? saldoDestVal / saldoDestCant : 0;
      await conn.query(
        `INSERT INTO maquicombus_kardex (producto_id, almacen_id, fecha, tipo_documento, numero_documento, referencia_id, movimiento, cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario, nro_factura, transferencia_detalle_id, usuario_id)
         VALUES (?, ?, ?, 'TRANSFERENCIA_IN', ?, ?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [producto_id, almacen_destino_id, fechaLinea, numero, result.insertId, linea.cantidad, linea.costo_unitario, linea.cantidad * linea.costo_unitario, saldoDestCant, saldoDestVal, saldoDestCostoProm, linea.nro_factura, linea.detalle_id, req.user.id]
      );
    }

    // El costo promedio final de inventario (origen no cambia; destino sí) se fija con el
    // último saldo calculado, para que cuadre exactamente con el kardex recién insertado.
    await conn.query(
      'UPDATE maquicombus_inventario SET costo_promedio = ? WHERE producto_id = ? AND almacen_id = ?',
      [saldoOrigCant > 0.0001 ? saldoOrigVal / saldoOrigCant : costoUnitario, producto_id, central.id]
    );
    await conn.query(
      'UPDATE maquicombus_inventario SET stock_fisico = ?, costo_promedio = ? WHERE producto_id = ? AND almacen_id = ?',
      [saldoDestCant, saldoDestCant > 0.0001 ? saldoDestVal / saldoDestCant : 0, producto_id, almacen_destino_id]
    );

    await conn.query("UPDATE maquicombus_transferencias SET estado = 'completada' WHERE id = ?", [result.insertId]);

    // Bloquear el producto para transferencias individuales desde Recepciones
    await conn.query(
      'UPDATE maquicombus_productos SET bloqueado_transferencia = 1, bloqueado_transferencia_fecha = NOW(), bloqueado_transferencia_usuario_id = ? WHERE id = ?',
      [req.user.id, producto_id]
    );

    await conn.commit();
    res.status(201).json({ transferencia_id: result.insertId, numero, cantidad: disponible, lotes: lineas.length });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al procesar la transferencia por bloque' });
  } finally {
    conn.release();
  }
});

module.exports = router;
