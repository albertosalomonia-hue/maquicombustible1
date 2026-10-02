const { pool } = require('../db');

// Última fecha bloqueada: cualquier movimiento con fecha <= a esta está dentro de un
// período ya cerrado. Un período "reabierto" deja de contar para el bloqueo.
async function getFechaLimiteCierre(conn = pool) {
  const [[row]] = await conn.query(
    `SELECT fecha_cierre FROM maquicombus_cierres_periodo WHERE estado = 'cerrado' ORDER BY anio DESC, mes DESC LIMIT 1`
  );
  return row ? row.fecha_cierre : null;
}

async function getUltimoCierre(conn = pool) {
  const [[row]] = await conn.query(
    `SELECT * FROM maquicombus_cierres_periodo WHERE estado = 'cerrado' ORDER BY anio DESC, mes DESC LIMIT 1`
  );
  return row || null;
}

// Lanza un error (status 400) si la fecha cae dentro de un período ya cerrado.
// Se usa dentro de las transacciones de recepciones/salidas/transferencias/ajustes
// para impedir registrar o revertir movimientos en un mes ya cerrado.
async function assertPeriodoAbierto(conn, fecha) {
  const fechaLimite = await getFechaLimiteCierre(conn);
  if (fechaLimite && String(fecha) <= String(fechaLimite)) {
    const err = new Error(
      `El período contable está cerrado hasta el ${fechaLimite}. No se pueden registrar ni modificar movimientos en esa fecha o anteriores.`
    );
    err.status = 400;
    throw err;
  }
}

module.exports = { getFechaLimiteCierre, getUltimoCierre, assertPeriodoAbierto };
