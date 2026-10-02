const router = require('../router').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// permisos se guarda como JSON (array de módulos) en un TEXT; NULL = acceso a todo.
function parsePermisos(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.almacen_id, u.ultimo_acceso, u.created_at, u.permisos,
              a.nombre as almacen_nombre
       FROM maquicombus_usuarios u LEFT JOIN maquicombus_almacenes a ON u.almacen_id = a.id ORDER BY u.nombre`
    );
    res.json(rows.map(r => ({ ...r, permisos: parsePermisos(r.permisos) })));
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { nombre, email, password, rol, almacen_id, permisos } = req.body;
  if (!nombre || !password) return res.status(400).json({ error: 'Nombre y contraseña son requeridos' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const permisosJson = Array.isArray(permisos) ? JSON.stringify(permisos) : null;
    const [r] = await pool.query(
      'INSERT INTO maquicombus_usuarios (nombre, email, password_hash, rol, almacen_id, permisos) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, email || null, hash, rol || 'almacenero', almacen_id || null, permisosJson]
    );
    const [row] = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.almacen_id, u.permisos, a.nombre as almacen_nombre
       FROM maquicombus_usuarios u LEFT JOIN maquicombus_almacenes a ON u.almacen_id = a.id WHERE u.id = ?`, [r.insertId]
    );
    res.status(201).json({ ...row[0], permisos: parsePermisos(row[0].permisos) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El nombre o email ya existe' });
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { nombre, email, rol, activo, almacen_id, password, permisos } = req.body;
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE maquicombus_usuarios SET password_hash=? WHERE id=?', [hash, req.params.id]);
    }
    const permisosJson = Array.isArray(permisos) ? JSON.stringify(permisos) : null;
    await pool.query(
      'UPDATE maquicombus_usuarios SET nombre=?, email=?, rol=?, activo=?, almacen_id=?, permisos=? WHERE id=?',
      [nombre, email || null, rol, activo !== false ? 1 : 0, almacen_id || null, permisosJson, req.params.id]
    );
    const [row] = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.almacen_id, u.permisos, a.nombre as almacen_nombre
       FROM maquicombus_usuarios u LEFT JOIN maquicombus_almacenes a ON u.almacen_id = a.id WHERE u.id = ?`, [req.params.id]
    );
    res.json({ ...row[0], permisos: parsePermisos(row[0].permisos) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El nombre o email ya existe' });
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const [[usuario]] = await pool.query('SELECT * FROM maquicombus_usuarios WHERE id = ?', [req.params.id]);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (req.user.id === parseInt(req.params.id)) return res.status(409).json({ error: 'No puedes eliminar tu propio usuario' });
    await pool.query('DELETE FROM maquicombus_usuarios WHERE id = ?', [req.params.id]);
    res.json({ message: 'Usuario eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

module.exports = router;
