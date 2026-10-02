const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware, requirePrincipalAccess } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { producto_id, almacen_id, estado, search } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (producto_id) { where += ' AND pl.producto_id = ?'; params.push(producto_id); }
    if (almacen_id)  { where += ' AND pl.almacen_id = ?'; params.push(almacen_id); }
    if (estado)      { where += ' AND pl.estado = ?'; params.push(estado); }
    if (req.query.tipo) { where += ' AND pl.tipo = ?'; params.push(req.query.tipo); }
    if (search)      { where += ' AND (pl.placa LIKE ? OR pl.descripcion LIKE ? OR p.descripcion LIKE ? OR p.sku LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }

    const [rows] = await pool.query(
      `SELECT pl.*, p.sku, p.descripcion as producto_descripcion, a.nombre as almacen_nombre
       FROM maquicombus_equipos_placas pl
       LEFT JOIN maquicombus_productos p ON pl.producto_id = p.id
       LEFT JOIN maquicombus_almacenes a ON pl.almacen_id = a.id
       ${where} ORDER BY pl.placa`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener placas' });
  }
});

router.post('/', requirePrincipalAccess, async (req, res) => {
  const { placa, tipo, descripcion, observaciones } = req.body;
  if (!placa) return res.status(400).json({ error: 'La placa/código es requerida' });
  try {
    const [result] = await pool.query(
      'INSERT INTO maquicombus_equipos_placas (placa, tipo, descripcion, observaciones) VALUES (?, ?, ?, ?)',
      [placa.trim(), tipo === 'maquinaria' ? 'maquinaria' : 'vehiculo', (descripcion || '').trim() || null, observaciones || null]
    );
    const [row] = await pool.query('SELECT * FROM maquicombus_equipos_placas WHERE id = ?', [result.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Esa placa/código ya está registrada' });
    console.error(err);
    res.status(500).json({ error: 'Error al crear la placa' });
  }
});

router.put('/:id', requirePrincipalAccess, async (req, res) => {
  const { placa, tipo, descripcion, estado, observaciones } = req.body;
  if (!placa) return res.status(400).json({ error: 'La placa/código es requerida' });
  try {
    await pool.query(
      'UPDATE maquicombus_equipos_placas SET placa=?, tipo=?, descripcion=?, estado=?, observaciones=? WHERE id=?',
      [placa.trim(), tipo === 'maquinaria' ? 'maquinaria' : 'vehiculo', (descripcion || '').trim() || null, estado || 'disponible', observaciones || null, req.params.id]
    );
    const [row] = await pool.query('SELECT * FROM maquicombus_equipos_placas WHERE id = ?', [req.params.id]);
    if (!row.length) return res.status(404).json({ error: 'Placa no encontrada' });
    res.json(row[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Esa placa/código ya está registrada' });
    res.status(500).json({ error: 'Error al actualizar la placa' });
  }
});

router.delete('/:id', requirePrincipalAccess, async (req, res) => {
  try {
    const [[{ usos }]] = await pool.query(
      'SELECT COUNT(*) as usos FROM maquicombus_salida_detalles WHERE placa_id = ?', [req.params.id]
    );
    if (parseInt(usos) > 0) return res.status(409).json({ error: 'No se puede eliminar: la placa tiene salidas registradas' });

    const [result] = await pool.query('DELETE FROM maquicombus_equipos_placas WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Placa no encontrada' });
    res.json({ message: 'Placa eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar la placa' });
  }
});

module.exports = router;
