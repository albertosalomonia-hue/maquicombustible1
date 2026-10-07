const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { registrarAuditoria, getClientIP } = require('../middleware/audit');

router.use(authMiddleware);

// Contraseña de confirmación requerida para eliminar (anular) una factura y para
// retornarla (misma clave usada en otras operaciones sensibles del sistema).
const PASSWORD_CONFIRMACION_FACTURA = '@ayala.com';

// GET /api/facturas/saldos-iniciales?producto_id=&almacen_id= — facturas ingresadas en Saldos
// Iniciales, con su saldo disponible para despachar diésel. Se muestran junto a las facturas
// normales en el selector de factura de diésel (id "si-<kardex id>").
router.get('/saldos-iniciales', async (req, res) => {
  try {
    const { producto_id, almacen_id, search } = req.query;
    if (!producto_id) return res.json({ data: [] });
    let where = "WHERE k.tipo_documento = 'SALDO_INICIAL' AND k.nro_factura IS NOT NULL AND k.nro_factura != '' AND k.producto_id = ?";
    const params = [producto_id];
    if (almacen_id) { where += ' AND k.almacen_id = ?'; params.push(almacen_id); }
    if (search) { where += ' AND k.nro_factura LIKE ?'; params.push(`%${search}%`); }
    const [rows] = await pool.query(
      `SELECT CONCAT('si-', k.id) AS id, k.nro_factura, k.fecha, k.numero_documento AS oc_numero,
              k.cantidad AS cantidad_recibida,
              COALESCE(d.despachado, 0) AS cantidad_despachada,
              (k.cantidad - COALESCE(d.despachado, 0)) AS saldo_disponible,
              1 AS es_saldo_inicial
       FROM maquicombus_kardex k
       LEFT JOIN (
         SELECT saldo_inicial_kardex_id, SUM(cantidad) AS despachado
         FROM maquicombus_salida_detalles WHERE es_diesel = 1 AND saldo_inicial_kardex_id IS NOT NULL
         GROUP BY saldo_inicial_kardex_id
       ) d ON d.saldo_inicial_kardex_id = k.id
       ${where} ORDER BY k.fecha DESC`,
      params
    );
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener facturas de saldos iniciales' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { search, estado, producto_id, incluir_anuladas, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = "WHERE 1=1";
    const params = [];
    if (search) {
      // Se busca por palabras (separadas por espacios o guiones) en vez de exigir el
      // texto completo tal cual en un solo campo: serie y número suelen escribirse
      // pegados ("F001-3143") aunque estén en columnas separadas, así que "F001" y
      // "3143" deben poder matchear cada uno en cualquier campo (AND entre palabras).
      const palabras = String(search).trim().split(/[\s-]+/).filter(Boolean);
      if (palabras.length) {
        where += ' AND ' + palabras.map(() => '(f.serie LIKE ? OR f.numero LIKE ? OR cl.razon_social LIKE ? OR cl.numero_documento LIKE ?)').join(' AND ');
        palabras.forEach(p => { const like = `%${p}%`; params.push(like, like, like, like); });
      }
    }
    // Las facturas de órdenes marcadas como RESERVA solo se muestran en los flujos de reserva.
    if (req.query.incluir_reserva !== '1') {
      where += ' AND NOT EXISTS (SELECT 1 FROM maquicombus_ordenes_compra ores WHERE ores.id = f.orden_compra_id AND ores.es_reserva = 1)';
    }
    if (req.query.cliente_id) { where += ' AND f.cliente_id = ?'; params.push(req.query.cliente_id); }
    if (estado) { where += ' AND f.estado = ?'; params.push(estado); }
    else if (!incluir_anuladas) { where += " AND f.estado != 'anulada'"; }
    if (producto_id) {
      where += ` AND EXISTS (
        SELECT 1 FROM maquicombus_orden_compra_detalles od
        WHERE od.orden_compra_id = f.orden_compra_id AND od.producto_id = ?
      )`;
      params.push(producto_id);
    }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM maquicombus_facturas f JOIN maquicombus_clientes cl ON f.cliente_id = cl.id ${where}`, params);

    // Cuando se filtra por producto (caso diésel), se calcula cuánto se recibió de ese
    // producto bajo la OC de cada factura y cuánto ya se despachó en salidas de diésel
    // que referencian esa factura, para mostrar el saldo disponible por comprobante.
    let saldoSelect = '';
    let saldoJoin = '';
    const saldoParams = [];
    if (producto_id) {
      saldoSelect = `,
              COALESCE(ocd.cantidad_recibida, 0) as cantidad_recibida,
              COALESCE(desp.despachado, 0) as cantidad_despachada,
              (COALESCE(ocd.cantidad_recibida, 0) - COALESCE(desp.despachado, 0)) as saldo_disponible`;
      saldoJoin = `
       LEFT JOIN (
         SELECT orden_compra_id, SUM(cantidad_recibida) as cantidad_recibida
         FROM maquicombus_orden_compra_detalles WHERE producto_id = ? GROUP BY orden_compra_id
       ) ocd ON ocd.orden_compra_id = f.orden_compra_id
       LEFT JOIN (
         SELECT factura_id, SUM(cantidad) as despachado
         FROM maquicombus_salida_detalles WHERE es_diesel = 1 AND producto_id = ? GROUP BY factura_id
       ) desp ON desp.factura_id = f.id`;
      saldoParams.push(producto_id, producto_id);
    }

    const [rows] = await pool.query(
      `SELECT f.*, cl.razon_social as cliente_nombre, oc.numero as oc_numero, oc.url_factura as oc_url_factura,
              COALESCE(oc.es_reserva, 0) as es_reserva,
              ua.nombre as anulada_por_nombre${saldoSelect}
       FROM maquicombus_facturas f
       JOIN maquicombus_clientes cl ON f.cliente_id = cl.id
       LEFT JOIN maquicombus_ordenes_compra oc ON f.orden_compra_id = oc.id
       LEFT JOIN maquicombus_usuarios ua ON f.anulada_por = ua.id
       ${saldoJoin}
       ${where} ORDER BY f.fecha DESC LIMIT ? OFFSET ?`,
      [...saldoParams, ...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener erp_facturas' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT f.*, cl.razon_social as cliente_nombre FROM maquicombus_facturas f JOIN maquicombus_clientes cl ON f.cliente_id = cl.id WHERE f.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/', async (req, res) => {
  const { serie, numero, fecha, cliente_id, orden_compra_id, subtotal, igv, total, tipo, observaciones } = req.body;
  if (!serie || !numero || !fecha || !cliente_id || !total) {
    return res.status(400).json({ error: 'Serie, número, fecha, cliente y total son requeridos' });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO maquicombus_facturas (serie, numero, fecha, cliente_id, orden_compra_id, subtotal, igv, total, tipo, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [serie, numero, fecha, cliente_id, orden_compra_id || null, subtotal || 0, igv || 0, total, tipo || 'factura', observaciones || null, req.user.id]
    );
    const [row] = await pool.query('SELECT * FROM maquicombus_facturas WHERE id = ?', [result.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una factura con esa serie/número o para esa orden de compra' });
    res.status(500).json({ error: 'Error al registrar factura' });
  }
});

router.put('/:id/estado', async (req, res) => {
  const { estado } = req.body;
  try {
    await pool.query('UPDATE maquicombus_facturas SET estado = ? WHERE id = ?', [estado, req.params.id]);
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.body.password !== PASSWORD_CONFIRMACION_FACTURA) {
      return res.status(403).json({ error: 'Contraseña de confirmación incorrecta' });
    }

    const [[factura]] = await pool.query('SELECT * FROM maquicombus_facturas WHERE id = ?', [req.params.id]);
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
    if (factura.estado === 'anulada') return res.status(400).json({ error: 'La factura ya está anulada' });

    // Si estaba vinculada a una OC, se guarda el nro_factura/estado que tenía esa OC antes
    // de limpiarlos, para poder restaurarlos exactamente al retornar la factura.
    let ocNroFacturaPrevio = null;
    let ocEstadoPrevio = null;
    if (factura.orden_compra_id) {
      const [[oc]] = await pool.query('SELECT nro_factura, estado FROM maquicombus_ordenes_compra WHERE id = ?', [factura.orden_compra_id]);
      if (oc) { ocNroFacturaPrevio = oc.nro_factura; ocEstadoPrevio = oc.estado; }
    }

    // Borrado lógico: se marca como anulada, no se elimina el registro
    await pool.query(
      `UPDATE maquicombus_facturas
       SET estado = 'anulada', estado_anterior = ?, anulada_en = NOW(), anulada_por = ?,
           oc_nro_factura_previo = ?, oc_estado_previo = ?
       WHERE id = ?`,
      [factura.estado, req.user.id, ocNroFacturaPrevio, ocEstadoPrevio, req.params.id]
    );

    // Si estaba vinculada a una OC, limpiar nro_factura y recalcular estado
    if (factura.orden_compra_id) {
      await pool.query('UPDATE maquicombus_ordenes_compra SET nro_factura = NULL WHERE id = ?', [factura.orden_compra_id]);

      const [[{ recCount }]] = await pool.query(
        'SELECT COUNT(*) as recCount FROM maquicombus_recepciones WHERE orden_compra_id = ?',
        [factura.orden_compra_id]
      );

      if (parseInt(recCount) === 0) {
        await pool.query("UPDATE maquicombus_ordenes_compra SET estado = 'emitida' WHERE id = ?", [factura.orden_compra_id]);
      } else {
        const [[stats]] = await pool.query(
          'SELECT SUM(cantidad_pedida) as pedido, SUM(cantidad_recibida) as recibido FROM maquicombus_orden_compra_detalles WHERE orden_compra_id = ?',
          [factura.orden_compra_id]
        );
        const recibido = parseFloat(stats.recibido || 0);
        const pedido   = parseFloat(stats.pedido   || 0);
        const nuevoEstado = recibido >= pedido ? 'completada' : 'parcialmente_recibida';
        await pool.query('UPDATE maquicombus_ordenes_compra SET estado = ? WHERE id = ?', [nuevoEstado, factura.orden_compra_id]);
      }
    }

    await registrarAuditoria({
      usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req),
      modulo: 'facturas', accion: 'anular', tabla: 'maquicombus_facturas', registroId: factura.id,
      valorAnterior: { factura, oc_nro_factura_previo: ocNroFacturaPrevio, oc_estado_previo: ocEstadoPrevio },
    });

    res.json({ message: 'Factura eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar factura' });
  }
});

// Retorna (des-anula) una factura eliminada: restaura su estado anterior y, si estaba
// vinculada a una OC, el nro_factura/estado que esa OC tenía antes de anularse.
router.post('/:id/retornar', async (req, res) => {
  try {
    if (req.body.password !== PASSWORD_CONFIRMACION_FACTURA) {
      return res.status(403).json({ error: 'Contraseña de confirmación incorrecta' });
    }

    const [[factura]] = await pool.query('SELECT * FROM maquicombus_facturas WHERE id = ?', [req.params.id]);
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
    if (factura.estado !== 'anulada') return res.status(400).json({ error: 'La factura no está anulada' });

    await pool.query(
      `UPDATE maquicombus_facturas
       SET estado = ?, estado_anterior = NULL, anulada_en = NULL, anulada_por = NULL,
           oc_nro_factura_previo = NULL, oc_estado_previo = NULL
       WHERE id = ?`,
      [factura.estado_anterior || 'registrada', req.params.id]
    );

    if (factura.orden_compra_id && factura.oc_estado_previo) {
      await pool.query(
        'UPDATE maquicombus_ordenes_compra SET nro_factura = ?, estado = ? WHERE id = ?',
        [factura.oc_nro_factura_previo, factura.oc_estado_previo, factura.orden_compra_id]
      );
    }

    await registrarAuditoria({
      usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req),
      modulo: 'facturas', accion: 'retornar', tabla: 'maquicombus_facturas', registroId: factura.id,
      valorAnterior: { factura },
    });

    res.json({ message: 'Factura retornada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al retornar la factura' });
  }
});

module.exports = router;
