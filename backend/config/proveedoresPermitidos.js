// La app de Maquicombustibles solo trabaja con órdenes de compra/servicio de estos
// proveedores (ESSO ENERGÍA, SERVICENTRO EL PIONERO y D&B COMBUSTIBLES DEL PERU) y solo del año indicado.
const RUCS_PERMITIDOS = ['20613076981', '20502669401', '20521579782'];
const ANIO_OC = 2026;

module.exports = { RUCS_PERMITIDOS, ANIO_OC };
