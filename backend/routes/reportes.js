const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// Ocultas temporalmente del reporte de Saldos de Inventario a pedido del usuario
// (2026-09): categorías que todavía no se van a usar. Quitar este filtro cuando
// corresponda volver a mostrarlas.
const CATEGORIAS_OCULTAS_SALDOS = ['COMBUSTIBLES', 'AGREGADOS', 'ACTIVO', 'MOBILIARIO', 'EQUIPO ELECTRONICO'];

// GET /api/reportes/saldos-inventario
// Listado del saldo actual (real, en vivo) de cada producto por almacén — excluye las
// combinaciones en stock 0. Antes este endpoint cruzaba contra erp_saldos_iniciales
// (una carga de migración de un solo uso); esa tabla quedó vacía y la comparación dejó
// de tener sentido, así que se simplificó a un listado directo de erp_inventario.
router.get('/saldos-inventario', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        p.id AS producto_id, p.sku, p.descripcion,
        COALESCE(NULLIF(p.familia, ''), 'SIN CATEGORÍA') AS categoria,
        um.codigo AS unidad,
        a.id AS almacen_id, a.nombre AS almacen, a.tipo AS almacen_tipo,
        ROUND(i.stock_fisico, 4)                    AS cantidad,
        ROUND(i.costo_promedio, 4)                  AS costo_promedio,
        ROUND(i.stock_fisico * i.costo_promedio, 2) AS valor,
        i.updated_at                                AS fecha
      FROM maquicombus_inventario i
      JOIN maquicombus_productos p ON i.producto_id = p.id
      LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
      JOIN maquicombus_almacenes a ON i.almacen_id = a.id
      WHERE i.stock_fisico <> 0
        AND p.estado = 'activo'
        AND COALESCE(NULLIF(p.familia, ''), 'X') NOT IN (${CATEGORIAS_OCULTAS_SALDOS.map(() => '?').join(',')})
      ORDER BY p.descripcion, a.nombre
    `, CATEGORIAS_OCULTAS_SALDOS);

    const valorTotal = rows.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
    const almacenesDistintos = new Set(rows.map(r => r.almacen_id)).size;

    res.json({
      data: rows,
      resumen: {
        total_items:     rows.length,
        total_almacenes: almacenesDistintos,
        valor_total:     Math.round(valorTotal * 100) / 100,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar reporte: ' + err.message });
  }
});

// GET /api/reportes/conteo-almacenes
// Últimos conteos físicos guardados (una fila por producto/almacén)
router.get('/conteo-almacenes', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT producto_id, almacen_id, cantidad_sistema, cantidad_contada, diferencia,
             estado, usuario_nombre, updated_at
      FROM maquicombus_conteos_almacen
    `);
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el conteo: ' + err.message });
  }
});

