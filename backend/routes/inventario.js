const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/erp_inventario - erp_inventario multialmacén
router.get('/', async (req, res) => {
  try {
    const { search, almacen_id, categoria_id, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Cuando se filtra por almacén usamos INNER JOIN para traer solo
    // erp_productos que tienen stock en ese almacén
    const invJoin = almacen_id
      ? `INNER JOIN maquicombus_inventario i ON p.id = i.producto_id AND i.almacen_id = ?`
      : `LEFT JOIN maquicombus_inventario i ON p.id = i.producto_id`;
    const joinParams = almacen_id ? [almacen_id] : [];

    let where = "WHERE p.estado = 'activo'";
    const whereParams = [];
    if (search)      { where += ' AND (p.descripcion LIKE ? OR p.sku LIKE ?)'; whereParams.push(`%${search}%`, `%${search}%`); }
    if (categoria_id){ where += ' AND p.categoria_id = ?'; whereParams.push(categoria_id); }

    const allParams = [...joinParams, ...whereParams];

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(DISTINCT p.id) as total FROM maquicombus_productos p ${invJoin} ${where}`,
      allParams
    );

    const [rows] = await pool.query(
      `SELECT p.id, p.sku, p.descripcion, p.stock_minimo, p.punto_reposicion, p.precio_costo,
              COALESCE(NULLIF(p.familia, ''), 'SIN CATEGORÍA') as categoria_nombre, um.codigo as unidad,
              COALESCE(SUM(i.stock_fisico), 0) as stock_total,
              COALESCE(SUM(i.stock_reservado), 0) as reservado_total,
              COALESCE(SUM(i.stock_fisico - i.stock_reservado), 0) as disponible_total,
              COALESCE(SUM(i.stock_fisico * i.costo_promedio), 0) as valor_total,
              (SELECT GROUP_CONCAT(DISTINCT cc.nombre ORDER BY cc.nombre SEPARATOR ', ')
               FROM maquicombus_orden_compra_detalles ocd
               JOIN maquicombus_ordenes_compra oc ON oc.id = ocd.orden_compra_id
               JOIN maquicombus_centros_costo cc ON cc.id = oc.centro_costo_id
               WHERE ocd.producto_id = p.id) as centro_costo_nombre
       FROM maquicombus_productos p
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       ${invJoin}
       ${where} GROUP BY p.id ORDER BY p.descripcion LIMIT ? OFFSET ?`,
      [...allParams, parseInt(limit), offset]
    );

    // Detalle por almacén (si se filtra, solo el almacén seleccionado)
    const productIds = rows.map(r => r.id);
    let detalleAlmacenes = [];
    if (productIds.length) {
      const detWhere = almacen_id
        ? `WHERE i.producto_id IN (${productIds.map(() => '?').join(',')}) AND i.almacen_id = ?`
        : `WHERE i.producto_id IN (${productIds.map(() => '?').join(',')})`;
      const detParams = almacen_id ? [...productIds, almacen_id] : productIds;
      [detalleAlmacenes] = await pool.query(
        `SELECT i.producto_id, i.almacen_id, a.nombre as almacen_nombre, a.tipo as almacen_tipo,
                i.stock_fisico, i.stock_reservado, (i.stock_fisico - i.stock_reservado) as disponible,
                i.costo_promedio, (i.stock_fisico * i.costo_promedio) as valor
         FROM maquicombus_inventario i
         JOIN maquicombus_almacenes a ON i.almacen_id = a.id
         ${detWhere}`,
        detParams
      );
    }

    const result = rows.map(p => ({
      ...p,
      erp_almacenes: detalleAlmacenes.filter(d => d.producto_id === p.id),
      estado_stock: p.disponible_total <= 0 ? 'sin_stock'
        : p.disponible_total <= p.stock_minimo ? 'critico'
        : p.disponible_total <= p.punto_reposicion ? 'bajo'
        : 'normal',
    }));

    res.json({ data: result, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener erp_inventario' });
  }
});

// GET /api/erp_inventario/resumen - resumen por almacén
router.get('/resumen', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.nombre, a.tipo,
              COUNT(DISTINCT i.producto_id) as total_productos,
              COALESCE(SUM(i.stock_fisico), 0) as stock_total,
              COALESCE(SUM(i.stock_fisico * i.costo_promedio), 0) as valor_total,
              COALESCE(SUM(CASE WHEN (i.stock_fisico - i.stock_reservado) <= p.stock_minimo THEN 1 ELSE 0 END), 0) as productos_criticos
       FROM maquicombus_almacenes a
       LEFT JOIN maquicombus_inventario i ON a.id = i.almacen_id AND i.stock_fisico <> 0
       LEFT JOIN maquicombus_productos p ON i.producto_id = p.id AND p.estado = 'activo'
       WHERE a.estado = 'activo'
       GROUP BY a.id ORDER BY a.tipo, a.nombre`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener resumen' });
  }
});

// GET /api/erp_inventario/criticos - erp_productos con stock bajo
router.get('/criticos', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.sku, p.descripcion, p.stock_minimo, p.punto_reposicion, um.codigo as unidad,
              a.nombre as almacen_nombre,
              i.stock_fisico, (i.stock_fisico - i.stock_reservado) as disponible, i.costo_promedio
       FROM maquicombus_inventario i
       JOIN maquicombus_productos p ON i.producto_id = p.id
       JOIN maquicombus_almacenes a ON i.almacen_id = a.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       WHERE p.estado = 'activo' AND (i.stock_fisico - i.stock_reservado) <= p.punto_reposicion
       ORDER BY (i.stock_fisico - i.stock_reservado) ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
