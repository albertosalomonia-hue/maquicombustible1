const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { registrarAuditoria, getClientIP } = require('../middleware/audit');

router.use(authMiddleware);

// GET /api/erp_clientes
router.get('/', async (req, res) => {
  try {
    const { search, estado, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (razon_social LIKE ? OR numero_documento LIKE ? OR nombre_comercial LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (estado) { where += ' AND estado = ?'; params.push(estado); }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM maquicombus_clientes ${where}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM maquicombus_clientes ${where} ORDER BY razon_social LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener erp_clientes' });
  }
});

// GET /api/erp_clientes/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM maquicombus_clientes WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
});

// POST /api/erp_clientes
router.post('/', async (req, res) => {
  const { tipo_documento, numero_documento, razon_social, nombre_comercial, direccion, contacto, telefono, telefono2, correo, correo2, condicion_comercial, limite_credito } = req.body;
  if (!tipo_documento || !numero_documento || !razon_social) {
    return res.status(400).json({ error: 'Tipo documento, número y razón social son requeridos' });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO maquicombus_clientes (tipo_documento, numero_documento, razon_social, nombre_comercial, direccion, contacto, telefono, telefono2, correo, correo2, condicion_comercial, limite_credito)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tipo_documento, numero_documento, razon_social, nombre_comercial || null, direccion || null, contacto || null, telefono || null, telefono2 || null, correo || null, correo2 || null, condicion_comercial || null, limite_credito || 0]
    );
    const [newRow] = await pool.query('SELECT * FROM maquicombus_clientes WHERE id = ?', [result.insertId]);
    await registrarAuditoria({ usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req), modulo: 'CLIENTES', accion: 'CREAR', tabla: 'maquicombus_clientes', registroId: result.insertId, valorNuevo: newRow[0] });
    res.status(201).json(newRow[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El número de documento ya existe' });
    res.status(500).json({ error: 'Error al crear cliente' });
  }
});

// PUT /api/erp_clientes/:id
router.put('/:id', async (req, res) => {
  const { razon_social, nombre_comercial, direccion, contacto, telefono, telefono2, correo, correo2, condicion_comercial, limite_credito, estado } = req.body;
  try {
    const [old] = await pool.query('SELECT * FROM maquicombus_clientes WHERE id = ?', [req.params.id]);
    if (!old.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    await pool.query(
      `UPDATE maquicombus_clientes SET razon_social=?, nombre_comercial=?, direccion=?, contacto=?, telefono=?, telefono2=?, correo=?, correo2=?, condicion_comercial=?, limite_credito=?, estado=? WHERE id=?`,
      [razon_social, nombre_comercial || null, direccion || null, contacto || null, telefono || null, telefono2 || null, correo || null, correo2 || null, condicion_comercial || null, limite_credito || 0, estado || 'activo', req.params.id]
    );
    const [updated] = await pool.query('SELECT * FROM maquicombus_clientes WHERE id = ?', [req.params.id]);
    await registrarAuditoria({ usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req), modulo: 'CLIENTES', accion: 'ACTUALIZAR', tabla: 'maquicombus_clientes', registroId: req.params.id, valorAnterior: old[0], valorNuevo: updated[0] });
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar cliente' });
  }
});

// DELETE /api/erp_clientes/:id (inactivar)
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE maquicombus_clientes SET estado = "inactivo" WHERE id = ?', [req.params.id]);
    await registrarAuditoria({ usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req), modulo: 'CLIENTES', accion: 'INACTIVAR', tabla: 'maquicombus_clientes', registroId: req.params.id });
    res.json({ message: 'Cliente inactivado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al inactivar cliente' });
  }
});

module.exports = router;
