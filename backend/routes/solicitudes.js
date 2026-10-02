const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

async function generarNumero() {
  const year = new Date().getFullYear();
  const [[{ max }]] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(numero, 10) AS UNSIGNED)) as max FROM maquicombus_solicitudes_abastecimiento WHERE numero LIKE ?`,
    [`SOL-${year}-%`]
  );
  return `SOL-${year}-${String((max || 0) + 1).padStart(5, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { search, estado, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params = [];
    if (search) { where += ' AND s.numero LIKE ?'; params.push(`%${search}%`); }
    if (estado) { where += ' AND s.estado = ?'; params.push(estado); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM maquicombus_solicitudes_abastecimiento s ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT s.*, as1.nombre as solicitante_nombre, as2.nombre as proveedor_nombre,
              u.nombre as usuario_nombre
       FROM maquicombus_solicitudes_abastecimiento s
       JOIN maquicombus_almacenes as1 ON s.almacen_solicitante_id = as1.id
       JOIN maquicombus_almacenes as2 ON s.almacen_proveedor_id = as2.id
       LEFT JOIN maquicombus_usuarios u ON s.usuario_id = u.id
       ${where} ORDER BY s.fecha DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener solicitudes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, as1.nombre as solicitante_nombre, as2.nombre as proveedor_nombre
       FROM maquicombus_solicitudes_abastecimiento s
       JOIN maquicombus_almacenes as1 ON s.almacen_solicitante_id = as1.id
       JOIN maquicombus_almacenes as2 ON s.almacen_proveedor_id = as2.id
       WHERE s.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Solicitud no encontrada' });

    const [detalles] = await pool.query(
      `SELECT sd.*, p.sku, p.descripcion as producto_descripcion, um.codigo as unidad
       FROM maquicombus_solicitud_detalles sd
       JOIN maquicombus_productos p ON sd.producto_id = p.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       WHERE sd.solicitud_id = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], detalles });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/', async (req, res) => {
  const { almacen_solicitante_id, almacen_proveedor_id, fecha, urgencia, observaciones, detalles } = req.body;
  if (!almacen_solicitante_id || !almacen_proveedor_id || !detalles?.length) {
    return res.status(400).json({ error: 'Almacén solicitante, proveedor y al menos un producto son requeridos' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const numero = await generarNumero();
    const [result] = await conn.query(
      `INSERT INTO maquicombus_solicitudes_abastecimiento (numero, almacen_solicitante_id, almacen_proveedor_id, fecha, urgencia, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [numero, almacen_solicitante_id, almacen_proveedor_id, fecha || new Date().toISOString().slice(0, 10), urgencia || 'normal', observaciones || null, req.user.id]
    );

    for (const d of detalles) {
      if (!d.producto_id || !d.cantidad_solicitada) continue;
      await conn.query(
        `INSERT INTO maquicombus_solicitud_detalles (solicitud_id, producto_id, cantidad_solicitada, cantidad_atendida, observaciones)
         VALUES (?, ?, ?, 0, ?)`,
        [result.insertId, d.producto_id, d.cantidad_solicitada, d.observaciones || null]
      );
    }

    await conn.commit();
    const [newRow] = await pool.query(
      `SELECT s.*, as1.nombre as solicitante_nombre, as2.nombre as proveedor_nombre
       FROM maquicombus_solicitudes_abastecimiento s
       JOIN maquicombus_almacenes as1 ON s.almacen_solicitante_id = as1.id
       JOIN maquicombus_almacenes as2 ON s.almacen_proveedor_id = as2.id
       WHERE s.id = ?`,
      [result.insertId]
    );
    res.status(201).json(newRow[0]);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al registrar solicitud' });
  } finally {
    conn.release();
  }
});

router.put('/:id/estado', async (req, res) => {
  const { estado } = req.body;
  const estados = ['pendiente', 'aprobada', 'atendida', 'rechazada'];
  if (!estados.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    await pool.query('UPDATE maquicombus_solicitudes_abastecimiento SET estado = ? WHERE id = ?', [estado, req.params.id]);
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
