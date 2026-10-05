const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { getFechaLimiteCierre } = require('../services/cierrePeriodo');
const { registrarAuditoria, getClientIP } = require('../middleware/audit');

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

// POST /api/inventario/recalcular-costos  { aplicar?: boolean }
// Recalcula el costo promedio de cada producto/almacén repitiendo el Kardex en orden (promedio
// ponderado móvil: las entradas promedian con su costo, las salidas no lo cambian). Antes corrige
// recepciones cuyo precio unitario es en realidad el total de la línea de la OC (precio × cantidad
// mayor que el subtotal de una OC de una sola línea): el precio correcto es subtotal / cantidad.
// Sin `aplicar` solo SIMULA (hace todo y deshace la transacción) y devuelve lo que cambiaría.
// No toca recepciones de períodos cerrados.
router.post('/recalcular-costos', async (req, res) => {
  const { rol } = req.user;
  if (rol !== 'admin' && rol !== 'gerente') {
    return res.status(403).json({ error: 'Solo admin o gerente pueden recalcular costos' });
  }
  const aplicar = req.body?.aplicar === true;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const fechaLimite = await getFechaLimiteCierre(conn);

    // 1) Recepciones con el total de la línea cargado como precio unitario.
    const [candidatas] = await conn.query(
      `SELECT rd.id, rd.recepcion_id, rd.producto_id, rd.cantidad_recibida, rd.precio_unitario,
              r.numero, r.fecha, oc.nro_factura, oc.subtotal,
              p.sku, p.descripcion,
              (SELECT COUNT(*) FROM maquicombus_orden_compra_detalles x WHERE x.orden_compra_id = oc.id) AS lineas
       FROM maquicombus_recepcion_detalles rd
       JOIN maquicombus_recepciones r ON r.id = rd.recepcion_id
       JOIN maquicombus_ordenes_compra oc ON oc.id = r.orden_compra_id
       JOIN maquicombus_productos p ON p.id = rd.producto_id
       WHERE r.estado <> 'anulada' AND rd.cantidad_recibida > 0 AND oc.subtotal > 0
         AND rd.precio_unitario * rd.cantidad_recibida > oc.subtotal * 1.02`
    );
    const correcciones = [];
    const bloqueadas = [];
    for (const c of candidatas) {
      if (Number(c.lineas) !== 1) continue; // con varias líneas no se puede deducir el precio
      const nuevo = +(parseFloat(c.subtotal) / parseFloat(c.cantidad_recibida)).toFixed(4);
      const item = {
        recepcion: c.numero, factura: c.nro_factura, sku: c.sku, producto: c.descripcion,
        cantidad: parseFloat(c.cantidad_recibida), precio_actual: parseFloat(c.precio_unitario), precio_nuevo: nuevo,
      };
      if (fechaLimite && String(c.fecha).slice(0, 10) <= String(fechaLimite).slice(0, 10)) { bloqueadas.push(item); continue; }
      await conn.query('UPDATE maquicombus_recepcion_detalles SET precio_unitario = ? WHERE id = ?', [nuevo, c.id]);
      await conn.query(
        `UPDATE maquicombus_kardex SET costo_unitario = ?, valor_total = cantidad * ?
         WHERE tipo_documento IN ('RECEPCION','COMPRA') AND referencia_id = ? AND producto_id = ?`,
        [nuevo, nuevo, c.recepcion_id, c.producto_id]
      );
      await conn.query('UPDATE maquicombus_reservas SET costo_unitario = ? WHERE recepcion_detalle_id = ?', [nuevo, c.id]);
      correcciones.push(item);
    }

    // 2) Repetir el Kardex y recalcular el costo promedio de cada producto/almacén.
    const [movs] = await conn.query(
      `SELECT producto_id, almacen_id, movimiento, cantidad, costo_unitario
       FROM maquicombus_kardex
       ORDER BY producto_id, almacen_id, fecha, (movimiento = 'entrada') DESC, (tipo_documento = 'SALDO_INICIAL') DESC, id`
    );
    const estado = new Map(); // "producto|almacen" -> { qty, avg }
    for (const m of movs) {
      const key = `${m.producto_id}|${m.almacen_id}`;
      const s = estado.get(key) || { qty: 0, avg: 0 };
      const cant = parseFloat(m.cantidad);
      if (m.movimiento === 'entrada') {
        const total = s.qty + cant;
        if (total > 0) s.avg = ((s.qty * s.avg) + (cant * parseFloat(m.costo_unitario))) / total;
        s.qty = total;
      } else {
        s.qty = Math.max(0, s.qty - cant);
      }
      estado.set(key, s);
    }

    const [invRows] = await conn.query(
      `SELECT i.producto_id, i.almacen_id, i.stock_fisico, i.costo_promedio, p.sku, p.descripcion, a.nombre AS almacen
       FROM maquicombus_inventario i
       JOIN maquicombus_productos p ON p.id = i.producto_id
       JOIN maquicombus_almacenes a ON a.id = i.almacen_id`
    );
    const cambios = [];
    for (const r of invRows) {
      const s = estado.get(`${r.producto_id}|${r.almacen_id}`);
      if (!s) continue; // sin Kardex: no hay base para recalcular
      const nuevo = +s.avg.toFixed(4);
      const actual = parseFloat(r.costo_promedio);
      if (Math.abs(nuevo - actual) <= 0.0001) continue;
      const stock = parseFloat(r.stock_fisico);
      cambios.push({
        sku: r.sku, producto: r.descripcion, almacen: r.almacen, stock,
        costo_actual: actual, costo_nuevo: nuevo, valor_actual: +(stock * actual).toFixed(2), valor_nuevo: +(stock * nuevo).toFixed(2),
      });
      await conn.query(
        'UPDATE maquicombus_inventario SET costo_promedio = ? WHERE producto_id = ? AND almacen_id = ?',
        [nuevo, r.producto_id, r.almacen_id]
      );
    }

    if (aplicar) {
      await conn.commit();
      await registrarAuditoria({
        usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req),
        modulo: 'inventario', accion: 'recalcular_costos', tabla: 'maquicombus_inventario', registroId: 0,
        valorAnterior: { correcciones, cambios, bloqueadas },
      });
    } else {
      await conn.rollback();
    }
    res.json({ aplicado: aplicar, correcciones, cambios, bloqueadas });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al recalcular los costos' });
  } finally {
    conn.release();
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
