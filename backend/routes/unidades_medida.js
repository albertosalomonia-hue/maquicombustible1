const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware, requirePrincipalAccess } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM maquicombus_unidades_medida ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener unidades de medida' });
  }
});

router.post('/', requirePrincipalAccess, async (req, res) => {
  const { codigo, nombre } = req.body;
  if (!codigo || !nombre) return res.status(400).json({ error: 'Código y nombre son requeridos' });
  try {
    const [r] = await pool.query('INSERT INTO maquicombus_unidades_medida (codigo, nombre) VALUES (?, ?)', [codigo, nombre]);
    const [row] = await pool.query('SELECT * FROM maquicombus_unidades_medida WHERE id = ?', [r.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El código ya existe' });
    res.status(500).json({ error: 'Error al crear unidad de medida' });
  }
});

router.put('/:id', requirePrincipalAccess, async (req, res) => {
  const { codigo, nombre, estado } = req.body;
  try {
    await pool.query('UPDATE maquicombus_unidades_medida SET codigo=?, nombre=?, estado=? WHERE id=?', [codigo, nombre, estado || 'activo', req.params.id]);
    const [row] = await pool.query('SELECT * FROM maquicombus_unidades_medida WHERE id=?', [req.params.id]);
    res.json(row[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El código ya existe' });
    res.status(500).json({ error: 'Error al actualizar unidad de medida' });
  }
});

router.delete('/:id', requirePrincipalAccess, async (req, res) => {
  try {
    const [[{ usos }]] = await pool.query(
      'SELECT COUNT(*) as usos FROM maquicombus_productos WHERE unidad_medida_id = ? OR unidad_compra_id = ?',
      [req.params.id, req.params.id]
    );
    if (parseInt(usos) > 0) return res.status(409).json({ error: 'No se puede eliminar: hay productos usando esta unidad de medida' });
    const [r] = await pool.query('DELETE FROM maquicombus_unidades_medida WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Unidad de medida no encontrada' });
    res.json({ message: 'Unidad de medida eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar unidad de medida' });
  }
});

module.exports = router;
