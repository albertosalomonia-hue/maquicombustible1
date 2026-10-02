'use client'

import React, { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setNavState } from '../../utils/navState'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { Search, ShoppingCart, PackageCheck, PackageX, FileText, ExternalLink, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Upload, RefreshCw, Plus, Trash2, FileSpreadsheet, FileDown, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'

const PDF_BASE = 'http://161.132.54.103:3001/api/ordenes-compra/pdf'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'
import api from '../../services/api'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import ProductoBuscador from '../../components/ui/ProductoBuscador'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'

const fmtMoneda = (moneda: string, n: number | string) =>
  moneda === 'USD'
    ? `$ ${parseFloat(String(n) || '0').toFixed(2)}`
    : `S/ ${parseFloat(String(n) || '0').toFixed(2)}`

const nuevaOcDefaults = {
  cliente_id: '', centro_costo_id: '', fecha: new Date().toISOString().slice(0, 10),
  fecha_entrega: '', moneda: 'PEN', tipo_cambio: 1, almacen_central: 'NO', nro_factura: '', observaciones: '',
  detalles: [{ producto_id: '', descripcion: '', cantidad_pedida: 1, precio_unitario: 0, descuento_pct: 0, igv_pct: 18 }],
}

function normalizarTexto(s: any) {
  return (s || '').toString().trim().toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
}

function normalizarClave(s: any) {
  return normalizarTexto(s).replace(/[^a-z0-9]/g, '')
}

function getCampo(row: Record<string, any>, ...nombres: string[]) {
  const mapa: Record<string, any> = {}
  for (const k of Object.keys(row)) mapa[normalizarClave(k)] = row[k]
  for (const n of nombres) {
    const v = mapa[normalizarClave(n)]
    if (v !== undefined && v !== '') return v
  }
  return undefined
}

export default function OrdenesCompraList() {
  const router = useRouter()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [facturaInput, setFacturaInput] = useState<Record<number, string>>({})
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [soloRecepcionar, setSoloRecepcionar] = useState(false)
  const [soloSinRecepcionar, setSoloSinRecepcionar] = useState(false)
  const [soloAlmacenCentral, setSoloAlmacenCentral] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 100
  const [exportando, setExportando] = useState(false)
  const fileInputDetalleRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    // Siempre se vuelve a pedir al entrar: el estado RECEPCIONAR/RECEPCIONADO cambia desde Recepciones.
    refetchOnMount: 'always',
    queryKey: ['ordenes-compra', search, fechaDesde, fechaHasta, soloAlmacenCentral, soloRecepcionar, soloSinRecepcionar, page],
    queryFn: () => api.get('/ordenes-compra', {
      params: {
        search, fecha_desde: fechaDesde || undefined, fecha_hasta: fechaHasta || undefined,
        almacen_central: soloAlmacenCentral ? 'SI' : undefined,
        estado_excluir: soloRecepcionar ? 'completada,anulada' : undefined,
        sin_recepcionar: soloSinRecepcionar ? '1' : undefined,
        limit: PAGE_SIZE, page,
      }
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const handleSearchChange = (v: string) => { setSearch(v); setPage(1) }
  const handleFechaDesdeChange = (v: string) => { setFechaDesde(v); setPage(1) }
  const handleFechaHastaChange = (v: string) => { setFechaHasta(v); setPage(1) }
  const handleSoloAlmacenCentralChange = (v: boolean) => { setSoloAlmacenCentral(v); setPage(1) }
  // Mutuamente excluyentes: ambos filtran "pendiente de recepción" desde ángulos distintos
  // (estado vs. si existe una recepción registrada) y combinados (AND) pueden dar 0 resultados
  // cuando una OC quedó en estado "completada" sin una recepción real (datos del sistema anterior).
  // Marca/desmarca la orden como RESERVA (su factura solo se ve en transferencias y salidas de reserva)
  const reservaMutation = useMutation({
    mutationFn: ({ id, es_reserva }: { id: number; es_reserva: boolean }) =>
      api.put(`/ordenes-compra/${id}/reserva`, { es_reserva }).then(r => r.data),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['ordenes-compra'] })
      qc.invalidateQueries({ queryKey: ['facturas'] })
      toast.success(r.es_reserva ? `Orden ${r.numero} marcada como RESERVA` : `Orden ${r.numero} ya no es RESERVA`)
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'No se pudo cambiar la marca de reserva'),
  })

  const handleSoloRecepcionarChange = () => { setSoloRecepcionar(v => { const next = !v; if (next) setSoloSinRecepcionar(false); return next }); setPage(1) }
  const handleSoloSinRecepcionarChange = () => { setSoloSinRecepcionar(v => { const next = !v; if (next) setSoloRecepcionar(false); return next }); setPage(1) }
  const totalRegistros = data?.total ?? 0
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / PAGE_SIZE))

  const { data: proveedores } = useQuery({ queryKey: ['clientes-sel'], queryFn: () => api.get('/clientes', { params: { limit: 500 } }).then(r => r.data.data) })
  const { data: centros } = useQuery({ queryKey: ['centros-costo'], queryFn: () => api.get('/centros-costo').then(r => r.data) })
  const { data: catalogo } = useQuery({ queryKey: ['catalogo-todos'], queryFn: () => api.get('/productos/catalogo', { params: { estado: 'todos' } }).then(r => r.data) })
  const { data: siguienteNumero } = useQuery({
    queryKey: ['oc-siguiente-numero'],
    queryFn: () => api.get('/ordenes-compra/siguiente-numero').then(r => r.data.numero),
    enabled: modalOpen,
    staleTime: 0,
  })

  const { register, handleSubmit, control, watch, reset, formState: { isSubmitting } } = useForm<any>({ defaultValues: nuevaOcDefaults })
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'detalles' })
  const detallesForm = watch('detalles')

  const handleImportarDetalleClick = () => fileInputDetalleRef.current?.click()

  const handleImportarDetalleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const XLSX = await import('xlsx')
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]]

      // Primero intenta emparejar por nombre de columna (Producto/SKU, Cantidad, Precio Unitario)
      const filasPorNombre = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[]
      const usaNombres = filasPorNombre.length > 0 && filasPorNombre.some(row =>
        getCampo(row, 'cantidad', 'cant', 'cantidad pedida', 'cant.') !== undefined &&
        parseFloat(getCampo(row, 'cantidad', 'cant', 'cantidad pedida', 'cant.')) > 0
      )

      // Si no hay columna "Cantidad" reconocible, usa las 3 primeras columnas por posición: Producto, Cantidad, Precio Unitario
      const filasPorPosicion = usaNombres ? null : (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]).slice(1)

      const totalFilas = usaNombres ? filasPorNombre.length : (filasPorPosicion || []).length
      if (!totalFilas) { toast.error('El archivo no contiene datos'); return }

      const nuevasLineas: any[] = []
      const errores: string[] = []

      for (let i = 0; i < totalFilas; i++) {
        const nFila = i + 2
        const skuOCodigo = usaNombres
          ? getCampo(filasPorNombre[i], 'producto', 'sku', 'codigo', 'código', 'codigo interno', 'codigo_interno', 'numero', 'n°')
          : (filasPorPosicion as any[][])[i][0]
        const cantidad = usaNombres
          ? parseFloat(getCampo(filasPorNombre[i], 'cantidad', 'cant', 'cantidad pedida', 'cant.')) || 0
          : parseFloat((filasPorPosicion as any[][])[i][1]) || 0
        const precio = usaNombres
          ? parseFloat(getCampo(filasPorNombre[i], 'precio unitario', 'precio', 'precio_unitario', 'p. unitario', 'costo')) || 0
          : parseFloat((filasPorPosicion as any[][])[i][2]) || 0

        if (!skuOCodigo) { errores.push(`Fila ${nFila}: falta producto/SKU`); continue }
        const clave = normalizarClave(skuOCodigo)
        let producto = (catalogo || []).find((p: any) =>
          normalizarClave(p.sku) === clave || normalizarClave(p.codigo_interno || '') === clave
        )
        if (!producto) {
          producto = (catalogo || []).find((p: any) => normalizarClave(p.descripcion) === clave)
        }
        if (!producto) {
          producto = (catalogo || []).find((p: any) => normalizarClave(p.descripcion).includes(clave))
        }
        if (!producto) { errores.push(`Fila ${nFila}: "${skuOCodigo}" no se encontró en el catálogo`); continue }
        if (cantidad <= 0) { errores.push(`Fila ${nFila}: cantidad inválida`); continue }

        nuevasLineas.push({
          producto_id: String(producto.id),
          descripcion: producto.descripcion,
          cantidad_pedida: cantidad,
          precio_unitario: precio || parseFloat(producto.precio_costo) || 0,
          descuento_pct: 0,
          igv_pct: 0,
        })
      }

      replace(nuevasLineas.length ? nuevasLineas : nuevaOcDefaults.detalles)
      toast.success(`Importadas ${nuevasLineas.length} de ${totalFilas} líneas`)
      if (errores.length) {
        const extra = errores.length > 5 ? `... y ${errores.length - 5} más` : ''
        toast.error(
          <div className="text-xs">
            {errores.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
            {extra && <div>{extra}</div>}
          </div>,
          { duration: 8000 }
        )
      }
    } catch (err) {
      toast.error('Error al leer el archivo Excel')
    }
  }

  const calcTotalesNuevaOc = () => {
    let sub = 0, igv = 0
    ;(detallesForm || []).forEach((d: any) => {
      const s = parseFloat(d.cantidad_pedida || 0) * parseFloat(d.precio_unitario || 0) * (1 - parseFloat(d.descuento_pct || 0) / 100)
      sub += s
      igv += s * (parseFloat(d.igv_pct || 18) / 100)
    })
    return { sub, igv, total: sub + igv }
  }

  const crearOcM = useMutation({
    mutationFn: (d: any) => api.post('/ordenes-compra/manual', d).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ordenes-compra'] })
      toast.success('Orden de compra creada')
      setModalOpen(false)
      reset(nuevaOcDefaults)
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al crear la orden de compra'),
  })

  const { data: ocDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['oc-detail', expandedId],
    queryFn: () => api.get(`/ordenes-compra/${expandedId}`).then(r => r.data),
    enabled: !!expandedId,
    retry: 1,
  })

  const facturaM = useMutation({
    mutationFn: ({ id, nro_factura }: { id: number; nro_factura: string }) =>
      api.put(`/ordenes-compra/${id}/factura`, { nro_factura }).then(r => r.data),
    onSuccess: (_, vars) => {
      toast.success('Factura registrada — OC completada')
      qc.invalidateQueries({ queryKey: ['ordenes-compra'] })
      qc.invalidateQueries({ queryKey: ['oc-detail', vars.id] })
      setFacturaInput(prev => { const n = { ...prev }; delete n[vars.id]; return n })
    },
  })

  const sincronizarM = useMutation({
    mutationFn: () => api.post('/ordenes-compra/sincronizar').then(r => r.data),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['ordenes-compra'] })
      const itemsActualizados = (r.detallesActualizados || 0) + (r.detallesReemplazados || 0)
      toast.success(`Sincronizado: ${r.ordenesNuevas} órdenes nuevas, ${r.ordenesActualizadas} actualizadas, ${r.detallesNuevos} ítems nuevos, ${itemsActualizados} ítems actualizados, ${r.productosCreados || 0} productos creados, ${r.familiasActualizadas || 0} familias actualizadas`)
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al sincronizar'),
  })

  const sincronizarCentrosM = useMutation({
    mutationFn: () => api.post('/ordenes-compra/sincronizar-centros').then(r => r.data),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['ordenes-compra'] })
      toast.success(`Centros de costo sincronizados: ${r.actualizados} línea(s) de compra actualizadas`)
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al sincronizar centros de costo'),
  })

  const todosOcs = data?.data || []
  const { sorted, sortCol, sortDir, toggle } = useSortTable(todosOcs, 'fecha', 'desc')
  const ocs = sorted

  const handleExportExcel = async () => {
    setExportando(true)
    try {
      const totalFilas = data?.total || 0
      const { data: full } = await api.get('/ordenes-compra', {
        params: {
          search, fecha_desde: fechaDesde || undefined, fecha_hasta: fechaHasta || undefined,
          almacen_central: soloAlmacenCentral ? 'SI' : undefined,
          estado_excluir: soloRecepcionar ? 'completada,anulada' : undefined,
          sin_recepcionar: soloSinRecepcionar ? '1' : undefined,
          limit: Math.max(totalFilas, 1), page: 1,
        },
      })
      const filas: any[] = full?.data || []
      if (!filas.length) { toast.error('No hay órdenes de compra para exportar'); return }

      // Trae el detalle de ítems de cada OC, en lotes para no saturar el pool de conexiones.
      // Si una puntual falla, no debe abortar la exportación completa: se omite y se avisa al final.
      const LOTE = 10
      const detalles: { oc: any; det: any[] }[] = []
      let fallidas = 0
      for (let i = 0; i < filas.length; i += LOTE) {
        const lote = filas.slice(i, i + LOTE)
        const resultados = await Promise.all(
          lote.map(oc =>
            api.get(`/ordenes-compra/${oc.id}`)
              .then(res => ({ oc, det: res.data.detalles || [] }))
              .catch(() => { fallidas++; return null })
          )
        )
        detalles.push(...resultados.filter((r): r is { oc: any; det: any[] } => r !== null))
      }
      if (!detalles.length) { toast.error('No se pudo obtener el detalle de ninguna orden de compra'); return }

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

      const ws = wb.addWorksheet('Órdenes de Compra', { views: [{ state: 'frozen', ySplit: 1 }] })
      ws.columns = [
        { header: 'N° OC', key: 'numero', width: 16 },
        { header: 'Fecha', key: 'fecha', width: 12 },
        { header: 'Fecha Entrega', key: 'fecha_entrega', width: 14 },
        { header: 'Proveedor', key: 'proveedor', width: 32 },
        { header: 'Centro Costo', key: 'cc', width: 20 },
        { header: 'Almacén Central', key: 'alm_central', width: 14 },
        { header: 'SKU', key: 'sku', width: 18 },
        { header: 'Producto', key: 'producto', width: 36 },
        { header: 'U/M', key: 'unidad', width: 10 },
        { header: 'Cant. Pedida', key: 'pedida', width: 14 },
        { header: 'Cant. Recibida', key: 'recibida', width: 14 },
        { header: 'Pendiente', key: 'pendiente', width: 12 },
        { header: 'Precio Unit.', key: 'precio', width: 14 },
        { header: 'Subtotal', key: 'subtotal', width: 14 },
        { header: 'IGV %', key: 'igv_pct', width: 10 },
        { header: 'Total c/IGV', key: 'total', width: 14 },
        { header: 'Moneda', key: 'moneda', width: 10 },
        { header: 'N° Factura', key: 'factura', width: 16 },
        { header: 'Estado', key: 'estado', width: 16 },
        { header: 'Observaciones', key: 'obs', width: 26 },
      ]
      ws.getRow(1).eachCell(cell => estiloHeaderCell(cell, COLOR.header))
      ws.getRow(1).height = 20

      let totalGeneral = 0
      let idxFila = 0
      detalles.forEach(({ oc, det }) => {
        det.forEach((d: any) => {
          const cant = parseFloat(d.cantidad_pedida) || 0
          const recibida = parseFloat(d.cantidad_recibida || 0)
          const unitario = parseFloat(d.precio_unitario) || 0
          const subtotal = parseFloat(d.subtotal) || (cant * unitario)
          const igvPct = parseFloat(d.igv_pct) || 0
          const total = subtotal * (1 + igvPct / 100)
          totalGeneral += total
          const row = ws.addRow({
            numero: oc.numero,
            fecha: oc.fecha,
            fecha_entrega: oc.fecha_entrega || '',
            proveedor: oc.cliente_nombre || '',
            cc: d.centro_costo_nombre || oc.centro_costo_nombre || '',
            alm_central: oc.almacen_central === 'SI' ? 'Sí' : 'No',
            sku: d.sku || '',
            producto: d.descripcion || d.producto_descripcion || '',
            unidad: d.unidad || '',
            pedida: cant,
            recibida,
            pendiente: Math.max(0, cant - recibida),
            precio: unitario,
            subtotal,
            igv_pct: igvPct,
            total,
            moneda: oc.moneda,
            factura: oc.nro_factura || 'SIN FACTURA',
            estado: oc.estado,
            obs: oc.observaciones || '',
          })
          const bgFila = idxFila % 2 === 0 ? COLOR.filaPar : COLOR.filaImpar
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.border = { bottom: thinBorder }
            cell.alignment = { vertical: 'middle', horizontal: [10, 11, 12, 13, 14, 15, 16].includes(colNumber) ? 'right' : [6, 17, 19].includes(colNumber) ? 'center' : 'left' }
            cell.fill = fill(bgFila)
          })
          row.getCell(18).font = !oc.nro_factura && !oc.url_factura ? { color: { argb: 'FF991B1B' }, bold: true } : {}
          row.getCell(10).numFmt = '#,##0.0000'
          row.getCell(11).numFmt = '#,##0.0000'
          row.getCell(12).numFmt = '#,##0.0000'
          row.getCell(13).numFmt = '#,##0.0000'
          row.getCell(14).numFmt = '#,##0.00'
          row.getCell(16).numFmt = '#,##0.00'
          row.getCell(16).font = { bold: true, color: { argb: 'FF166534' } }
          idxFila++
        })
      })
      const filaTotal = ws.addRow({ numero: '', fecha: '', fecha_entrega: '', proveedor: '', cc: '', alm_central: 'TOTAL GENERAL', sku: '', producto: '', unidad: '', pedida: '', recibida: '', pendiente: '', precio: '', subtotal: '', igv_pct: '', total: totalGeneral, moneda: '', factura: '', estado: '', obs: '' })
      ws.mergeCells(`A${filaTotal.number}:E${filaTotal.number}`)
      filaTotal.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.fill = fill('FFF1F5F9')
        cell.font = { bold: true, size: 10 }
        cell.border = { top: { style: 'medium', color: { argb: 'FF94A3B8' } } }
        if (colNumber === 6) cell.alignment = { horizontal: 'right' }
        if (colNumber === 16) { cell.numFmt = '#,##0.00'; cell.alignment = { horizontal: 'right' }; cell.font = { bold: true, color: { argb: 'FF166534' } } }
      })
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 20 } }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ordenes_compra_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      if (fallidas > 0) {
        toast.error(`Excel exportado, pero ${fallidas} orden(es) no se pudieron incluir (falló su detalle)`)
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

  const toggleExpand = (id: number) => setExpandedId(prev => prev === id ? null : id)

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar por número, proveedor..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
          />
        </div>
        <input
          className="input w-40"
          type="date"
          value={fechaDesde}
          onChange={e => handleFechaDesdeChange(e.target.value)}
          title="Fecha desde"
        />
        <input
          className="input w-40"
          type="date"
          value={fechaHasta}
          onChange={e => handleFechaHastaChange(e.target.value)}
          title="Fecha hasta"
        />
        {(fechaDesde || fechaHasta) && (
          <button className="btn-secondary" onClick={() => { setFechaDesde(''); setFechaHasta(''); setPage(1) }}>
            Limpiar fechas
          </button>
        )}
        <select
          className="select w-48"
          value={soloAlmacenCentral ? 'central' : 'todos'}
          onChange={e => handleSoloAlmacenCentralChange(e.target.value === 'central')}
        >
          <option value="todos">Todos</option>
          <option value="central">Solo Almacén Central</option>
        </select>
        <button
          onClick={handleSoloRecepcionarChange}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl border-2 transition-all duration-150 ${
            soloRecepcionar
              ? 'bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-200'
              : 'bg-white border-emerald-400 text-emerald-600 hover:bg-emerald-50'
          }`}
          title="Mostrar órdenes que no estén completadas ni anuladas (por estado)"
        >
          <PackageCheck size={16} />
          RECEPCIONAR
        </button>
        <button
          className="btn-secondary"
          onClick={handleExportExcel}
          disabled={exportando || !ocs.length}
          title="Exportar órdenes de compra a Excel"
        ><FileDown size={16} /> {exportando ? 'Exportando...' : 'Exportar Excel'}</button>
        <button
          onClick={() => sincronizarM.mutate()}
          disabled={sincronizarM.isPending}
          className="btn-secondary"
          title="Traer órdenes nuevas o actualizadas del sistema anterior"
        >
          <RefreshCw size={16} className={sincronizarM.isPending ? 'animate-spin' : ''} />
          {sincronizarM.isPending ? 'Actualizando...' : 'Actualizar'}
        </button>
        <button
          onClick={() => sincronizarCentrosM.mutate()}
          disabled={sincronizarCentrosM.isPending}
          className="btn-secondary"
          title="Llenar el centro de costo vacío de las líneas de compra con el centro de costo más reciente de sus salidas"
        >
          <Wallet size={16} className={sincronizarCentrosM.isPending ? 'animate-spin' : ''} />
          {sincronizarCentrosM.isPending ? 'Sincronizando...' : 'Sincronizar Centros'}
        </button>
        <button className="btn-primary hidden" onClick={() => { reset(nuevaOcDefaults); setModalOpen(true) }}>
          <Plus size={16} /> Nueva Orden de Compra
        </button>
        <button
          onClick={handleSoloSinRecepcionarChange}
          className={`hidden inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl border-2 transition-all duration-150 ${
            soloSinRecepcionar
              ? 'bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-200'
              : 'bg-white border-orange-400 text-orange-600 hover:bg-orange-50'
          }`}
          title="Mostrar solo órdenes que aún tienen ítems pendientes de recepcionar"
        >
          <PackageX size={16} />
          SIN RECEPCIONAR
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <ShoppingCart size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Órdenes de Compra</span>
          <span className="ml-auto text-sm text-slate-400">{totalRegistros} registros</span>
        </div>

        {!ocs.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header w-8"></th>
                  <SortableTh col="numero" label="N° OC" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="fecha" label="Fecha" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="cliente_nombre" label="Proveedor" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="nro_factura" label="N° Factura" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="total" label="Total" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortableTh col="moneda" label="Moneda" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="estado" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <th className="table-header text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {ocs.map((oc: any) => {
                  const isExpanded = expandedId === oc.id
                  // Verde / RECEPCIONADO solo cuando la orden está completa. Con una recepción parcial
                  // (o tras eliminar una) vuelve al estado normal y se puede seguir recepcionando.
                  const recepcionada = parseInt(oc.tiene_recepcion) > 0 && oc.estado === 'completada'
                  return (
                    <React.Fragment key={oc.id}>
                      <tr
                        className={`table-row cursor-pointer select-none ${
                          isExpanded ? 'bg-blue-50/60' : recepcionada ? 'bg-emerald-50' : ''
                        }`}
                        onClick={() => toggleExpand(oc.id)}
                      >
                        {/* Chevron toggle */}
                        <td className="table-cell w-8 text-center">
                          {isExpanded
                            ? <ChevronUp size={15} className="text-blue-500 mx-auto" />
                            : <ChevronDown size={15} className="text-slate-400 mx-auto" />}
                        </td>

                        {/* N° OC + badges PDF */}
                        <td className="table-cell font-mono text-xs font-bold">
                          <div className="flex items-center gap-1.5">
                            <span className="text-blue-700">{oc.numero}</span>
                            {oc.id_source && (
                              <a href={`${PDF_BASE}/${oc.id_source}`} target="_blank" rel="noopener noreferrer"
                                 className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-sm transition-colors"
                                 title="Ver PDF de OC" onClick={e => e.stopPropagation()}>
                                <ExternalLink size={9} /> PDF
                              </a>
                            )}
                            {oc.url_factura && (
                              <a href={oc.url_factura} target="_blank" rel="noopener noreferrer"
                                 className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-1.5 py-0.5 rounded-sm transition-colors"
                                 title="Ver factura" onClick={e => e.stopPropagation()}>
                                <ExternalLink size={9} /> FAC
                              </a>
                            )}
                          </div>
                        </td>

                        <td className="table-cell text-slate-500 whitespace-nowrap">{oc.fecha}</td>
                        <td className="table-cell font-medium text-slate-900 max-w-[200px] truncate">{oc.cliente_nombre || '—'}</td>
                        <td className="table-cell text-xs text-slate-500 font-mono">{oc.nro_factura || '—'}</td>
                        <td className="table-cell text-right font-bold text-slate-900">{fmtMoneda(oc.moneda, oc.total)}</td>
                        <td className="table-cell text-center">
                          <span className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded-sm">{oc.moneda}</span>
                        </td>
                        <td className="table-cell text-center">
                          <Badge value={oc.estado === 'emitida' && (oc.nro_factura || oc.url_factura) ? 'emitida_con_factura' : oc.estado} />
                        </td>
                        <td className="table-cell text-center" onClick={e => e.stopPropagation()}>
                          <label className={`mb-2 mx-auto flex w-fit items-center justify-center gap-2 cursor-pointer select-none rounded-lg border-2 px-2.5 py-1 shadow-xs transition-colors ${oc.es_reserva ? 'border-red-600 bg-red-600' : 'border-red-500 bg-white hover:bg-red-50'}`} title="Si está activo, esta orden y su factura solo se usan en transferencias y salidas de RESERVA">
                            <span className={`text-xs font-extrabold tracking-wide ${oc.es_reserva ? 'text-white' : 'text-red-600'}`}>RESERVA</span>
                            <span className="relative inline-flex items-center">
                              <input
                                type="checkbox" role="switch" className="peer sr-only"
                                checked={!!oc.es_reserva}
                                disabled={reservaMutation.isPending}
                                onChange={e => reservaMutation.mutate({ id: oc.id, es_reserva: e.target.checked })}
                              />
                              <span className="h-5 w-10 rounded-full bg-red-200 transition-colors peer-checked:bg-red-900/60" />
                              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
                            </span>
                          </label>
                          {oc.almacen_central === 'SI' && (
                            recepcionada ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 rounded-lg cursor-not-allowed opacity-75">
                                <PackageCheck size={13} />
                                RECEPCIONADO
                              </span>
                            ) : (
                              <button
                                onClick={() => { setNavState('/recepciones', { ocId: oc.id, ocNumero: oc.numero, ocFecha: oc.fecha, esReserva: !!Number(oc.es_reserva) }); router.push('/recepciones') }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 rounded-lg shadow-xs shadow-emerald-200 transition-all duration-150 hover:shadow-md hover:shadow-emerald-300 hover:-translate-y-px"
                              >
                                <PackageCheck size={13} />
                                RECEPCIONAR
                              </button>
                            )
                          )}
                        </td>
                      </tr>

                      {/* Acordeón de detalle */}
                      {isExpanded && (
                        <tr key={`${oc.id}-detail`}>
                          <td colSpan={9} className="p-0 bg-orange-50 border-b border-orange-200">
                            {loadingDetail ? (
                              <div className="px-8 py-4 text-sm text-slate-400">Cargando ítems...</div>
                            ) : !ocDetail || ocDetail.id !== oc.id ? (
                              <div className="px-8 py-4 text-sm text-slate-400">Cargando...</div>
                            ) : (
                              <div className="px-8 py-4 space-y-3">
                                {/* Info cabecera */}
                                <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                                  <span><span className="font-semibold text-slate-700">Proveedor:</span> {ocDetail.cliente_nombre || '—'}</span>
                                  {ocDetail.cliente_ruc && <span><span className="font-semibold text-slate-700">RUC:</span> {ocDetail.cliente_ruc}</span>}
                                  {/* "Entrega" y la insignia "Almacén Central" ocultas para no confundir al operador. */}
                                  <span className="hidden"><span className="font-semibold text-slate-700">Entrega:</span> ALMACÉN CENTRAL VIRTUAL</span>
                                  <span className={`hidden items-center gap-1 font-bold px-2 py-0.5 rounded-full text-[11px] ${ocDetail.almacen_central === 'SI' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                                    {ocDetail.almacen_central === 'SI' ? '✓ Almacén Central' : '✗ Almacén Central'}
                                  </span>
                                  <span><span className="font-semibold text-slate-700">T/C:</span> {parseFloat(ocDetail.tipo_cambio || 1).toFixed(4)}</span>
                                  {ocDetail.nro_factura && (
                                    <span className="flex items-center gap-1">
                                      <FileText size={11} />
                                      <span className="font-semibold text-slate-700">Factura:</span>
                                      <span className="font-mono text-blue-700">{ocDetail.nro_factura}</span>
                                    </span>
                                  )}
                                </div>

                                {/* Registrar N° Factura: solo si aún no tiene ni número ni PDF vinculado,
                                    ya que basta con uno de los dos para considerarla registrada */}
                                {ocDetail.estado === 'emitida' && !ocDetail.nro_factura && !ocDetail.url_factura && (
                                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
                                    <Upload size={14} className="text-red-500 shrink-0" />
                                    <span className="text-xs font-semibold text-red-700 shrink-0">N° Factura:</span>
                                    <input
                                      className="input text-xs h-7 flex-1 min-w-0"
                                      placeholder="Ej: F001-00012345"
                                      value={facturaInput[ocDetail.id] ?? ''}
                                      onChange={e => setFacturaInput(prev => ({ ...prev, [ocDetail.id]: e.target.value }))}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter' && facturaInput[ocDetail.id]?.trim()) {
                                          facturaM.mutate({ id: ocDetail.id, nro_factura: facturaInput[ocDetail.id] })
                                        }
                                      }}
                                    />
                                    <button
                                      onClick={() => facturaM.mutate({ id: ocDetail.id, nro_factura: facturaInput[ocDetail.id] ?? '' })}
                                      disabled={!facturaInput[ocDetail.id]?.trim() || facturaM.isPending}
                                      className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg transition-colors shrink-0"
                                    >
                                      {facturaM.isPending ? 'Guardando...' : 'Registrar'}
                                    </button>
                                  </div>
                                )}

                                {/* Links PDF */}
                                {(ocDetail.id_source || ocDetail.url_factura) && (
                                  <div className="flex gap-2 flex-wrap">
                                    {ocDetail.id_source && (
                                      <a href={`${PDF_BASE}/${ocDetail.id_source}`} target="_blank" rel="noopener noreferrer"
                                         className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors">
                                        <ExternalLink size={12} /> Ver Orden de Compra (PDF)
                                      </a>
                                    )}
                                    {ocDetail.url_factura && (
                                      <a href={ocDetail.url_factura} target="_blank" rel="noopener noreferrer"
                                         className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors">
                                        <ExternalLink size={12} /> Ver Factura (PDF)
                                      </a>
                                    )}
                                  </div>
                                )}

                                {/* Tabla ítems */}
                                <div className="rounded-lg border border-orange-200 overflow-hidden">
                                  <table className="w-full text-xs">
                                    <thead className="bg-orange-100">
                                      <tr>
                                        <th className="table-header text-left">SKU</th>
                                        <th className="table-header text-left">C.Costo</th>
                                        <th className="table-header text-left">Descripción</th>
                                        <th className="table-header text-right">Cant.</th>
                                        <th className="table-header text-right">Recibido</th>
                                        <th className="table-header text-right">Costo Unit.</th>
                                        <th className="table-header text-right">Subtotal</th>
                                        <th className="table-header text-right">Total c/IGV</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(ocDetail.detalles || []).length === 0 ? (
                                        <tr><td colSpan={8} className="table-cell text-center text-slate-400 py-4">Sin ítems registrados</td></tr>
                                      ) : (ocDetail.detalles || []).map((d: any) => {
                                        const cant     = parseFloat(d.cantidad_pedida) || 0
                                        const recibido = parseFloat(d.cantidad_recibida || 0)
                                        const pendiente = cant - recibido
                                        const unitario  = parseFloat(d.precio_unitario) || 0
                                        const subtotal  = parseFloat(d.subtotal) || (cant * unitario)
                                        const igvPct    = parseFloat(d.igv_pct) || 18
                                        const totalIgv  = subtotal * (1 + igvPct / 100)
                                        return (
                                          <tr key={d.id} className="border-t border-orange-100 bg-white/60 hover:bg-orange-50/60">
                                            <td className="table-cell font-mono text-slate-400">{d.sku || '—'}</td>
                                            <td className="table-cell text-slate-500 max-w-[140px] truncate">{d.centro_costo_nombre || '—'}</td>
                                            <td className="table-cell font-medium text-slate-800 max-w-[220px]">
                                              <span title={d.descripcion || d.producto_descripcion || ''}>
                                                {d.descripcion || d.producto_descripcion || '—'}
                                              </span>
                                            </td>
                                            <td className="table-cell text-right whitespace-nowrap">
                                              {cant.toFixed(2)} <span className="text-slate-400">{d.unidad}</span>
                                            </td>
                                            <td className="table-cell text-right">
                                              <span className={recibido > 0 ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
                                                {recibido.toFixed(2)}
                                              </span>
                                              {pendiente > 0 && (
                                                <span className="block text-orange-400">pend: {pendiente.toFixed(2)}</span>
                                              )}
                                            </td>
                                            <td className="table-cell text-right text-slate-600">{fmtMoneda(ocDetail.moneda, unitario)}</td>
                                            <td className="table-cell text-right font-semibold">{fmtMoneda(ocDetail.moneda, subtotal)}</td>
                                            <td className="table-cell text-right font-bold text-blue-700">{fmtMoneda(ocDetail.moneda, totalIgv)}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {/* Totales */}
                                <div className="flex justify-end">
                                  <div className="text-xs space-y-1 min-w-[200px]">
                                    <div className="flex justify-between gap-8 text-slate-500">
                                      <span>Subtotal:</span><span className="font-medium">{fmtMoneda(ocDetail.moneda, ocDetail.subtotal)}</span>
                                    </div>
                                    <div className="flex justify-between gap-8 text-slate-500">
                                      <span>IGV:</span><span className="font-medium">{fmtMoneda(ocDetail.moneda, ocDetail.igv)}</span>
                                    </div>
                                    <div className="flex justify-between gap-8 font-bold text-sm border-t border-slate-200 pt-1 mt-1">
                                      <span>Total:</span><span className="text-blue-700">{fmtMoneda(ocDetail.moneda, ocDetail.total)}</span>
                                    </div>
                                  </div>
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

      {/* Modal Nueva Orden de Compra */}
      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset(nuevaOcDefaults) }} title="Nueva Orden de Compra" size="2xl">
        <form onSubmit={handleSubmit(d => crearOcM.mutate(d))} className="p-6 space-y-5">
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-sm">
            <span className="text-blue-700">N° de Orden de Compra a crear:</span>
            <span className="font-mono font-bold text-blue-800">{siguienteNumero || 'calculando...'}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className="label">Proveedor *</label>
              <select className="select" {...register('cliente_id', { required: true })}>
                <option value="">-- Seleccionar --</option>
                {(proveedores || []).map((c: any) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Fecha *</label>
              <input className="input" type="date" {...register('fecha', { required: true })} />
            </div>
            <div>
              <label className="label">Fecha de entrega</label>
              <input className="input" type="date" {...register('fecha_entrega')} />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="label">Centro de Costo</label>
              <select className="select" {...register('centro_costo_id')}>
                <option value="">-- Sin asignar --</option>
                {(centros || []).map((cc: any) => <option key={cc.id} value={cc.id}>{cc.codigo} - {cc.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Moneda</label>
              <select className="select" {...register('moneda')}>
                <option value="PEN">PEN - Soles</option>
                <option value="USD">USD - Dólares</option>
                <option value="EUR">EUR - Euros</option>
              </select>
            </div>
            <div>
              <label className="label">Tipo de Cambio</label>
              <input className="input" type="number" step="0.0001" {...register('tipo_cambio')} />
            </div>
            <div>
              <label className="label">Almacén Central</label>
              <select className="select" {...register('almacen_central')}>
                <option value="NO">No</option>
                <option value="SI">Sí</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">N° Factura (opcional)</label>
            <input className="input" {...register('nro_factura')} placeholder="Ej: F001-00012345" />
          </div>

          {/* Detalle */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="font-medium text-slate-900 text-sm">Detalle de Productos</label>
              <div className="flex items-center gap-2">
                <input ref={fileInputDetalleRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportarDetalleFile} />
                <button type="button" onClick={handleImportarDetalleClick} className="btn-secondary text-xs py-1.5" title="Importar todas las líneas de esta orden desde un Excel">
                  <FileSpreadsheet size={14} /> Importar Excel
                </button>
                <button type="button" onClick={() => append({ producto_id: '', descripcion: '', cantidad_pedida: 1, precio_unitario: 0, descuento_pct: 0, igv_pct: 18 })} className="btn-secondary text-xs py-1.5">
                  <Plus size={14} /> Agregar línea
                </button>
              </div>
            </div>
            <div className="border border-slate-200 rounded-xl">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="table-header text-left">Producto</th>
                    <th className="table-header text-right w-20">Cant.</th>
                    <th className="table-header text-right w-28">P. Unitario</th>
                    <th className="table-header text-right w-20">Desc. %</th>
                    <th className="table-header text-right w-20">IGV %</th>
                    <th className="table-header text-right w-28">Subtotal</th>
                    <th className="table-header w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, i) => {
                    const d = detallesForm?.[i] || {}
                    const sub = parseFloat(d.cantidad_pedida || 0) * parseFloat(d.precio_unitario || 0) * (1 - parseFloat(d.descuento_pct || 0) / 100)
                    const totalLinea = sub * (1 + parseFloat(d.igv_pct || 18) / 100)
                    return (
                      <tr key={field.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 min-w-[220px]">
                          <Controller
                            control={control}
                            name={`detalles.${i}.producto_id`}
                            rules={{ required: true }}
                            render={({ field: f }) => (
                              <ProductoBuscador productos={catalogo || []} value={f.value} onChange={f.onChange} />
                            )}
                          />
                        </td>
                        <td className="px-2 py-2"><input className="input text-right text-sm" type="number" step="0.01" {...register(`detalles.${i}.cantidad_pedida`)} /></td>
                        <td className="px-2 py-2"><input className="input text-right text-sm" type="number" step="0.0001" {...register(`detalles.${i}.precio_unitario`)} /></td>
                        <td className="px-2 py-2"><input className="input text-right text-sm" type="number" step="0.01" {...register(`detalles.${i}.descuento_pct`)} /></td>
                        <td className="px-2 py-2"><input className="input text-right text-sm" type="number" step="0.01" {...register(`detalles.${i}.igv_pct`)} /></td>
                        <td className="px-3 py-2 text-right text-sm font-medium text-slate-900">{fmtMoneda(watch('moneda'), totalLinea)}</td>
                        <td className="px-2 py-2">
                          {fields.length > 1 && <button type="button" onClick={() => remove(i)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {/* Totales */}
            <div className="flex justify-end mt-3">
              <div className="w-64 space-y-1 text-sm">
                <div className="flex justify-between text-slate-500"><span>Subtotal:</span><span>{fmtMoneda(watch('moneda'), calcTotalesNuevaOc().sub)}</span></div>
                <div className="flex justify-between text-slate-500"><span>IGV:</span><span>{fmtMoneda(watch('moneda'), calcTotalesNuevaOc().igv)}</span></div>
                <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1 mt-1"><span>Total:</span><span>{fmtMoneda(watch('moneda'), calcTotalesNuevaOc().total)}</span></div>
              </div>
            </div>
          </div>

          <div>
            <label className="label">Observaciones</label>
            <textarea className="input h-16 resize-none" {...register('observaciones')} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset(nuevaOcDefaults) }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Guardando...' : 'Crear Orden de Compra'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
