const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/reservas?almacen_id=&producto_id=&con_saldo=1
// Reservas de combustible (cada una asociada a su factura) con su saldo pendiente de salida.
router.get('/', async (req, res) => {
  try {
    const { almacen_id, producto_id, con_saldo } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (almacen_id)  { where += ' AND rv.almacen_id = ?';  params.push(almacen_id); }
    if (producto_id) { where += ' AND rv.producto_id = ?'; params.push(producto_id); }
    if (con_saldo === '1') where += ' AND (rv.cantidad - rv.cantidad_salida) > 0';

    const [rows] = await pool.query(
      `SELECT rv.id, rv.transferencia_id, COALESCE(t.numero, 'ENTRADA') AS transferencia_numero, rv.producto_id,
              p.sku, p.descripcion AS producto_descripcion, rv.almacen_id, a.nombre AS almacen_nombre,
              rv.nro_factura, rv.fecha, rv.cantidad, rv.cantidad_salida,
              (rv.cantidad - rv.cantidad_salida) AS saldo, rv.costo_unitario
       FROM maquicombus_reservas rv
       LEFT JOIN maquicombus_transferencias t ON rv.transferencia_id = t.id
       JOIN maquicombus_productos p ON rv.producto_id = p.id
       JOIN maquicombus_almacenes a ON rv.almacen_id = a.id
       ${where} ORDER BY rv.fecha DESC, rv.id DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las reservas' });
  }
});

module.exports = router;
