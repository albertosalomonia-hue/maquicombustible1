'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { FileSearch, ExternalLink, FileDown, Search, Upload, X, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

const PDF_BASE = 'http://161.132.54.103:3001/api/ordenes-compra/pdf'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'
import api from '../../services/api'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'

const fmtMoneda = (moneda: string, n: number | string) =>
  moneda === 'USD'
    ? `$ ${parseFloat(String(n) || '0').toFixed(2)}`
    : `S/ ${parseFloat(String(n) || '0').toFixed(2)}`

// Arma "RUC-SERIE-NUMERO" a partir del RUC del proveedor y el N° de factura
// (guardado como "SERIE-NUMERO", ej. F022-00018499). Los ceros a la izquierda
// del número se eliminan: F022-00018499 -> F022-18499.
function buildMatch(ruc?: string | null, nroFactura?: string | null) {
  if (!ruc || !nroFactura) return null
  const nro = nroFactura.trim()
  const dashIdx = nro.indexOf('-')
  const serie = dashIdx > -1 ? nro.substring(0, dashIdx).trim() : 'F001'
  const numero = (dashIdx > -1 ? nro.substring(dashIdx + 1) : nro).trim().replace(/^0+(?=\d)/, '')
  return `${ruc}-${serie}-${numero}`
}

// La URL de pago es url_pdf (campo "url" del sistema anterior: la imagen/PDF del
// pago). Es un documento distinto de url_factura (la factura en sí, mostrada aparte
// como badge "FAC"), así que no debe mezclarse con ella.
function pagoUrl(oc: { url_pdf?: string | null }) {
  return (oc.url_pdf && oc.url_pdf.trim()) || null
}

type FilaContabilidad = { buscador: string; proveedor: string; fecha: any; monto: any; glosa: string; fecha_rastreo?: string | null }

// Fecha/hora en que quedó registrado ese BUSCADOR en erp_contabilidad_importada
// (columna "fecha de rastreo"): local, formato corto DD/MM/AAAA HH:mm.
function fmtFechaRastreo(v: any) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Lee el reporte de Contabilidad y extrae sus filas identificadas por la columna
// "BUSCADOR" (mismo formato que Match: RUC-SERIE-NUMERO), con el resto de columnas
// útiles para mostrar contexto (Proveedor, fecha, monto, glosa). El archivo trae
// varias filas de encabezado/metadata antes de la fila con los nombres de columna
// reales, así que se busca la fila que contiene "BUSCADOR" en vez de asumir una
// posición fija. Se deduplica por BUSCADOR (se queda con la primera aparición).
function extraerFilasContabilidad(rows: any[][]): FilaContabilidad[] {
  const headerIdx = rows.findIndex(r => r.some(c => String(c ?? '').trim().toUpperCase() === 'BUSCADOR'))
  if (headerIdx === -1) throw new Error('No se encontró la columna "BUSCADOR" en el archivo')
  const header = rows[headerIdx].map(c => String(c ?? '').trim().toUpperCase())
  const colBuscador = header.indexOf('BUSCADOR')
  const colProveedor = header.indexOf('PROVEEDOR')
  const colFecha = header.indexOf('FEC. MOV.')
  const colMonto = header.indexOf('MTO. HABER')
  const colGlosa = header.indexOf('GLOSA')

  const vistos = new Set<string>()
  const filas: FilaContabilidad[] = []
  for (const r of rows.slice(headerIdx + 1)) {
    const buscador = String(r[colBuscador] ?? '').trim().toUpperCase()
    if (!buscador || vistos.has(buscador)) continue
    vistos.add(buscador)
    filas.push({
      buscador,
      proveedor: colProveedor > -1 ? String(r[colProveedor] ?? '').trim() : '',
      fecha: colFecha > -1 ? r[colFecha] : '',
      monto: colMonto > -1 ? r[colMonto] : '',
      glosa: colGlosa > -1 ? String(r[colGlosa] ?? '').trim() : '',
    })
  }
  return filas
}

// Serial de Excel (días desde 1900) -> {y, m, d}. Equivale a XLSX.SSF.parse_date_code sin cargar
// toda la librería xlsx en el bundle inicial (25569 = 1970-01-01 en serial de Excel).
function parseDateCode(serial: number) {
  const dt = new Date(Math.round((Math.floor(serial) - 25569) * 86400 * 1000))
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}

