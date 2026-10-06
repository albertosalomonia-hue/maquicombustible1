// La app de Maquicombustibles solo trabaja con órdenes de compra/servicio de estos
// proveedores (ESSO ENERGÍA, SERVICENTRO EL PIONERO, D&B COMBUSTIBLES DEL PERU y SERVICENTRO PIZARRO SAC)
// y solo del año indicado.
const RUCS_PERMITIDOS = ['20613076981', '20502669401', '20521579782', '20427140467'];
const ANIO_OC = 2026;

module.exports = { RUCS_PERMITIDOS, ANIO_OC };
