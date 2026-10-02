const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { tipo, estado } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (tipo) { where += ' AND a.tipo = ?'; params.push(tipo); }
    if (estado) { where += ' AND a.estado = ?'; params.push(estado); }

    const [rows] = await pool.query(
      `SELECT a.*, u.nombre as responsable_nombre FROM maquicombus_almacenes a
       LEFT JOIN maquicombus_usuarios u ON a.responsable_id = u.id
       ${where} ORDER BY a.tipo, a.nombre`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener erp_almacenes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, u.nombre as responsable_nombre FROM maquicombus_almacenes a
       LEFT JOIN maquicombus_usuarios u ON a.responsable_id = u.id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Almacén no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

router.get('/:id/erp_inventario', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, p.sku, p.descripcion, p.stock_minimo, p.punto_reposicion,
              um.codigo as unidad,
              (i.stock_fisico - i.stock_reservado) as stock_disponible,
              (i.stock_fisico * i.costo_promedio) as valor_total,
              CASE WHEN (i.stock_fisico - i.stock_reservado) <= p.stock_minimo THEN 'critico'
                   WHEN (i.stock_fisico - i.stock_reservado) <= p.punto_reposicion THEN 'bajo'
                   ELSE 'normal' END as estado_stock
       FROM maquicombus_inventario i
       JOIN maquicombus_productos p ON i.producto_id = p.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       WHERE i.almacen_id = ? AND p.estado = 'activo'
       ORDER BY p.descripcion`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener erp_inventario del almacén' });
  }
});

router.post('/', async (req, res) => {
  const { codigo, nombre, tipo, descripcion, responsable_id } = req.body;
  if (!codigo || !nombre || !tipo) return res.status(400).json({ error: 'Código, nombre y tipo son requeridos' });
  try {
    const [result] = await pool.query(
      'INSERT INTO maquicombus_almacenes (codigo, nombre, tipo, descripcion, responsable_id) VALUES (?, ?, ?, ?, ?)',
      [codigo, nombre, tipo, descripcion || null, responsable_id || null]
    );
    const [row] = await pool.query('SELECT * FROM maquicombus_almacenes WHERE id = ?', [result.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El código de almacén ya existe' });
    res.status(500).json({ error: 'Error al crear almacén' });
  }
});

router.put('/:id', async (req, res) => {
  const { codigo, nombre, tipo, descripcion, responsable_id, estado } = req.body;
  try {
    await pool.query(
      'UPDATE maquicombus_almacenes SET codigo=?, nombre=?, tipo=?, descripcion=?, responsable_id=?, estado=? WHERE id=?',
      [codigo, nombre, tipo, descripcion || null, responsable_id || null, estado || 'activo', req.params.id]
    );
    const [row] = await pool.query('SELECT * FROM maquicombus_almacenes WHERE id = ?', [req.params.id]);
    res.json(row[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar almacén' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [[almacen]] = await pool.query('SELECT * FROM maquicombus_almacenes WHERE id = ?', [req.params.id]);
    if (!almacen) return res.status(404).json({ error: 'Almacén no encontrado' });
    const [[{ usos }]] = await pool.query(
      'SELECT COUNT(*) as usos FROM maquicombus_inventario WHERE almacen_id = ?', [req.params.id]
    );
    if (parseInt(usos) > 0) return res.status(409).json({ error: 'No se puede eliminar: el almacén tiene inventario registrado' });
    await pool.query('DELETE FROM maquicombus_almacenes WHERE id = ?', [req.params.id]);
    res.json({ message: 'Almacén eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar almacén' });
  }
});

module.exports = router;
