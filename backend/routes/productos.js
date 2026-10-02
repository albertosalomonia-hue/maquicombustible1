const router = require('../router').Router();
const multer = require('../router').multer;
const XLSX = require('xlsx');
const { pool } = require('../db');
const { authMiddleware, requirePrincipalAccess } = require('../middleware/auth');
const { sincronizarProductosNuevosDeHoy } = require('../services/syncProductosLegacy');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware);

function normKey(k) {
  return k.toString().trim().toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]/g, '');
}

function getField(row, ...names) {
  const map = {};
  for (const k of Object.keys(row)) map[normKey(k)] = row[k];
  for (const n of names) {
    const v = map[normKey(n)];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function parseFecha(val) {
  if (val instanceof Date && !isNaN(val)) return val.toISOString().slice(0, 10);
  const s = val === undefined || val === null ? '' : String(val).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return new Date().toISOString().slice(0, 10);
}

// GET /api/erp_productos
router.get('/', async (req, res) => {
  try {
    const { search, categoria_id, estado, fecha_desde, fecha_hasta, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (p.descripcion LIKE ? OR p.sku LIKE ? OR p.codigo_interno LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoria_id) { where += ' AND p.categoria_id = ?'; params.push(categoria_id); }
    if (estado) { where += ' AND p.estado = ?'; params.push(estado); }
    if (fecha_desde) { where += ' AND p.fecha >= ?'; params.push(fecha_desde); }
    if (fecha_hasta) { where += ' AND p.fecha <= ?'; params.push(fecha_hasta); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM maquicombus_productos p ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT p.*, c.nombre as categoria_nombre,
              um.nombre as unidad_nombre, um.codigo as unidad_codigo,
              uc.nombre as unidad_compra_nombre, uc.codigo as unidad_compra_codigo,
              COALESCE(p.factor_conversion, 1) as factor_conversion
       FROM maquicombus_productos p
       LEFT JOIN maquicombus_categorias c ON p.categoria_id = c.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       LEFT JOIN maquicombus_unidades_medida uc ON p.unidad_compra_id = uc.id
       ${where} ORDER BY p.descripcion LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// GET /api/erp_productos/catalogo (para selects en forms)
// Por defecto solo trae productos activos; pasar ?estado=todos para incluir también los inactivos
// (necesario para reconstruir órdenes de compra históricas que referencian productos ya descontinuados).
router.get('/catalogo', async (req, res) => {
  try {
    const soloActivos = req.query.estado !== 'todos';
    const [rows] = await pool.query(
      `SELECT p.id, p.sku, p.codigo_interno, p.descripcion, p.precio_costo, p.estado,
              um.codigo as unidad, um.nombre as unidad_nombre,
              uc.codigo as unidad_compra_codigo, uc.nombre as unidad_compra_nombre,
              COALESCE(p.factor_conversion, 1) as factor_conversion,
              COALESCE(p.bloqueado_transferencia, 0) as bloqueado_transferencia,
              COALESCE(p.es_equipo, 0) as es_equipo
       FROM maquicombus_productos p
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       LEFT JOIN maquicombus_unidades_medida uc ON p.unidad_compra_id = uc.id
       ${soloActivos ? "WHERE p.estado = 'activo'" : ''} ORDER BY p.descripcion`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener catálogo' });
  }
});

// POST /api/erp_productos/sincronizar
// Trae al catálogo los productos dados de alta HOY en el sistema anterior (listado_items_2025)
// que todavía no existen en erp_productos, para que aparezcan de inmediato en el listado.
router.post('/sincronizar', requirePrincipalAccess, async (req, res) => {
  try {
    const resumen = await sincronizarProductosNuevosDeHoy(pool);
    res.json(resumen);
  } catch (err) {
    console.error('[Productos/sincronizar]', err);
    res.status(500).json({ error: 'Error al sincronizar productos' });
  }
});

// GET /api/erp_productos/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, c.nombre as categoria_nombre, um.nombre as unidad_nombre
       FROM maquicombus_productos p
       LEFT JOIN maquicombus_categorias c ON p.categoria_id = c.id
       LEFT JOIN maquicombus_unidades_medida um ON p.unidad_medida_id = um.id
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// POST /api/erp_productos
router.post('/', requirePrincipalAccess, async (req, res) => {
  const { sku, codigo_interno, codigo_barras, descripcion, descripcion_larga, fecha, categoria_id, familia, marca,
          unidad_medida_id, unidad_compra_id, factor_conversion,
          stock_minimo, stock_maximo, punto_reposicion, precio_costo, precio_venta, metodo_costeo, es_equipo } = req.body;
  if (!sku || !descripcion) return res.status(400).json({ error: 'SKU y descripción son requeridos' });
  try {
    const [result] = await pool.query(
      `INSERT INTO maquicombus_productos (sku, codigo_interno, codigo_barras, descripcion, descripcion_larga, fecha,
        categoria_id, familia, marca, unidad_medida_id, unidad_compra_id, factor_conversion,
        stock_minimo, stock_maximo, punto_reposicion, precio_costo, precio_venta, metodo_costeo, es_equipo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sku, codigo_interno || null, codigo_barras || null, descripcion, descripcion_larga || null, fecha || null,
       categoria_id || null, familia || null, marca || null, unidad_medida_id || null,
       unidad_compra_id || null, parseFloat(factor_conversion) || 1,
       stock_minimo || 0, stock_maximo || 0, punto_reposicion || 0,
       precio_costo || 0, precio_venta || 0, metodo_costeo || 'promedio', !!es_equipo]
    );
    const [newRow] = await pool.query('SELECT * FROM maquicombus_productos WHERE id = ?', [result.insertId]);
    res.status(201).json(newRow[0]);
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El SKU ya existe' });
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// PUT /api/erp_productos/:id
router.put('/:id', requirePrincipalAccess, async (req, res) => {
  const { sku, codigo_interno, codigo_barras, descripcion, descripcion_larga, fecha, categoria_id, familia, marca,
          unidad_medida_id, unidad_compra_id, factor_conversion,
          stock_minimo, stock_maximo, punto_reposicion, precio_costo, precio_venta, metodo_costeo, estado, es_equipo } = req.body;
  if (!sku || !descripcion) return res.status(400).json({ error: 'SKU y descripción son requeridos' });
  try {
    await pool.query(
      `UPDATE maquicombus_productos SET sku=?, codigo_interno=?, codigo_barras=?, descripcion=?, descripcion_larga=?, fecha=?,
        categoria_id=?, familia=?, marca=?, unidad_medida_id=?, unidad_compra_id=?, factor_conversion=?,
        stock_minimo=?, stock_maximo=?, punto_reposicion=?, precio_costo=?, precio_venta=?,
        metodo_costeo=?, estado=?, es_equipo=? WHERE id=?`,
      [sku, codigo_interno || null, codigo_barras || null, descripcion, descripcion_larga || null, fecha || null,
       categoria_id || null, familia || null, marca || null, unidad_medida_id || null,
       unidad_compra_id || null, parseFloat(factor_conversion) || 1,
       stock_minimo || 0, stock_maximo || 0, punto_reposicion || 0,
       precio_costo || 0, precio_venta || 0, metodo_costeo || 'promedio', estado || 'activo', !!es_equipo, req.params.id]
    );
    const [updated] = await pool.query('SELECT * FROM maquicombus_productos WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El SKU ya existe' });
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// GET /api/erp_productos/:id/stock
router.get('/:id/stock', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, a.nombre as almacen_nombre, a.tipo as almacen_tipo,
              (i.stock_fisico - i.stock_reservado) as stock_disponible,
              (i.stock_fisico * i.costo_promedio) as valor_total
       FROM maquicombus_inventario i
       JOIN maquicombus_almacenes a ON i.almacen_id = a.id
       WHERE i.producto_id = ?`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener stock' });
  }
});

// GET /api/erp_categorias
router.get('/meta/erp_categorias', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM maquicombus_categorias WHERE estado = 'activo' ORDER BY nombre");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// GET /api/unidades
router.get('/meta/unidades', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM maquicombus_unidades_medida ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// Prefijo fijo para los SKU autogenerados: 1-F-F-11E-<correlativo consecutivo>
const PREFIJO_SKU_AUTO = '1-F-F-11E-';

// Lee el excel, genera SKU faltantes y detecta duplicados (contra la BD y dentro del propio archivo)
async function procesarFilasExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const [existentes] = await pool.query('SELECT sku, descripcion FROM maquicombus_productos');
  const skuSet = new Set(existentes.map(r => r.sku));
  const descSet = new Set(existentes.map(r => normKey(r.descripcion || '')));

  let correlativo = 0;
  for (const r of existentes) {
    if (r.sku && r.sku.startsWith(PREFIJO_SKU_AUTO)) {
      const n = parseInt(r.sku.slice(PREFIJO_SKU_AUTO.length), 10);
      if (!isNaN(n) && n > correlativo) correlativo = n;
    }
  }

  const vistos = new Set();
  const descVistos = new Set();

  return rows.map((row, i) => {
    const nFila = i + 2;
    const descripcion = getField(row, 'descripcion', 'descripción');
    const codigoInterno = getField(row, 'codigo interno', 'codigo_interno');
    const precioCosto = parseFloat(getField(row, 'precio costo', 'precio_costo')) || 0;
    const fecha = parseFecha(getField(row, 'fecha'));
    const descKey = descripcion ? normKey(descripcion) : '';

    let sku = getField(row, 'sku');
    sku = sku ? String(sku).trim() : '';
    const generado = !sku;
    if (generado) {
      correlativo += 1;
      sku = `${PREFIJO_SKU_AUTO}${String(correlativo).padStart(3, '0')}`;
    }

    let estado = 'nuevo';
    let motivo = null;
    if (!descripcion) {
      estado = 'error'; motivo = 'Descripción vacía';
    } else if (skuSet.has(sku)) {
      estado = 'duplicado'; motivo = 'El SKU ya existe en el catálogo';
    } else if (vistos.has(sku)) {
      estado = 'duplicado'; motivo = 'SKU repetido dentro del archivo';
    } else if (descSet.has(descKey)) {
      estado = 'duplicado'; motivo = 'Ya existe un producto con esta misma descripción';
    } else if (descKey && descVistos.has(descKey)) {
      estado = 'duplicado'; motivo = 'Descripción repetida dentro del archivo';
    }
    if (estado === 'nuevo') {
      vistos.add(sku);
      if (descKey) descVistos.add(descKey);
    }

    return {
      fila: nFila, sku, generado,
      codigo_interno: codigoInterno ? String(codigoInterno).trim() : null,
      descripcion: descripcion ? String(descripcion).trim() : '',
      precio_costo: precioCosto, fecha, estado, motivo,
    };
  });
}

// POST /api/erp_productos/importar/preview (analiza el excel sin insertar nada)
router.post('/importar/preview', requirePrincipalAccess, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo Excel' });
  try {
    const filas = await procesarFilasExcel(req.file.buffer);
    if (!filas.length) return res.status(400).json({ error: 'El archivo no contiene datos' });
    const resumen = {
      total: filas.length,
      nuevos: filas.filter(f => f.estado === 'nuevo').length,
      duplicados: filas.filter(f => f.estado === 'duplicado').length,
      errores: filas.filter(f => f.estado === 'error').length,
    };
    res.json({ filas, resumen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar el archivo Excel' });
  }
});

// POST /api/erp_productos/importar/confirmar (inserta las filas ya revisadas en la vista previa)
router.post('/importar/confirmar', requirePrincipalAccess, async (req, res) => {
  const { filas } = req.body;
  if (!Array.isArray(filas) || !filas.length) return res.status(400).json({ error: 'No hay filas para importar' });
  try {
    let [[und]] = await pool.query("SELECT id FROM maquicombus_unidades_medida WHERE codigo = 'UND' LIMIT 1");
    let undId;
    if (und) undId = und.id;
    else {
      const [r] = await pool.query("INSERT INTO maquicombus_unidades_medida (codigo, nombre) VALUES ('UND','Unidad')");
      undId = r.insertId;
    }

    const [existentes] = await pool.query('SELECT sku FROM maquicombus_productos');
    const skuSet = new Set(existentes.map(r => r.sku));

    let insertados = 0, omitidos = 0;
    const errores = [];

    for (const f of filas) {
      if (!f || !f.sku || !f.descripcion) { omitidos++; continue; }
      if (skuSet.has(f.sku)) {
        omitidos++;
        errores.push(`Fila ${f.fila}: SKU "${f.sku}" ya existe, se omitió`);
        continue;
      }
      try {
        await pool.query(
          `INSERT INTO maquicombus_productos (sku, codigo_interno, descripcion, precio_costo, fecha, unidad_medida_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [f.sku, f.codigo_interno || null, f.descripcion, f.precio_costo || 0, f.fecha || null, undId]
        );
        skuSet.add(f.sku);
        insertados++;
      } catch (err) {
        omitidos++;
        errores.push(`Fila ${f.fila}: ${err.code === 'ER_DUP_ENTRY' ? 'SKU duplicado' : 'error al insertar'}`);
      }
    }

    res.json({ total: filas.length, insertados, omitidos, errores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al importar productos' });
  }
});

// Tablas con historial que referencian erp_productos con FK "NO ACTION" (no se puede
// borrar el producto si tiene alguna fila ahí; se inactiva en su lugar).
const TABLAS_CON_HISTORIAL = [
  'maquicombus_cotizacion_detalles', 'maquicombus_orden_compra_detalles', 'maquicombus_recepcion_detalles',
  'maquicombus_transferencia_detalles', 'maquicombus_salida_detalles', 'maquicombus_solicitud_detalles', 'maquicombus_kardex',
];

async function inactivarProducto(id) {
  await pool.query("UPDATE maquicombus_productos SET estado = 'inactivo' WHERE id = ?", [id]);
}

router.delete('/:id', async (req, res) => {
  try {
    const [[producto]] = await pool.query('SELECT * FROM maquicombus_productos WHERE id = ?', [req.params.id]);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const [[{ usos }]] = await pool.query(
      'SELECT COUNT(*) as usos FROM maquicombus_inventario WHERE producto_id = ? AND stock_fisico > 0', [req.params.id]
    );
    if (parseInt(usos) > 0) return res.status(409).json({ error: 'No se puede eliminar: el producto tiene stock en inventario' });

    for (const tabla of TABLAS_CON_HISTORIAL) {
      const [[{ n }]] = await pool.query(`SELECT COUNT(*) as n FROM ${tabla} WHERE producto_id = ?`, [req.params.id]);
      if (parseInt(n) > 0) {
        await inactivarProducto(req.params.id);
        return res.json({
          message: 'El producto tiene movimientos registrados (compras, recepciones, kardex, etc.) y no se puede borrar; se marcó como inactivo.',
          inactivado: true,
        });
      }
    }

    await pool.query('DELETE FROM maquicombus_productos WHERE id = ?', [req.params.id]);
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    console.error(err);
    // Respaldo por si queda alguna referencia no contemplada arriba: en vez de un 500 opaco,
    // se inactiva el producto para no romper el historial existente.
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
      try {
        await inactivarProducto(req.params.id);
        return res.json({ message: 'El producto tiene movimientos registrados y no se puede borrar; se marcó como inactivo.', inactivado: true });
      } catch (e2) {
        console.error(e2);
      }
    }
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

module.exports = router;
