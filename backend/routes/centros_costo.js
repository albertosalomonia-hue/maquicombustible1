const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cc.*,
              COALESCE((SELECT SUM(total) FROM maquicombus_cotizaciones c WHERE c.centro_costo_id = cc.id AND c.estado IN ('aprobada','convertida') AND YEAR(c.fecha) = YEAR(CURDATE())), 0) as ejecutado_anual
       FROM maquicombus_centros_costo cc ORDER BY cc.nombre`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener centros de costo' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM maquicombus_centros_costo WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Centro de costo no encontrado' });

    const [presupuesto] = await pool.query(
      'SELECT * FROM maquicombus_presupuesto_mensual WHERE centro_costo_id = ? AND anio = YEAR(CURDATE()) ORDER BY mes',
      [req.params.id]
    );
    res.json({ ...rows[0], presupuesto_mensual_detalle: presupuesto });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/', async (req, res) => {
  const { codigo, nombre, descripcion, presupuesto_anual, presupuesto_mensual, alerta_porcentaje, bloqueo_porcentaje } = req.body;
  if (!codigo || !nombre) return res.status(400).json({ error: 'Código y nombre son requeridos' });
  try {
    const [result] = await pool.query(
      'INSERT INTO maquicombus_centros_costo (codigo, nombre, descripcion, presupuesto_anual, presupuesto_mensual, alerta_porcentaje, bloqueo_porcentaje) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [codigo, nombre, descripcion || null, presupuesto_anual || 0, presupuesto_mensual || 0, alerta_porcentaje || 80, bloqueo_porcentaje || 100]
    );
    const [row] = await pool.query('SELECT * FROM maquicombus_centros_costo WHERE id = ?', [result.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El código ya existe' });
    res.status(500).json({ error: 'Error al crear centro de costo' });
  }
});

router.put('/:id', async (req, res) => {
  const { codigo, nombre, descripcion, presupuesto_anual, presupuesto_mensual, alerta_porcentaje, bloqueo_porcentaje, estado } = req.body;
  try {
    await pool.query(
      'UPDATE maquicombus_centros_costo SET codigo=?, nombre=?, descripcion=?, presupuesto_anual=?, presupuesto_mensual=?, alerta_porcentaje=?, bloqueo_porcentaje=?, estado=? WHERE id=?',
      [codigo, nombre, descripcion || null, presupuesto_anual || 0, presupuesto_mensual || 0, alerta_porcentaje || 80, bloqueo_porcentaje || 100, estado || 'activo', req.params.id]
    );
    const [row] = await pool.query('SELECT * FROM maquicombus_centros_costo WHERE id = ?', [req.params.id]);
    res.json(row[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

module.exports = router;
