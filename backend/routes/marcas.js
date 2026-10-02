const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware, requirePrincipalAccess } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM maquicombus_marcas ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener marcas' });
  }
});

router.post('/', requirePrincipalAccess, async (req, res) => {
  const { nombre, descripcion } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const [r] = await pool.query('INSERT INTO maquicombus_marcas (nombre, descripcion) VALUES (?, ?)', [nombre, descripcion || null]);
    const [row] = await pool.query('SELECT * FROM maquicombus_marcas WHERE id = ?', [r.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'La marca ya existe' });
    res.status(500).json({ error: 'Error al crear marca' });
  }
});

router.put('/:id', requirePrincipalAccess, async (req, res) => {
  const { nombre, descripcion, estado } = req.body;
  try {
    await pool.query('UPDATE maquicombus_marcas SET nombre=?, descripcion=?, estado=? WHERE id=?', [nombre, descripcion || null, estado || 'activo', req.params.id]);
    const [row] = await pool.query('SELECT * FROM maquicombus_marcas WHERE id=?', [req.params.id]);
    res.json(row[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'La marca ya existe' });
    res.status(500).json({ error: 'Error al actualizar marca' });
  }
});

router.delete('/:id', requirePrincipalAccess, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM maquicombus_marcas WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Marca no encontrada' });
    res.json({ message: 'Marca eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar marca' });
  }
});

module.exports = router;
