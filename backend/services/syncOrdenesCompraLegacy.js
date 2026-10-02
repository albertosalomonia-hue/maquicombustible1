const ESTADO_MAP = {
  PENDIENTE: 'borrador',
  APROBADA: 'aprobada',
  FIRMADA: 'emitida',
  PARCIALMENTE_RECEPCIONADA: 'parcialmente_recibida',
  COMPLETADA: 'completada',
  CANCELADA: 'anulada',
};

const MONEDA_MAP = { SOLES: 'PEN', DOLARES: 'USD' };

// Prefijo fijo para los SKU autogenerados: 1-F-F-11E-<correlativo consecutivo>
const PREFIJO_SKU_AUTO = '1-F-F-11E-';

// Traduce las unidades de medida del sistema anterior a los códigos ya existentes
// en erp_unidades_medida. Lo que no se reconoce cae en 'UND' por defecto.
const UM_MAP = {
  UNIDAD: 'UND', UND: 'UND', '2U': 'UND', NIU: 'UND', ZZ: 'UND', HORAS: 'UND', DIA: 'UND', HUR: 'UND',
  PAR: 'PAR', CAJA: 'CJA', CAJ: 'CJA', CJ: 'CJA',
  GALON: 'GLN', GAL: 'GLN', GL: 'GLN', GLN: 'GLN',
  METROS: 'MT', M: 'MT', MT: 'MT',
  PQT: 'PAQ', PAQ: 'PAQ', 'PQT 8U': 'PAQ',
  TALONARIO: 'TALON', TALON: 'TALON',
  M3: 'M3', MTQ: 'M3', M2: 'M2',
  BALDE: 'BALDE', 'BAL 19LT': 'BALDE',
  BLISTER: 'BLISTER', VIAJE: 'VIAJE', SERV: 'SERV',
  KG: 'KG', LT: 'LT', TN: 'TN', BIDON: 'BIDON', JUEGO: 'JGO',
};

const TAMANO_LOTE = 300;

// Ejecuta `db.query(sql, [lote])` en lotes de `TAMANO_LOTE` filas (bulk INSERT con
// `VALUES ?`). Si un lote entero falla (p.ej. un dato inválido en una sola fila), en vez
// de perder todo el lote se reintenta fila por fila para aislar el problema — cada fila
// mala se reporta vía `onFilaError` sin tumbar a las demás.
async function ejecutarEnLotes(db, sql, filas, onFilaError) {
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);
    try {
      await db.query(sql, [lote]);
    } catch (e) {
      for (const fila of lote) {
        try { await db.query(sql, [[fila]]); } catch (e2) { onFilaError(fila, e2); }
      }
    }
  }
}

// Sincroniza proveedores → erp_clientes y ordenes_compra (+ detalles) desde las
// tablas del sistema anterior hacia erp_ordenes_compra / erp_orden_compra_detalles.
// Los encabezados de OC se actualizan siempre (clave única: numero).
// Los detalles de producto se actualizan (cantidad/precio/producto/descripción) si
// la línea legada ya existía, y se insertan si son nuevas. cantidad_recibida NUNCA
// se pisa aquí: ese campo se gestiona solo dentro del ERP (endpoint /recepcionar).
//
// Todas las escrituras van en bulk INSERT ... ON DUPLICATE KEY UPDATE (por lotes de
// TAMANO_LOTE filas) en vez de una consulta por fila: con ~1800 proveedores+órdenes+
// detalles typical, un round-trip por fila contra la BD remota es el cuello de botella
// real detrás de la lentitud del botón "Actualizar".
const { RUCS_PERMITIDOS, ANIO_OC } = require('../config/proveedoresPermitidos');

