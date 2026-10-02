const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// Proveedores de combustible (grifos/servicentros/gasocentros): ese gasto ya no se
// gestiona en este sistema, se excluye de los KPIs y gráficos de compras del Dashboard.
const CLIENTES_COMBUSTIBLE_IDS = [6, 66, 85, 111, 113, 115, 116, 117, 118, 222, 268, 290, 291, 292, 361, 394, 457];

// GET /api/dashboard/gauges — saldo actual de cada almacén auxiliar, separado en CONSUMO (disponible)
// y RESERVA (reservado), para los medidores del Dashboard.
router.get('/gauges', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.codigo, a.nombre,
              COALESCE(SUM(i.stock_fisico), 0) AS fisico,
              COALESCE(SUM(i.stock_reservado), 0) AS reserva,
              COALESCE(SUM(i.stock_fisico - i.stock_reservado), 0) AS consumo
       FROM maquicombus_almacenes a
       LEFT JOIN maquicombus_inventario i ON i.almacen_id = a.id
       WHERE a.tipo = 'auxiliar' AND a.estado = 'activo'
       GROUP BY a.id ORDER BY a.nombre`
    );
    const almacenes = rows.map(r => ({
      id: r.id, codigo: r.codigo, nombre: r.nombre,
      fisico: parseFloat(r.fisico), consumo: parseFloat(r.consumo), reserva: parseFloat(r.reserva),
    }));
    // Escala de los medidores: el mayor stock físico entre los auxiliares (el fluido se llena
    // en proporción a eso; el saldo real se muestra en galones debajo de cada medidor).
    const escala = Math.max(1, ...almacenes.map(a => a.fisico));
    res.json({ almacenes, escala });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los medidores' });
  }
});

router.get('/', async (req, res) => {
  try {
    const [[comprasMes]] = await pool.query(
      `SELECT COUNT(*) as total_oc, COALESCE(SUM(total), 0) as monto_total
       FROM maquicombus_ordenes_compra
       WHERE MONTH(fecha) = MONTH(CURDATE()) AND YEAR(fecha) = YEAR(CURDATE()) AND estado != 'anulada'
         AND cliente_id NOT IN (?)`,
      [CLIENTES_COMBUSTIBLE_IDS]
    );

    const [[pagosMes]] = await pool.query(
      `SELECT COUNT(*) as total_pagos, COALESCE(SUM(importe), 0) as monto_total
       FROM maquicombus_pagos WHERE MONTH(fecha) = MONTH(CURDATE()) AND YEAR(fecha) = YEAR(CURDATE()) AND estado != 'anulado'`
    );

    const [[inventarioValor]] = await pool.query(
      `SELECT COALESCE(SUM(i.stock_fisico * i.costo_promedio), 0) as valor_total,
              COUNT(DISTINCT i.producto_id) as total_productos
       FROM maquicombus_inventario i JOIN maquicombus_productos p ON i.producto_id = p.id
       WHERE p.estado = 'activo' AND i.stock_fisico <> 0`
    );

    const [stockAlmacen] = await pool.query(
      `SELECT a.nombre, a.tipo,
              COALESCE(SUM(i.stock_fisico * i.costo_promedio), 0) as valor,
              COUNT(DISTINCT i.producto_id) as erp_productos
       FROM maquicombus_almacenes a
       LEFT JOIN maquicombus_inventario i ON a.id = i.almacen_id
       WHERE a.estado = 'activo'
       GROUP BY a.id ORDER BY a.tipo`
    );

    const [productosCriticos] = await pool.query(
      `SELECT p.sku, p.descripcion, p.stock_minimo, a.nombre as almacen,
              COALESCE(i.stock_fisico - i.stock_reservado, 0) as disponible, um.codigo as unidad
       FROM maquicombus_productos p
       LEFT JOIN maquicombus_inventario i ON p.id = i.producto_id
       LEFT JOIN maquicombus_almacenes a ON i.almacen_id = a.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       WHERE p.estado = 'activo' AND COALESCE(i.stock_fisico - i.stock_reservado, 0) <= p.stock_minimo
       LIMIT 10`
    );

    const [ocPendientes] = await pool.query(
      `SELECT oc.numero, cl.razon_social, oc.total, oc.estado, oc.fecha
       FROM maquicombus_ordenes_compra oc JOIN maquicombus_clientes cl ON oc.cliente_id = cl.id
       WHERE oc.estado IN ('emitida', 'parcialmente_recibida')
       ORDER BY oc.fecha LIMIT 5`
    );

    const [cotizacionesRecientes] = await pool.query(
      `SELECT q.numero, cl.razon_social, q.total, q.estado, q.fecha
       FROM maquicombus_cotizaciones q JOIN maquicombus_clientes cl ON q.cliente_id = cl.id
       ORDER BY q.created_at DESC LIMIT 5`
    );

    const [comprasPorMes] = await pool.query(
      `SELECT MONTH(fecha) as mes, MONTHNAME(fecha) as mes_nombre,
              COUNT(*) as cantidad, COALESCE(SUM(total), 0) as total
       FROM maquicombus_ordenes_compra
       WHERE YEAR(fecha) = YEAR(CURDATE()) AND estado != 'anulada'
         AND cliente_id NOT IN (?)
       GROUP BY MONTH(fecha), MONTHNAME(fecha) ORDER BY MONTH(fecha)`,
      [CLIENTES_COMBUSTIBLE_IDS]
    );

    const [consumoPorCC] = await pool.query(
      `SELECT cc.nombre as centro_costo, COALESCE(SUM(oc.total), 0) as ejecutado, cc.presupuesto_anual
       FROM maquicombus_centros_costo cc
       LEFT JOIN maquicombus_ordenes_compra oc ON cc.id = oc.centro_costo_id AND YEAR(oc.fecha) = YEAR(CURDATE()) AND oc.estado != 'anulada'
       WHERE cc.estado = 'activo'
       GROUP BY cc.id ORDER BY ejecutado DESC LIMIT 7`
    );

    const [transferenciasPendientes] = await pool.query(
      `SELECT COUNT(*) as total FROM maquicombus_transferencias WHERE estado = 'pendiente'`
    );

    res.json({
      kpis: {
        compras_mes: { cantidad: comprasMes.total_oc, monto: comprasMes.monto_total },
        pagos_mes: { cantidad: pagosMes.total_pagos, monto: pagosMes.monto_total },
        erp_inventario: { valor: inventarioValor.valor_total, erp_productos: inventarioValor.total_productos },
        transferencias_pendientes: transferenciasPendientes[0]?.total || 0,
      },
      stock_por_almacen: stockAlmacen,
      productos_criticos: productosCriticos,
      oc_pendientes: ocPendientes,
      cotizaciones_recientes: cotizacionesRecientes,
      compras_por_mes: comprasPorMes,
      consumo_por_cc: consumoPorCC,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener datos del dashboard' });
  }
});

module.exports = router;
