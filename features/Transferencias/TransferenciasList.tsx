'use client'

import React, { useState, useRef, useEffect } from 'react'
import { consumeNavState } from '../../utils/navState'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, ArrowLeftRight, Trash2, ChevronDown, ChevronUp, FileText, FileDown, Undo2 } from 'lucide-react'
import { useConfirm } from '../../context/ConfirmContext'
import { useForm, useFieldArray } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'

// Misma clave de confirmación usada en Salidas, Trans-Almacenes y Cierre de Período.
const PASSWORD_CONFIRMACION_REVERSION = '@ayala.com'

export default function TransferenciasList() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [almacenFiltro, setAlmacenFiltro] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [exportando, setExportando] = useState(false)
  const toggleExpand = (id: number) => setExpandedId(prev => prev === id ? null : id)

  const { data, isLoading } = useQuery({
    queryKey: ['transferencias', search, almacenFiltro],
    queryFn: () => api.get('/transferencias', { params: { search, almacen_id: almacenFiltro || undefined, limit: 100 } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })
  const { data: almacenes } = useQuery({ queryKey: ['almacenes'], queryFn: () => api.get('/almacenes').then(r => r.data) })
  const { data: catalogo } = useQuery({ queryKey: ['catalogo'], queryFn: () => api.get('/productos/catalogo').then(r => r.data) })

  const { data: transferenciaDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['transferencia-detail', expandedId],
    queryFn: () => api.get(`/transferencias/${expandedId}`).then(r => r.data),
    enabled: !!expandedId,
  })

  const { register, handleSubmit, reset, control, watch, setValue, formState: { isSubmitting } } = useForm<any>({
    defaultValues: { almacen_origen_id: '', almacen_destino_id: '', fecha: new Date().toISOString().slice(0,10), observaciones: '', detalles: [{ producto_id: '', cantidad: 1 }] }
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'detalles' })

  const origenId = watch('almacen_origen_id')
  const esReserva = !!watch('es_reserva')

  // Lotes (facturas recibidas) con saldo por transferir en el origen: una reserva siempre va
  // asociada a una factura.
  const { data: lotesReserva } = useQuery({
    queryKey: ['lotes-reserva', origenId],
    queryFn: () => api.get('/transferencias/reserva/lotes', { params: { almacen_id: origenId } }).then(r => r.data),
    enabled: !!origenId && esReserva,
  })

  const { data: inventarioOrigen } = useQuery({
    queryKey: ['inventario-origen', origenId],
    queryFn: () => api.get('/inventario', { params: { almacen_id: origenId, limit: 1000 } }).then(r => r.data),
    enabled: !!origenId,
  })
  const destinoId = watch('almacen_destino_id')
  const { data: inventarioDestino } = useQuery({
    queryKey: ['inventario-destino', destinoId],
    queryFn: () => api.get('/inventario', { params: { almacen_id: destinoId, limit: 1000 } }).then(r => r.data),
    enabled: !!destinoId,
  })
  const getStockDestino = (productoId: any) =>
    (inventarioDestino?.data as any[] | undefined)?.find(inv => String(inv.id) === String(productoId)) || null
  const origenAlmacen = (almacenes || []).find((a: any) => String(a.id) === String(origenId))
  const almacenesOrigen = (almacenes || []).filter((a: any) => a.tipo === 'central' && a.estado === 'activo')
  const almacenesDestino = (almacenes || []).filter((a: any) => a.tipo === 'auxiliar' && a.estado === 'activo')

  // El origen siempre es el Almacén Central (campo de solo lectura): se preselecciona al abrir.
  useEffect(() => {
    if (modalOpen && !origenId && almacenesOrigen.length) setValue('almacen_origen_id', String(almacenesOrigen[0].id))
  }, [modalOpen, origenId, almacenesOrigen.length])

  // Buscadores por fila de producto
  const [productoSearch, setProductoSearch] = useState<Record<number, string>>({})
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null)
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 })
  const [stockOrigen, setStockOrigen] = useState<Record<number, { disponible: number; unidad: string }>>({})
  const [loteOrigen, setLoteOrigen] = useState<{ recepcionDetalleId: number; nroFactura?: string; fechaOrigen?: string } | null>(null)

  const getStockProducto = (productoId: any) => {
    if (!inventarioOrigen?.data) return null
    return (inventarioOrigen.data as any[]).find(inv => String(inv.id) === String(productoId)) || null
  }

  // Prellenar formulario cuando se llega desde "Transferir" en un ítem de Recepciones
  useEffect(() => {
    const state = consumeNavState<{
      productoId?: number; almacenOrigenId?: number; cantidad?: number; sku?: string; descripcion?: string; unidad?: string
      recepcionDetalleId?: number; nroFactura?: string; fechaOrigen?: string
    }>('/transferencias')
    if (state?.productoId && state?.almacenOrigenId) {
      reset({
        almacen_origen_id: String(state.almacenOrigenId),
        almacen_destino_id: '',
        // Se prellena con la fecha de la recepción/OC de origen (no la de hoy), para que
        // el Kardex quede con la fecha real de la orden en toda la cadena.
        fecha: state.fechaOrigen || new Date().toISOString().slice(0, 10),
        observaciones: '',
        detalles: [{ producto_id: state.productoId, cantidad: state.cantidad || 1 }],
      })
      setProductoSearch({ 0: state.sku ? `[${state.sku}] ${state.descripcion || ''}` : (state.descripcion || '') })
      setStockOrigen({})
      setLoteOrigen(state.recepcionDetalleId ? { recepcionDetalleId: state.recepcionDetalleId, nroFactura: state.nroFactura, fechaOrigen: state.fechaOrigen } : null)
      setModalOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Una vez cargado el inventario del origen prellenado, mostrar el stock disponible de la fila 0
  useEffect(() => {
    const pid = watch('detalles.0.producto_id')
    if (!origenId || !pid || !inventarioOrigen?.data || stockOrigen[0] !== undefined) return
    const inv = getStockProducto(pid)
    const prod = (catalogo || []).find((p: any) => String(p.id) === String(pid))
    setStockOrigen(prev => ({ ...prev, 0: { disponible: inv?.disponible_total ?? 0, unidad: prod?.unidad || '' } }))
  }, [origenId, inventarioOrigen, catalogo])

  const getFilteredCatalogo = (query: string) => {
    const q = (query || '').toLowerCase().trim()
    if (!q) return (catalogo || []).slice(0, 80)
    return (catalogo || []).filter((p: any) =>
      p.sku?.toLowerCase().includes(q) ||
      p.descripcion?.toLowerCase().includes(q) ||
      p.codigo_interno?.toLowerCase().includes(q)
    ).slice(0, 80)
  }

  const openDropdown = (i: number) => {
    const el = inputRefs.current[i]
    if (el) {
      const rect = el.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: rect.width })
    }
    setActiveDropdown(i)
  }

  const selectProducto = (i: number, prod: any) => {
    setValue(`detalles.${i}.producto_id`, prod.id)
    setProductoSearch(prev => ({ ...prev, [i]: `[${prod.sku}] ${prod.descripcion}` }))
    setActiveDropdown(null)
    const inv = getStockProducto(prod.id)
    setStockOrigen(prev => ({
      ...prev,
      [i]: { disponible: inv?.disponible_total ?? 0, unidad: prod.unidad || '' }
    }))
    // Si cambian el producto de la línea que traía el lote de origen (factura/fecha), se pierde esa trazabilidad
    if (i === 0 && loteOrigen && String(prod.id) !== String(watch('detalles.0.producto_id'))) setLoteOrigen(null)
  }

  const mutation = useMutation({
    mutationFn: (d: any) => api.post('/transferencias', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transferencias'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      qc.invalidateQueries({ queryKey: ['reservas'] })
      qc.invalidateQueries({ queryKey: ['lotes-reserva'] })
      toast.success(esReserva ? 'Ingreso a RESERVA completado' : 'Ingreso completado e inventario actualizado')
      setModalOpen(false); reset()
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al registrar la transferencia')
    },
  })

  const revertMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/transferencias/${id}`, { data: { password: PASSWORD_CONFIRMACION_REVERSION } }).then(r => r.data),
    onSuccess: () => {
      toast.success('Transferencia revertida: stock devuelto al origen')
      qc.invalidateQueries({ queryKey: ['transferencias'] })
      qc.invalidateQueries({ queryKey: ['transferencia-detail'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      qc.invalidateQueries({ queryKey: ['reservas'] })
      qc.invalidateQueries({ queryKey: ['lotes-reserva'] })
      qc.invalidateQueries({ queryKey: ['dashboard-gauges'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al revertir la transferencia')
    },
  })

  const handleRevertir = async (t: any) => {
    const ok = await confirm({
      title: 'Revertir transferencia',
      message: <>¿Revertir la transferencia <strong>{t.numero}</strong>? El stock volverá al almacén de origen, saldrá del destino y se eliminarán sus movimientos del Kardex.</>,
      variant: 'danger',
      confirmLabel: 'Revertir',
      requiresPassword: true,
      passwordLabel: 'Contraseña de confirmación',
      validatePassword: (v) => v === PASSWORD_CONFIRMACION_REVERSION ? null : 'Contraseña incorrecta',
    })
    if (!ok) return
    revertMutation.mutate(t.id)
  }

  const transferencias = data?.data || []
  const { sorted, sortCol, sortDir, toggle } = useSortTable(transferencias, 'fecha', 'desc')

  const ESTADO_COLOR: Record<string, { bg: string; text: string }> = {
    completada: { bg: 'FFDCFCE7', text: 'FF166534' },
    aprobada:   { bg: 'FFDBEAFE', text: 'FF1D4ED8' },
    borrador:   { bg: 'FFF1F5F9', text: 'FF475569' },
    anulada:    { bg: 'FFFEE2E2', text: 'FF991B1B' },
  }

  const handleExportExcel = async () => {
    setExportando(true)
    try {
      const totalFilas = data?.total || 0
      const { data: full } = await api.get('/transferencias', {
        params: { search, almacen_id: almacenFiltro || undefined, limit: Math.max(totalFilas, 1), page: 1 },
      })
      const filas: any[] = full?.data || []
      if (!filas.length) { toast.error('No hay transferencias para exportar'); return }

      // Trae el detalle de ítems de cada transferencia, en lotes para no saturar el pool
      // de conexiones del servidor si hay muchas transferencias. Si una puntual falla,
      // no debe abortar la exportación completa: se omite y se avisa al final.
      const LOTE = 10
      const detalles: { transferencia: any; det: any[] }[] = []
      let fallidas = 0
      for (let i = 0; i < filas.length; i += LOTE) {
        const lote = filas.slice(i, i + LOTE)
        const resultados = await Promise.all(
          lote.map(t =>
            api.get(`/transferencias/${t.id}`)
              .then(res => ({ transferencia: t, det: res.data.detalles || [] }))
              .catch(() => { fallidas++; return null })
          )
        )
        detalles.push(...resultados.filter((r): r is { transferencia: any; det: any[] } => r !== null))
      }
      if (!detalles.length) { toast.error('No se pudo obtener el detalle de ninguna transferencia'); return }

      const COLOR = { header: 'FF1E293B', filaPar: 'FFFFFFFF', filaImpar: 'FFF8FAFC', borde: 'FFE2E8F0' }
      const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
      const thinBorder = { style: 'thin' as const, color: { argb: COLOR.borde } }
      const estiloHeaderCell = (cell: any, bg: string) => {
        cell.fill = fill(bg)
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
        cell.border = { bottom: { style: 'thin' as const, color: { argb: 'FF0F172A' } } }
      }

      const { default: ExcelJS } = await import('exceljs')

      const wb = new ExcelJS.Workbook()
      wb.creator = 'KardexERP 2026'
      wb.created = new Date()

      const ws = wb.addWorksheet('Transferencias', { views: [{ state: 'frozen', ySplit: 1 }] })
      ws.columns = [
        { header: 'Número', key: 'numero', width: 16 },
        { header: 'Fecha', key: 'fecha', width: 12 },
        { header: 'Almacén Origen', key: 'origen', width: 24 },
        { header: 'Almacén Destino', key: 'destino', width: 24 },
        { header: 'SKU', key: 'sku', width: 18 },
        { header: 'Producto', key: 'producto', width: 36 },
        { header: 'C. Costo', key: 'cc', width: 20 },
        { header: 'U/M', key: 'unidad', width: 10 },
        { header: 'Cantidad', key: 'cantidad', width: 14 },
        { header: 'Costo Unitario', key: 'costo', width: 14 },
        { header: 'Total', key: 'total', width: 14 },
        { header: 'N° Factura', key: 'factura', width: 16 },
        { header: 'Fecha Origen', key: 'fecha_origen', width: 14 },
        { header: 'Estado', key: 'estado', width: 14 },
        { header: 'Responsable', key: 'usuario', width: 20 },
        { header: 'Observaciones', key: 'obs', width: 26 },
      ]
      ws.getRow(1).eachCell(cell => estiloHeaderCell(cell, COLOR.header))
      ws.getRow(1).height = 20

      let totalGeneral = 0
      let idxFila = 0
      detalles.forEach(({ transferencia: t, det }) => {
        det.forEach((d: any) => {
          const cant = parseFloat(d.cantidad) || 0
          const costo = parseFloat(d.costo_unitario) || 0
          const total = cant * costo
          totalGeneral += total
          const row = ws.addRow({
            numero: t.numero,
            fecha: t.fecha,
            origen: t.origen_nombre,
            destino: t.destino_nombre,
            sku: d.sku || '',
            producto: d.producto_descripcion || '',
            cc: d.centro_costo_nombre || '',
            unidad: d.unidad || '',
            cantidad: cant,
            costo,
            total,
            factura: d.nro_factura || '',
            fecha_origen: d.fecha_origen || '',
            estado: t.estado,
            usuario: t.usuario_nombre || '',
            obs: t.observaciones || '',
          })
          const bgFila = idxFila % 2 === 0 ? COLOR.filaPar : COLOR.filaImpar
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.border = { bottom: thinBorder }
            cell.alignment = { vertical: 'middle', horizontal: [9, 10, 11].includes(colNumber) ? 'right' : colNumber === 14 ? 'center' : 'left' }
            cell.fill = fill(bgFila)
          })
          row.getCell(9).numFmt = '#,##0.0000'
          row.getCell(10).numFmt = '"S/ "#,##0.0000'
          row.getCell(11).numFmt = '"S/ "#,##0.00'
          row.getCell(11).font = { bold: true, color: { argb: 'FF166534' } }
          const ec = ESTADO_COLOR[t.estado]
          if (ec) { row.getCell(14).fill = fill(ec.bg); row.getCell(14).font = { color: { argb: ec.text }, bold: true } }
          idxFila++
        })
      })
      const filaTotal = ws.addRow({ numero: '', fecha: '', origen: '', destino: 'TOTAL GENERAL', sku: '', producto: '', cc: '', unidad: '', cantidad: '', costo: '', total: totalGeneral, factura: '', fecha_origen: '', estado: '', usuario: '', obs: '' })
      ws.mergeCells(`A${filaTotal.number}:D${filaTotal.number}`)
      filaTotal.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.fill = fill('FFF1F5F9')
        cell.font = { bold: true, size: 10 }
        cell.border = { top: { style: 'medium', color: { argb: 'FF94A3B8' } } }
        if (colNumber === 4) cell.alignment = { horizontal: 'right' }
        if (colNumber === 11) { cell.numFmt = '"S/ "#,##0.00'; cell.alignment = { horizontal: 'right' }; cell.font = { bold: true, color: { argb: 'FF166534' } } }
      })
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 16 } }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const almacenNombre = almacenFiltro ? (almacenes || []).find((a: any) => String(a.id) === String(almacenFiltro))?.nombre : null
      a.download = `transferencias${almacenNombre ? '_' + almacenNombre.replace(/\s+/g, '_') : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      if (fallidas > 0) {
        toast.error(`Excel exportado, pero ${fallidas} transferencia(s) no se pudieron incluir (falló su detalle)`)
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
          <input className="input pl-9" placeholder="Buscar por número..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="select sm:w-56" value={almacenFiltro} onChange={e => setAlmacenFiltro(e.target.value)}>
          <option value="">Todos los almacenes</option>
          {(almacenes || []).map((a: any) => (
            <option key={a.id} value={a.id}>{a.nombre}</option>
          ))}
        </select>
        <button
          className="btn-secondary"
          onClick={handleExportExcel}
          disabled={exportando || !transferencias.length}
          title="Exportar transferencias a Excel"
        ><FileDown size={16} /> {exportando ? 'Exportando...' : 'Exportar Excel'}</button>
        <button
          className="btn-primary"
          disabled
          title="Las transferencias se generan desde el botón 'Transferir' de un ítem recepcionado"
        ><Plus size={16} /> Nuevo Ingreso</button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <ArrowLeftRight size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Transferencias entre Almacenes</span>
          <span className="ml-auto text-sm text-slate-400">{transferencias.length} registros</span>
        </div>
        {!transferencias.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header w-8"></th>
                  <SortableTh col="numero" label="Número" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="fecha" label="Fecha" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="origen_nombre" label="Origen" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <th className="table-header text-center">→</th>
                  <SortableTh col="destino_nombre" label="Destino" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="estado" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="usuario_nombre" label="Responsable" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((t: any) => {
                  const isExpanded = expandedId === t.id
                  return (
                    <React.Fragment key={t.id}>
                      <tr
                        className={`table-row cursor-pointer select-none ${isExpanded ? 'bg-blue-50/60' : ''}`}
                        onClick={() => toggleExpand(t.id)}
                      >
                        <td className="table-cell w-8 text-center">
                          {isExpanded
                            ? <ChevronUp size={15} className="text-blue-500 mx-auto" />
                            : <ChevronDown size={15} className="text-slate-400 mx-auto" />}
                        </td>
                        <td className="table-cell font-mono text-xs font-bold text-purple-700">{t.numero}{!!t.es_reserva && <span className="ml-2 rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">RESERVA</span>}</td>
                        <td className="table-cell text-slate-500">{t.fecha}</td>
                        <td className="table-cell">
                          <p className="font-medium text-slate-900">{t.origen_nombre}</p>
                          <Badge value={t.origen_tipo} className="mt-0.5" />
                        </td>
                        <td className="table-cell text-center text-slate-400">→</td>
                        <td className="table-cell">
                          <p className="font-medium text-slate-900">{t.destino_nombre}</p>
                          <Badge value={t.destino_tipo} className="mt-0.5" />
                        </td>
                        <td className="table-cell text-center"><Badge value={t.estado} /></td>
                        <td className="table-cell text-slate-500">{t.usuario_nombre}</td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={8} className="p-0 bg-purple-50 border-b border-purple-200">
                            {loadingDetail || !transferenciaDetail || transferenciaDetail.id !== t.id ? (
                              <div className="px-8 py-4 text-sm text-slate-400">Cargando ítems...</div>
                            ) : (
                              <div className="px-8 py-4 space-y-2">
                                <p className="text-xs font-semibold text-slate-600">
                                  Ítems transferidos — {(transferenciaDetail.detalles || []).length} línea(s), sin agrupar
                                </p>
                                <div className="rounded-lg border border-purple-200 overflow-hidden">
                                  <table className="w-full text-xs">
                                    <thead className="bg-purple-100">
                                      <tr>
                                        <th className="table-header text-left">SKU</th>
                                        <th className="table-header text-left">C.Costo</th>
                                        <th className="table-header text-left">Producto</th>
                                        <th className="table-header text-right">Cantidad</th>
                                        <th className="table-header text-right">Costo Unit.</th>
                                        <th className="table-header text-left">N° Factura</th>
                                        <th className="table-header text-left">Fecha Origen</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(transferenciaDetail.detalles || []).length === 0 ? (
                                        <tr><td colSpan={7} className="table-cell text-center text-slate-400 py-3">Sin ítems</td></tr>
                                      ) : (transferenciaDetail.detalles || []).map((d: any) => (
                                        <tr key={d.id} className="border-t border-purple-100 bg-white/60 hover:bg-purple-50/60">
                                          <td className="table-cell font-mono text-slate-400">{d.sku || '—'}</td>
                                          <td className="table-cell text-slate-500 max-w-[140px] truncate">{d.centro_costo_nombre || '—'}</td>
                                          <td className="table-cell font-medium text-slate-800">{d.producto_descripcion || '—'}</td>
                                          <td className="table-cell text-right font-semibold text-purple-700">
                                            {parseFloat(d.cantidad).toFixed(4)} <span className="text-slate-400 font-normal">{d.unidad}</span>
                                          </td>
                                          <td className="table-cell text-right text-slate-600">S/ {parseFloat(d.costo_unitario).toFixed(4)}</td>
                                          <td className="table-cell">
                                            {d.nro_factura
                                              ? <span className="inline-flex items-center gap-1 font-mono text-blue-700"><FileText size={11} />{d.nro_factura}</span>
                                              : <span className="text-slate-300">—</span>}
                                          </td>
                                          <td className="table-cell text-slate-500">{d.fecha_origen || '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                {t.estado === 'completada' && (
                                  <div className="flex justify-end pt-1">
                                    <button
                                      type="button"
                                      className="btn-secondary text-xs py-1.5 text-red-600"
                                      disabled={revertMutation.isPending}
                                      onClick={(e) => { e.stopPropagation(); handleRevertir(t) }}
                                    >
                                      <Undo2 size={14} /> Revertir transferencia
                                    </button>
                                  </div>
                                )}
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
      </div>

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset() }} title="Nuevo Ingreso" size="2xl">
        <form onSubmit={handleSubmit(d => {
          const detalles = (d.detalles || []).map((det: any, i: number) =>
            i === 0 && loteOrigen && !det.recepcion_detalle_id ? { ...det, recepcion_detalle_id: loteOrigen.recepcionDetalleId } : det
          )
          if (d.es_reserva && detalles.some((det: any) => !det.recepcion_detalle_id)) {
            toast.error('En una reserva cada producto debe estar asociado a una factura')
            return
          }
          mutation.mutate({ ...d, es_reserva: !!d.es_reserva, detalles })
        })} className="p-6 space-y-5">
          {/* Info flujo */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-purple-800">
            <ArrowLeftRight size={18} className="text-purple-500 shrink-0" />
            <span><span className="font-bold">Ingreso de mercadería</span> a un almacén auxiliar</span>
          </div>

          {/* El origen ya no se muestra: es el inicio del envío (un ingreso). Se mantiene el valor
              interno (Almacén Central) porque el backend lo necesita para descontar y registrar. */}
          <input type="hidden" {...register('almacen_origen_id', { required: true })} />
          <div>
            <label className="label">Almacén de Destino *</label>
            <select className="select" {...register('almacen_destino_id', { required: true })} disabled={!origenId}>
              <option value="">-- Seleccionar --</option>
              {almacenesDestino.map((a: any) => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </div>

          {/* Interruptor: el combustible va a una RESERVA */}
          <label className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${esReserva ? 'bg-red-50 border-red-500' : 'bg-white border-red-300'}`}>
            <div>
              <p className="text-sm font-extrabold text-red-600">Enviar a RESERVA</p>
              <p className="text-xs text-slate-500">
                {esReserva
                  ? 'El combustible ingresará al Kardex del destino con tipo RESERVA, asociado a su factura. Solo saldrá con una salida de reserva.'
                  : 'Desactivado: el combustible ingresa como stock de consumo (proceso normal).'}
              </p>
            </div>
            <span className="relative inline-flex shrink-0 items-center">
              <input type="checkbox" className="peer sr-only" role="switch" {...register('es_reserva')} />
              <span className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-red-600 peer-focus-visible:ring-2 peer-focus-visible:ring-red-400" />
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
            </span>
          </label>

          {/* Panel info destino seleccionado */}
          {destinoId && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs flex items-center gap-3">
              <span className="font-semibold text-emerald-700">Destino:</span>
              <span className="text-emerald-800 font-bold">{(almacenes || []).find((a: any) => String(a.id) === String(destinoId))?.nombre}</span>
              <span className="ml-auto text-emerald-700">
                {inventarioDestino ? `${((inventarioDestino.data as any[]) || []).filter(p => parseFloat(p.stock_total) > 0.0001).length} producto(s) con stock` : 'Cargando stock...'}
              </span>
            </div>
          )}

          {/* Trazabilidad del lote de origen (cuando se llega desde "Transferir" en Recepciones) */}
          {loteOrigen && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs flex items-center gap-3 text-amber-800">
              <span className="font-semibold">Lote de origen:</span>
              <span>Factura {loteOrigen.nroFactura || '—'}</span>
              <span className="text-amber-400">·</span>
              <span>Recibido el {loteOrigen.fechaOrigen || '—'}</span>
              <span className="ml-auto text-amber-500">Se guardará junto con esta línea</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Fecha *</label>
              <input className="input" type="date" {...register('fecha', { required: true })} />
            </div>
            <div>
              <label className="label">Observaciones</label>
              <input className="input" {...register('observaciones')} />
            </div>
          </div>

          {/* Productos */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="font-medium text-slate-900 text-sm">Productos a Ingresar</label>
              {/* Botón "Agregar" oculto: los productos vienen de la recepción, no se agregan a mano. */}
              <button type="button" onClick={() => append({ producto_id: '', cantidad: 1 })} className="btn-secondary text-xs py-1.5 hidden">
                <Plus size={14} /> Agregar
              </button>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-visible">
              <table className="w-full">
                <thead><tr className="bg-slate-50">
                  <th className="table-header text-left">Producto</th>
                  <th className="table-header text-center w-36">Stock Destino</th>
                  <th className="table-header text-right w-32">Cantidad</th>
                  <th className="table-header w-10"></th>
                </tr></thead>
                <tbody>
                  {fields.map((f, i) => {
                    const selectedId = watch(`detalles.${i}.producto_id`)
                    const filtered = getFilteredCatalogo(productoSearch[i] || '')
                    const isActive = activeDropdown === i
                    const stock = stockOrigen[i]
                    const disponible = stock?.disponible ?? null
                    const sinStock = disponible !== null && disponible <= 0
                    // En reserva, la cantidad es libre (puede ser parcial) hasta el saldo de la factura elegida.
                    const loteSel = esReserva
                      ? (lotesReserva || []).find((l: any) => String(l.recepcion_detalle_id) === String(watch(`detalles.${i}.recepcion_detalle_id`)))
                      : null
                    const saldoLote = loteSel ? parseFloat(loteSel.pendiente) : null
                    const maxCant = [disponible !== null && disponible > 0 ? disponible : null, saldoLote].filter((v): v is number => v !== null)
                    const maxCantidad = maxCant.length ? Math.min(...maxCant) : undefined
                    const cantidadIngresada = parseFloat(String(watch(`detalles.${i}.cantidad`))) || 0
                    return (
                      <tr key={f.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <input type="hidden" {...register(`detalles.${i}.producto_id`, { required: true })} />
                          <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
                            <input
                              ref={el => { inputRefs.current[i] = el }}
                              className="input pl-7 text-sm w-full"
                              placeholder="Buscar SKU, nombre o código..."
                              value={productoSearch[i] ?? ''}
                              onChange={e => {
                                setProductoSearch(prev => ({ ...prev, [i]: e.target.value }))
                                setValue(`detalles.${i}.producto_id`, '')
                                setStockOrigen(prev => { const n = {...prev}; delete n[i]; return n })
                                if (i === 0) setLoteOrigen(null)
                                openDropdown(i)
                              }}
                              onFocus={() => openDropdown(i)}
                              onBlur={() => setTimeout(() => setActiveDropdown(null), 200)}
                            />
                          </div>
                          {isActive && (
                            <div
                              style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 9999 }}
                              className="bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto"
                            >
                              {filtered.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-slate-400">Sin resultados</div>
                              ) : filtered.map((p: any) => {
                                const dispP = null // el disponible del origen ya no se muestra (es un ingreso)
                                return (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onMouseDown={() => selectProducto(i, p)}
                                    className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2 ${String(selectedId) === String(p.id) ? 'bg-blue-50 text-blue-700' : 'text-slate-800'}`}
                                  >
                                    <span className="font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-sm text-[10px] shrink-0">{p.sku}</span>
                                    <span className="truncate">{p.descripcion}</span>
                                    {dispP !== null && (
                                      <span className={`ml-auto shrink-0 font-semibold text-[10px] ${dispP <= 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                        {dispP} {p.unidad}
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                          {esReserva && selectedId && (() => {
                            const lotes = (lotesReserva || []).filter((l: any) => String(l.producto_id) === String(selectedId) && !!l.es_reserva)
                            return (
                              <div className="mt-1.5">
                                <select
                                  className="select text-xs py-1"
                                  {...register(`detalles.${i}.recepcion_detalle_id`, {
                                    onChange: (e: any) => {
                                      const l = lotes.find((x: any) => String(x.recepcion_detalle_id) === String(e.target.value))
                                      if (l) setValue(`detalles.${i}.cantidad`, parseFloat(l.pendiente))
                                    },
                                  })}
                                >
                                  <option value="">-- Factura de la reserva --</option>
                                  {lotes.map((l: any) => (
                                    <option key={l.recepcion_detalle_id} value={l.recepcion_detalle_id}>
                                      {l.nro_factura || 'Sin factura'} · {l.oc_numero} · saldo {parseFloat(l.pendiente)}
                                    </option>
                                  ))}
                                </select>
                                {!lotes.length && <p className="text-[10px] text-red-500 mt-0.5">No hay órdenes marcadas como RESERVA con saldo para este producto</p>}
                              </div>
                            )
                          })()}
                          {selectedId && !isActive && (
                            <p className="text-xs text-emerald-600 mt-0.5 font-medium pl-1">
                              ✓ {(catalogo || []).find((p: any) => String(p.id) === String(selectedId))?.sku}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2 w-36 text-center">
                          {!destinoId || !selectedId ? (
                            <span className="text-xs text-slate-300">—</span>
                          ) : (() => {
                            const sd = getStockDestino(selectedId)
                            const fisico = sd ? parseFloat(sd.stock_total) : 0
                            const reservado = sd ? parseFloat(sd.reservado_total) : 0
                            return (
                              <span className="text-sm font-bold text-slate-700">
                                {fisico} <span className="text-xs font-normal text-slate-400">{stock?.unidad}</span>
                                {reservado > 0 && <span className="block text-[10px] font-normal text-amber-600">({reservado} reservado)</span>}
                              </span>
                            )
                          })()}
                        </td>
                        <td className="px-2 py-2 w-32">
                          <input className="input text-right text-sm" type="number" step="0.0001" min="0.0001"
                            max={maxCantidad}
                            {...register(`detalles.${i}.cantidad`, { required: true })} />
                          {saldoLote !== null && cantidadIngresada > saldoLote && (
                            <p className="text-[10px] text-red-500 mt-0.5 text-right">Supera el saldo de la factura ({saldoLote})</p>
                          )}
                        </td>
                        <td className="px-2 py-2 w-10">
                          {fields.length > 1 && (
                            <button type="button" onClick={() => { remove(i); setProductoSearch(prev => { const n={...prev}; delete n[i]; return n }); setStockOrigen(prev => { const n={...prev}; delete n[i]; return n }); if (i === 0) setLoteOrigen(null) }}
                              className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset() }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Procesando...' : 'Confirmar Ingreso'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
