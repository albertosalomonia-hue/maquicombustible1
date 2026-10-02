const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware, requirePrincipalAccess } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM maquicombus_categorias ORDER BY nombre");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/', async (req, res) => {
  const { nombre, descripcion } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const [r] = await pool.query('INSERT INTO maquicombus_categorias (nombre, descripcion) VALUES (?, ?)', [nombre, descripcion || null]);
    const [row] = await pool.query('SELECT * FROM maquicombus_categorias WHERE id = ?', [r.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

router.put('/:id', async (req, res) => {
  const { nombre, descripcion, estado } = req.body;
  try {
    await pool.query('UPDATE maquicombus_categorias SET nombre=?, descripcion=?, estado=? WHERE id=?', [nombre, descripcion || null, estado || 'activo', req.params.id]);
    const [row] = await pool.query('SELECT * FROM maquicombus_categorias WHERE id=?', [req.params.id]);
    res.json(row[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

router.delete('/:id', requirePrincipalAccess, async (req, res) => {
  try {
    const [[{ usos }]] = await pool.query('SELECT COUNT(*) as usos FROM maquicombus_productos WHERE categoria_id = ?', [req.params.id]);
    if (parseInt(usos) > 0) return res.status(409).json({ error: 'No se puede eliminar: hay productos asignados a esta categoría' });
    const [r] = await pool.query('DELETE FROM maquicombus_categorias WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ message: 'Categoría eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

module.exports = router;
