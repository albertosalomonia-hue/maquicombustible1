const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { registrarAuditoria, getClientIP } = require('../middleware/audit');
const { getFechaLimiteCierre, getUltimoCierre } = require('../services/cierrePeriodo');

router.use(authMiddleware);

// GET /api/cierres-periodo/estado - cualquier usuario autenticado (lo consultan los
// formularios de recepciones/salidas/transferencias para bloquear fechas en el cliente)
router.get('/estado', async (req, res) => {
  try {
    const fechaLimite = await getFechaLimiteCierre();
    const ultimoCierre = await getUltimoCierre();
    res.json({ fecha_limite: fechaLimite, ultimo_cierre: ultimoCierre });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el estado del período' });
  }
});

router.use(requireRole('admin', 'gerente', 'contador'));

// Contraseña de confirmación requerida para cerrar o reabrir un período (misma clave
// usada para otras operaciones sensibles del sistema, p.ej. Trans-Almacenes).
const PASSWORD_CONFIRMACION_CIERRE = '@ayala.com';

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*, uc.nombre as usuario_cierre_nombre, ur.nombre as usuario_reapertura_nombre
       FROM maquicombus_cierres_periodo c
       LEFT JOIN maquicombus_usuarios uc ON c.usuario_cierre_id = uc.id
       LEFT JOIN maquicombus_usuarios ur ON c.usuario_reapertura_id = ur.id
       ORDER BY c.anio DESC, c.mes DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el historial de cierres' });
  }
});