async function sincronizarOrdenesCompraLegacy(db) {
  await db.query(`ALTER TABLE maquicombus_ordenes_compra
    MODIFY cotizacion_id INT NULL,
    MODIFY cliente_id INT NULL,
    MODIFY centro_costo_id INT NULL`);

  // ─── Proveedores → erp_clientes ──────────────────────────────
  const [provs] = await db.query('SELECT * FROM proveedores WHERE TRIM(ruc) IN (?)', [RUCS_PERMITIDOS]);

  const provOk = provs.length;
  const provCandidatos = provs.map(p => {
    const ruc = (p.ruc || '').trim();
    const numDoc = ruc || ('PROV-' + (p.codigo_proveedor || p.id_proveedor).trim());
    const tipoDoc = ruc.length === 11 ? 'RUC' : ruc.length === 8 ? 'DNI' : 'RUC';
    const estado = p.activo ? 'activo' : 'inactivo';
    return {
      numDoc,
      valores: [
        tipoDoc, numDoc,
        (p.nombre_proveedor || '').substring(0, 200),
        (p.contacto || '').substring(0, 100) || null,
        (p.telefono || '').substring(0, 20) || null,
        (p.email || '').substring(0, 100) || null,
        p.direccion || null,
        estado,
      ],
    };
  });

  // Se compara contra lo ya guardado para no reescribir proveedores sin cambios reales:
  // evita tocar (y bloquear de escritura) filas que ya están al día.
  const provExistentesMap = new Map();
  if (provCandidatos.length) {
    const [provExistentes] = await db.query(
      'SELECT numero_documento, razon_social, contacto, telefono, correo, direccion, estado FROM maquicombus_clientes WHERE numero_documento IN (?)',
      [provCandidatos.map(c => c.numDoc)]
    );
    provExistentes.forEach(r => provExistentesMap.set(r.numero_documento, r));
  }
  const provValues = provCandidatos.filter(c => {
    const actual = provExistentesMap.get(c.numDoc);
    if (!actual) return true; // nuevo
    const [, , razon_social, contacto, telefono, correo, direccion, estado] = c.valores;
    return actual.razon_social !== razon_social || actual.contacto !== contacto ||
      actual.telefono !== telefono || actual.correo !== correo ||
      actual.direccion !== direccion || actual.estado !== estado;
  }).map(c => c.valores);

  if (provValues.length) {
    const UPSERT_PROVEEDOR_SQL = `
      INSERT INTO maquicombus_clientes
        (tipo_documento, numero_documento, razon_social, contacto, telefono, correo, direccion, estado)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        razon_social = VALUES(razon_social),
        contacto     = VALUES(contacto),
        telefono     = VALUES(telefono),
        correo       = VALUES(correo),
        direccion    = VALUES(direccion),
        estado       = VALUES(estado)
    `;
    await ejecutarEnLotes(db, UPSERT_PROVEEDOR_SQL, provValues, () => {});
  }

  // Un solo SELECT masivo en vez de uno por proveedor: evita cientos de round-trips
  // secuenciales a la BD remota (el cuello de botella real del botón "Actualizar").
  const provMap = new Map();
  const numDocsProv = provs.map(p => {
    const ruc = (p.ruc || '').trim();
    return ruc || ('PROV-' + (p.codigo_proveedor || p.id_proveedor).trim());
  });
  if (numDocsProv.length) {
    const [clientesRows] = await db.query(
      'SELECT id, numero_documento FROM maquicombus_clientes WHERE numero_documento IN (?)',
      [numDocsProv]
    );
    const clienteIdPorNumDoc = new Map(clientesRows.map(c => [c.numero_documento, c.id]));
    provs.forEach((p, i) => {
      const cliId = clienteIdPorNumDoc.get(numDocsProv[i]);
      if (cliId) provMap.set(p.id_proveedor, cliId);
    });
  }

  // ─── Órdenes de compra → erp_ordenes_compra (encabezados, siempre) ───
  const [ocs] = await db.query(
    `SELECT oc.* FROM ordenes_compra oc
     JOIN proveedores p ON oc.id_proveedor = p.id_proveedor
     WHERE oc.deleted_at IS NULL AND TRIM(p.ruc) IN (?) AND YEAR(oc.fecha_orden) = ?
     ORDER BY oc.id_orden_compra`,
    [RUCS_PERMITIDOS, ANIO_OC]
  );

  // Se trae el estado ACTUAL (no solo el numero) para poder comparar y saltarse las
  // órdenes que no tuvieron ningún cambio real desde la última sincronización, en vez
  // de reescribirlas todas cada vez.
  const ocExistenteMap = new Map();
  if (ocs.length) {
    const [existRows] = await db.query(
      `SELECT numero, cliente_id, estado, subtotal, igv, total, moneda, tipo_cambio,
              observaciones, almacen_central, nro_factura, url_factura, url_pdf, id_source
       FROM maquicombus_ordenes_compra WHERE numero IN (?)`,
      [ocs.map(oc => oc.numero_orden)]
    );
    existRows.forEach(r => ocExistenteMap.set(r.numero, r));
  }

  let ocErr = 0, ocSinCambios = 0;
  const UPSERT_OC_SQL = `
    INSERT INTO maquicombus_ordenes_compra
      (numero, cotizacion_id, pago_id, cliente_id, centro_costo_id, proyecto,
       fecha, fecha_entrega, moneda, tipo_cambio,
       subtotal, igv, total, estado, observaciones, usuario_id,
       almacen_central, nro_factura, url_factura, url_pdf, id_source)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      cliente_id      = VALUES(cliente_id),
      subtotal        = VALUES(subtotal),
      igv             = VALUES(igv),
      total           = VALUES(total),
      moneda          = VALUES(moneda),
      tipo_cambio     = VALUES(tipo_cambio),
      observaciones   = VALUES(observaciones),
      almacen_central = VALUES(almacen_central),
      nro_factura     = IF(nro_factura IS NULL OR nro_factura = '', VALUES(nro_factura), nro_factura),
      url_factura     = IF(url_factura IS NULL OR url_factura = '', VALUES(url_factura), url_factura),
      url_pdf         = IF(url_pdf IS NULL OR url_pdf = '', VALUES(url_pdf), url_pdf),
      id_source       = VALUES(id_source)
  `;
  let ocOk = 0, ocDup = 0;
  const ocValues = [];
  for (const oc of ocs) {
    // Todas las órdenes de estos proveedores entran como emitidas y de Almacén Central para
    // reiniciar las recepciones desde cero (el estado del sistema anterior no aplica).
    const estadoErp = ESTADO_MAP[oc.estado] === 'anulada' ? 'anulada' : 'emitida';
    const monedaErp = MONEDA_MAP[(oc.moneda || '').toUpperCase()] || 'PEN';
    const clienteId = provMap.get(oc.id_proveedor) || null;
    const subtotal = parseFloat(oc.subtotal) || 0;
    const igv = parseFloat(oc.igv) || 0;
    const total = parseFloat(oc.total) || 0;
    const tipoCambio = parseFloat(oc.tipo_cambio) || 1.0;
    const observaciones = oc.observaciones ? oc.observaciones.substring(0, 65535) : null;
    const almacenCentral = 'SI';
    const nroFactura = (oc.nro_factura || '').trim() || null;
    const urlFactura = (oc.url_factura || '').trim() || null;
    // "url" en el sistema anterior es la imagen/PDF del pago (distinta de url_factura,
    // que es la factura en sí) → se sincroniza hacia erp_ordenes_compra.url_pdf.
    const urlPdf = (oc.url || '').trim() || null;

    const actual = ocExistenteMap.get(oc.numero_orden);
    if (actual) {
      const factNoCambia = actual.nro_factura ? true : nroFactura === actual.nro_factura;
      const urlNoCambia = actual.url_factura ? true : urlFactura === actual.url_factura;
      const urlPdfNoCambia = actual.url_pdf ? true : urlPdf === actual.url_pdf;
      const sinCambios =
        actual.cliente_id === clienteId &&
        Number(actual.subtotal) === subtotal && Number(actual.igv) === igv && Number(actual.total) === total &&
        actual.moneda === monedaErp && Number(actual.tipo_cambio) === tipoCambio &&
        actual.observaciones === observaciones && actual.almacen_central === almacenCentral &&
        factNoCambia && urlNoCambia && urlPdfNoCambia && actual.id_source === oc.id_orden_compra;
      if (sinCambios) { ocSinCambios++; continue; }
      ocDup++;
    } else {
      ocOk++;
    }

    ocValues.push([
      oc.numero_orden, null, null,
      clienteId, null, null,
      oc.fecha_orden,
      oc.fecha_entrega_prevista || null,
      monedaErp, tipoCambio,
      subtotal, igv, total,
      estadoErp, observaciones, 1,
      almacenCentral, nroFactura, urlFactura, urlPdf,
      oc.id_orden_compra,
    ]);
  }
  await ejecutarEnLotes(db, UPSERT_OC_SQL, ocValues, () => { ocErr++; });

  // Igual que con provMap: un solo SELECT masivo por todos los "numero" en vez de
  // uno por orden, para no repetir cientos de round-trips ya evitables.
  const ocIdMap = new Map();
  if (ocs.length) {
    const numerosOC = ocs.map(oc => oc.numero_orden);
    const [ocRows] = await db.query('SELECT id, numero FROM maquicombus_ordenes_compra WHERE numero IN (?)', [numerosOC]);
    const erpIdPorNumero = new Map(ocRows.map(r => [r.numero, r.id]));
    for (const oc of ocs) {
      const erpId = erpIdPorNumero.get(oc.numero_orden);
      if (erpId) ocIdMap.set(oc.id_orden_compra, erpId);
    }
  }

  // ─── Detalles → erp_orden_compra_detalles (solo para OC sin detalles aún) ───
  // Mapeo de codigo_item (legado) -> producto, con prioridad explícita (el último
  // .set() gana para una misma clave, así que se cargan del menos al más confiable):
  //   1) puente items_nuevo_2026 (indirecto, vía numeracion/sku del catálogo maestro)
  //   2) sku directo (fallback para productos dados de alta usando el código legado
  //      como sku, ej. "PROD00230"; puede dar falsos cruces si el sku coincide por
  //      casualidad, así que va antes que codigo_interno)
  //   3) codigo_interno directo — la fuente más confiable: cada producto debería
  //      tener aquí su código real PROD00... del sistema anterior (ver limpieza de
  //      julio 2026). Es la que decide en caso de choque con las anteriores.
  const prodMap = new Map();

  const [bridgeRows] = await db.query(`
    SELECT i.codigo AS codigo_item, p.id AS producto_id
    FROM items_nuevo_2026 i
    INNER JOIN maquicombus_productos p
      ON p.sku = i.sku OR p.sku = i.codigo OR p.codigo_interno = i.numeracion
    GROUP BY i.codigo, p.id
  `);
  bridgeRows.forEach(r => prodMap.set(r.codigo_item, r.producto_id));

  const [skuRows] = await db.query(`SELECT sku AS codigo_item, id AS producto_id FROM maquicombus_productos WHERE sku IS NOT NULL`);
  skuRows.forEach(r => prodMap.set(r.codigo_item, r.producto_id));

  const [codigoInternoRows] = await db.query(`SELECT codigo_interno AS codigo_item, id AS producto_id FROM maquicombus_productos WHERE codigo_interno IS NOT NULL AND codigo_interno <> ''`);
  codigoInternoRows.forEach(r => prodMap.set(r.codigo_item, r.producto_id));

  // Catálogo maestro del sistema anterior (más completo que items_nuevo_2026),
  // usado para enriquecer los productos que se autogeneran durante la sincronización.
  const [catalogoLegado] = await db.query('SELECT codigo, descripcion, precio_unitario, u_m FROM listado_items_2025');
  const catalogoLegadoMap = new Map(catalogoLegado.map(c => [c.codigo, c]));

  const [unidades] = await db.query('SELECT id, codigo FROM maquicombus_unidades_medida');
  const unidadPorCodigo = new Map(unidades.map(u => [u.codigo, u.id]));
  const undId = unidadPorCodigo.get('UND');

  const [existentesSku] = await db.query("SELECT sku FROM maquicombus_productos WHERE sku LIKE ?", [`${PREFIJO_SKU_AUTO}%`]);
  let correlativoSku = 0;
  for (const r of existentesSku) {
    const n = parseInt(r.sku.slice(PREFIJO_SKU_AUTO.length), 10);
    if (!isNaN(n) && n > correlativoSku) correlativoSku = n;
  }

  // Líneas legadas (por id_detalle_origen) ya sincronizadas antes, para actualizarlas
  // en vez de reinsertarlas. Se usa el id exacto del detalle de origen (no
  // producto+orden) porque varios códigos legados pueden mapear al mismo producto,
  // lo que haría ambigua esa comparación.
  const [existentesDetalle] = await db.query(`
    SELECT id, orden_compra_id, producto_id, id_detalle_origen, descripcion, cantidad_pedida, precio_unitario, subtotal
    FROM maquicombus_orden_compra_detalles WHERE id_detalle_origen IS NOT NULL
  `);
  const detalleExistenteMap = new Map(existentesDetalle.map(r => [r.id_detalle_origen, r.id]));
  const detalleActualPorId = new Map(existentesDetalle.map(r => [r.id, r]));

  // Solo se procesan (y solo se autogeneran productos para) líneas de órdenes
  // marcadas como Almacén Central en el sistema anterior.
  const [dets] = await db.query(`
    SELECT d.* FROM detalles_orden_compra d
    JOIN ordenes_compra oc ON d.id_orden_compra = oc.id_orden_compra
    JOIN proveedores pv ON oc.id_proveedor = pv.id_proveedor
    WHERE TRIM(pv.ruc) IN (?) AND YEAR(oc.fecha_orden) = ?
    ORDER BY d.id_detalle
  `, [RUCS_PERMITIDOS, ANIO_OC]);

  // El sistema anterior NO edita las líneas en su sitio: cuando alguien corrige
  // cantidad/precio de un ítem, borra la fila vieja de detalles_orden_compra y crea
  // una nueva con otro id_detalle para la misma orden. Eso deja "huérfana" la fila ya
  // sincronizada (su id_detalle_origen ya no existe en el legado). Para no perder esa
  // edición, se arma un set de id_detalle vigentes por orden legada y, si una línea
  // huérfana de erp_orden_compra_detalles comparte producto con una línea legada sin
  // match directo dentro de la misma orden, se reutiliza esa fila (reasignando su
  // id_detalle_origen) en vez de insertar un duplicado.
  const legacyIdsPorOrden = new Map();
  for (const d of dets) {
    if (!legacyIdsPorOrden.has(d.id_orden_compra)) legacyIdsPorOrden.set(d.id_orden_compra, new Set());
    legacyIdsPorOrden.get(d.id_orden_compra).add(d.id_detalle);
  }
  const legacyOrdenPorErpId = new Map();
  for (const [legacyId, erpId] of ocIdMap.entries()) legacyOrdenPorErpId.set(erpId, legacyId);

  const orfanasPorErpOrden = new Map();
  for (const r of existentesDetalle) {
    const legacyOrdenId = legacyOrdenPorErpId.get(r.orden_compra_id);
    const idsVigentes = legacyOrdenId != null ? legacyIdsPorOrden.get(legacyOrdenId) : null;
    if (idsVigentes && idsVigentes.has(r.id_detalle_origen)) continue; // sigue vigente, no es huérfana
    if (!orfanasPorErpOrden.has(r.orden_compra_id)) orfanasPorErpOrden.set(r.orden_compra_id, []);
    orfanasPorErpOrden.get(r.orden_compra_id).push({ id: r.id, producto_id: r.producto_id });
  }

  let detOk = 0, detActualizados = 0, detReemplazados = 0, detSinOC = 0, detSinProd = 0, detErr = 0, productosCreados = 0, detSinCambios = 0;

  // ── Paso 1: autogenerar (en bulk) los productos que hagan falta ──
  // Se resuelven ANTES de decidir qué hacer con cada línea, para que el resto del
  // procesamiento (paso 2) no dependa de escrituras intercaladas fila por fila.
  const codigosFaltantesVistos = new Set();
  const nuevosProductos = []; // { codigo_item, sku, descripcion, unidad_medida_id, precio_costo }
  for (const d of dets) {
    if (prodMap.has(d.codigo_item) || codigosFaltantesVistos.has(d.codigo_item)) continue;
    codigosFaltantesVistos.add(d.codigo_item);

    const infoLegado = catalogoLegadoMap.get(d.codigo_item);
    const descripcion = ((infoLegado && infoLegado.descripcion) || d.descripcion_item || d.codigo_item || 'Producto sin descripción').substring(0, 250);
    const precioCosto = parseFloat((infoLegado && infoLegado.precio_unitario) || d.precio_unitario) || 0;
    const umCodigo = infoLegado && infoLegado.u_m ? UM_MAP[infoLegado.u_m.trim().toUpperCase()] : null;
    const unidadMedidaId = (umCodigo && unidadPorCodigo.get(umCodigo)) || undId;

    correlativoSku += 1;
    const sku = `${PREFIJO_SKU_AUTO}${String(correlativoSku).padStart(3, '0')}`;
    nuevosProductos.push({ codigo_item: d.codigo_item, sku, descripcion, unidad_medida_id: unidadMedidaId, precio_costo: precioCosto });
  }

  if (nuevosProductos.length) {
    const INSERT_PRODUCTO_SQL = `
      INSERT INTO maquicombus_productos (sku, codigo_interno, descripcion, unidad_medida_id, precio_costo, estado)
      VALUES ?
    `;
    const codigosFallidos = new Set();
    await ejecutarEnLotes(
      db, INSERT_PRODUCTO_SQL,
      nuevosProductos.map(p => [p.sku, p.codigo_item, p.descripcion, p.unidad_medida_id, p.precio_costo, 'activo']),
      (fila) => { codigosFallidos.add(fila[1]); }
    );
    const skusOk = nuevosProductos.filter(p => !codigosFallidos.has(p.codigo_item));
    if (skusOk.length) {
      const [rows] = await db.query('SELECT id, sku FROM maquicombus_productos WHERE sku IN (?)', [skusOk.map(p => p.sku)]);
      const idPorSku = new Map(rows.map(r => [r.sku, r.id]));
      for (const p of skusOk) {
        const id = idPorSku.get(p.sku);
        if (id) { prodMap.set(p.codigo_item, id); productosCreados++; }
      }
    }
  }

  // ── Paso 2: con el catálogo de productos ya completo, decidir por línea si se
  // actualiza una existente, se reutiliza una huérfana, o se inserta una nueva ──
  const filasUpsert = []; // updates por id (existentes + huérfanas reasignadas)
  const filasInsert = []; // inserts nuevos

  for (const d of dets) {
    const erpOcId = ocIdMap.get(d.id_orden_compra);
    if (!erpOcId) { detSinOC++; continue; }

    const prodId = prodMap.get(d.codigo_item);
    if (!prodId) { detSinProd++; continue; }

    const cant = parseFloat(d.cantidad_solicitada) || 0;
    const precio = parseFloat(d.precio_unitario) || 0;
    const subtot = parseFloat(d.subtotal) || parseFloat((cant * precio).toFixed(2));
    const descripcion = (d.descripcion_item || '').substring(0, 250) || null;

    const detalleExistenteId = detalleExistenteMap.get(d.id_detalle);
    if (detalleExistenteId) {
      // Línea ya importada antes con el mismo id_detalle: actualizar con los últimos
      // cambios del sistema anterior. cantidad_recibida no se toca (la controla el ERP).
      // Si nada cambió desde la última sync, se salta por completo (no reescribir lo
      // que ya está al día).
      const actual = detalleActualPorId.get(detalleExistenteId);
      const sinCambios = actual && actual.producto_id === prodId && actual.descripcion === descripcion &&
        Number(actual.cantidad_pedida) === cant && Number(actual.precio_unitario) === precio && Number(actual.subtotal) === subtot;
      if (sinCambios) { detSinCambios++; continue; }
      filasUpsert.push([detalleExistenteId, erpOcId, prodId, descripcion, cant, precio, subtot, d.id_detalle, 0, 0, 18]);
      detActualizados++;
      continue;
    }

    // Sin match directo: buscar una fila huérfana del mismo producto en la misma
    // orden (línea editada en el sistema anterior, que borró y recreó el detalle
    // con otro id). Si existe, reutilizarla en vez de insertar un duplicado.
    const pool = orfanasPorErpOrden.get(erpOcId);
    const idxOrfana = pool ? pool.findIndex(o => o.producto_id === prodId) : -1;
    if (idxOrfana !== -1) {
      const orfana = pool.splice(idxOrfana, 1)[0];
      filasUpsert.push([orfana.id, erpOcId, prodId, descripcion, cant, precio, subtot, d.id_detalle, 0, 0, 18]);
      detalleExistenteMap.set(d.id_detalle, orfana.id);
      detReemplazados++;
      continue;
    }

    const cantRec = 0; // recepciones desde cero
    filasInsert.push([erpOcId, prodId, descripcion, cant, cantRec, precio, 0, 18, subtot, d.id_detalle]);
    detalleExistenteMap.set(d.id_detalle, true);
    detOk++;
  }

  if (filasUpsert.length) {
    // Upsert por id: como `id` es la PK, MySQL siempre entra por la rama UPDATE para
    // estas filas (ya existen). cantidad_recibida/descuento_pct/igv_pct van como
    // relleno en el INSERT VALUES pero no se tocan en ON DUPLICATE KEY UPDATE.
    const UPSERT_DETALLE_SQL = `
      INSERT INTO maquicombus_orden_compra_detalles
        (id, orden_compra_id, producto_id, descripcion, cantidad_pedida, precio_unitario, subtotal, id_detalle_origen, cantidad_recibida, descuento_pct, igv_pct)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        producto_id = VALUES(producto_id),
        descripcion = VALUES(descripcion),
        cantidad_pedida = VALUES(cantidad_pedida),
        precio_unitario = VALUES(precio_unitario),
        subtotal = VALUES(subtotal),
        id_detalle_origen = VALUES(id_detalle_origen)
    `;
    await ejecutarEnLotes(db, UPSERT_DETALLE_SQL, filasUpsert, () => { detErr++; });
  }

  if (filasInsert.length) {
    const INSERT_DETALLE_SQL = `
      INSERT INTO maquicombus_orden_compra_detalles
        (orden_compra_id, producto_id, descripcion,
         cantidad_pedida, cantidad_recibida,
         precio_unitario, descuento_pct, igv_pct, subtotal, id_detalle_origen)
      VALUES ?
    `;
    await ejecutarEnLotes(db, INSERT_DETALLE_SQL, filasInsert, () => { detErr++; });
  }

  const familiasActualizadas = await sincronizarFamiliasProductos(db);
  // Las facturas se generan al recepcionar la orden (routes/recepciones.js), no al sincronizar.
  const facturasCreadas = 0;

  return {
    proveedores: provOk,
    ordenesNuevas: ocOk,
    ordenesActualizadas: ocDup,
    ordenesSinCambios: ocSinCambios,
    ordenesErrores: ocErr,
    detallesNuevos: detOk,
    detallesActualizados: detActualizados,
    detallesReemplazados: detReemplazados,
    detallesSinCambios: detSinCambios,
    detallesSinOrden: detSinOC,
    detallesSinProducto: detSinProd,
    detallesErrores: detErr,
    productosCreados,
    familiasActualizadas,
    facturasCreadas,
  };
}

