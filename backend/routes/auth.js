const router = require('../router').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { registrarAuditoria, getClientIP } = require('../middleware/audit');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol, u.activo, u.almacen_id, u.permisos,
              a.tipo as almacen_tipo, a.nombre as almacen_nombre
       FROM maquicombus_usuarios u LEFT JOIN maquicombus_almacenes a ON u.almacen_id = a.id
       WHERE u.nombre = ?`,
      [usuario]
    );
    if (!rows.length) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const user = rows[0];
    if (!user.activo) return res.status(403).json({ error: 'Usuario desactivado' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    await pool.query('UPDATE maquicombus_usuarios SET ultimo_acceso = NOW() WHERE id = ?', [user.id]);

    let permisos = null;
    try { permisos = user.permisos ? JSON.parse(user.permisos) : null; } catch { permisos = null; }

    const payload = {
      id: user.id, nombre: user.nombre, email: user.email, rol: user.rol,
      almacen_id: user.almacen_id || null,
      almacen_tipo: user.almacen_tipo || null,
      almacen_nombre: user.almacen_nombre || null,
      permisos,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

    await registrarAuditoria({
      usuarioId: user.id,
      usuarioNombre: user.nombre,
      ip: getClientIP(req),
      modulo: 'AUTH',
      accion: 'LOGIN',
      tabla: 'maquicombus_usuarios',
      registroId: user.id,
    });

    res.json({ token, user: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req, res) => {
  await registrarAuditoria({
    usuarioId: req.user.id,
    usuarioNombre: req.user.nombre,
    ip: getClientIP(req),
    modulo: 'AUTH',
    accion: 'LOGOUT',
    tabla: 'maquicombus_usuarios',
    registroId: req.user.id,
  });
  res.json({ message: 'Sesión cerrada' });
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.almacen_id, u.ultimo_acceso, u.permisos,
              a.tipo as almacen_tipo, a.nombre as almacen_nombre
       FROM maquicombus_usuarios u LEFT JOIN maquicombus_almacenes a ON u.almacen_id = a.id
       WHERE u.id = ?`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    let permisos = null;
    try { permisos = rows[0].permisos ? JSON.parse(rows[0].permisos) : null; } catch { permisos = null; }
    res.json({ ...rows[0], permisos });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
  }
  try {
    const [rows] = await pool.query('SELECT password_hash FROM maquicombus_usuarios WHERE id = ?', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Contraseña actual incorrecta' });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE maquicombus_usuarios SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
