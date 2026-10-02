'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { setNavState, consumeNavState } from '../../utils/navState'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, Truck, Trash2, Pencil, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ExternalLink, ArrowLeftRight, Lock as LockIcon, FileDown } from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'
import { useConfirm } from '../../context/ConfirmContext'

const TRANSFERIR_DESDE_RECEPCION_HABILITADO = true

export default function RecepcionesList() {
  const router = useRouter()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedOC, setSelectedOC] = useState<any>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 100
  const [exportando, setExportando] = useState(false)
  const [despachoFijo, setDespachoFijo] = useState(false)
  const [editFecha, setEditFecha] = useState<{ id: number; numero: string; fecha: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['recepciones', search, fechaDesde, fechaHasta, page],
    queryFn: () => api.get('/recepciones', { params: { search, fecha_desde: fechaDesde || undefined, fecha_hasta: fechaHasta || undefined, limit: PAGE_SIZE, page } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const fechaMutation = useMutation({
    mutationFn: (d: { id: number; fecha: string }) => api.put(`/recepciones/${d.id}/fecha`, { fecha: d.fecha }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recepciones'] })
      qc.invalidateQueries({ queryKey: ['recepcion'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      toast.success('Fecha de la recepción actualizada')
      setEditFecha(null)
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al actualizar la fecha'),
  })

  const handleSearchChange =(v: string) => { setSearch(v); setPage(1) }
  const handleFechaDesdeChange = (v: string) => { setFechaDesde(v); setPage(1) }
  const handleFechaHastaChange = (v: string) => { setFechaHasta(v); setPage(1) }
  const limpiarFechas = () => { setFechaDesde(''); setFechaHasta(''); setPage(1) }
  const totalRegistros = data?.total ?? 0
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / PAGE_SIZE))
  // La ENTRADA puede ir a cualquier almacén activo: se elige al recepcionar.
  const { data: almacenes } = useQuery({
    queryKey: ['almacenes-activos'],
    queryFn: () => api.get('/almacenes').then(r => (r.data as any[]).filter(a => a.estado === 'activo')),
  })
  const { data: catalogo } = useQuery({
    queryKey: ['catalogo'],
    queryFn: () => api.get('/productos/catalogo').then(r => r.data),
  })

  const { register, handleSubmit, reset, watch, control, setValue, formState: { isSubmitting } } = useForm<any>({
    defaultValues: { orden_compra_id: '', almacen_destino_id: '', tipo_despacho: '', fecha: new Date().toISOString().slice(0,10), tipo: 'total', observaciones: '', detalles: [] }
  })

  // Abrir modal pre-seleccionado si venimos desde OrdenesCompra. El almacén y el despacho
  // (CONSUMO / RESERVA) se eligen a mano: cambian por factura.
  useEffect(() => {
    const state = consumeNavState<{ ocId?: number; ocNumero?: string; ocFecha?: string; esReserva?: boolean }>('/recepciones')
    if (state?.ocId) {
      // Si la orden se marcó RESERVA, el despacho llega preseleccionado y en solo lectura.
      setDespachoFijo(true)
      reset({ orden_compra_id: String(state.ocId), almacen_destino_id: '', tipo_despacho: state.esReserva ? 'reserva' : 'consumo', fecha: state.ocFecha || new Date().toISOString().slice(0,10), tipo: 'total', observaciones: '', detalles: [] })
      setModalOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const tipoDespacho = watch('tipo_despacho')
  const { fields, append, remove } = useFieldArray({ control, name: 'detalles' })

  const ocId = watch('orden_compra_id')
  const { data: ocDetalle } = useQuery({
    queryKey: ['oc-detalle-rec', ocId],
    queryFn: () => api.get(`/ordenes-compra/${ocId}`).then(r => r.data),
    enabled: !!ocId,
  })

  useEffect(() => {
    if (!ocDetalle?.detalles) return
    // La fecha de la recepción se prellena con la fecha de la propia OC (no la de hoy),
    // para que el Kardex quede con la fecha real de la orden en toda la cadena.
    if (ocDetalle.fecha) setValue('fecha', ocDetalle.fecha)
    // Enrich each detail with product conversion data from catalogo
    const cat: any[] = catalogo || []
    setValue('detalles', ocDetalle.detalles.map((det: any) => {
      const prod = cat.find((p: any) => p.id === det.producto_id) || {}
      const factor = parseFloat(prod.factor_conversion) || 1
      const pendiente = det.cantidad_pedida - (det.cantidad_recibida || 0)
      // cantidad_compra: en unidad de compra (CAJA); cantidad_recibida: en unidad base (UND)
      return {
        producto_id: det.producto_id,
        orden_detalle_id: det.id,
        producto_nombre: det.producto_descripcion || det.descripcion,
        unidad: prod.unidad || det.unidad || '',
        unidad_compra: prod.unidad_compra_codigo || '',
        factor_conversion: factor,
        cantidad_pedida: pendiente,
        cantidad_compra: factor > 1 ? +(pendiente / factor).toFixed(4) : pendiente,
        cantidad_recibida: pendiente,
        precio_unitario: det.precio_unitario,
      }
    }))
  }, [ocDetalle, catalogo])

  const mutation = useMutation({
    mutationFn: (d: any) => api.post('/recepciones', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recepciones'] })
      qc.invalidateQueries({ queryKey: ['ordenes-compra'] })
      qc.invalidateQueries({ queryKey: ['oc-detail'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      toast.success('Recepción registrada e inventario actualizado')
      setModalOpen(false); reset()
    },
  })

  const [expandedId, setExpandedId] = useState<number | null>(null)
  const toggleExpand = (id: number) => setExpandedId(prev => prev === id ? null : id)

  const { data: recDetail } = useQuery({
    queryKey: ['recepcion-detail', expandedId],
    queryFn: () => api.get(`/recepciones/${expandedId}`).then(r => r.data),
    enabled: !!expandedId,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/recepciones/${id}`).then(r => r.data),
    onSuccess: () => {
      toast.success('Recepción eliminada y stock revertido')
      qc.invalidateQueries({ queryKey: ['recepciones'] })
      qc.invalidateQueries({ queryKey: ['ordenes-compra'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      setExpandedId(null)
    },
  })

  const handleDelete = async (r: any) => {
    const ok = await confirm({
      title: 'Eliminar recepción',
      message: <>¿Eliminar la recepción <strong>{r.numero}</strong>? Se revertirá el stock y se recalculará el estado de la OC.</>,
      variant: 'danger',
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    deleteMutation.mutate(r.id)
  }

  const recepciones = data?.data || []
  const { sorted, sortCol, sortDir, toggle } = useSortTable(recepciones, 'fecha', 'desc')

  const ESTADO_COLOR: Record<string, { bg: string; text: string }> = {
    completada: { bg: 'FFDCFCE7', text: 'FF166534' },
    borrador:   { bg: 'FFF1F5F9', text: 'FF475569' },
    anulada:    { bg: 'FFFEE2E2', text: 'FF991B1B' },
  }
  const TIPO_COLOR: Record<string, { bg: string; text: string }> = {
    total:   { bg: 'FFDBEAFE', text: 'FF1D4ED8' },
    parcial: { bg: 'FFFEF3C7', text: 'FFB45309' },
  }

  const handleExportExcel = async () => {
    setExportando(true)
    try {
      const totalFilas = data?.total || 0
      const { data: full } = await api.get('/recepciones', { params: { search, fecha_desde: fechaDesde || undefined, fecha_hasta: fechaHasta || undefined, limit: Math.max(totalFilas, 1), page: 1 } })
      const filas: any[] = full?.data || []
      if (!filas.length) { toast.error('No hay recepciones para exportar'); return }

      // Trae el detalle de ítems de cada recepción, en lotes para no saturar el pool
      // de conexiones del servidor si hay cientos de recepciones. Si una recepción puntual
      // falla, no debe abortar la exportación completa: se omite y se avisa al final.
      const LOTE = 10
      const detalles: { recepcion: any; det: any[] }[] = []
      let fallidas = 0
      for (let i = 0; i < filas.length; i += LOTE) {
        const lote = filas.slice(i, i + LOTE)
        const resultados = await Promise.all(
          lote.map(r =>
            api.get(`/recepciones/${r.id}`)
              .then(res => ({ recepcion: r, det: res.data.detalles || [] }))
              .catch(() => { fallidas++; return null })
          )
        )
        detalles.push(...resultados.filter((r): r is { recepcion: any; det: any[] } => r !== null))
      }
      if (!detalles.length) { toast.error('No se pudo obtener el detalle de ninguna recepción'); return }

      const COLOR = {
        header: 'FF1E293B', headerText: 'FFFFFFFF',
        filaPar: 'FFFFFFFF', filaImpar: 'FFF8FAFC', borde: 'FFE2E8F0',
      }
      const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
      const thinBorder = { style: 'thin' as const, color: { argb: COLOR.borde } }
      const estiloHeaderCell = (cell: any, bg: string) => {
        cell.fill = fill(bg)
        cell.font = { color: { argb: COLOR.headerText }, bold: true, size: 10 }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
      }

      const { default: ExcelJS } = await import('exceljs')

      const wb = new ExcelJS.Workbook()
      wb.creator = 'KardexERP 2026'
      wb.created = new Date()

      // ── Hoja única: Recepciones (una fila por producto recibido, con todos los datos) ──
      const ws = wb.addWorksheet('Recepciones', { views: [{ state: 'frozen', ySplit: 1 }] })
      ws.columns = [
        { header: 'Número', key: 'numero', width: 16 },
        { header: 'Fecha', key: 'fecha', width: 12 },
        { header: 'Factura', key: 'factura', width: 16 },
        { header: 'OC Origen', key: 'oc', width: 16 },
        { header: 'Almacén Destino', key: 'almacen', width: 24 },
        { header: 'SKU', key: 'sku', width: 18 },
        { header: 'Producto', key: 'producto', width: 36 },
        { header: 'C. Costo', key: 'cc', width: 20 },
        { header: 'U/M', key: 'unidad', width: 10 },
        { header: 'Cantidad Recibida', key: 'cantidad', width: 16 },
        { header: 'Precio Unitario', key: 'precio', width: 14 },
        { header: 'Total', key: 'total', width: 14 },
        { header: 'Lote', key: 'lote', width: 14 },
        { header: 'Vencimiento', key: 'venc', width: 14 },
        { header: 'Transferido', key: 'transferido', width: 14 },
        { header: 'Tipo', key: 'tipo', width: 12 },
        { header: 'Estado', key: 'estado', width: 14 },
        { header: 'Registrado por', key: 'usuario', width: 20 },
        { header: 'Observaciones', key: 'obs', width: 26 },
      ]
      ws.getRow(1).eachCell(cell => estiloHeaderCell(cell, COLOR.header))
      ws.getRow(1).height = 20

      const TRANSFERIDO_COLOR: Record<string, { bg: string; text: string }> = {
        'Sí':      { bg: 'FFDCFCE7', text: 'FF166534' },
        'Parcial': { bg: 'FFFEF3C7', text: 'FFB45309' },
        'No':      { bg: 'FFFEE2E2', text: 'FF991B1B' },
      }

      let totalGeneral = 0
      let idxFila = 0
      detalles.forEach(({ recepcion: r, det }) => {
        det.forEach((d: any) => {
          const cant = parseFloat(d.cantidad_recibida) || 0
          const precio = parseFloat(d.precio_unitario) || 0
          const total = cant * precio
          totalGeneral += total
          const cantTransferida = parseFloat(d.cantidad_transferida) || 0
          const transferido = cantTransferida <= 0 ? 'No' : cantTransferida >= cant - 0.01 ? 'Sí' : 'Parcial'
          const row = ws.addRow({
            numero: r.numero,
            fecha: r.fecha,
            factura: r.oc_nro_factura || 'SIN FACTURA',
            oc: r.oc_numero,
            almacen: r.almacen_nombre,
            sku: d.sku || '',
            producto: d.producto_descripcion || '',
            cc: d.centro_costo_nombre || '',
            unidad: d.unidad || '',
            cantidad: cant,
            precio,
            total,
            lote: d.lote || '',
            venc: d.fecha_vencimiento || '',
            transferido,
            tipo: r.tipo,
            estado: r.estado,
            usuario: r.usuario_nombre || '',
            obs: r.observaciones || '',
          })
          const bgFila = idxFila % 2 === 0 ? COLOR.filaPar : COLOR.filaImpar
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.border = { bottom: thinBorder }
            cell.alignment = { vertical: 'middle', horizontal: [10, 11, 12].includes(colNumber) ? 'right' : [9, 15, 16, 17].includes(colNumber) ? 'center' : 'left' }
            cell.fill = fill(bgFila)
          })
          row.getCell(3).font = !r.oc_nro_factura ? { color: { argb: 'FF991B1B' }, bold: true } : {}
          row.getCell(10).numFmt = '#,##0.0000'
          row.getCell(11).numFmt = '"S/ "#,##0.0000'
          row.getCell(12).numFmt = '"S/ "#,##0.00'
          row.getCell(12).font = { bold: true, color: { argb: 'FF166534' } }
          const trc = TRANSFERIDO_COLOR[transferido]
          if (trc) { row.getCell(15).fill = fill(trc.bg); row.getCell(15).font = { color: { argb: trc.text }, bold: true } }
          const tc = TIPO_COLOR[r.tipo]
          if (tc) { row.getCell(16).fill = fill(tc.bg); row.getCell(16).font = { color: { argb: tc.text }, bold: true } }
          const ec = ESTADO_COLOR[r.estado]
          if (ec) { row.getCell(17).fill = fill(ec.bg); row.getCell(17).font = { color: { argb: ec.text }, bold: true } }
          idxFila++
        })
      })
      const filaTotal = ws.addRow({ numero: '', fecha: '', factura: '', oc: '', almacen: '', sku: '', producto: '', cc: 'TOTAL GENERAL', unidad: '', cantidad: '', precio: '', total: totalGeneral, lote: '', venc: '', transferido: '', tipo: '', estado: '', usuario: '', obs: '' })
      ws.mergeCells(`A${filaTotal.number}:H${filaTotal.number}`)
      filaTotal.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.fill = fill('FFF1F5F9')
        cell.font = { bold: true, size: 10 }
        cell.border = { top: { style: 'medium', color: { argb: 'FF94A3B8' } } }
        if (colNumber === 8) cell.alignment = { horizontal: 'right' }
        if (colNumber === 12) { cell.numFmt = '"S/ "#,##0.00'; cell.alignment = { horizontal: 'right' }; cell.font = { bold: true, color: { argb: 'FF166534' } } }
      })
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 19 } }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recepciones_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      if (fallidas > 0) {
        toast.error(`Excel exportado, pero ${fallidas} recepción(es) no se pudieron incluir (falló su detalle)`)
      } else {
        toast.success('Excel exportado correctamente')
      }
    } catch (err) {
      console.error(err)
      toast.error('Error al exportar el Excel')
    } finally {
      setExportando(false)
    }
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar por número, OC, factura, proveedor o producto..." value={search} onChange={e => handleSearchChange(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <input className="input" type="date" value={fechaDesde} onChange={e => handleFechaDesdeChange(e.target.value)} title="Fecha desde" />
          <span className="text-slate-400 text-sm">a</span>
          <input className="input" type="date" value={fechaHasta} onChange={e => handleFechaHastaChange(e.target.value)} title="Fecha hasta" />
          {(fechaDesde || fechaHasta) && (
            <button type="button" className="btn-secondary px-3" onClick={limpiarFechas} title="Quitar filtro de fechas">
              Limpiar
            </button>
          )}
        </div>
        <button className="btn-secondary" onClick={handleExportExcel} disabled={exportando || !recepciones.length}>
          <FileDown size={16} /> {exportando ? 'Exportando...' : 'Exportar Excel'}
        </button>
        <button
          className="btn-primary"
          disabled
          title="Las recepciones se generan desde la Orden de Compra correspondiente (botón 'Recibir')"
        ><Plus size={16} /> Nueva Recepción</button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Truck size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Recepciones de Mercadería</span>
          <span className="ml-auto text-sm text-slate-400">{totalRegistros} registros</span>
        </div>
        {!recepciones.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header w-8"></th>
                  <SortableTh col="numero" label="Número" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="fecha" label="Fecha" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <th className="table-header text-left">Factura</th>
                  <SortableTh col="oc_numero" label="OC Origen" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="almacen_nombre" label="Almacén Destino" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="tipo" label="Tipo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="estado" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="usuario_nombre" label="Registrado por" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <th className="table-header text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r: any) => {
                  const isExpanded = expandedId === r.id
                  const totalmenteTransferida = !!Number(r.totalmente_transferida)
                  return (
                    <React.Fragment key={r.id}>
                      <tr
                        className={`table-row cursor-pointer select-none ${totalmenteTransferida && !isExpanded ? 'bg-blue-300 border-l-4 border-blue-700' : isExpanded ? 'bg-blue-50/60' : ''}`}
                        title={totalmenteTransferida ? 'Todos los ítems de esta recepción ya fueron transferidos' : undefined}
                        onClick={() => toggleExpand(r.id)}
                      >
                        <td className="table-cell w-8 text-center">
                          {isExpanded
                            ? <ChevronUp size={15} className="text-blue-500 mx-auto" />
                            : <ChevronDown size={15} className="text-slate-400 mx-auto" />}
                        </td>
                        <td className="table-cell font-mono text-xs font-bold text-green-700">
                          {r.numero}
                          {!!r.oc_es_reserva && <span className="ml-2 rounded-sm bg-red-600 px-2 py-0.5 font-sans text-xs font-extrabold tracking-wide text-white">RESERVA</span>}
                        </td>
                        <td className="table-cell text-slate-500">{r.fecha}</td>
                        <td className="table-cell text-center" onClick={e => e.stopPropagation()}>
                          {(r.oc_url_factura) ? (
                            <a href={r.oc_url_factura} target="_blank" rel="noopener noreferrer"
                               className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                               title={r.oc_nro_factura ? `Ver factura ${r.oc_nro_factura}` : 'Ver factura'}>
                              <ExternalLink size={11} /> {r.oc_nro_factura || 'Factura'}
                            </a>
                          ) : r.oc_nro_factura ? (
                            <span className="text-xs font-mono text-slate-600">{r.oc_nro_factura}</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg" title="Sin factura registrada">
                              SIN FACTURA
                            </span>
                          )}
                        </td>
                        <td className="table-cell text-xs font-medium">
                          <div className="flex items-center gap-1.5">
                            <span className="text-blue-700">{r.oc_numero}</span>
                            {r.oc_id_source && (
                              <a href={`http://161.132.54.103:3001/api/ordenes-compra/pdf/${r.oc_id_source}`}
                                 target="_blank" rel="noopener noreferrer"
                                 className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-sm transition-colors"
                                 title="Ver PDF de OC" onClick={e => e.stopPropagation()}>
                                <ExternalLink size={9} /> PDF
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="table-cell text-slate-700">{r.almacen_nombre}</td>
                        <td className="table-cell text-center"><Badge value={r.tipo} /></td>
                        <td className="table-cell text-center"><Badge value={r.estado} /></td>
                        <td className="table-cell text-sm text-slate-500">{r.usuario_nombre}</td>
                        <td className="table-cell text-center" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => setEditFecha({ id: r.id, numero: r.numero, fecha: String(r.fecha).slice(0, 10) })}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Editar fecha"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(r)}
                            disabled={deleteMutation.isPending}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Eliminar recepción"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>

                      {/* Acordeón items recepcionados */}
                      {isExpanded && (
                        <tr key={`${r.id}-detail`}>
                          <td colSpan={10} className="p-0 bg-orange-50 border-b border-orange-200">
                            {!recDetail || recDetail.id !== r.id ? (
                              <div className="px-8 py-3 text-xs text-slate-400">Cargando ítems...</div>
                            ) : (
                              <div className="px-8 py-4 space-y-2">
                                <p className="text-xs font-semibold text-slate-600">
                                  Ítems recepcionados — {(recDetail.detalles || []).length} producto(s)
                                </p>
                                <div className="rounded-lg border border-orange-200 overflow-hidden">
                                  <table className="w-full text-xs">
                                    <thead className="bg-orange-100">
                                      <tr>
                                        <th className="table-header text-left">SKU</th>
                                        <th className="table-header text-left">C.Costo</th>
                                        <th className="table-header text-left">Producto</th>
                                        <th className="table-header text-left">U/M</th>
                                        <th className="table-header text-right">Cant. Recibida</th>
                                        <th className="table-header text-right">Precio Unit.</th>
                                        <th className="table-header text-right">Total</th>
                                        <th className="table-header text-left">Lote</th>
                                        <th className="table-header text-center">Acciones</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(recDetail.detalles || []).length === 0 ? (
                                        <tr><td colSpan={9} className="table-cell text-center text-slate-400 py-3">Sin ítems</td></tr>
                                      ) : (recDetail.detalles || []).map((d: any) => {
                                        const cant = parseFloat(d.cantidad_recibida) || 0
                                        const precio = parseFloat(d.precio_unitario) || 0
                                        const transferido = parseFloat(d.cantidad_transferida) || 0
                                        // Diferencias menores a 0.01 (redondeo de galones) cuentan como transferido por completo.
                                        const pendienteReal = +(cant - transferido).toFixed(4)
                                        const pendiente = pendienteReal <= 0.01 ? 0 : pendienteReal
                                        return (
                                          <tr key={d.id} className="border-t border-orange-100 bg-white/60 hover:bg-orange-50/60">
                                            <td className="table-cell font-mono text-slate-400">{d.sku || '—'}</td>
                                            <td className="table-cell text-slate-500 max-w-[140px] truncate">{d.centro_costo_nombre || '—'}</td>
                                            <td className="table-cell font-medium text-slate-800">{d.producto_descripcion || '—'}</td>
                                            <td className="table-cell text-slate-500">{d.unidad || '—'}</td>
                                            <td className="table-cell text-right font-semibold text-emerald-700">
                                              {cant.toFixed(4)}
                                            </td>
                                            <td className="table-cell text-right text-slate-600">S/ {precio.toFixed(4)}</td>
                                            <td className="table-cell text-right font-bold text-blue-700">S/ {(cant * precio).toFixed(2)}</td>
                                            <td className="table-cell text-slate-500">{d.lote || '—'}</td>
                                            <td className="table-cell text-center" onClick={e => e.stopPropagation()}>
                                              {pendiente <= 0 ? (
                                                <span
                                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 rounded-lg cursor-not-allowed"
                                                  title="Ya fue transferida por completo"
                                                >
                                                  <LockIcon size={11} /> Transferido
                                                </span>
                                              ) : r.almacen_tipo !== 'central' ? (
                                                <span className="text-[11px] text-slate-400" title="Esta entrada ya está en su almacén de destino">—</span>
                                              ) : !TRANSFERIR_DESDE_RECEPCION_HABILITADO ? (
                                                <span
                                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 rounded-lg cursor-not-allowed"
                                                  title="Ingresos temporalmente desactivados"
                                                >
                                                  <ArrowLeftRight size={11} /> Ingresar
                                                </span>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() => { setNavState('/transferencias', {
                                                      productoId: d.producto_id,
                                                      almacenOrigenId: r.almacen_destino_id,
                                                      cantidad: pendiente,
                                                      sku: d.sku,
                                                      descripcion: d.producto_descripcion,
                                                      unidad: d.unidad,
                                                      recepcionDetalleId: d.id,
                                                      nroFactura: recDetail.oc_nro_factura,
                                                      fechaOrigen: r.fecha,
                                                    }); router.push('/transferencias') }}
                                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors"
                                                  title="Ingresar este ítem a un almacén auxiliar"
                                                >
                                                  <ArrowLeftRight size={11} /> Ingresar
                                                </button>
                                              )}
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100">
            <span className="text-sm text-slate-400">Página {page} de {totalPaginas}</span>
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary px-3 py-1.5"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft size={16} /> Anterior
              </button>
              <button
                className="btn-secondary px-3 py-1.5"
                onClick={() => setPage(p => Math.min(totalPaginas, p + 1))}
                disabled={page >= totalPaginas}
              >
                Siguiente <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={!!editFecha} onClose={() => setEditFecha(null)} title={`Editar fecha — ${editFecha?.numero || ''}`}>
        <div className="p-6 space-y-4">
          <div>
            <label className="label">Fecha de la recepción *</label>
            <input
              className="input"
              type="date"
              value={editFecha?.fecha || ''}
              onChange={e => setEditFecha(prev => prev ? { ...prev, fecha: e.target.value } : prev)}
            />
            <p className="text-xs text-slate-400 mt-1">También se actualiza la fecha del movimiento de esta recepción en el Kardex.</p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setEditFecha(null)}>Cancelar</button>
            <button
              type="button"
              className="btn-primary"
              disabled={fechaMutation.isPending || !editFecha?.fecha}
              onClick={() => editFecha && fechaMutation.mutate({ id: editFecha.id, fecha: editFecha.fecha })}
            >
              {fechaMutation.isPending ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset() }} title="Nueva Recepción de Mercadería" size="2xl">
        <form onSubmit={handleSubmit(({ tipo_despacho, ...d }) => mutation.mutate({ ...d, es_reserva: tipo_despacho === 'reserva' }))} className="p-6 space-y-5">

          {/* Orden de Compra: siempre viene fijada desde el botón "Recepcionar" de
              Órdenes de Compra, por lo que se muestra en solo lectura para evitar
              que se seleccione o se pierda la orden correcta por error. */}
          <input type="hidden" {...register('orden_compra_id', { required: true })} />
          <div>
            <label className="label">Orden de Compra *</label>
            <div className="input bg-slate-50 text-slate-700 font-mono cursor-not-allowed">
              {ocDetalle ? `${ocDetalle.numero} — ${ocDetalle.cliente_nombre || 'Sin proveedor'}` : (ocId ? 'Cargando...' : '—')}
            </div>
          </div>

          {/* Panel info OC seleccionada */}
          {ocDetalle && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-blue-400 font-semibold uppercase tracking-wide mb-0.5">N° Orden</p>
                <p className="font-bold text-blue-800 text-sm font-mono">{ocDetalle.numero}</p>
              </div>
              <div>
                <p className="text-blue-400 font-semibold uppercase tracking-wide mb-0.5">Proveedor</p>
                <p className="font-semibold text-slate-800">{ocDetalle.cliente_nombre || '—'}</p>
              </div>
              <div>
                <p className="text-blue-400 font-semibold uppercase tracking-wide mb-0.5">Fecha OC</p>
                <p className="font-semibold text-slate-700">{ocDetalle.fecha || '—'}</p>
              </div>
              <div>
                <p className="text-blue-400 font-semibold uppercase tracking-wide mb-0.5">Total OC</p>
                <p className="font-bold text-blue-700">{ocDetalle.moneda === 'USD' ? '$' : 'S/'} {parseFloat(ocDetalle.total || 0).toFixed(2)}</p>
              </div>
              {ocDetalle.nro_factura && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-blue-400 font-semibold uppercase tracking-wide mb-0.5">Factura Asociada</p>
                  <p className="font-mono font-bold text-emerald-700">{ocDetalle.nro_factura}</p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Almacén de Entrada *</label>
              <select className="select" {...register('almacen_destino_id', { required: true })}>
                <option value="">-- Seleccionar --</option>
                {(almacenes || []).map((a: any) => <option key={a.id} value={a.id}>{a.nombre} ({a.tipo})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Despacho *</label>
              {/* Solo lectura cuando viene de una orden marcada RESERVA (sin `disabled`, para que react-hook-form conserve el valor). */}
              <select
                className={`select ${despachoFijo ? `font-bold cursor-not-allowed pointer-events-none ${tipoDespacho === 'reserva' ? 'bg-red-50 text-red-700' : 'bg-orange-50 text-orange-700'}` : ''}`}
                tabIndex={despachoFijo ? -1 : undefined}
                aria-readonly={despachoFijo || undefined}
                {...register('tipo_despacho', { required: true })}
              >
                <option value="">-- Seleccionar --</option>
                <option value="consumo">CONSUMO</option>
                <option value="reserva">RESERVA</option>
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                {despachoFijo ? 'Definido por el toggle RESERVA de la orden de compra (apagado = CONSUMO).' : 'Cambia por factura. La reserva solo sale con una salida de RESERVA.'}
              </p>
            </div>
            <div>
              <label className="label">Fecha de Recepción *</label>
              <input className="input" type="date" {...register('fecha', { required: true })} defaultValue={new Date().toISOString().slice(0,10)} />
            </div>
          </div>

          {/* Alerta grande en cuanto se elige RESERVA, junto al selector de Despacho. */}
          {tipoDespacho === 'reserva' && (
            <div role="alert" className="rounded-xl border-4 border-red-600 bg-red-100 py-4 text-center shadow-md">
              <span className="block text-6xl font-black tracking-widest text-red-600">RESERVA</span>
              <span className="block mt-1 text-sm font-bold uppercase text-red-700">Esta entrada quedará reservada y solo saldrá con una salida de RESERVA</span>
            </div>
          )}

          {/* Detalles */}
          {fields.length > 0 && (
            <div>
              <label className="label mb-2">Productos a Recibir ({fields.length})</label>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="table-header text-left">SKU</th>
                      <th className="table-header text-left">Producto</th>
                      <th className="table-header text-right">Pendiente</th>
                      <th className="table-header text-right">Cant. Recibida</th>
                      <th className="table-header text-right">→ Inv.</th>
                      <th className="table-header text-right">Precio Unit. *</th>
                      <th className="table-header text-left">Lote</th>
                      <th className="table-header text-left">Vencimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f, i) => {
                      const item = watch(`detalles.${i}`) as any
                      const factor = parseFloat(item?.factor_conversion) || 1
                      const tieneEmpaque = factor > 1 && item?.unidad_compra
                      const cantCompra  = parseFloat(item?.cantidad_compra) || 0
                      const cantInv     = +(cantCompra * factor).toFixed(4)
                      const prod = (catalogo || []).find((p: any) => p.id === item?.producto_id) as any
                      return (
                        <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                          {/* SKU */}
                          <td className="px-3 py-2">
                            <span className="font-mono text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-sm">{prod?.sku || '—'}</span>
                          </td>
                          {/* Nombre */}
                          <td className="px-3 py-2 max-w-[180px]">
                            <p className="font-medium text-slate-900 text-xs leading-tight">{item?.producto_nombre || 'Producto'}</p>
                            {tieneEmpaque && (
                              <p className="text-xs text-blue-600 mt-0.5">1 {item.unidad_compra} = {factor} {item.unidad}</p>
                            )}
                          </td>
                          {/* Pendiente */}
                          <td className="px-2 py-2 text-right text-slate-400 text-xs whitespace-nowrap">
                            {item?.cantidad_pedida} {item?.unidad}
                          </td>
                          {/* Cantidad recibida */}
                          <td className="px-2 py-2">
                            {tieneEmpaque ? (
                              <div className="flex items-center gap-1 justify-end">
                                <input className="input text-right text-sm w-20" type="number" step="0.0001" min="0.0001"
                                  {...register(`detalles.${i}.cantidad_compra`, {
                                    required: true,
                                    onChange: (e) => {
                                      const v = parseFloat(e.target.value) || 0
                                      setValue(`detalles.${i}.cantidad_recibida`, +(v * factor).toFixed(4))
                                    }
                                  })} />
                                <span className="text-xs text-slate-500 whitespace-nowrap">{item.unidad_compra}</span>
                              </div>
                            ) : (
                              <input className="input text-right text-sm w-24" type="number" step="0.0001" min="0.0001"
                                {...register(`detalles.${i}.cantidad_recibida`, { required: true })} />
                            )}
                          </td>
                          {/* Unidades inventario */}
                          <td className="px-2 py-2 text-right text-xs whitespace-nowrap">
                            {tieneEmpaque ? (
                              <span className={`font-semibold ${cantInv > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                                {cantInv} {item.unidad}
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          {/* Precio */}
                          <td className="px-2 py-2">
                            <input className="input text-right text-sm w-24" type="number" step="0.0001"
                              {...register(`detalles.${i}.precio_unitario`, { required: true })} />
                          </td>
                          {/* Lote */}
                          <td className="px-2 py-2">
                            <input className="input text-sm w-24" {...register(`detalles.${i}.lote`)} placeholder="Lote" />
                          </td>
                          {/* Vencimiento */}
                          <td className="px-2 py-2">
                            <input className="input text-sm w-32" type="date" {...register(`detalles.${i}.fecha_vencimiento`)} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!fields.length && ocId && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-blue-600">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Cargando productos de la OC...
            </div>
          )}
          {!ocId && (
            <p className="text-sm text-slate-400 text-center py-4">Selecciona una Orden de Compra para ver los productos</p>
          )}

          <div>
            <label className="label">Observaciones</label>
            <textarea className="input h-16 resize-none" {...register('observaciones')} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset() }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || !fields.length}>
              {isSubmitting ? 'Procesando...' : `Confirmar Recepción${fields.length ? ` (${fields.length} productos)` : ''}`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