// Crea en erp_facturas el registro correspondiente a toda OC que ya tenga
// nro_factura (llegado desde el sistema anterior, en cualquier estado —
// ya no hay registro manual de órdenes, todo entra por esta sincronización)
// pero que todavía no tenga su fila en erp_facturas. Sin esto, esas facturas
// quedan "invisibles" en la página Facturas aunque la OC ya las tenga cargadas.
async function crearFacturasFaltantes(db) {
  const [pendientes] = await db.query(`
    SELECT oc.id, oc.nro_factura, oc.url_factura, oc.fecha, oc.cliente_id, oc.subtotal, oc.igv, oc.total
    FROM maquicombus_ordenes_compra oc
    LEFT JOIN maquicombus_facturas f ON f.orden_compra_id = oc.id
    WHERE oc.nro_factura IS NOT NULL AND oc.nro_factura <> ''
      AND oc.cliente_id IS NOT NULL
      AND f.id IS NULL
  `);
  if (!pendientes.length) return 0;

  const filas = pendientes.map(oc => {
    const nro = oc.nro_factura.trim();
    const dashIdx = nro.indexOf('-');
    const serie = (dashIdx > -1 ? nro.substring(0, dashIdx).trim() : 'F001').substring(0, 10) || 'F001';
    const numero = (dashIdx > -1 ? nro.substring(dashIdx + 1) : nro).trim().substring(0, 15);
    return { numero, valores: [serie, numero, oc.fecha, oc.cliente_id, oc.id, oc.subtotal, oc.igv, oc.total, oc.url_factura || null] };
  }).filter(f => f.numero).map(f => f.valores);
  if (!filas.length) return 0;

  const INSERT_FACTURA_SQL = `
    INSERT IGNORE INTO maquicombus_facturas
      (serie, numero, fecha, cliente_id, orden_compra_id, subtotal, igv, total, pdf_url)
    VALUES ?
  `;
  let creadas = 0;
  await ejecutarEnLotes(db, INSERT_FACTURA_SQL, filas, () => {});
  const [[{ total: totalFacturas }]] = await db.query(
    'SELECT COUNT(*) as total FROM maquicombus_facturas WHERE orden_compra_id IN (?)',
    [pendientes.map(p => p.id)]
  );
  creadas = totalFacturas;
  return creadas;
}

