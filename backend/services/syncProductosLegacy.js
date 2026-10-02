const { UM_MAP } = require('./syncOrdenesCompraLegacy');

// Trae a erp_productos TODOS los productos ACTIVOS del catálogo del sistema anterior
// (listado_items_2025, tabla legada que comparte la misma base de datos) que todavía no
// existen en erp_productos (por sku o codigo_interno) — sin importar cuándo se crearon o
// modificaron. Como la condición "todavía no existe" se vuelve falsa apenas se crea el
// producto, correr esto varias veces es seguro: cada corrida solo trae lo que sigue
// faltando. Los ítems marcados inactivos en el sistema anterior (p.ej. dados de baja) se
// excluyen a propósito.
//
// A diferencia de sincronizarOrdenesCompraLegacy, no depende de que el código haya
// aparecido en una línea de orden de compra: sirve para que un producto recién dado de
// alta en el sistema anterior aparezca de inmediato en el listado de Productos del ERP.
async function sincronizarProductosNuevosDeHoy(db) {
  const [pendientes] = await db.query(`
    SELECT li.codigo, li.descripcion, li.precio_unitario, li.u_m, li.activo, li.id_familia
    FROM listado_items_2025 li
    LEFT JOIN maquicombus_productos p ON p.sku = li.codigo OR p.codigo_interno = li.codigo
    WHERE p.id IS NULL AND li.activo = 1
  `);

  if (!pendientes.length) return { revisados: 0, creados: 0, fallidos: 0 };

  const [unidades] = await db.query('SELECT id, codigo FROM maquicombus_unidades_medida');
  const unidadPorCodigo = new Map(unidades.map(u => [u.codigo, u.id]));
  const undId = unidadPorCodigo.get('UND');

  const [familias] = await db.query('SELECT id_familia, nombre_familia FROM familias_productos');
  const familiaPorId = new Map(familias.map(f => [f.id_familia, f.nombre_familia]));

  let creados = 0;
  let fallidos = 0;
  for (const p of pendientes) {
    const umCodigo = p.u_m ? UM_MAP[p.u_m.trim().toUpperCase()] : null;
    const unidadMedidaId = (umCodigo && unidadPorCodigo.get(umCodigo)) || undId;
    const descripcion = (p.descripcion || p.codigo).substring(0, 250);
    const precioCosto = parseFloat(p.precio_unitario) || 0;
    const estado = p.activo ? 'activo' : 'inactivo';
    const familia = p.id_familia ? (familiaPorId.get(p.id_familia) || null) : null;

    try {
      await db.query(
        `INSERT INTO maquicombus_productos (sku, codigo_interno, descripcion, unidad_medida_id, precio_costo, estado, familia)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.codigo, p.codigo, descripcion, unidadMedidaId, precioCosto, estado, familia]
      );
      creados++;
    } catch (err) {
      fallidos++;
    }
  }

  return { revisados: pendientes.length, creados, fallidos };
}

module.exports = { sincronizarProductosNuevosDeHoy };
