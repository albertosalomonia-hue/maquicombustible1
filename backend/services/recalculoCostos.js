// Recalcula el Kardex de uno o más (producto, almacén) reproduciendo su historial en el
// mismo orden con que se muestra (fecha, entradas antes que salidas, saldo inicial primero, id).
//
// Reglas de costeo (las mismas con las que se registran los movimientos):
//  - Entradas (RECEPCION, SALDO_INICIAL, AJUSTE_POS): conservan su costo. Las
//    TRANSFERENCIA_IN toman el costo de su TRANSFERENCIA_OUT (se propaga entre almacenes).
//  - TRANSFERENCIA_OUT ligada a un lote de recepción: costo del lote (precio de la recepción).
//  - SALIDA_RESERVA: costo de la reserva de donde sale.
//  - Resto de salidas (consumo, ajuste negativo, transferencia sin lote): costo promedio
//    ponderado corrido.
//  - Líneas "Saldo Inicial" de cierre de período (cierre_periodo_id): son el arrastre del
//    saldo del mes anterior, no un movimiento; no suman al saldo corrido y se reajustan al
//    saldo recalculado justo antes de su fecha.
// Después actualiza detalles de salida/transferencia, reservas y el costo promedio de
// inventario (si la cantidad del Kardex coincide con el stock físico).

const EPS = 0.00005;
const dif = (a, b) => Math.abs(parseFloat(a) - parseFloat(b)) > EPS;