// Mantiene erp_productos.familia al día con familias_productos (sistema anterior),
// vía listado_items_2025.id_familia. Empareja por codigo_interno o sku ==
// listado_items_2025.codigo (el mismo código legado con el que se autogeneran los
// productos más arriba), y solo toca las filas cuyo valor cambió — así vuelve a
// aplicarse en cada "Actualizar" sin reescribir lo que ya está al día.
async function sincronizarFamiliasProductos(db) {
  const [result] = await db.query(`
    UPDATE maquicombus_productos p
    JOIN listado_items_2025 li ON (p.codigo_interno = li.codigo OR p.sku = li.codigo)
    JOIN familias_productos f ON li.id_familia = f.id_familia
    SET p.familia = f.nombre_familia
    WHERE p.familia IS NULL OR p.familia <> f.nombre_familia
  `);
  return result.changedRows || 0;
}

// Llena el centro_costo (legado, texto libre) de detalles_orden_compra que esté vacío,
// usando el centro de costo de la salida MÁS RECIENTE de ese mismo producto dentro del
// ERP (erp_salida_detalles). No hay forma de saber de qué OC específica salió cada
// unidad (el inventario es costo promedio mezclado, no por lote), así que el criterio
// es: "¿qué centro de costo tiene HOY este producto según su consumo?" — no reemplaza
// nada que ya tenga un valor, solo llena lo vacío. Match por codigo_item = codigo_interno
// (cubre ~99% de las filas vacías; ver sincronizarOrdenesCompraLegacy para el mapeo
// completo de 3 niveles que usa la sync principal, no replicado aquí a propósito para
// mantener este llenado simple y auditable).
async function sincronizarCentrosCostoDesdeSalidas(db) {
  const [result] = await db.query(`
    UPDATE detalles_orden_compra d
    JOIN maquicombus_productos p ON d.codigo_item = p.codigo_interno
    JOIN (
      SELECT sd.producto_id, cc.codigo,
             ROW_NUMBER() OVER (PARTITION BY sd.producto_id ORDER BY s.fecha DESC, sd.id DESC) AS rn
      FROM maquicombus_salida_detalles sd
      JOIN maquicombus_salidas s ON sd.salida_id = s.id
      JOIN maquicombus_centros_costo cc ON sd.centro_costo_id = cc.id
    ) ultimo ON ultimo.producto_id = p.id AND ultimo.rn = 1
    SET d.centro_costo = ultimo.codigo
    WHERE d.centro_costo IS NULL OR TRIM(d.centro_costo) = ''
  `);
  return result.changedRows || 0;
}

module.exports = { sincronizarOrdenesCompraLegacy, crearFacturasFaltantes, sincronizarCentrosCostoDesdeSalidas, UM_MAP };
