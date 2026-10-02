const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.rol)) {
      return res.status(403).json({ error: 'Acceso denegado: permisos insuficientes' });
    }
    next();
  };
}

// Solo admin, gerente, o erp_usuarios del almacén central pueden crear/editar maestros y compras
function requirePrincipalAccess(req, res, next) {
  const { rol, almacen_tipo } = req.user || {};
  if (rol === 'admin' || rol === 'gerente') return next();
  if (!almacen_tipo || almacen_tipo === 'central') return next();
  return res.status(403).json({ error: 'Solo el almacén central puede realizar esta operación' });
}

// Fuerza filtro de almacén para erp_usuarios con almacén asignado (que no son admin/gerente)
function injectAlmacenFilter(req, res, next) {
  const { rol, almacen_id } = req.user || {};
  if (almacen_id && rol !== 'admin' && rol !== 'gerente') {
    req.almacenFiltro = almacen_id;
  }
  next();
}

module.exports = { authMiddleware, requireRole, requirePrincipalAccess, injectAlmacenFilter };
