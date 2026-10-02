const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// Registro persistente de las filas "BUSCADOR" del reporte de Contabilidad
// importadas en Control de Facturas. buscador es UNIQUE, así que re-importar el
// mismo archivo (o uno que se solape con importaciones anteriores) actualiza la
// fila existente en vez de duplicarla — la comparación acumula todo el historial.

// GET /api/contabilidad-importada — todo lo importado hasta ahora, para armar la
// comparación completa (no solo lo del archivo recién subido).
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT buscador, proveedor, fecha, monto, glosa, archivo_origen, fecha_importacion, fecha_actualizacion
       FROM maquicombus_contabilidad_importada ORDER BY fecha_importacion DESC`
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la contabilidad importada' });
  }
});

// El reporte de Contabilidad a veces trae, para ciertas filas, el RUC de la propia
// empresa en vez del RUC real del proveedor (defecto del reporte de origen, no de
// esta app) — eso hacía que esas filas quedaran "sin rastrear" pese a tener una
// orden real detrás, cada vez que se reimportaba el mismo archivo. Se normaliza la
// serie-número de una factura (mismo criterio que Match en el frontend) para poder
// cruzarla contra las órdenes reales sin depender del RUC que traiga el archivo.
function serieNumero(nroFactura) {
  if (!nroFactura) return null;
  const nro = String(nroFactura).trim();
  const dashIdx = nro.indexOf('-');
  const serie = dashIdx > -1 ? nro.substring(0, dashIdx).trim() : 'F001';
  const numero = (dashIdx > -1 ? nro.substring(dashIdx + 1) : nro).trim().replace(/^0+(?=\d)/, '');
  return `${serie}-${numero}`.toUpperCase();
}

// Casos verificados a mano (número de factura genérico que en la tabla legacy
// "ordenes_servicio" coincide con más de un RUC real, así que la heurística de
// "único candidato" de más abajo no puede resolverlos sola — o el archivo de
// origen trae la serie-número mal tipeada). Confirmados cruzando el monto de
// la orden real contra el importe de la fila de Contabilidad. Se aplican antes
// que la heurística porque el archivo de origen no siempre trae el mismo RUC
// equivocado de una exportación a otra para estas mismas filas.
const RUC_POR_SERIE_NUMERO_CONFIRMADO = {
  'E001-117': '10076850998', // RAMOS SALAZAR GHYPER ANA — orden 0000-02210, S/380.00
  'E001-119': '10076850998', // RAMOS SALAZAR GHYPER ANA — orden 0000-02235, S/380.00
  'E001-11': '10090673632', // AYALA LIZANA RAUL MARIO — orden 0000-02233, S/110.00
};
const BUSCADOR_CORREGIDO = {
  '20608430301-FBM5-6463': '20608430301-FBM5-7463', // typo en el número (6463 -> 7463), RUC ya correcto (BOTICAS IP)
  '20612600725-FT01-2831': '20612600725-FT01-12831', // typo en el número (2831 -> 12831), RUC ya correcto (GRUPO COLORANT)
  '20613126318-F001-2448': '20613126318-FF01-2448', // typo en la serie (F001 -> FF01), RUC ya correcto (CORPORACION ESTRELLA)
  '20609706296-E001-16563': '20609706296-F001-16563', // typo en la serie (E001 -> F001), RUC ya correcto (MASSAFETY)
  '20608280333-FC44-201517': '20608280333-FC44-501517', // typo en el número (201517 -> 501517), RUC ya correcto (HARD DISCOUNT)
  '20100049181-F561-181683': '20100049181-F561-161683', // typo en el número (181683 -> 161683), RUC ya correcto (TAI LOY, orden 0000-02253)
};

// POST /api/contabilidad-importada/importar
// Body: { archivo, filas: [{ buscador, proveedor, fecha, monto, glosa }] }
router.post('/importar', async (req, res) => {
  const { archivo, filas } = req.body;
  if (!Array.isArray(filas) || !filas.length) {
    return res.status(400).json({ error: 'No hay filas para importar' });
  }
  try {
    const [existentesRows] = await pool.query('SELECT buscador FROM maquicombus_contabilidad_importada');
    const existentes = new Set(existentesRows.map(r => r.buscador));

    // Mapa serie-número -> RUC(s) reales, construido desde las órdenes de compra y
    // de servicio ya existentes, para poder corregir el RUC de una fila del archivo
    // cuando no coincide con ninguna orden pero sí lo hace por serie-número.
    const [ordenes] = await pool.query(
      `SELECT oc.nro_factura, cl.numero_documento AS ruc
       FROM maquicombus_ordenes_compra oc LEFT JOIN maquicombus_clientes cl ON oc.cliente_id = cl.id
       WHERE oc.nro_factura IS NOT NULL`
    );
    const [servicio] = await pool.query(
      `SELECT os.nro_factura, p.ruc
       FROM ordenes_servicio os LEFT JOIN proveedores p ON os.id_proveedor = p.id_proveedor
       WHERE os.deleted_at IS NULL AND os.nro_factura IS NOT NULL`
    );
    const rucsPorSerieNumero = new Map();
    for (const o of [...ordenes, ...servicio]) {
      const sn = serieNumero(o.nro_factura);
      if (!sn || !o.ruc) continue;
      if (!rucsPorSerieNumero.has(sn)) rucsPorSerieNumero.set(sn, new Set());
      rucsPorSerieNumero.get(sn).add(o.ruc);
    }

    let nuevos = 0, actualizados = 0, autoCorregidos = 0;
    const UPSERT_SQL = `
      INSERT INTO maquicombus_contabilidad_importada (buscador, proveedor, fecha, monto, glosa, archivo_origen, usuario_id)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        proveedor = VALUES(proveedor),
        fecha = VALUES(fecha),
        monto = VALUES(monto),
        glosa = VALUES(glosa),
        archivo_origen = VALUES(archivo_origen)
    `;
    const valores = filas.map(f => {
      let buscador = String(f.buscador || '').trim().toUpperCase();

      if (BUSCADOR_CORREGIDO[buscador]) {
        buscador = BUSCADOR_CORREGIDO[buscador];
        autoCorregidos++;
      } else {
        const dashIdx = buscador.indexOf('-');
        const rucArchivo = dashIdx > -1 ? buscador.substring(0, dashIdx) : null;
        const sn = dashIdx > -1 ? buscador.substring(dashIdx + 1) : null;
        const rucConfirmado = sn ? RUC_POR_SERIE_NUMERO_CONFIRMADO[sn] : null;
        if (rucConfirmado && rucConfirmado !== rucArchivo) {
          buscador = `${rucConfirmado}-${sn}`;
          autoCorregidos++;
        } else {
          const rucsReales = sn ? rucsPorSerieNumero.get(sn) : null;
          // Solo se autocorrige cuando la serie-número identifica a un único RUC real
          // distinto del que trae el archivo — si hubiera más de uno sería ambiguo.
          if (rucsReales && rucsReales.size === 1 && !rucsReales.has(rucArchivo)) {
            const [rucCorrecto] = rucsReales;
            buscador = `${rucCorrecto}-${sn}`;
            autoCorregidos++;
          }
        }
      }
      if (existentes.has(buscador)) actualizados++; else nuevos++;
      return [
        buscador,
        (f.proveedor || '').toString().substring(0, 255) || null,
        f.fecha || null,
        f.monto !== '' && f.monto != null ? parseFloat(f.monto) || 0 : null,
        (f.glosa || '').toString().substring(0, 500) || null,
        (archivo || '').substring(0, 255) || null,
        req.user.id,
      ];
    });

    await pool.query(UPSERT_SQL, [valores]);
    res.json({ nuevos, actualizados, autoCorregidos, total: filas.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar la importación de contabilidad' });
  }
});

module.exports = router;
