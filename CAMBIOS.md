# Cambios realizados

Resumen de los cambios de esta sesión (trabajo "solo con RESERVAS", reversión de transferencias, recálculo de costos).
Todos están ya en `main` (commits `870b8c5` a `557831c`). No se modificaron datos en la base de datos desde el código.

## 1. Dashboard — solo RESERVA

Archivo: `features/Dashboard.tsx`

- El medidor (cilindro) de **CONSUMO** queda oculto (bloque comentado, se reactiva quitando el comentario).
- El número grande de la tarjeta ("Stock físico") ahora muestra la **reserva** (`a.reserva`), no el físico. Ej.: LAR 230.00 en vez de 235.00.
- La escala del cilindro se calcula con la **mayor reserva** entre almacenes (antes usaba el stock físico, que incluía consumo).
- El backend (`GET /dashboard/gauges`) no cambió: sigue enviando consumo, pero la pantalla no lo usa.

## 2. Salidas — tipo RESERVA por defecto, CONSUMO en standby

Archivo: `features/Salidas/SalidasList.tsx`

- `tipo_salida` por defecto: `'reserva'` (formulario inicial y `reset` al pulsar "Nueva salida").
- Botón **CONSUMO** oculto (comentado). El botón RESERVA queda solo.
- Etiqueta **"Solicitante" → "CENTRO DE COSTOS"** en el formulario, lista, detalle, búsqueda y Excel. El dato se sigue guardando en el campo `solicitante`.
- El **Motivo** ahora se muestra siempre en el detalle (con "—" si está vacío).
- Vale PDF (`utils/valeSalidaPdf.ts`): la línea dice "Centro de costos: …".
- El backend no cambió: sigue aceptando `tipo_salida = 'consumo'` si se envía directamente.

## 3. Reversión de transferencias

Archivos: `backend/routes/transferencias.js`, `features/Transferencias/TransferenciasList.tsx`, `features/Transferencias/TransAlmacenes.tsx`

Nuevo endpoint `DELETE /api/transferencias/:id` (body: `{ password }`, clave de confirmación igual a la de Salidas).

Al revertir una transferencia `completada` (TRF-, TALM- o de reserva):

- El stock sale del destino y vuelve al origen.
- Si salió de una reserva (TALM-), se restituyen `stock_reservado` y el saldo (`cantidad`) de la reserva de origen (se busca por almacén, producto, lote y factura).
- Se eliminan las líneas de Kardex `TRANSFERENCIA_OUT` / `TRANSFERENCIA_IN` y la reserva creada en el destino.
- En transferencias `TRF-` el lote de recepción vuelve a quedar pendiente (`cantidad_transferida`).
- La transferencia queda en estado `anulada` y se registra en auditoría.

Se rechaza si: el período está cerrado, la reserva del destino ya tiene salidas, el destino ya no tiene la cantidad disponible, o el usuario no es admin/gerente ni del almacén involucrado.

Corrección posterior (`a1dacb8`): la búsqueda de la reserva de origen excluía las reservas creadas por recepción (`transferencia_detalle_id = NULL`) por usar `<>`; ahora usa `NOT (… <=> ?)`.

Pantallas:
- **Transferencias**: botón "Revertir transferencia" al expandir una transferencia completada.
- **Trans-Almacenes** (historial): columna con botón "Revertir".

Limitaciones: no existe "anular reversión"; el costo promedio del destino no se recalcula al revertir.

## 4. Inventario — botón "Recalcular costos"

Archivos: `backend/routes/inventario.js`, `features/Inventario/InventarioPage.tsx`

Nuevo endpoint `POST /api/inventario/recalcular-costos` (`{ aplicar?: boolean }`, solo admin/gerente).

1. Corrige recepciones cuyo **precio unitario es en realidad el total de la línea de la OC** (precio × cantidad > subtotal × 1.02, OC de una sola línea). Precio correcto = subtotal ÷ cantidad. Actualiza `recepcion_detalles`, la línea de Kardex y la reserva. No toca períodos cerrados.
2. Repite el Kardex en orden (promedio ponderado móvil) y recalcula `costo_promedio` por producto/almacén.
3. Sin `aplicar` **solo simula** (hace todo y deshace la transacción). Con `aplicar: true` confirma y registra auditoría.

