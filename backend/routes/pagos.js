const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

async function generarNumero() {
  const year = new Date().getFullYear();
  const [[{ max }]] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(numero, 10) AS UNSIGNED)) as max FROM maquicombus_pagos WHERE numero LIKE ?`,
    [`PAG-${year}-%`]
  );
  return `PAG-${year}-${String((max || 0) + 1).padStart(5, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { search, estado, cliente_id, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params = [];
    if (search) { where += ' AND (p.numero LIKE ? OR cl.razon_social LIKE ? OR p.numero_operacion LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (estado) { where += ' AND p.estado = ?'; params.push(estado); }
    if (cliente_id) { where += ' AND p.cliente_id = ?'; params.push(cliente_id); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM maquicombus_pagos p JOIN maquicombus_clientes cl ON p.cliente_id = cl.id ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT p.*, cl.razon_social as cliente_nombre, q.numero as cotizacion_numero
       FROM maquicombus_pagos p
       JOIN maquicombus_clientes cl ON p.cliente_id = cl.id
       LEFT JOIN maquicombus_cotizaciones q ON p.cotizacion_id = q.id
       ${where} ORDER BY p.fecha DESC, p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener erp_pagos' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, cl.razon_social as cliente_nombre FROM maquicombus_pagos p
       JOIN maquicombus_clientes cl ON p.cliente_id = cl.id WHERE p.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pago no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/', async (req, res) => {
  const { cotizacion_id, cliente_id, fecha, importe, banco, moneda, tipo_cambio, numero_operacion, medio, observaciones } = req.body;
  if (!cliente_id || !fecha || !importe || !medio) {
    return res.status(400).json({ error: 'Cliente, fecha, importe y medio de pago son requeridos' });
  }
  try {
    const numero = await generarNumero();
    const [result] = await pool.query(
      `INSERT INTO maquicombus_pagos (numero, cotizacion_id, cliente_id, fecha, importe, banco, moneda, tipo_cambio, numero_operacion, medio, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero, cotizacion_id || null, cliente_id, fecha, importe, banco || null, moneda || 'PEN', tipo_cambio || 1, numero_operacion || null, medio, observaciones || null, req.user.id]
    );
    const [row] = await pool.query('SELECT * FROM maquicombus_pagos WHERE id = ?', [result.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar pago' });
  }
});

router.put('/:id/estado', async (req, res) => {
  const { estado } = req.body;
  try {
    await pool.query('UPDATE maquicombus_pagos SET estado = ? WHERE id = ?', [estado, req.params.id]);
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
