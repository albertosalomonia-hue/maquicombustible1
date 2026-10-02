const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

async function generarNumero(prefix) {
  const year = new Date().getFullYear();
  const [[{ max }]] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(numero, LENGTH(?)+2) AS UNSIGNED)) as max FROM maquicombus_cotizaciones WHERE numero LIKE ?`,
    [`${prefix}-${year}`, `${prefix}-${year}-%`]
  );
  const seq = (max || 0) + 1;
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}

// GET /api/erp_cotizaciones
router.get('/', async (req, res) => {
  try {
    const { search, estado, cliente_id, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params = [];
    if (search) { where += ' AND (q.numero LIKE ? OR cl.razon_social LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (estado) { where += ' AND q.estado = ?'; params.push(estado); }
    if (cliente_id) { where += ' AND q.cliente_id = ?'; params.push(cliente_id); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM maquicombus_cotizaciones q JOIN maquicombus_clientes cl ON q.cliente_id = cl.id ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT q.*, cl.razon_social as cliente_nombre, cl.numero_documento as cliente_doc,
              cc.nombre as centro_costo_nombre, u.nombre as usuario_nombre
       FROM maquicombus_cotizaciones q
       JOIN maquicombus_clientes cl ON q.cliente_id = cl.id
       JOIN maquicombus_centros_costo cc ON q.centro_costo_id = cc.id
       LEFT JOIN maquicombus_usuarios u ON q.usuario_id = u.id
       ${where} ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener erp_cotizaciones' });
  }
});

// GET /api/erp_cotizaciones/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT q.*, cl.razon_social as cliente_nombre, cl.numero_documento as cliente_doc,
              cc.nombre as centro_costo_nombre
       FROM maquicombus_cotizaciones q
       JOIN maquicombus_clientes cl ON q.cliente_id = cl.id
       JOIN maquicombus_centros_costo cc ON q.centro_costo_id = cc.id
       WHERE q.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cotización no encontrada' });

    const [detalles] = await pool.query(
      `SELECT cd.*, p.sku, p.descripcion as producto_descripcion, um.codigo as unidad
       FROM maquicombus_cotizacion_detalles cd
       JOIN maquicombus_productos p ON cd.producto_id = p.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       WHERE cd.cotizacion_id = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], detalles });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/erp_cotizaciones
router.post('/', async (req, res) => {
  const { fecha, fecha_vigencia, cliente_id, centro_costo_id, proyecto, moneda, tipo_cambio, observaciones, terminos, detalles } = req.body;
  if (!fecha || !cliente_id || !centro_costo_id || !detalles?.length) {
    return res.status(400).json({ error: 'Fecha, cliente, centro de costo y detalles son requeridos' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const numero = await generarNumero('COT');

    let subtotal = 0, igv = 0, total = 0;
    for (const d of detalles) {
      const sub = d.cantidad * d.precio_unitario * (1 - (d.descuento_pct || 0) / 100);
      const igvLine = sub * (d.igv_pct || 18) / 100;
      subtotal += sub;
      igv += igvLine;
      total += sub + igvLine;
    }

    const [result] = await conn.query(
      `INSERT INTO maquicombus_cotizaciones (numero, fecha, fecha_vigencia, cliente_id, centro_costo_id, proyecto, moneda, tipo_cambio, subtotal, igv, total, observaciones, terminos, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero, fecha, fecha_vigencia || null, cliente_id, centro_costo_id, proyecto || null, moneda || 'PEN', tipo_cambio || 1, subtotal, igv, total, observaciones || null, terminos || null, req.user.id]
    );

    for (const d of detalles) {
      const sub = d.cantidad * d.precio_unitario * (1 - (d.descuento_pct || 0) / 100);
      const totalLinea = sub * (1 + (d.igv_pct || 18) / 100);
      await conn.query(
        `INSERT INTO maquicombus_cotizacion_detalles (cotizacion_id, producto_id, descripcion, cantidad, unidad, precio_unitario, descuento_pct, igv_pct, subtotal, total_linea) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, d.producto_id, d.descripcion || null, d.cantidad, d.unidad || null, d.precio_unitario, d.descuento_pct || 0, d.igv_pct || 18, sub, totalLinea]
      );
    }

    await conn.commit();
    const [newRow] = await pool.query('SELECT * FROM maquicombus_cotizaciones WHERE id = ?', [result.insertId]);
    res.status(201).json(newRow[0]);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al crear cotización' });
  } finally {
    conn.release();
  }
});

// PUT /api/erp_cotizaciones/:id/estado
router.put('/:id/estado', async (req, res) => {
  const { estado } = req.body;
  const estados = ['borrador', 'enviada', 'aprobada', 'rechazada', 'vencida', 'convertida'];
  if (!estados.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    await pool.query('UPDATE maquicombus_cotizaciones SET estado = ? WHERE id = ?', [estado, req.params.id]);
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

module.exports = router;
