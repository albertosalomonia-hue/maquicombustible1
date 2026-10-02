// Capa de acceso a datos sobre Prisma 7 (adapter MariaDB/MySQL).
//
// El código de las rutas se escribió con la API de mysql2 (`pool.query(sql, params)` →
// `[rows, meta]`, `getConnection()` + transacciones). Esta capa mantiene ese contrato pero
// ejecuta todo con Prisma (`$queryRawUnsafe` / `$executeRawUnsafe` / `$transaction`), y
// normaliza los tipos para que el JSON de las respuestas sea el mismo que antes:
//   BigInt → number · Decimal → string · Date → 'YYYY-MM-DD HH:mm:ss' (como `dateStrings`).
// Para consultas nuevas usa `prisma` (cliente tipado generado desde prisma/schema.prisma).
const sqlstring = require('sqlstring');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { PrismaClient } = require('../generated/prisma/client');

const TZ = '-05:00'; // misma zona que usaba el pool de mysql2 al serializar fechas JS
const TX_OPTIONS = { timeout: 60_000, maxWait: 15_000 };

function crearCliente() {
  const url = new URL(process.env.DATABASE_URL);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    // En Vercel cada instancia abre su propio pool: mantenerlo pequeño.
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 5,
    connectTimeout: 30_000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  return new PrismaClient({ adapter });
}

// Singleton (también sobrevive al hot-reload en desarrollo). Se crea en la primera consulta,
// no al importar: `next build` carga los módulos del API sin DATABASE_URL.
const globalForPrisma = globalThis;
const obtenerCliente = () => globalForPrisma.__maquiPrisma ?? (globalForPrisma.__maquiPrisma = crearCliente());
const prisma = new Proxy({}, {
  get(_, clave) {
    const cliente = obtenerCliente();
    const valor = cliente[clave];
    return typeof valor === 'function' ? valor.bind(cliente) : valor;
  },
});

// ── Normalización de resultados ────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

function fechaATexto(d) {
  if (Number.isNaN(d.getTime())) return null;
  // El adapter entrega el valor "naive" de MySQL como si fuera UTC → leer con getters UTC.
  const f = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const h = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return { f, h, soloFecha: h === '00:00:00' && d.getUTCMilliseconds() === 0 };
}

// Prisma entrega DECIMAL como Decimal.js (la clase se llama 'Decimal2' al estar empaquetada).
const esDecimal = (v) => /^Decimal\d*$/.test(v.constructor?.name ?? '') && typeof v.toFixed === 'function';

// mysql2 devolvía DECIMAL como texto con su escala ('0.00'); la escala exacta no viaja en
// las consultas raw, así que se garantizan al menos 2 decimales.
function decimalATexto(d) {
  const t = d.toString();
  if (/e/i.test(t)) return d.toFixed();
  const dec = t.includes('.') ? t.split('.')[1].length : 0;
  return dec >= 2 ? t : d.toFixed(2);
}

function normalizar(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) {
    const t = fechaATexto(v);
    if (!t) return null;
    // Una columna DATE llega como medianoche exacta → 'YYYY-MM-DD' (como `dateStrings`).
    return t.soloFecha ? t.f : `${t.f} ${t.h}`;
  }
  if (Array.isArray(v)) return v.map(normalizar);
  if (typeof v === 'object') {
    if (esDecimal(v)) return decimalATexto(v);
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) return v;
    const out = {};
    for (const k of Object.keys(v)) out[k] = normalizar(v[k]);
    return out;
  }
  return v;
}

// ── Errores: traducir códigos de Prisma a los de mysql2 que usan las rutas ─────
const CODIGOS_MYSQL = {
  1062: 'ER_DUP_ENTRY',
  1451: 'ER_ROW_IS_REFERENCED_2',
  1452: 'ER_NO_REFERENCED_ROW_2',
  1048: 'ER_BAD_NULL_ERROR',
  1264: 'ER_WARN_DATA_OUT_OF_RANGE',
  1406: 'ER_DATA_TOO_LONG',
};