router.post('/cerrar', async (req, res) => {
  const { anio, mes, observaciones, password } = req.body;
  const anioNum = parseInt(anio);
  const mesNum = parseInt(mes);
  if (!anioNum || !mesNum || mesNum < 1 || mesNum > 12) {
    return res.status(400).json({ error: 'Año y mes son requeridos (mes entre 1 y 12)' });
  }
  if (password !== PASSWORD_CONFIRMACION_CIERRE) {
    return res.status(403).json({ error: 'Contraseña de confirmación incorrecta' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[ultimo]] = await conn.query(
      `SELECT anio, mes FROM maquicombus_cierres_periodo WHERE estado = 'cerrado' ORDER BY anio DESC, mes DESC LIMIT 1`
    );

    if (ultimo) {
      const siguienteMes = ultimo.mes === 12 ? 1 : ultimo.mes + 1;
      const siguienteAnio = ultimo.mes === 12 ? ultimo.anio + 1 : ultimo.anio;
      if (anioNum !== siguienteAnio || mesNum !== siguienteMes) {
        await conn.rollback();
        return res.status(400).json({
          error: `Los cierres deben hacerse en orden. El siguiente período a cerrar es ${String(siguienteMes).padStart(2, '0')}/${siguienteAnio}.`,
        });
      }
    }

    const [[{ fecha_cierre: fechaCierre }]] = await conn.query(
      'SELECT LAST_DAY(?) as fecha_cierre', [`${anioNum}-${String(mesNum).padStart(2, '0')}-01`]
    );

    const hoy = new Date().toISOString().slice(0, 10);
    if (String(fechaCierre) > hoy) {
      await conn.rollback();
      return res.status(400).json({ error: 'No se puede cerrar un período que aún no ha terminado' });
    }

    const [result] = await conn.query(
      `INSERT INTO maquicombus_cierres_periodo (anio, mes, fecha_cierre, estado, observaciones, usuario_cierre_id)
       VALUES (?, ?, ?, 'cerrado', ?, ?)`,
      [anioNum, mesNum, fechaCierre, observaciones || null, req.user.id]
    );

    // Foto de los saldos de inventario al momento del cierre: sirve como saldo de
    // apertura verificado del mes siguiente, aunque erp_inventario ya arrastra el
    // saldo corriente de forma nativa entre meses.
    await conn.query(
      `INSERT INTO maquicombus_cierre_periodo_saldos (cierre_id, producto_id, almacen_id, cantidad, costo_unitario, valor_total)
       SELECT ?, producto_id, almacen_id, stock_fisico, costo_promedio, stock_fisico * costo_promedio
       FROM maquicombus_inventario WHERE stock_fisico <> 0 OR costo_promedio <> 0`,
      [result.insertId]
    );

    // Traslado del stock al período siguiente como líneas "Saldo Inicial" en el Kardex
    // (visibles ahí igual que cualquier otro movimiento). No tocan erp_inventario: el
    // stock físico ya está correcto, esto solo lo deja asentado como apertura del mes
    // que empieza. Quedan marcadas con cierre_periodo_id para que no puedan borrarse
    // sueltas — solo revirtiendo (reabriendo) este cierre.
    const siguienteMesRollover  = mesNum === 12 ? 1 : mesNum + 1;
    const siguienteAnioRollover = mesNum === 12 ? anioNum + 1 : anioNum;
    const fechaAperturaSiguiente = `${siguienteAnioRollover}-${String(siguienteMesRollover).padStart(2, '0')}-01`;
    const numeroDocSaldoInicial = `SI-${siguienteAnioRollover}${String(siguienteMesRollover).padStart(2, '0')}`;

    const [saldosParaTrasladar] = await conn.query(
      `SELECT producto_id, almacen_id, cantidad, costo_unitario, valor_total
       FROM maquicombus_cierre_periodo_saldos WHERE cierre_id = ? AND cantidad <> 0`,
      [result.insertId]
    );
    for (const s of saldosParaTrasladar) {
      await conn.query(
        `INSERT INTO maquicombus_kardex
           (producto_id, almacen_id, fecha, tipo_documento, numero_documento, movimiento,
            cantidad, costo_unitario, valor_total, saldo_cantidad, saldo_valor, saldo_costo_unitario,
            usuario_id, cierre_periodo_id)
         VALUES (?, ?, ?, 'SALDO_INICIAL', ?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.producto_id, s.almacen_id, fechaAperturaSiguiente, numeroDocSaldoInicial,
          s.cantidad, s.costo_unitario, s.valor_total,
          s.cantidad, s.valor_total, s.costo_unitario,
          req.user.id, result.insertId,
        ]
      );
    }

    await conn.commit();

    await registrarAuditoria({
      usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req),
      modulo: 'cierre_periodo', accion: 'cerrar', tabla: 'maquicombus_cierres_periodo', registroId: result.insertId,
      valorNuevo: { anio: anioNum, mes: mesNum, fecha_cierre: fechaCierre, saldos_iniciales_generados: saldosParaTrasladar.length },
    });

    const [[nuevo]] = await pool.query('SELECT * FROM maquicombus_cierres_periodo WHERE id = ?', [result.insertId]);
    res.status(201).json({ ...nuevo, saldos_iniciales_generados: saldosParaTrasladar.length });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese período ya fue cerrado' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error al cerrar el período' });
  } finally {
    conn.release();
  }
});

// POST /api/cierres-periodo/:id/reabrir - solo admin, y solo el último período cerrado
router.post('/:id/reabrir', requireRole('admin'), async (req, res) => {
  if (req.body.password !== PASSWORD_CONFIRMACION_CIERRE) {
    return res.status(403).json({ error: 'Contraseña de confirmación incorrecta' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[cierre]] = await conn.query('SELECT * FROM maquicombus_cierres_periodo WHERE id = ?', [req.params.id]);
    if (!cierre) { await conn.rollback(); return res.status(404).json({ error: 'Cierre no encontrado' }); }
    if (cierre.estado !== 'cerrado') { await conn.rollback(); return res.status(409).json({ error: 'Ese período ya está reabierto' }); }

    const [[ultimo]] = await conn.query(
      `SELECT id FROM maquicombus_cierres_periodo WHERE estado = 'cerrado' ORDER BY anio DESC, mes DESC LIMIT 1`
    );
    if (!ultimo || ultimo.id !== cierre.id) {
      await conn.rollback();
      return res.status(400).json({ error: 'Solo se puede reabrir el último período cerrado' });
    }

    await conn.query(
      `UPDATE maquicombus_cierres_periodo SET estado = 'reabierto', usuario_reapertura_id = ?, fecha_reapertura = NOW() WHERE id = ?`,
      [req.user.id, cierre.id]
    );

    await conn.commit();

    await registrarAuditoria({
      usuarioId: req.user.id, usuarioNombre: req.user.nombre, ip: getClientIP(req),
      modulo: 'cierre_periodo', accion: 'reabrir', tabla: 'maquicombus_cierres_periodo', registroId: cierre.id,
      valorAnterior: { anio: cierre.anio, mes: cierre.mes },
    });

    const [[actualizado]] = await pool.query('SELECT * FROM maquicombus_cierres_periodo WHERE id = ?', [cierre.id]);
    res.json(actualizado);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al reabrir el período' });
  } finally {
    conn.release();
  }
});

module.exports = router;