// POST /api/reportes/conteo-almacenes
// Guarda (o borra, si cantidad_contada viene vacío) el conteo físico de un producto en
// un almacén. La cantidad del sistema se recalcula al momento de guardar, no se confía
// en lo que el cliente tenga en pantalla.
router.post('/conteo-almacenes', async (req, res) => {
  try {
    const { producto_id, almacen_id, cantidad_contada } = req.body;
    if (!producto_id || !almacen_id) {
      return res.status(400).json({ error: 'producto_id y almacen_id son obligatorios' });
    }

    if (cantidad_contada === '' || cantidad_contada === null || cantidad_contada === undefined) {
      await pool.query('DELETE FROM maquicombus_conteos_almacen WHERE producto_id = ? AND almacen_id = ?', [producto_id, almacen_id]);
      return res.json({ data: null });
    }

    const cantidadContadaNum = parseFloat(cantidad_contada);
    if (isNaN(cantidadContadaNum)) {
      return res.status(400).json({ error: 'cantidad_contada inválida' });
    }

    const [[inv]] = await pool.query(
      'SELECT stock_fisico FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?',
      [producto_id, almacen_id]
    );
    const cantidadSistema = inv ? parseFloat(inv.stock_fisico) : 0;
    const diferencia = Math.round((cantidadContadaNum - cantidadSistema) * 10000) / 10000;
    const estado = Math.abs(diferencia) > 0.009 ? 'desfase' : 'igualdad';

    await pool.query(`
      INSERT INTO maquicombus_conteos_almacen
        (producto_id, almacen_id, cantidad_sistema, cantidad_contada, diferencia, estado, usuario_id, usuario_nombre)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        cantidad_sistema = VALUES(cantidad_sistema),
        cantidad_contada = VALUES(cantidad_contada),
        diferencia       = VALUES(diferencia),
        estado           = VALUES(estado),
        usuario_id       = VALUES(usuario_id),
        usuario_nombre   = VALUES(usuario_nombre)
    `, [producto_id, almacen_id, cantidadSistema, cantidadContadaNum, diferencia, estado, req.user.id, req.user.nombre]);

    res.json({
      data: {
        producto_id, almacen_id,
        cantidad_sistema: cantidadSistema,
        cantidad_contada: cantidadContadaNum,
        diferencia, estado,
        usuario_nombre: req.user.nombre,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el conteo: ' + err.message });
  }
});

// GET /api/reportes/reversiones-salidas
// Listado de las salidas que fueron revertidas. Revertir una salida la borra físicamente
// (ver DELETE /api/salidas/:id), así que la única foto de lo que existió queda en
// erp_auditoria (modulo='salidas', accion='revertir', valor_anterior = snapshot completo).
router.get('/reversiones-salidas', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, usuario_nombre, fecha AS fecha_reversion, valor_anterior
      FROM maquicombus_auditoria
      WHERE modulo = 'salidas' AND accion = 'revertir'
      ORDER BY fecha DESC
    `);

    const data = [];
    for (const r of rows) {
      const snap = r.valor_anterior || {};
      const salida = snap.salida || {};
      const detalles = snap.detalles || [];
      for (const d of detalles) {
        data.push({
          auditoria_id:     r.id,
          salida_id:        salida.id,
          numero:           salida.numero,
          fecha_salida:     salida.fecha,
          almacen:          salida.almacen_nombre,
          solicitante:      salida.solicitante,
          motivo:           salida.motivo,
          sku:              d.sku,
          producto:         d.producto_descripcion,
          unidad:           d.unidad,
          centro_costo:     d.centro_costo_nombre,
          placa:            d.placa,
          cantidad:         d.cantidad,
          costo_unitario:   d.costo_unitario,
          valor_total:      d.valor_total,
          revertido_por:    r.usuario_nombre,
          fecha_reversion:  r.fecha_reversion,
        });
      }
    }

    res.json({
      data,
      resumen: {
        total_reversiones: rows.length,
        total_items:       data.length,
        valor_total:       Math.round(data.reduce((s, d) => s + (parseFloat(d.valor_total) || 0), 0) * 100) / 100,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar reporte: ' + err.message });
  }
});

// POST /api/reportes/saldos-inventario/generar-skus
// Cruza saldos iniciales con productos por descripción/sku y actualiza el campo sku
router.post('/saldos-inventario/generar-skus', async (req, res) => {
  try {
    const [saldos]   = await pool.query('SELECT id, codigo_producto, descripcion_producto FROM maquicombus_saldos_iniciales');
    const [productos] = await pool.query('SELECT id, sku, descripcion FROM maquicombus_productos WHERE estado = ?', ['activo']);

    const norm = (s) => String(s || '').trim().toUpperCase()
      .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I').replace(/Ó/g,'O').replace(/Ú/g,'U')
      .replace(/\s+/g,' ');

    let actualizados = 0;
    let sinMatch     = 0;

    for (const saldo of saldos) {
      // 1. SKU exacto
      let prod = productos.find(p => norm(p.sku) === norm(saldo.codigo_producto));
      // 2. Descripción exacta normalizada
      if (!prod) prod = productos.find(p => norm(p.descripcion) === norm(saldo.descripcion_producto));

      if (prod) {
        await pool.query('UPDATE maquicombus_saldos_iniciales SET sku = ? WHERE id = ?', [prod.sku, saldo.id]);
        actualizados++;
      } else {
        sinMatch++;
      }
    }

    res.json({
      actualizados,
      sin_match: sinMatch,
      total: saldos.length,
      mensaje: `${actualizados} SKUs asignados, ${sinMatch} sin coincidencia`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar SKUs: ' + err.message });
  }
});

// PATCH /api/reportes/saldos-inventario/sku/:id — actualiza sku manualmente
router.patch('/saldos-inventario/sku/:id', async (req, res) => {
  try {
    const { sku } = req.body;
    await pool.query('UPDATE maquicombus_saldos_iniciales SET sku = ? WHERE id = ?', [sku || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar SKU' });
  }
});

// GET /api/reportes/detalle-ordenes-compra
// Todos los productos de todas las OC emitidas (excluye borrador y anulada)
router.get('/detalle-ordenes-compra', async (req, res) => {
  try {
    const { search, estado, almacen_central } = req.query;

    let where = `WHERE oc.estado NOT IN ('borrador','anulada')`;
    const params = [];

    if (estado) { where += ' AND oc.estado = ?'; params.push(estado); }
    if (almacen_central === '1') { where += ' AND oc.almacen_central = 1'; }
    if (search) {
      where += ` AND (p.sku LIKE ? OR p.descripcion LIKE ? OR d.descripcion LIKE ? OR oc.numero LIKE ? OR cl.razon_social LIKE ?)`;
      const q = `%${search}%`;
      params.push(q, q, q, q, q);
    }

    const [rows] = await pool.query(`
      SELECT
        d.id                                    AS detalle_id,
        oc.id                                   AS oc_id,
        oc.numero                               AS oc_numero,
        oc.fecha,
        oc.estado,
        oc.moneda,
        oc.almacen_central,
        oc.nro_factura,
        cl.razon_social                         AS proveedor,
        cc.nombre                               AS centro_costo,
        p.sku,
        COALESCE(d.descripcion, p.descripcion)  AS descripcion,
        d.cantidad_pedida,
        d.cantidad_recibida,
        d.precio_unitario,
        d.descuento_pct,
        d.igv_pct,
        d.subtotal
      FROM maquicombus_orden_compra_detalles d
      JOIN maquicombus_ordenes_compra  oc ON d.orden_compra_id = oc.id
      JOIN maquicombus_productos        p ON d.producto_id     = p.id
      LEFT JOIN maquicombus_clientes   cl ON oc.cliente_id     = cl.id
      LEFT JOIN maquicombus_centros_costo cc ON oc.centro_costo_id = cc.id
      ${where}
      ORDER BY oc.fecha DESC, oc.numero, p.descripcion
    `, params);

    const ocIds = new Set(rows.map(r => r.oc_id));
    const valorTotal     = rows.reduce((s, r) => s + parseFloat(r.subtotal || 0), 0);
    const valorCentral   = rows.filter(r => r.almacen_central).reduce((s, r) => s + parseFloat(r.subtotal || 0), 0);

    res.json({
      data: rows,
      resumen: {
        total_lineas:     rows.length,
        total_ordenes:    ocIds.size,
        valor_total:      Math.round(valorTotal   * 100) / 100,
        valor_central:    Math.round(valorCentral * 100) / 100,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar reporte: ' + err.message });
  }
});

// Nombres reales de obra para el "Nivel 1" del reporte por familias — el código es el
// primer tramo del centro de costo (antes del primer guion, p.ej. "1001" de "1001-102-3A").
// Provisto a mano por el usuario; lo que no está aquí (p.ej. "TEST") se muestra con su
// código tal cual en vez de ocultarlo, para no perder centros de costo nuevos que todavía
// no se hayan agregado a este mapa.
const NOMBRES_NIVEL1 = {
  '1001': 'PROYECTO LAR',
  '1002': 'PROYECTO GASPAR HERNANDEZ',
  '1003': 'PROYECTO PARQUES DE SAN JUAN',
  '1004': 'PROYECTO ALAMEDA CENTRAL',
  '1005': 'PROYECTO CENTRIQO',
  '1006': 'PROYECTO STRIP MALL',
  '1007': 'PROYECTO INDEPENDENCIA',
  '1008': 'OFICINA',
  '1009': 'PROYECTO CALLAO',
  '1010': 'PROYECTO PARQUES DE COMAS',
  '1011': 'PROYECTO DORUE',
  '1012': 'SERVICIOS A TERCEROS',
  '1013': 'SERVICIOS TMA',
  '1014': 'HUACHIPA - LAS GARZAS',
  '1015': 'HUACHIPA - LAS PALOMAS',
  'MTTO': 'GESTION DE MTTO',
};

function resolverNivel1(centroCosto) {
  const codigo = centroCosto.split('-')[0].toUpperCase();
  return NOMBRES_NIVEL1[codigo] || codigo;
}

// GET /api/reportes/salidas-por-familia
// Reporte "por Familias": para cada familia de producto, los ítems que la componen,
// la(s) obra(s) (centro de costo) a las que se destinó cada salida, la cantidad
// despachada mes a mes y el total. Se arma en dos pasos: una consulta plana agregada
// por (familia, producto, centro de costo, mes) y luego se anida en JS para que el
// frontend (y el export a Excel) puedan recorrer familia → ítem → obra → mes sin
// tener que reprocesar filas planas.
router.get('/salidas-por-familia', async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta, familia, centro_costo_id, almacen_id, search } = req.query;

    let where = "WHERE (s.anulada = 0 OR s.anulada IS NULL)";
    const params = [];
    if (fecha_desde)      { where += ' AND s.fecha >= ?'; params.push(fecha_desde); }
    if (fecha_hasta)      { where += ' AND s.fecha <= ?'; params.push(fecha_hasta); }
    if (familia)          { where += ' AND COALESCE(NULLIF(p.familia,\'\'), \'SIN FAMILIA\') = ?'; params.push(familia); }
    if (centro_costo_id)  { where += ' AND sd.centro_costo_id = ?'; params.push(centro_costo_id); }
    if (almacen_id)       { where += ' AND s.almacen_id = ?'; params.push(almacen_id); }
    if (search) {
      where += ' AND (p.sku LIKE ? OR p.descripcion LIKE ? OR cc.nombre LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    const [rows] = await pool.query(`
      SELECT
        COALESCE(NULLIF(p.familia,''), 'SIN FAMILIA') AS familia,
        p.id AS producto_id, p.sku, p.descripcion, um.codigo AS unidad,
        cc.id AS centro_costo_id,
        COALESCE(cc.nombre, 'SIN CENTRO DE COSTO') AS obra,
        DATE_FORMAT(s.fecha, '%Y-%m') AS periodo,
        SUM(sd.cantidad) AS cantidad,
        SUM(sd.valor_total) AS valor
      FROM maquicombus_salida_detalles sd
      JOIN maquicombus_salidas s ON sd.salida_id = s.id
      JOIN maquicombus_productos p ON sd.producto_id = p.id
      LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
      LEFT JOIN maquicombus_centros_costo cc ON sd.centro_costo_id = cc.id
      ${where}
      GROUP BY familia, p.id, cc.id, periodo
      ORDER BY familia, p.descripcion, obra, periodo
    `, params);

    // Períodos (años-mes) distintos presentes en el resultado, ordenados — son las
    // columnas dinámicas de la tabla/pivote en el frontend y en el Excel.
    const periodos = [...new Set(rows.map(r => r.periodo))].sort();

    const familiasMap = new Map();
    for (const r of rows) {
      if (!familiasMap.has(r.familia)) {
        familiasMap.set(r.familia, { familia: r.familia, items: new Map(), total_cantidad: 0, total_valor: 0 });
      }
      const fam = familiasMap.get(r.familia);

      if (!fam.items.has(r.producto_id)) {
        fam.items.set(r.producto_id, {
          producto_id: r.producto_id, sku: r.sku, descripcion: r.descripcion, unidad: r.unidad,
          obras: new Map(), total_cantidad: 0, total_valor: 0,
        });
      }
      const item = fam.items.get(r.producto_id);

      const claveObra = r.centro_costo_id ?? 'sin-cc';
      if (!item.obras.has(claveObra)) {
        item.obras.set(claveObra, {
          // "Nivel 1" es el nombre real de la obra, resuelto a partir del primer tramo del
          // código de centro de costo (antes del primer guion) vía NOMBRES_NIVEL1 — el
          // resto del código (área, mes, sub-frente, etc.) queda en "obra" completo.
          centro_costo_id: r.centro_costo_id, obra: r.obra, nivel1: resolverNivel1(r.obra),
          meses: {}, total_cantidad: 0, total_valor: 0,
        });
      }
      const obra = item.obras.get(claveObra);

      const cant = parseFloat(r.cantidad) || 0;
      const val  = parseFloat(r.valor) || 0;
      obra.meses[r.periodo] = { cantidad: cant, valor: Math.round(val * 100) / 100 };
      obra.total_cantidad += cant;
      obra.total_valor    += val;
      item.total_cantidad += cant;
      item.total_valor    += val;
      fam.total_cantidad  += cant;
      fam.total_valor     += val;
    }

    const familias = [...familiasMap.values()]
      .sort((a, b) => a.familia.localeCompare(b.familia))
      .map(fam => ({
        familia: fam.familia,
        total_cantidad: Math.round(fam.total_cantidad * 10000) / 10000,
        total_valor: Math.round(fam.total_valor * 100) / 100,
        items: [...fam.items.values()]
          .sort((a, b) => a.descripcion.localeCompare(b.descripcion))
          .map(item => ({
            producto_id: item.producto_id, sku: item.sku, descripcion: item.descripcion, unidad: item.unidad,
            total_cantidad: Math.round(item.total_cantidad * 10000) / 10000,
            total_valor: Math.round(item.total_valor * 100) / 100,
            obras: [...item.obras.values()]
              .sort((a, b) => a.obra.localeCompare(b.obra))
              .map(obra => ({
                centro_costo_id: obra.centro_costo_id, obra: obra.obra, nivel1: obra.nivel1,
                meses: obra.meses,
                total_cantidad: Math.round(obra.total_cantidad * 10000) / 10000,
                total_valor: Math.round(obra.total_valor * 100) / 100,
              })),
          })),
      }));

    const totalObras = new Set(rows.map(r => r.centro_costo_id ?? 'sin-cc')).size;
    const totalItems = new Set(rows.map(r => r.producto_id)).size;
    const totalCantidad = rows.reduce((s, r) => s + (parseFloat(r.cantidad) || 0), 0);
    const totalValor    = rows.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);

    res.json({
      periodos,
      familias,
      resumen: {
        total_familias: familias.length,
        total_items: totalItems,
        total_obras: totalObras,
        total_cantidad: Math.round(totalCantidad * 10000) / 10000,
        total_valor: Math.round(totalValor * 100) / 100,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar reporte: ' + err.message });
  }
});

// GET /api/reportes/actividad-usuarios
// Verifica ingresos a la aplicación (LOGIN/LOGOUT en erp_auditoria, módulo AUTH)
// y calcula horas de conexión por usuario emparejando cada LOGIN con su LOGOUT.
router.get('/actividad-usuarios', async (req, res) => {
  try {
    const CAP_HORAS = 8; // tope de una sesión abierta sin LOGOUT registrado (= expiración del token)
    const CAP_MS = CAP_HORAS * 60 * 60 * 1000;

    // OJO: el orden es por fecha dentro de cada usuario_id (NUNCA por usuario_nombre,
    // que puede cambiar a mitad del historial si el usuario fue renombrado y rompería
    // la cronología necesaria para emparejar LOGIN/LOGOUT correctamente).
    const [eventos] = await pool.query(
      `SELECT usuario_id, usuario_nombre, accion, fecha, ip
       FROM maquicombus_auditoria
       WHERE modulo = 'AUTH' AND accion IN ('LOGIN', 'LOGOUT')
       ORDER BY COALESCE(usuario_id, 0), fecha ASC`
    );

    const porUsuario = new Map();
    for (const ev of eventos) {
      const key = ev.usuario_id ?? `nombre:${ev.usuario_nombre}`;
      if (!porUsuario.has(key)) {
        porUsuario.set(key, {
          usuario_id: ev.usuario_id,
          usuario_nombre: ev.usuario_nombre,
          ultima_ip: null,
          total_ingresos: 0,
          ultimo_login: null,
          duracionMs: 0,
          openLogin: null,
          en_linea: false,
        });
      }
      const u = porUsuario.get(key);
      const fecha = new Date(ev.fecha);
      u.usuario_nombre = ev.usuario_nombre; // conserva el nombre más reciente (puede haber sido renombrado)

      if (ev.accion === 'LOGIN') {
        // Si había una sesión previa sin LOGOUT, se cierra de forma implícita (tope CAP_HORAS)
        if (u.openLogin) {
          u.duracionMs += Math.max(0, Math.min(fecha - u.openLogin, CAP_MS));
        }
        u.openLogin = fecha;
        u.total_ingresos += 1;
        u.ultimo_login = fecha;
        u.ultima_ip = ev.ip;
      } else if (ev.accion === 'LOGOUT' && u.openLogin) {
        u.duracionMs += Math.max(0, Math.min(fecha - u.openLogin, CAP_MS));
        u.openLogin = null;
      }
    }

    const ahora = Date.now();
    const data = Array.from(porUsuario.values()).map(u => {
      let horas = u.duracionMs;
      let enLinea = false;
      if (u.openLogin) {
        const transcurrido = ahora - u.openLogin;
        enLinea = transcurrido < CAP_MS;
        horas += Math.min(transcurrido, CAP_MS);
      }
      return {
        usuario_id: u.usuario_id,
        usuario_nombre: u.usuario_nombre,
        ultima_ip: u.ultima_ip,
        total_ingresos: u.total_ingresos,
        ultimo_login: u.ultimo_login,
        horas_conectado: Math.round((horas / 3600000) * 100) / 100,
        en_linea: enLinea,
      };
    }).sort((a, b) => (b.ultimo_login || 0) - (a.ultimo_login || 0));

    res.json({ data, cap_horas_sesion: CAP_HORAS });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar reporte: ' + err.message });
  }
});

module.exports = router;
