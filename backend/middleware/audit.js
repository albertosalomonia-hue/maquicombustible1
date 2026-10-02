const { pool } = require('../db');

async function registrarAuditoria({ usuarioId, usuarioNombre, ip, modulo, accion, tabla, registroId, valorAnterior, valorNuevo }) {
  try {
    await pool.query(
      `INSERT INTO maquicombus_auditoria (usuario_id, usuario_nombre, ip, modulo, accion, tabla, registro_id, valor_anterior, valor_nuevo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usuarioId || null,
        usuarioNombre || null,
        ip || null,
        modulo,
        accion,
        tabla || null,
        registroId ? String(registroId) : null,
        valorAnterior ? JSON.stringify(valorAnterior) : null,
        valorNuevo ? JSON.stringify(valorNuevo) : null,
      ]
    );
  } catch (err) {
    console.error('Error en auditoría:', err.message);
  }
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || null;
}

module.exports = { registrarAuditoria, getClientIP };