function traducirError(err) {
  const mysqlCode = Number(err?.meta?.code ?? err?.meta?.driverAdapterError?.cause?.originalCode);
  if (mysqlCode) {
    err.errno = mysqlCode;
    err.code = CODIGOS_MYSQL[mysqlCode] || err.code;
    err.sqlMessage = err.meta?.message || err.message;
  }
  return err;
}

// ── Ejecución de SQL ───────────────────────────────────────────────────────────
const ES_LECTURA = /^\s*(\(|SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b/i;
const ES_INSERT = /^\s*(INSERT|REPLACE)\b/i;
const esPrimitivo = (p) => p === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof p);

// Parámetros simples → binding nativo de Prisma. Arrays (`IN (?)`, `VALUES ?`), fechas y
// objetos → se expanden en cliente igual que hacía mysql2 en `pool.query`.
function prepararSql(sql, params) {
  if (!params || !params.length) return [sql, []];
  if (params.every(esPrimitivo)) return [sql, params.map((p) => (p === undefined ? null : p))];
  return [sqlstring.format(sql, params, false, TZ), []];
}

// `cliente` es el PrismaClient o el `tx` de una transacción interactiva.
async function ejecutar(cliente, sql, params) {
  const [q, p] = prepararSql(sql, params);
  try {
    if (ES_LECTURA.test(q)) {
      const filas = await cliente.$queryRawUnsafe(q, ...p);
      return [normalizar(filas), []];
    }
    if (ES_INSERT.test(q)) {
      // LAST_INSERT_ID() es por conexión: debe ir en la misma transacción que el INSERT.
      const correr = async (tx) => {
        const affectedRows = await tx.$executeRawUnsafe(q, ...p);
        const [{ id }] = await tx.$queryRawUnsafe('SELECT LAST_INSERT_ID() AS id');
        return { affectedRows, changedRows: 0, insertId: Number(id) };
      };
      // Fuera de transacción se abre una mínima; dentro de una ya abierta se usa tal cual
      // (el `tx` de Prisma también expone $transaction, pero anidarla rompe el rollback).
      const meta = cliente === prisma
        ? await prisma.$transaction(correr, TX_OPTIONS)
        : await correr(cliente);
      return [meta, []];
    }
    const affectedRows = await cliente.$executeRawUnsafe(q, ...p);
    return [{ affectedRows, changedRows: affectedRows, insertId: 0 }, []];
  } catch (err) {
    throw traducirError(err);
  }
}

class Conexion {
  constructor() {
    this.tx = null;
    this._terminar = null;
    this._finTx = null;
  }

  query(sql, params) {
    return ejecutar(this.tx ?? prisma, sql, params);
  }
  execute(sql, params) {
    return this.query(sql, params);
  }

  // Mantiene abierta una transacción interactiva hasta commit()/rollback().
  async beginTransaction() {
    if (this.tx) throw new Error('Transacción ya iniciada');
    let iniciada = false;
    await new Promise((listo, fallo) => {
      this._finTx = prisma
        .$transaction(async (tx) => {
          this.tx = tx;
          iniciada = true;
          listo();
          await new Promise((fin, abortar) => { this._terminar = { fin, abortar }; });
        }, TX_OPTIONS)
        .catch((e) => { if (!iniciada) fallo(traducirError(e)); else throw traducirError(e); });
    });
  }

  async commit() {
    if (!this.tx) return;
    const t = this._terminar; const fin = this._finTx;
    this.tx = null; this._terminar = null; this._finTx = null;
    t.fin();
    await fin;
  }

  async rollback() {
    if (!this.tx) return;
    const t = this._terminar; const fin = this._finTx;
    this.tx = null; this._terminar = null; this._finTx = null;
    t.abortar(ROLLBACK);
    await fin.catch(() => {});
  }

  release() {
    // Si el código olvidó cerrar la transacción, descartarla para no dejar la conexión ocupada.
    if (this.tx) this.rollback().catch(() => {});
  }
}
const ROLLBACK = new Error('rollback');

const pool = {
  query: (sql, params) => ejecutar(prisma, sql, params),
  execute: (sql, params) => ejecutar(prisma, sql, params),
  getConnection: async () => new Conexion(),
};

module.exports = { prisma, pool, normalizar };