En la pantalla: botón junto a "Exportar Excel" (solo supervisores). Muestra la simulación y pide la contraseña de confirmación antes de aplicar.

Caso detectado (producto `1-F-F-11E-001`, DIESEL B5 S50 UV):

| Recepción | Cantidad | Precio guardado | Precio correcto |
|---|---|---|---|
| REC-2026-00002 (F003-0000015302) | 40 | 575.93 | 14.3983 |
| REC-2026-00003 (F003-0000015303) | 30 | 526.02 | 17.5340 |

Efecto esperado: el costo promedio en LAR baja de S/ 165.0158 a unos S/ 16.89 y el valor del producto de unos S/ 47,359 a unos S/ 4,850. Las OC no se modifican.

**Pendiente:** ejecutar el botón y revisar la simulación antes de aplicar.

## 4b. Reportes — "Facturas vs Stock" (acordeón)

Archivos: `backend/routes/reportes.js`, `features/Reportes/FacturasVsStockPage.tsx`, `app/(app)/reportes/facturas-vs-stock/page.tsx`, `components/Layout/Sidebar.tsx`, `features/Usuarios/UsuariosList.tsx`

- Menú: Reportes → **Facturas vs Stock** (permiso `reportes/facturas-vs-stock`, agregado a la lista de Usuarios).
- Endpoint `GET /api/reportes/facturas-vs-stock`: una fila por línea de recepción de OC de **reserva**. Devuelve recibido, transferido, salido, queda, ubicación por almacén y los movimientos (transferencias completadas y salidas no anuladas).
- Pantalla en acordeón: cabecera con N° de factura, producto y totales (Recibido / Salió / Queda); al abrir, cuadro de movimientos con "queda" después de cada uno y dónde está lo que queda. Buscador, "Solo con saldo" y Exportar Excel.
- Regla: `queda = recibido − salidas`; las transferencias solo mueven stock entre almacenes.
- Verificado contra la base: 12 facturas, recibido 302.001, salidas 117, queda 185.001 (coincide con el saldo de `maquicombus_reservas` y con el stock reservado por almacén).

## 5. Hallazgos de datos (sin cambios aplicados)

- **LAR, producto 11:** el consumo de 5 GLN venía de `SI-2025-00001` (+37) menos las salidas SAL-2026-00002 (−31) y SAL-2026-00001 (−1). Esas salidas ya se revirtieron: consumo 37, reserva 250.001, físico 287.001.
- **Saldo guardado 74 en `SI-2025-00001`:** el saldo inicial se sumó sobre un stock físico que ya existía (37 + 37). Los saldos guardados por línea no siguen el orden por fecha; la pantalla de Kardex los recalcula.
- **CENTRIQO:** tiene 10 GLN de reserva (TALM-2026-00005 y 00006, 5 + 5, factura F001-16962). En Salidas solo se ven con tipo **RESERVA**: el modo CONSUMO lista `físico − reservado`, que es 0.
- **Contraseña `@ayala.com`:** está escrita en el código del frontend (`SalidasList.tsx`, `TransferenciasList.tsx`, `TransAlmacenes.tsx`, `InventarioPage.tsx`) y del backend (`salidas.js`, `transferencias.js`). Se pide solo para revertir/aplicar cambios sensibles, no para registrar salidas. Conviene moverla a una variable de entorno.

## 6. Pendientes / decisiones abiertas

- Confirmar que el despliegue incluya estos commits (el cilindro de consumo, el botón CONSUMO en Salidas y el botón de revertir dependen de ello).
- "Stock en inventario de 250 en LAR": tras revertir TALM-2026-00001 a 00003 la reserva de LAR volvió a 250.001.
- Decidir si la casilla "Centro de costos" de Salidas pasa a ser un selector en lugar de texto libre.
- Decidir si el Kardex debe mostrar el motivo de las salidas.