// El reporte trae la fecha como número de serie de Excel (días desde 1900). Se
// convierte a DD/MM/AAAA para mostrarla; si no es numérico se muestra tal cual.
function fmtFechaExcel(v: any) {
  if (typeof v === 'number') {
    try {
      const d = parseDateCode(v)
      if (d) return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`
    } catch { /* deja el valor crudo si no se puede parsear */ }
  }
  // Una vez persistida, la fecha vuelve de la BD como string ISO (ej. "2026-01-08T00:00:00.000Z").
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split('-')
    return `${d}/${m}/${y}`
  }
  return v || '—'
}

// Convierte el serial de Excel a 'YYYY-MM-DD' para poder persistirlo en una
// columna DATE (fmtFechaExcel de arriba es solo para *mostrarlo*, no sirve para
// guardarlo). Si ya viene como texto o no se puede parsear, se manda tal cual.
function excelSerialAIso(v: any): any {
  if (typeof v === 'number') {
    try {
      const d = parseDateCode(v)
      if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
    } catch { /* deja el valor crudo si no se puede parsear */ }
  }
  return v || null
}

const btnGreen = 'inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

// Muestra TODAS las órdenes de servicio y compra registradas en el sistema, para
// control y verificación de facturas. El único filtro es el buscador por N° de OC
// o proveedor; no hay filtros de fecha, estado ni almacén.
export default function ControlFacturasList() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const PAGE_SIZE = 200
  const [exportando, setExportando] = useState(false)
  const [rastreados, setRastreados] = useState<Set<string> | null>(null)
  const [archivoContabilidad, setArchivoContabilidad] = useState<{ nombre: string; totalBuscador: number; totalOrdenes: number; coincidencias: number; nuevos: number; actualizados: number; autoCorregidos: number } | null>(null)
  const [noRastreadas, setNoRastreadas] = useState<FilaContabilidad[]>([])
  const [rastreadas, setRastreadas] = useState<(FilaContabilidad & { numero: string; orden_proveedor: string; tipo: 'Compra' | 'Servicio' })[]>([])
  const [modalResultadoOpen, setModalResultadoOpen] = useState(false)
  const [modalNoRastreadasOpen, setModalNoRastreadasOpen] = useState(false)
  const [modalRastreadasOpen, setModalRastreadasOpen] = useState(false)
  const [importando, setImportando] = useState(false)
  const fileInputContabilidadRef = useRef<HTMLInputElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const handleSearchChange = (v: string) => setSearch(v)

  // Carga el acumulado ya guardado de "Importar Contabilidad" (ver
  // erp_contabilidad_importada) apenas se abre la página, para que el coloreado
  // RASTREADO funcione sin tener que volver a subir el archivo cada sesión.
  const { data: contabilidadAcumulada } = useQuery({
    queryKey: ['contabilidad-importada'],
    queryFn: () => api.get('/contabilidad-importada').then(r => r.data),
  })
  useEffect(() => {
    if (rastreados || !contabilidadAcumulada?.data?.length) return
    setRastreados(new Set(contabilidadAcumulada.data.map((f: any) => f.buscador)))
  }, [contabilidadAcumulada, rastreados])

  const sincronizarM = useMutation({
    mutationFn: () => api.post('/ordenes-compra/sincronizar').then(r => r.data),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['control-facturas'] })
      qc.invalidateQueries({ queryKey: ['facturas'] })
      const itemsActualizados = (r.detallesActualizados || 0) + (r.detallesReemplazados || 0)
      toast.success(`Actualizado: ${r.ordenesNuevas} órdenes nuevas, ${r.ordenesActualizadas} actualizadas, ${r.detallesNuevos} ítems nuevos, ${itemsActualizados} ítems actualizados, ${r.familiasActualizadas || 0} familias actualizadas, ${r.facturasCreadas || 0} facturas registradas`)
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al actualizar'),
  })

  const handleImportarContabilidadClick = () => fileInputContabilidadRef.current?.click()

  // Compara un conjunto de filas de contabilidad (ya persistidas) contra TODAS las
  // órdenes de compra Y de servicio del sistema (no solo la página cargada). Las
  // órdenes de servicio viven en una tabla legada aparte de las de compra, así que
  // un pago puede existir solo ahí. Se reutiliza tanto al importar un archivo nuevo
  // como al abrir "RASTREADOS" sin reimportar nada.
  const compararConOrdenes = async (filasContabilidad: FilaContabilidad[]) => {
    const set = new Set(filasContabilidad.map(f => f.buscador))
    const totalFilas = data?.pages?.[0]?.total || 0
    const [{ data: full }, { data: servicio }] = await Promise.all([
      api.get('/ordenes-compra', { params: { search: search || undefined, limit: Math.max(totalFilas, 1), page: 1 } }),
      api.get('/ordenes-compra/servicio-comparacion'),
    ])
    const filas: any[] = full?.data || []
    const filasServicio: any[] = servicio?.data || []
    let coincidencias = 0
    const matchados = new Map<string, { numero: string; orden_proveedor: string; tipo: 'Compra' | 'Servicio' }>()
    const contarMatch = (ruc: any, nroFactura: any, numero: string, proveedor: string, tipo: 'Compra' | 'Servicio') => {
      const m = buildMatch(ruc, nroFactura)
      const mUpper = m ? m.toUpperCase() : null
      if (mUpper && set.has(mUpper) && !matchados.has(mUpper)) {
        coincidencias++
        matchados.set(mUpper, { numero, orden_proveedor: proveedor || '', tipo })
      }
    }
    filas.forEach((oc: any) => contarMatch(oc.cliente_ruc, oc.nro_factura, oc.numero, oc.cliente_nombre, 'Compra'))
    filasServicio.forEach((os: any) => contarMatch(os.cliente_ruc, os.nro_factura, os.numero, os.cliente_nombre, 'Servicio'))

    setRastreados(set)
    setNoRastreadas(filasContabilidad.filter(f => !matchados.has(f.buscador)))
    setRastreadas(filasContabilidad
      .filter(f => matchados.has(f.buscador))
      .map(f => ({ ...f, ...matchados.get(f.buscador)! })))
    return { totalBuscador: set.size, totalOrdenes: filas.length + filasServicio.length, coincidencias }
  }

  const handleImportarContabilidadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const XLSX = await import('xlsx')
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportando(true)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
      const filasArchivo = extraerFilasContabilidad(rows)

      // Se guarda (upsert por BUSCADOR) en vez de comparar solo con lo del archivo
      // recién leído: así, si el mismo archivo (u otro que se solape) se vuelve a
      // importar más adelante, no se duplica nada — se actualiza la fila existente
      // y la comparación sigue usando el acumulado histórico completo.
      const { data: resultadoImport } = await api.post('/contabilidad-importada/importar', {
        archivo: file.name,
        filas: filasArchivo.map(f => ({ ...f, fecha: excelSerialAIso(f.fecha) })),
      })

      const { data: acumulado } = await api.get('/contabilidad-importada')
      const filasContabilidad: FilaContabilidad[] = (acumulado?.data || []).map((f: any) => ({
        buscador: f.buscador, proveedor: f.proveedor || '', fecha: f.fecha || '', monto: f.monto ?? '', glosa: f.glosa || '',
        fecha_rastreo: f.fecha_actualizacion || f.fecha_importacion || null,
      }))
      const resultado = await compararConOrdenes(filasContabilidad)

      setArchivoContabilidad({
        nombre: file.name, ...resultado,
        nuevos: resultadoImport.nuevos, actualizados: resultadoImport.actualizados, autoCorregidos: resultadoImport.autoCorregidos || 0,
      })
      qc.invalidateQueries({ queryKey: ['contabilidad-importada'] })
      setModalResultadoOpen(true)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'Error al leer el archivo Excel')
    } finally {
      setImportando(false)
    }
  }

  const handleVerRastreados = async () => {
    if (rastreadas.length) { setModalRastreadasOpen(true); return }
    setImportando(true)
    try {
      const { data: acumulado } = await api.get('/contabilidad-importada')
      const filasContabilidad: FilaContabilidad[] = (acumulado?.data || []).map((f: any) => ({
        buscador: f.buscador, proveedor: f.proveedor || '', fecha: f.fecha || '', monto: f.monto ?? '', glosa: f.glosa || '',
        fecha_rastreo: f.fecha_actualizacion || f.fecha_importacion || null,
      }))
      if (!filasContabilidad.length) { toast.error('Todavía no se importó ningún archivo de contabilidad'); return }
      await compararConOrdenes(filasContabilidad)
      setModalRastreadasOpen(true)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'Error al calcular los rastreados')
    } finally {
      setImportando(false)
    }
  }

  const handleLimpiarContabilidad = () => { setRastreados(null); setArchivoContabilidad(null); setNoRastreadas([]); setRastreadas([]) }

  const handleExportarComparacion = async () => {
    if (!archivoContabilidad) return
    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      wb.creator = 'KardexERP 2026'
      wb.created = new Date()

      const wsResumen = wb.addWorksheet('Resumen')
      wsResumen.columns = [{ header: 'Indicador', key: 'k', width: 30 }, { header: 'Valor', key: 'v', width: 40 }]
      wsResumen.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      })
      wsResumen.addRow({ k: 'Archivo', v: archivoContabilidad.nombre })
      wsResumen.addRow({ k: 'Filas en BUSCADOR', v: archivoContabilidad.totalBuscador })
      wsResumen.addRow({ k: 'Órdenes comparadas (compra + servicio)', v: archivoContabilidad.totalOrdenes })
      wsResumen.addRow({ k: 'Coincidencias (RASTREADO)', v: archivoContabilidad.coincidencias })
      wsResumen.addRow({ k: 'Sin rastrear', v: noRastreadas.length })

      const wsSinRastrear = wb.addWorksheet('Sin Rastrear')
      wsSinRastrear.columns = [
        { header: 'BUSCADOR', key: 'buscador', width: 26 },
        { header: 'Proveedor', key: 'proveedor', width: 32 },
        { header: 'Fecha', key: 'fecha', width: 14 },
        { header: 'Monto', key: 'monto', width: 14 },
        { header: 'Glosa', key: 'glosa', width: 30 },
      ]
      wsSinRastrear.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      })
      noRastreadas.forEach(f => {
        wsSinRastrear.addRow({
          buscador: f.buscador,
          proveedor: f.proveedor,
          fecha: fmtFechaExcel(f.fecha),
          monto: f.monto !== '' ? Number(f.monto) : '',
          glosa: f.glosa,
        })
      })

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `comparacion_contabilidad_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Excel exportado correctamente')
    } catch (err) {
      console.error(err)
      toast.error('Error al exportar el Excel')
    }
  }

  // Scroll infinito: cada página se agrega al final de "pages" en vez de
  // reemplazar el resultado, así se puede seguir buscando/ordenando sobre todo lo
  // ya cargado sin perder el scroll ni tener que ir apretando "Siguiente".
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['control-facturas', search],
    queryFn: ({ pageParam }) => api.get('/ordenes-compra', { params: { search: search || undefined, limit: PAGE_SIZE, page: pageParam } }).then(r => r.data),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const cargados = allPages.reduce((s, p) => s + (p.data?.length || 0), 0)
      return cargados < (lastPage.total || 0) ? allPages.length + 1 : undefined
    },
    placeholderData: keepPreviousData,
  })

  const totalRegistros = data?.pages?.[0]?.total ?? 0

  // Dispara la carga de la siguiente página cuando el sentinel del final de la
  // tabla entra en pantalla (scroll infinito).
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '400px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const todasLasOcs = (data?.pages || []).flatMap((p: any) => p.data || []).map((oc: any) => {
    const match = buildMatch(oc.cliente_ruc, oc.nro_factura) || ''
    const rastreado = !!(rastreados && match && rastreados.has(match.toUpperCase()))
    // El badge RASTREADO reemplaza al estado real en pantalla, así que para que el
    // ordenamiento por "Estado" agrupe los rastreados en vez de mezclarlos según su
    // estado real, se ordena por un campo aparte en vez de por "estado" tal cual.
    const estado_sort = rastreado ? `0-RASTREADO` : `1-${oc.estado || ''}`
    return { ...oc, match, url_pago: pagoUrl(oc) || '', rastreado, estado_sort }
  })
  const { sorted, sortCol, sortDir, toggle } = useSortTable(todasLasOcs, 'fecha', 'desc')
  const ocs = sorted

  const handleExportExcel = async () => {
    setExportando(true)
    try {
      const totalFilas = data?.pages?.[0]?.total || 0
      const { data: full } = await api.get('/ordenes-compra', { params: { search: search || undefined, limit: Math.max(totalFilas, 1), page: 1 } })
      const filas: any[] = full?.data || []
      if (!filas.length) { toast.error('No hay órdenes para exportar'); return }

      const { default: ExcelJS } = await import('exceljs')

      const wb = new ExcelJS.Workbook()
      wb.creator = 'KardexERP 2026'
      wb.created = new Date()

      const ws = wb.addWorksheet('Control Facturas', { views: [{ state: 'frozen', ySplit: 1 }] })
      ws.columns = [
        { header: 'N° OC', key: 'numero', width: 16 },
        { header: 'Fecha', key: 'fecha', width: 12 },
        { header: 'Proveedor', key: 'proveedor', width: 32 },
        { header: 'N° RUC', key: 'ruc', width: 14 },
        { header: 'N° Factura', key: 'factura', width: 16 },
        { header: 'Match', key: 'match', width: 26 },
        { header: 'URL', key: 'url', width: 30 },
        { header: 'Centro Costo', key: 'cc', width: 20 },
        { header: 'Total', key: 'total', width: 14 },
        { header: 'Moneda', key: 'moneda', width: 10 },
        { header: 'Almacén Central', key: 'alm_central', width: 16 },
        { header: 'Estado', key: 'estado', width: 18 },
        { header: 'Observaciones', key: 'obs', width: 30 },
      ]
      ws.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
      })
      ws.getRow(1).height = 20

      filas.forEach((oc: any) => {
        const urlPago = pagoUrl(oc)
        const match = buildMatch(oc.cliente_ruc, oc.nro_factura) || ''
        const rastreado = !!(rastreados && match && rastreados.has(match.toUpperCase()))
        const row = ws.addRow({
          numero: oc.numero,
          fecha: oc.fecha,
          proveedor: oc.cliente_nombre || '',
          ruc: oc.cliente_ruc || '',
          factura: oc.nro_factura || 'SIN FACTURA',
          match,
          url: urlPago || '',
          cc: oc.centro_costo_nombre || '',
          total: parseFloat(oc.total) || 0,
          moneda: oc.moneda,
          alm_central: oc.almacen_central === 'SI' ? 'Sí' : 'No',
          estado: rastreado ? 'RASTREADO' : oc.estado,
          obs: oc.observaciones || '',
        })
        row.getCell(9).numFmt = '#,##0.00'
        row.getCell(5).font = !oc.nro_factura && !oc.url_factura ? { color: { argb: 'FF991B1B' }, bold: true } : {}
        if (urlPago) row.getCell(7).value = { text: urlPago, hyperlink: urlPago }
        row.getCell(11).font = oc.almacen_central === 'SI' ? { color: { argb: 'FF166534' }, bold: true } : { color: { argb: 'FF991B1B' }, bold: true }
        if (rastreado) row.getCell(12).font = { color: { argb: 'FF166534' }, bold: true }
      })
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } }

      // Si hay una comparación de contabilidad cargada, se agrega en otra pestaña
      // el detalle de lo que no tiene coincidencia (mismo contenido que el modal
      // "Sin Rastrear"), para tener todo en un solo archivo.
      if (noRastreadas.length) {
        const wsSinRastrear = wb.addWorksheet('Sin Rastrear')
        wsSinRastrear.columns = [
          { header: 'BUSCADOR', key: 'buscador', width: 26 },
          { header: 'Proveedor', key: 'proveedor', width: 32 },
          { header: 'Fecha', key: 'fecha', width: 14 },
          { header: 'Monto', key: 'monto', width: 14 },
          { header: 'Glosa', key: 'glosa', width: 30 },
        ]
        wsSinRastrear.getRow(1).eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
          cell.alignment = { vertical: 'middle', horizontal: 'center' }
        })
        wsSinRastrear.getRow(1).height = 20
        noRastreadas.forEach(f => {
          wsSinRastrear.addRow({
            buscador: f.buscador,
            proveedor: f.proveedor,
            fecha: fmtFechaExcel(f.fecha),
            monto: f.monto !== '' ? Number(f.monto) : '',
            glosa: f.glosa,
          })
        })
        wsSinRastrear.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } }
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `control_facturas_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Excel exportado correctamente')
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
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar por N° de OC, proveedor, N° de factura o RUC..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
          />
        </div>
        <button
          onClick={() => sincronizarM.mutate()}
          disabled={sincronizarM.isPending}
          className={btnGreen}
          title="Traer las órdenes nuevas o actualizadas del sistema anterior"
        >
          <RefreshCw size={16} className={sincronizarM.isPending ? 'animate-spin' : ''} />
          {sincronizarM.isPending ? 'Actualizando...' : 'ACTUALIZAR'}
        </button>
        <input
          ref={fileInputContabilidadRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleImportarContabilidadFile}
        />
        <button
          className={`${btnGreen} ml-auto`}
          onClick={handleImportarContabilidadClick}
          disabled={importando}
          title='Importar Excel de Contabilidad y comparar su columna "BUSCADOR" contra Match'
        ><Upload size={16} /> {importando ? 'Comparando...' : 'Importar Contabilidad'}</button>
        <button
          className="btn-secondary bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
          onClick={handleVerRastreados}
          disabled={importando}
          title="Ver el listado de importaciones de contabilidad que ya encontraron una orden coincidente"
        >
          RASTREADOS{rastreadas.length ? ` (${rastreadas.length})` : ''}
        </button>
        {archivoContabilidad && (
          <>
            <button
              className="text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg px-3 py-1.5 truncate max-w-[260px] transition-colors"
              onClick={() => setModalResultadoOpen(true)}
              title={archivoContabilidad.nombre}
            >
              {archivoContabilidad.coincidencias} coincidencias — ver detalle
            </button>
            <button
              className={btnGreen}
              onClick={handleLimpiarContabilidad}
              title="Quitar la comparación importada"
            ><X size={16} /></button>
          </>
        )}
        <button
          className={btnGreen}
          onClick={handleExportExcel}
          disabled={exportando || !ocs.length}
          title="Exportar todas las órdenes a Excel"
        ><FileDown size={16} /> {exportando ? 'Exportando...' : 'Exportar Excel'}</button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <FileSearch size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Control de Facturas — Todas las Órdenes de Servicio y Compra</span>
          <span className="ml-auto text-sm text-slate-400">{totalRegistros} registros</span>
        </div>

        {!ocs.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableTh col="numero" label="N° OC" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="fecha" label="Fecha" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="cliente_nombre" label="Proveedor" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="match" label="Match" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="url_pago" label="URL" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="centro_costo_nombre" label="Centro Costo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="total" label="Total" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortableTh col="moneda" label="Moneda" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="almacen_central" label="Almacén Central" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="estado_sort" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                </tr>
              </thead>
              <tbody>
                {ocs.map((oc: any) => (
                  <tr key={oc.id} className={`table-row ${oc.rastreado ? 'bg-[#F3E5D3] hover:bg-[#EFDCC5]' : ''}`}>
                    <td className="table-cell font-mono text-xs font-bold">
                      <div className="flex items-center gap-1.5">
                        <span className="text-blue-700">{oc.numero}</span>
                        {oc.id_source && (
                          <a href={`${PDF_BASE}/${oc.id_source}`} target="_blank" rel="noopener noreferrer"
                             className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-sm transition-colors"
                             title="Ver PDF de OC">
                            <ExternalLink size={9} /> PDF
                          </a>
                        )}
                        {oc.url_factura && (
                          <a href={oc.url_factura} target="_blank" rel="noopener noreferrer"
                             className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-1.5 py-0.5 rounded-sm transition-colors"
                             title="Ver factura">
                            <ExternalLink size={9} /> FAC
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="table-cell text-slate-500 whitespace-nowrap">{oc.fecha}</td>
                    <td className="table-cell font-medium text-slate-900 max-w-[200px] truncate">{oc.cliente_nombre || '—'}</td>
                    <td className="table-cell text-xs font-mono font-semibold text-blue-700">{oc.match || '—'}</td>
                    <td className="table-cell text-center">
                      {oc.url_pago ? (
                        <a href={oc.url_pago} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-sm transition-colors">
                          <ExternalLink size={11} /> VER PAGO
                        </a>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="table-cell text-slate-500 max-w-[160px] truncate">{oc.centro_costo_nombre || '—'}</td>
                    <td className="table-cell text-right font-bold text-slate-900">{fmtMoneda(oc.moneda, oc.total)}</td>
                    <td className="table-cell text-center">
                      <span className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded-sm">{oc.moneda}</span>
                    </td>
                    <td className="table-cell text-center">
                      <span className={`badge ${oc.almacen_central === 'SI' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {oc.almacen_central === 'SI' ? 'SI' : 'NO'}
                      </span>
                    </td>
                    <td className="table-cell text-center">
                      {oc.rastreado ? (
                        <span className="badge bg-emerald-100 text-emerald-700 font-bold">RASTREADO</span>
                      ) : (
                        <Badge value={oc.estado === 'emitida' && (oc.nro_factura || oc.url_factura) ? 'emitida_con_factura' : oc.estado} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Scroll infinito: este div-sentinel entra en pantalla cuando el usuario
            llega al final de la lista cargada y dispara la carga de la siguiente
            página automáticamente, sin botones de "Anterior/Siguiente". */}
        <div ref={sentinelRef} className="flex items-center justify-center py-4 border-t border-slate-100">
          {isFetchingNextPage ? (
            <span className="text-sm text-slate-400">Cargando más órdenes...</span>
          ) : hasNextPage ? (
            <span className="text-xs text-slate-300">Desplázate para cargar más</span>
          ) : ocs.length > 0 ? (
            <span className="text-xs text-slate-300">Fin del listado — {totalRegistros} registros</span>
          ) : null}
        </div>
      </div>

      <Modal isOpen={modalResultadoOpen} onClose={() => setModalResultadoOpen(false)} title="Resultado de la comparación" size="sm">
        {archivoContabilidad && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-500 truncate" title={archivoContabilidad.nombre}>
              Archivo: <span className="font-medium text-slate-700">{archivoContabilidad.nombre}</span>
            </p>
            <p className="text-xs text-slate-400">
              De este archivo: <span className="font-medium text-slate-600">{archivoContabilidad.nuevos} nuevas</span>, {archivoContabilidad.actualizados} ya estaban guardadas (sin duplicar)
              {archivoContabilidad.autoCorregidos > 0 && <> — <span className="font-medium text-amber-600">{archivoContabilidad.autoCorregidos} con RUC autocorregido</span> (el archivo traía el RUC de la propia empresa)</>}
            </p>
            <div className="text-center py-4">
              <p className="text-4xl font-bold text-emerald-600">{archivoContabilidad.coincidencias}</p>
              <p className="text-sm text-slate-500 mt-1">coincidencias (RASTREADO)</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-slate-50 rounded-xl py-3">
                <p className="text-lg font-semibold text-slate-800">{archivoContabilidad.totalBuscador}</p>
                <p className="text-xs text-slate-500">filas BUSCADOR acumuladas</p>
              </div>
              <div className="bg-slate-50 rounded-xl py-3">
                <p className="text-lg font-semibold text-slate-800">{archivoContabilidad.totalOrdenes}</p>
                <p className="text-xs text-slate-500">órdenes comparadas</p>
              </div>
            </div>
            {noRastreadas.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2">Sin orden encontrada ({noRastreadas.length}):</p>
                <div className="max-h-40 overflow-y-auto border border-red-200 rounded-xl divide-y divide-red-100">
                  {noRastreadas.map(f => (
                    <div key={f.buscador} className="px-3 py-1.5 text-xs">
                      <div className="font-mono font-semibold text-red-700">{f.buscador}</div>
                      <div className="text-slate-500 truncate">{f.proveedor || '—'} · {f.glosa || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              className={`${btnGreen} w-full justify-center`}
              onClick={handleExportarComparacion}
            ><FileDown size={16} /> Exportar Excel</button>
            <div className="flex flex-wrap justify-between items-center gap-2 pt-2">
              <div className="flex gap-2">
                <button
                  className="btn-secondary bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                  onClick={() => { setModalResultadoOpen(false); setModalRastreadasOpen(true) }}
                  disabled={!rastreadas.length}
                >
                  RASTREADOS ({rastreadas.length})
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => { setModalResultadoOpen(false); setModalNoRastreadasOpen(true) }}
                  disabled={!noRastreadas.length}
                >
                  Ver no rastreadas ({noRastreadas.length})
                </button>
              </div>
              <button className="btn-primary" onClick={() => setModalResultadoOpen(false)}>Cerrar</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={modalRastreadasOpen} onClose={() => setModalRastreadasOpen(false)} title={`Rastreados (${rastreadas.length})`} size="lg">
        <div className="p-6">
          <p className="text-sm text-slate-500 mb-4">
            Filas del acumulado de contabilidad que sí encontraron una orden de compra o servicio coincidente.
          </p>
          {!rastreadas.length ? (
            <p className="text-sm text-slate-400 text-center py-8">Todavía no hay coincidencias.</p>
          ) : (
            <div className="overflow-x-auto max-h-[55vh] overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="table-header text-left">BUSCADOR</th>
                    <th className="table-header text-left">Proveedor (Contabilidad)</th>
                    <th className="table-header text-left">Orden</th>
                    <th className="table-header text-left">Tipo</th>
                    <th className="table-header text-right">Monto</th>
                    <th className="table-header text-left">Fecha de Rastreo</th>
                  </tr>
                </thead>
                <tbody>
                  {rastreadas.map(f => (
                    <tr key={f.buscador} className="border-t border-slate-100">
                      <td className="table-cell font-mono text-xs text-blue-700 font-semibold">{f.buscador}</td>
                      <td className="table-cell max-w-[180px] truncate" title={f.proveedor}>{f.proveedor || '—'}</td>
                      <td className="table-cell font-mono text-xs">{f.numero}</td>
                      <td className="table-cell">
                        <span className={`badge ${f.tipo === 'Compra' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{f.tipo}</span>
                      </td>
                      <td className="table-cell text-right">{f.monto !== '' ? Number(f.monto).toFixed(2) : '—'}</td>
                      <td className="table-cell whitespace-nowrap text-slate-500 text-xs">{fmtFechaRastreo(f.fecha_rastreo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end pt-4">
            <button className="btn-primary" onClick={() => setModalRastreadasOpen(false)}>Cerrar</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={modalNoRastreadasOpen} onClose={() => setModalNoRastreadasOpen(false)} title={`Sin rastrear (${noRastreadas.length})`} size="lg">
        <div className="p-6">
          <p className="text-sm text-slate-500 mb-4">
            Filas del archivo{archivoContabilidad ? ` "${archivoContabilidad.nombre}"` : ''} cuyo BUSCADOR no coincide con ninguna orden del sistema.
          </p>
          {!noRastreadas.length ? (
            <p className="text-sm text-slate-400 text-center py-8">Todas las filas del archivo tienen coincidencia.</p>
          ) : (
            <div className="overflow-x-auto max-h-[55vh] overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="table-header text-left">BUSCADOR</th>
                    <th className="table-header text-left">Proveedor</th>
                    <th className="table-header text-left">Fecha</th>
                    <th className="table-header text-right">Monto</th>
                    <th className="table-header text-left">Glosa</th>
                    <th className="table-header text-left">Fecha de Rastreo</th>
                  </tr>
                </thead>
                <tbody>
                  {noRastreadas.map(f => (
                    <tr key={f.buscador} className="border-t border-slate-100">
                      <td className="table-cell font-mono text-xs text-slate-700">{f.buscador}</td>
                      <td className="table-cell max-w-[180px] truncate" title={f.proveedor}>{f.proveedor || '—'}</td>
                      <td className="table-cell whitespace-nowrap">{fmtFechaExcel(f.fecha)}</td>
                      <td className="table-cell text-right">{f.monto !== '' ? Number(f.monto).toFixed(2) : '—'}</td>
                      <td className="table-cell max-w-[200px] truncate" title={f.glosa}>{f.glosa || '—'}</td>
                      <td className="table-cell whitespace-nowrap text-slate-500 text-xs">{fmtFechaRastreo(f.fecha_rastreo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end pt-4">
            <button className="btn-primary" onClick={() => setModalNoRastreadasOpen(false)}>Cerrar</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
