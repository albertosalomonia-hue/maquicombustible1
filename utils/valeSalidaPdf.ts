const logoUrl = '/logonuevo.png'

let logoImgPromise: Promise<HTMLImageElement> | null = null
function cargarLogo(): Promise<HTMLImageElement> {
  if (!logoImgPromise) {
    logoImgPromise = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = logoUrl
    })
  }
  return logoImgPromise
}

export async function generarValeSalidaPDF(salida: any) {
  // jsPDF pesa bastante: se descarga solo cuando el usuario genera un vale.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const logo = await cargarLogo()
  const logoRatio = logo.naturalHeight / logo.naturalWidth

  // Marca de agua: el logo centrado y a baja opacidad detrás de todo el contenido.
  const wmWidth = pageWidth * 0.7
  const wmHeight = wmWidth * logoRatio
  doc.saveGraphicsState()
  doc.setGState(new (doc as any).GState({ opacity: 0.06 }))
  doc.addImage(logo, 'PNG', (pageWidth - wmWidth) / 2, (pageHeight - wmHeight) / 2, wmWidth, wmHeight)
  doc.restoreGraphicsState()

  // Logo en la esquina superior izquierda
  const logoW = 24
  const logoH = logoW * logoRatio
  doc.addImage(logo, 'PNG', 12, 8, logoW, logoH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('VALE DE SALIDA DE ALMACÉN', pageWidth / 2, 18, { align: 'center' })

  doc.setFontSize(11)
  doc.text(salida.numero || '', pageWidth / 2, 25, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const infoY = 36
  doc.text(`Fecha: ${salida.fecha || ''}`, 14, infoY)
  doc.text(`Almacén: ${salida.almacen_nombre || ''}`, 14, infoY + 6)
  doc.text(`Centro de costos: ${salida.solicitante || '—'}`, 14, infoY + 12)
  doc.text(`Motivo: ${salida.motivo || '—'}`, 14, infoY + 18)
  if (salida.tipo_salida === 'reserva') {
    doc.text(`Tipo: RESERVA · Orden de salida de reserva: ${salida.orden_salida_reserva || '—'}`, 14, infoY + 24)
  }

  const filas = (salida.detalles || []).map((d: any) => [
    d.sku || '',
    d.reserva_factura ? `${d.reserva_factura} (RESERVA)` : d.es_diesel
      ? (d.factura_serie ? `${d.factura_serie}-${d.factura_numero}${d.oc_numero ? ` (OC ${d.oc_numero})` : ''}` : '—')
      : '—',
    d.producto_descripcion || '',
    d.centro_costo_nombre || '—',
    d.placa || (d.es_diesel ? d.placa_vehiculo : null) || '—',
    d.es_diesel && d.horometro != null ? String(d.horometro) : '—',
    d.es_diesel ? (d.fecha_abastecimiento || '—') : '—',
    `${parseFloat(d.cantidad).toFixed(2)} ${d.unidad || ''}`.trim(),
  ])

  autoTable(doc, {
    startY: infoY + 26,
    head: [['SKU', 'FACT/OC', 'Producto', 'Centro de Costo', 'Placa / Código', 'Horómetro', 'Fecha Abast.', 'Cantidad']],
    body: filas,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 7: { halign: 'right' } },
  })

  const finalY = (doc as any).lastAutoTable?.finalY || infoY + 30

  const firmaY = Math.min(finalY + 30, doc.internal.pageSize.getHeight() - 20)
  const col1X = 30
  const col2X = pageWidth / 2 + 15

  doc.setFontSize(9)
  doc.line(col1X, firmaY, col1X + 60, firmaY)
  doc.text('Entregado por', col1X + 30, firmaY + 5, { align: 'center' })
  doc.line(col2X, firmaY, col2X + 60, firmaY)
  doc.text('Recibido por', col2X + 30, firmaY + 5, { align: 'center' })

  doc.save(`Vale_${salida.numero || 'salida'}.pdf`)
}