async function recalcularPar(conn, productoId, almacenId, cola, resumen) {
  const [rows] = await conn.query(
    `SELECT k.id, k.fecha, k.tipo_documento, k.movimiento, k.cantidad, k.costo_unitario, k.valor_total,
            k.saldo_cantidad, k.saldo_valor, k.saldo_costo_unitario,
            k.referencia_id, k.transferencia_detalle_id, k.cierre_periodo_id,
            rd.precio_unitario AS lote_costo,
            CASE WHEN k.tipo_documento = 'SALIDA_RESERVA' THEN
              (SELECT rv.costo_unitario
                 FROM maquicombus_salida_detalles sd
                 JOIN maquicombus_reservas rv ON rv.id = sd.reserva_id
                WHERE sd.salida_id = k.referencia_id AND sd.producto_id = k.producto_id
                  AND sd.cantidad = k.cantidad AND sd.reserva_id IS NOT NULL LIMIT 1)
            END AS reserva_costo
     FROM maquicombus_kardex k
     LEFT JOIN maquicombus_transferencia_detalles td ON td.id = k.transferencia_detalle_id
     LEFT JOIN maquicombus_recepcion_detalles rd ON rd.id = td.recepcion_detalle_id
     WHERE k.producto_id = ? AND k.almacen_id = ?
     ORDER BY k.fecha, (k.movimiento = 'entrada') DESC, (k.tipo_documento = 'SALDO_INICIAL') DESC, k.id`,
    [productoId, almacenId]
  );

  let qty = 0, val = 0, ultimoCosto = 0;
  for (const r of rows) {
    const cant = parseFloat(r.cantidad);
    let costo;

    if (r.cierre_periodo_id) {
      // Arrastre de cierre: refleja el saldo recalculado hasta ese momento.
      costo = qty > EPS ? val / qty : 0;
      const nuevoVal = cant * costo;
      if (dif(r.costo_unitario, costo) || dif(r.valor_total, nuevoVal)) {
        await conn.query(
          'UPDATE maquicombus_kardex SET costo_unitario = ?, valor_total = ?, saldo_cantidad = ?, saldo_valor = ?, saldo_costo_unitario = ? WHERE id = ?',
          [costo, nuevoVal, cant, nuevoVal, costo, r.id]
        );
        resumen.lineas++;
      }
      continue;
    }

    if (r.movimiento === 'entrada') {
      costo = parseFloat(r.costo_unitario);
      qty += cant; val += cant * costo;
    } else {
      if (r.tipo_documento === 'TRANSFERENCIA_OUT' && r.lote_costo != null) costo = parseFloat(r.lote_costo);
      else if (r.tipo_documento === 'SALIDA_RESERVA' && r.reserva_costo != null) costo = parseFloat(r.reserva_costo);
      else costo = qty > EPS ? val / qty : ultimoCosto;
      qty -= cant; val -= cant * costo;
    }
    ultimoCosto = costo;

    const valorLinea = cant * costo;
    const saldoCu = qty > EPS ? val / qty : 0;
    const cambioCosto = dif(r.costo_unitario, costo) || dif(r.valor_total, valorLinea);
    const cambioSaldo = dif(r.saldo_cantidad, qty) || dif(r.saldo_valor, val) || dif(r.saldo_costo_unitario, saldoCu);
    if (cambioCosto || cambioSaldo) {
      await conn.query(
        'UPDATE maquicombus_kardex SET costo_unitario = ?, valor_total = ?, saldo_cantidad = ?, saldo_valor = ?, saldo_costo_unitario = ? WHERE id = ?',
        [costo, valorLinea, qty, val, saldoCu, r.id]
      );
      resumen.lineas++;
    }

    if (cambioCosto && r.movimiento === 'salida') {
      if (r.tipo_documento === 'SALIDA_CONSUMO' || r.tipo_documento === 'SALIDA_RESERVA') {
        await conn.query(
          'UPDATE maquicombus_salida_detalles SET costo_unitario = ?, valor_total = cantidad * ? WHERE salida_id = ? AND producto_id = ? AND cantidad = ?',
          [costo, costo, r.referencia_id, productoId, r.cantidad]
        );
      } else if (r.tipo_documento === 'TRANSFERENCIA_OUT' && r.transferencia_detalle_id) {
        await conn.query('UPDATE maquicombus_transferencia_detalles SET costo_unitario = ? WHERE id = ?', [costo, r.transferencia_detalle_id]);
        await conn.query('UPDATE maquicombus_reservas SET costo_unitario = ? WHERE transferencia_detalle_id = ?', [costo, r.transferencia_detalle_id]);
        // La entrada del almacén destino hereda este costo → se recalcula su almacén también.
        const [ins] = await conn.query(
          "SELECT id, almacen_id, cantidad FROM maquicombus_kardex WHERE transferencia_detalle_id = ? AND tipo_documento = 'TRANSFERENCIA_IN'",
          [r.transferencia_detalle_id]
        );
        for (const i of ins) {
          await conn.query('UPDATE maquicombus_kardex SET costo_unitario = ?, valor_total = cantidad * ? WHERE id = ?', [costo, costo, i.id]);
          cola.push([productoId, i.almacen_id]);
        }
      }
    }
  }

  // Costo promedio del inventario: solo si el Kardex cuadra con el stock físico.
  const [[inv]] = await conn.query(
    'SELECT stock_fisico, costo_promedio FROM maquicombus_inventario WHERE producto_id = ? AND almacen_id = ?',
    [productoId, almacenId]
  );
  if (inv) {
    if (Math.abs(parseFloat(inv.stock_fisico) - qty) < 0.01) {
      const cp = qty > EPS ? val / qty : 0;
      if (dif(inv.costo_promedio, cp)) {
        await conn.query('UPDATE maquicombus_inventario SET costo_promedio = ? WHERE producto_id = ? AND almacen_id = ?', [cp, productoId, almacenId]);
        resumen.inventarios++;
      }
    } else {
      resumen.inventarioDescuadrado.push({ producto_id: productoId, almacen_id: almacenId, kardex: +qty.toFixed(4), stock_fisico: parseFloat(inv.stock_fisico) });
    }
  }
}

// pares: [[producto_id, almacen_id], ...]
async function recalcularCostosKardex(db, pares) {
  const resumen = { pares: 0, lineas: 0, inventarios: 0, inventarioDescuadrado: [] };
  if (!pares.length) return resumen;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const cola = [...pares];
    const hechos = new Map(); // clave → veces procesado (tope para evitar ciclos)
    while (cola.length) {
      const [p, a] = cola.shift();
      const clave = `${p}|${a}`;
      const veces = hechos.get(clave) || 0;
      if (veces >= 3) continue;
      hechos.set(clave, veces + 1);
      await recalcularPar(conn, p, a, cola, resumen);
    }
    resumen.pares = hechos.size;
    await conn.commit();
    return resumen;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { recalcularCostosKardex };
