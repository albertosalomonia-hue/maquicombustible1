// Mini-router con la forma de Express (`router.get('/:id', mw, handler)`, `router.use(mw)`,
// `req.params/query/body/user`, `res.status().json()`), pero sin Express: lo ejecuta el
// Route Handler de Next (app/api/[...path]/route.ts). Así los módulos de `routes/` siguen
// siendo handlers planos (req, res) y no dependen del framework HTTP.

function compilar(path) {
  const nombres = [];
  const fuente = path
    .replace(/\/+$/, '')
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === ':' ? c : `\\${c}`))
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => { nombres.push(n); return '([^/]+)'; });
  return { regex: new RegExp(`^${fuente}/?$`), nombres };
}

class Router {
  constructor() {
    this.capas = [];
  }

  use(...fns) {
    this.capas.push({ metodo: null, patron: null, fns });
    return this;
  }

  _ruta(metodo, path, fns) {
    this.capas.push({ metodo, patron: compilar(path), fns });
    return this;
  }

  get(p, ...f) { return this._ruta('GET', p, f); }
  post(p, ...f) { return this._ruta('POST', p, f); }
  put(p, ...f) { return this._ruta('PUT', p, f); }
  patch(p, ...f) { return this._ruta('PATCH', p, f); }
  delete(p, ...f) { return this._ruta('DELETE', p, f); }

  // Devuelve true si alguna ruta respondió.
  async handle(req, res, subpath) {
    const cola = [];
    for (const capa of this.capas) {
      if (capa.metodo === null) { cola.push({ fns: capa.fns, params: {} }); continue; }
      if (capa.metodo !== req.method) continue;
      const m = capa.patron.regex.exec(subpath);
      if (!m) continue;
      const params = {};
      capa.patron.nombres.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      cola.push({ fns: capa.fns, params });
    }
    // Un `use` solo cuenta si luego hay una ruta que coincida (si no, 404 sin autenticar).
    const tieneRuta = this.capas.some((c) => c.metodo === req.method && c.patron.regex.test(subpath));
    if (!tieneRuta) return false;

    for (const { fns, params } of cola) {
      req.params = params;
      for (const fn of fns) {
        let siguiente = false;
        await fn(req, res, () => { siguiente = true; });
        if (res.terminada) return true;
        if (!siguiente) {
          // Handler final: terminó sin llamar a next().
          return true;
        }
      }
    }
    return true;
  }
}

// Reemplazo mínimo de multer.memoryStorage + single(): el archivo ya viene parseado
// (request.formData()) en req.files; aquí solo se aplica el límite y se expone en req.file.
const multer = Object.assign(
  (opts = {}) => ({
    single: (campo) => (req, res, next) => {
      const f = req.files?.[campo];
      if (f && opts.limits?.fileSize && f.size > opts.limits.fileSize) {
        return res.status(413).json({ error: 'Archivo demasiado grande' });
      }
      req.file = f;
      next();
    },
  }),
  { memoryStorage: () => ({}) }
);

module.exports = { Router: () => new Router(), multer };
