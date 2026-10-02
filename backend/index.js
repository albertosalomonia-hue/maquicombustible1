// Despachador del API: /api/<recurso>/... → módulo de backend/routes.
// Equivale a los `app.use('/api/xxx', require('./routes/xxx'))` del Express original.
const rutas = {
  auth: require('./routes/auth'),
  clientes: require('./routes/clientes'),
  productos: require('./routes/productos'),
  categorias: require('./routes/categorias'),
  familias: require('./routes/familias'),
  'contabilidad-importada': require('./routes/contabilidad_importada'),
  marcas: require('./routes/marcas'),
  'unidades-medida': require('./routes/unidades_medida'),
  almacenes: require('./routes/almacenes'),
  'centros-costo': require('./routes/centros_costo'),
  cotizaciones: require('./routes/cotizaciones'),
  pagos: require('./routes/pagos'),
  'ordenes-compra': require('./routes/ordenes_compra'),
  facturas: require('./routes/facturas'),
  recepciones: require('./routes/recepciones'),
  transferencias: require('./routes/transferencias'),
  kardex: require('./routes/kardex'),
  inventario: require('./routes/inventario'),
  solicitudes: require('./routes/solicitudes'),
  salidas: require('./routes/salidas'),
  reservas: require('./routes/reservas'),
  placas: require('./routes/placas'),
  dashboard: require('./routes/dashboard'),
  usuarios: require('./routes/usuarios'),
  reportes: require('./routes/reportes'),
  'cierres-periodo': require('./routes/cierres_periodo'),
};

const json = (status, body) => ({ status, body });

// Lee el cuerpo según el Content-Type → { body, files }.
async function leerCuerpo(request) {
  if (['GET', 'HEAD', 'DELETE'].includes(request.method) && !request.headers.get('content-length')) {
    return { body: {}, files: {} };
  }
  const tipo = request.headers.get('content-type') || '';
  try {
    if (tipo.includes('application/json')) return { body: (await request.json()) ?? {}, files: {} };
    if (tipo.includes('multipart/form-data') || tipo.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      const body = {}; const files = {};
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') body[k] = v;
        else files[k] = { originalname: v.name, mimetype: v.type, size: v.size, buffer: Buffer.from(await v.arrayBuffer()) };
      }
      return { body, files };
    }
  } catch {
    throw Object.assign(new Error('Cuerpo de la petición inválido'), { status: 400 });
  }
  return { body: {}, files: {} };
}

function leerQuery(url) {
  const query = {};
  for (const [k, v] of url.searchParams.entries()) {
    const clave = k.endsWith('[]') ? k.slice(0, -2) : k;
    if (k.endsWith('[]') || clave in query) query[clave] = [].concat(query[clave] ?? [], v);
    else query[clave] = v;
  }
  return query;
}

/** Atiende una petición del API. Devuelve { status, body }. */
async function atender(request, segmentos) {
  const [recurso, ...resto] = segmentos;
  const url = new URL(request.url);

  if (recurso === 'health' && !resto.length) {
    return json(200, { status: 'ok', timestamp: new Date().toISOString(), version: '2026.1.0' });
  }
  const router = Object.hasOwn(rutas, recurso ?? '') ? rutas[recurso] : null;
  if (!router) return json(404, { error: 'Ruta no encontrada' });

  let cuerpo;
  try { cuerpo = await leerCuerpo(request); } catch (e) { return json(e.status || 400, { error: e.message }); }

  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    query: leerQuery(url),
    body: cuerpo.body,
    files: cuerpo.files,
    params: {},
    socket: { remoteAddress: null },
  };

  let respuesta = null;
  const res = {
    terminada: false,
    _status: 200,
    status(c) { this._status = c; return this; },
    json(b) { respuesta = json(this._status, b); this.terminada = true; return this; },
  };

  try {
    const atendida = await router.handle(req, res, '/' + resto.join('/'));
    if (!atendida) return json(404, { error: 'Ruta no encontrada' });
    return respuesta ?? json(500, { error: 'Error interno del servidor' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Error interno del servidor' });
  }
}

module.exports = { atender };
