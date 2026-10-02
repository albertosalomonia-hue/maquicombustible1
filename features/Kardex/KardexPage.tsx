'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { BookOpen, Filter, Plus, Scale, Search, FileDown } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import { useAuth } from '../../context/AuthContext'

const n2 = (n: any) => parseFloat(String(n) || '0').toFixed(2)
const n4 = (n: any) => parseFloat(String(n) || '0').toFixed(4)
const S  = (n: any) => `S/ ${n2(n)}`

const TIPO_LABEL: Record<string, string> = {
  SALDO_INICIAL:     'Saldo Inicial',
  RECEPCION:         'Entrada',
  TRANSFERENCIA_IN:  'Transferencia Entrada',
  TRANSFERENCIA_OUT: 'Transferencia Salida',
  AJUSTE_POS:        'Ajuste Positivo',
  AJUSTE_NEG:        'Ajuste Negativo',
  AJUSTE_POSITIVO:   'Ajuste Positivo',
  AJUSTE_NEGATIVO:   'Ajuste Negativo',
  SALIDA_CONSUMO:    'Consumo',
  SALIDA_RESERVA:    'Salida de Reserva',
}

export default function KardexPage() {
  const qc = useQueryClient()
  const { almacenId, esSupervisor } = useAuth()
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ producto_id: '', almacen_id: almacenId ? String(almacenId) : '', fecha_desde: '', fecha_hasta: '' })
  const [ajusteModal, setAjusteModal] = useState(false)
  const [page, setPage] = useState(1)
  const [exportando, setExportando] = useState(false)

  // Por defecto, el Kardex muestra solo el período contable actual (el día siguiente al
  // último cierre en adelante) en vez de todo el historial completo.
  const { data: estadoPeriodo } = useQuery({
    queryKey: ['cierres-periodo-estado'],
    queryFn: () => api.get('/cierres-periodo/estado').then(r => r.data),
  })
  const inicioPeriodoActual = (() => {
    if (!estadoPeriodo?.fecha_limite) return null
    const d = new Date(`${estadoPeriodo.fecha_limite}T00:00:00`)
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })()
  useEffect(() => {
    if (!inicioPeriodoActual) return
    setFilters(f => (f.fecha_desde ? f : { ...f, fecha_desde: inicioPeriodoActual }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicioPeriodoActual])

  const handleSearchChange = (v: string) => { setSearch(v); setPage(1) }

  const params: Record<string, any> = { ...filters, search, page, limit: 100 }
  // Si el usuario tiene almacén forzado, siempre se aplica aunque el select diga ''
  if (almacenId && !esSupervisor) params.almacen_id = String(almacenId)

  const { data, isLoading } = useQuery({
    queryKey: ['kardex', params],
    queryFn: () => api.get('/kardex', { params }).then(r => r.data),
    placeholderData: keepPreviousData,
  })
  const { data: catalogo } = useQuery({ queryKey: ['catalogo'], queryFn: () => api.get('/productos/catalogo').then(r => r.data) })
  const { data: almacenes } = useQuery({ queryKey: ['almacenes'], queryFn: () => api.get('/almacenes').then(r => r.data) })

  const { register: ajReg, handleSubmit: ajSubmit, reset: ajReset, formState: { isSubmitting } } = useForm()

  const ajusteMutation = useMutation({
    mutationFn: (d: any) => api.post('/kardex/ajuste', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kardex'] })
      qc.invalidateQueries({ queryKey: ['inventario-multi'] })
      toast.success('Ajuste registrado correctamente')
      setAjusteModal(false); ajReset()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al registrar ajuste'),
  })

  const handleExportExcel = async () => {
    setExportando(true)
    try {
      const totalFilas = data?.total || 0
      const { data: full } = await api.get('/kardex', { params: { ...params, page: 1, limit: Math.max(totalFilas, 1) } })
      const filas: any[] = full?.data || []
      if (!filas.length) { toast.error('No hay movimientos para exportar'); return }

      // Paleta acorde a la pantalla: gris oscuro (encabezado general), verde (entradas),
      // rojo (salidas), azul (saldo).
      const COLOR = {
        header: 'FF1E293B', headerText: 'FFFFFFFF',
        entrada: 'FF15803D', entradaBg: 'FFF0FDF4', entradaText: 'FF166534',
        salida: 'FFB91C1C', salidaBg: 'FFFEF2F2', salidaText: 'FF991B1B',
        saldo: 'FF1D4ED8', saldoBg: 'FFEFF6FF', saldoText: 'FF1E40AF',
        filaPar: 'FFFFFFFF', filaImpar: 'FFF8FAFC', borde: 'FFE2E8F0',
      }
      const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
      const thinBorder = { style: 'thin' as const, color: { argb: COLOR.borde } }

      const { default: ExcelJS } = await import('exceljs')

      const wb = new ExcelJS.Workbook()
      wb.creator = 'KardexERP 2026'
      wb.created = new Date()
      const ws = wb.addWorksheet('Kardex', { views: [{ state: 'frozen', ySplit: 2 }] })

      const anchosCols = [12, 16, 18, 22, 34, 18, 16, 24, 11, 11, 13, 11, 11, 13, 11, 13, 13]
      ws.columns = anchosCols.map(width => ({ width }))

      // Fila 1 y 2: encabezados agrupados
      const gruposSimples: [string, string][] = [['A', 'Fecha'], ['B', 'Documento'], ['C', 'Factura'], ['D', 'Concepto'], ['E', 'Producto'], ['F', 'Categoría'], ['G', 'SKU'], ['H', 'Almacén']]
      gruposSimples.forEach(([col, label]) => {
        ws.mergeCells(`${col}1:${col}2`)
        ws.getCell(`${col}1`).value = label
      })
      ws.mergeCells('I1:K1'); ws.getCell('I1').value = 'ENTRADAS'
      ws.mergeCells('L1:N1'); ws.getCell('L1').value = 'SALIDAS'
      ws.mergeCells('O1:Q1'); ws.getCell('O1').value = 'SALDO'
      const subEtiquetas: Record<string, string> = {
        I2: 'Cant.', J2: 'P.U.', K2: 'Total',
        L2: 'Cant.', M2: 'P.U.', N2: 'Total',
        O2: 'Cant.', P2: 'C.U. Prom.', Q2: 'Total',
      }
      Object.entries(subEtiquetas).forEach(([addr, val]) => { ws.getCell(addr).value = val })

      const headerAddrsSimples = gruposSimples.map(([col]) => `${col}1`)
      const headerAddrsEntrada = ['I1', 'J1', 'K1', 'I2', 'J2', 'K2']
      const headerAddrsSalida = ['L1', 'M1', 'N1', 'L2', 'M2', 'N2']
      const headerAddrsSaldo = ['O1', 'P1', 'Q1', 'O2', 'P2', 'Q2']
      const estiloHeader = (addr: string, bg: string) => {
        const cell = ws.getCell(addr)
        cell.fill = fill(bg)
        cell.font = { color: { argb: COLOR.headerText }, bold: true, size: 10 }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
      }
      headerAddrsSimples.forEach(a => estiloHeader(a, COLOR.header))
      headerAddrsEntrada.forEach(a => estiloHeader(a, COLOR.entrada))
      headerAddrsSalida.forEach(a => estiloHeader(a, COLOR.salida))
      headerAddrsSaldo.forEach(a => estiloHeader(a, COLOR.saldo))
      ws.getRow(1).height = 20
      ws.getRow(2).height = 18

      // Filas de datos
      filas.forEach((m, idx) => {
        const esEntrada = m.movimiento === 'entrada'
        const esSalida = m.movimiento === 'salida'
        const almacen = m.almacen_destino_nombre ? `${m.almacen_nombre} → ${m.almacen_destino_nombre}` : m.almacen_nombre
        const row = ws.addRow([
          m.fecha,
          m.numero_documento,
          m.nro_factura || '',
          TIPO_LABEL[m.tipo_documento] || m.tipo_documento.replace(/_/g, ' '),
          m.producto_descripcion || '',
          m.categoria || '',
          m.sku || '',
          almacen || '',
          esEntrada ? parseFloat(m.cantidad) : null,
          esEntrada ? parseFloat(m.costo_unitario) : null,
          esEntrada ? parseFloat(m.valor_total) : null,
          esSalida ? parseFloat(m.cantidad) : null,
          esSalida ? parseFloat(m.costo_unitario) : null,
          esSalida ? parseFloat(m.valor_total) : null,
          parseFloat(m.saldo_cantidad),
          parseFloat(m.saldo_costo_unitario),
          parseFloat(m.saldo_valor),
        ])
        const bgFila = idx % 2 === 0 ? COLOR.filaPar : COLOR.filaImpar
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.border = { bottom: thinBorder }
          cell.alignment = { vertical: 'middle', horizontal: colNumber <= 8 ? 'left' : 'right' }
          if (colNumber >= 9 && colNumber <= 11) { cell.fill = fill(esEntrada ? COLOR.entradaBg : bgFila) }
          else if (colNumber >= 12 && colNumber <= 14) { cell.fill = fill(esSalida ? COLOR.salidaBg : bgFila) }
          else if (colNumber >= 15 && colNumber <= 17) { cell.fill = fill(COLOR.saldoBg) }
          else { cell.fill = fill(bgFila) }
        })
        if (esEntrada) [9, 10, 11].forEach(c => { row.getCell(c).font = { color: { argb: COLOR.entradaText }, bold: true } })
        if (esSalida) [12, 13, 14].forEach(c => { row.getCell(c).font = { color: { argb: COLOR.salidaText }, bold: true } })
        row.getCell(15).font = { color: { argb: COLOR.saldoText } }
        row.getCell(16).font = { color: { argb: COLOR.saldoText } }
        row.getCell(17).font = { color: { argb: COLOR.saldoText }, bold: true }
        ;[10, 11, 13, 14, 16, 17].forEach(c => { row.getCell(c).numFmt = '"S/ "#,##0.00' })
        ;[9, 12, 15].forEach(c => { row.getCell(c).numFmt = '#,##0.0000' })
      })

      // Fila de totales
      const totEnt = filas.filter(m => m.movimiento === 'entrada').reduce((s, m) => s + parseFloat(m.valor_total || 0), 0)
      const totSal = filas.filter(m => m.movimiento === 'salida').reduce((s, m) => s + parseFloat(m.valor_total || 0), 0)
      const ultimoSaldoExport = filas[filas.length - 1]
      const filaTotal = ws.addRow(['', '', '', '', '', '', '', 'TOTALES', '', '', totEnt, '', '', totSal, '', '', parseFloat(ultimoSaldoExport?.saldo_valor || 0)])
      ws.mergeCells(`A${filaTotal.number}:H${filaTotal.number}`)
      filaTotal.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.fill = fill('FFF1F5F9')
        cell.font = { bold: true, size: 10 }
        cell.border = { top: { style: 'medium', color: { argb: 'FF94A3B8' } } }
        if (colNumber === 8) cell.alignment = { horizontal: 'right' }
        if ([11, 14, 17].includes(colNumber)) { cell.numFmt = '"S/ "#,##0.00'; cell.alignment = { horizontal: 'right' } }
      })

      ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 17 } }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const prodExport = (catalogo || []).find((p: any) => String(p.id) === filters.producto_id)
      const sufijo = prodExport ? `_${prodExport.sku}` : ''
      const a = document.createElement('a')
      a.href = url
      a.download = `kardex${sufijo}_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      toast.error('Error al exportar el Kardex')
    } finally {
      setExportando(false)
    }
  }

  if (isLoading) return <PageLoader />
  const movimientos: any[] = data?.data || []
  const total = data?.total || 0

  const productoSeleccionado = (catalogo || []).find((p: any) => String(p.id) === filters.producto_id)
  const almacenSeleccionado  = (almacenes  || []).find((a: any) => String(a.id) === filters.almacen_id)

  const ultimoSaldo = movimientos.length ? movimientos[movimientos.length - 1] : null

  const thBase = 'px-3 py-2 text-xs font-semibold text-slate-600 text-right bg-slate-50 border-b border-slate-200 whitespace-nowrap'
  const thL    = 'px-3 py-2 text-xs font-semibold text-slate-600 text-left  bg-slate-50 border-b border-slate-200 whitespace-nowrap'
  const tdBase = 'px-3 py-2 text-xs text-right align-middle'
  const tdL    = 'px-3 py-2 text-xs text-left  align-middle'

  return (
    <div className="fade-in space-y-5">

      {/* Búsqueda */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="Buscar por SKU, producto o número de documento..."
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
        />
      </div>

      {/* Filtros */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={16} className="text-slate-500" />
          <span className="font-semibold text-slate-900 text-sm">Filtros</span>
          {inicioPeriodoActual && (
            <span className="text-xs text-slate-400 font-normal">
              · Mostrando el período actual (desde el {inicioPeriodoActual.split('-').reverse().join('/')})
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="label">Producto</label>
            <select className="select" value={filters.producto_id}
              onChange={e => { setFilters(f => ({ ...f, producto_id: e.target.value })); setPage(1) }}>
              <option value="">Todos</option>
              {(catalogo || []).map((p: any) => <option key={p.id} value={p.id}>{p.descripcion}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Almacén</label>
            <select className="select" value={filters.almacen_id}
              disabled={!!(almacenId && !esSupervisor)}
              onChange={e => { setFilters(f => ({ ...f, almacen_id: e.target.value })); setPage(1) }}>
              <option value="">Todos</option>
              {(almacenes || []).map((a: any) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Desde</label>
            <input className="input" type="date" value={filters.fecha_desde}
              onChange={e => { setFilters(f => ({ ...f, fecha_desde: e.target.value })); setPage(1) }} />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input className="input" type="date" value={filters.fecha_hasta}
              onChange={e => { setFilters(f => ({ ...f, fecha_hasta: e.target.value })); setPage(1) }} />
          </div>
        </div>
      </div>

      {/* Encabezado tarjeta Kardex */}
      <div className="card p-0 overflow-hidden">
        {/* Header del card */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-6 py-4 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg"><BookOpen size={18} className="text-blue-600" /></div>
            <div>
              <p className="font-bold text-slate-900 text-base">
                Kardex — Método Promedio Ponderado
              </p>
              {productoSeleccionado && (
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="font-medium text-slate-700">{productoSeleccionado.descripcion}</span>
                  {almacenSeleccionado && <span> · {almacenSeleccionado.nombre}</span>}
                </p>
              )}
            </div>
          </div>
          <div className="sm:ml-auto flex items-center gap-3">
            <span className="text-sm text-slate-400">{total} movimientos</span>
            <button className="btn-secondary text-xs py-1.5" onClick={handleExportExcel} disabled={exportando || !total}>
              <FileDown size={14} /> {exportando ? 'Exportando...' : 'Exportar Excel'}
            </button>
            <button className="btn-secondary text-xs py-1.5" onClick={() => setAjusteModal(true)}>
              <Plus size={14} /> Ajuste
            </button>
          </div>
        </div>


        {!movimientos.length
          ? <EmptyState message="Sin movimientos" description="Seleccione un producto para ver su Kardex." />
          : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  {/* Encabezados agrupados */}
                  <thead>
                    {/* Fila 1: grupos */}
                    <tr className="bg-slate-100 border-b border-slate-300">
                      <th className={thL} rowSpan={2}>Fecha</th>
                      <th className={thL} rowSpan={2}>Documento</th>
                      <th className={thL} rowSpan={2}>Factura</th>
                      <th className={thL} rowSpan={2}>Concepto</th>
                      {!filters.producto_id && <th className={thL} rowSpan={2}>C.Costo</th>}
                      {!filters.producto_id && <th className={thL} rowSpan={2}>Producto</th>}
                      {!filters.producto_id && <th className={thL} rowSpan={2}>Categoría</th>}
                      {!filters.almacen_id  && <th className={thL} rowSpan={2}>Almacén</th>}
                      {/* ENTRADAS */}
                      <th colSpan={3}
                        className="px-3 py-1.5 text-xs font-bold text-green-700 bg-green-50 text-center border-b border-green-200 border-x border-green-200">
                        ENTRADAS
                      </th>
                      {/* SALIDAS */}
                      <th colSpan={3}
                        className="px-3 py-1.5 text-xs font-bold text-red-700 bg-red-50 text-center border-b border-red-200 border-x border-red-200">
                        SALIDAS
                      </th>
                      {/* SALDO */}
                      <th colSpan={3}
                        className="px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 text-center border-b border-blue-200 border-x border-blue-200">
                        SALDO
                      </th>
                    </tr>
                    {/* Fila 2: sub-columnas */}
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {/* Entradas */}
                      <th className={`${thBase} bg-green-50 border-l border-green-200`}>Cant.</th>
                      <th className={`${thBase} bg-green-50`}>P.U.</th>
                      <th className={`${thBase} bg-green-50 border-r border-green-200`}>Total</th>
                      {/* Salidas */}
                      <th className={`${thBase} bg-red-50 border-l border-red-200`}>Cant.</th>
                      <th className={`${thBase} bg-red-50`}>P.U.</th>
                      <th className={`${thBase} bg-red-50 border-r border-red-200`}>Total</th>
                      {/* Saldo */}
                      <th className={`${thBase} bg-blue-50 border-l border-blue-200`}>Cant.</th>
                      <th className={`${thBase} bg-blue-50`}>C.U. Prom.</th>
                      <th className={`${thBase} bg-blue-50 border-r border-blue-200`}>Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {movimientos.map((m: any, idx: number) => {
                      const esEntrada = m.movimiento === 'entrada'
                      const esSalida  = m.movimiento === 'salida'
                      return (
                        <tr key={m.id}
                          className={`border-b border-slate-100 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-blue-50/30`}>
                          {/* Fecha */}
                          <td className={`${tdL} text-slate-500 whitespace-nowrap`}>{m.fecha}</td>
                          {/* Documento */}
                          <td className={`${tdL}`}>
                            <p className="font-mono font-semibold text-blue-700">{m.numero_documento}</p>
                          </td>
                          {/* Factura */}
                          <td className={`${tdL}`}>
                            {m.nro_factura
                              ? <span className="font-mono text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-sm font-semibold">{m.nro_factura}</span>
                              : <span className="text-slate-300">—</span>}
                          </td>
                          {/* Concepto */}
                          <td className={`${tdL} text-slate-600`}>
                            {TIPO_LABEL[m.tipo_documento] || m.tipo_documento.replace(/_/g, ' ')}
                            {m.tipo_stock === 'reserva' && <span className="ml-1.5 rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">RESERVA</span>}
                            {/* Hacia dónde va (o de dónde viene) el movimiento */}
                            {(() => {
                              const t = m.tipo_documento
                              let texto = ''
                              if (t === 'TRANSFERENCIA_OUT') texto = `${m.almacen_nombre} → ${m.almacen_destino_nombre || '—'}`
                              else if (t === 'TRANSFERENCIA_IN') texto = `${m.almacen_destino_nombre || '—'} → ${m.almacen_nombre}`
                              else if (t === 'RECEPCION' || t === 'SALDO_INICIAL') texto = `→ ${m.almacen_nombre}`
                              else if (t === 'SALIDA_CONSUMO' || t === 'SALIDA_RESERVA') texto = m.salida_destino ? `${m.almacen_nombre} → ${m.salida_destino}` : `Sale de ${m.almacen_nombre}`
                              return texto ? <p className="text-xs font-semibold text-indigo-700">{texto}</p> : null
                            })()}
                          </td>
                          {/* C.Costo (si no hay filtro) */}
                          {!filters.producto_id && (
                            <td className={`${tdL} text-slate-500 max-w-[140px] truncate`}>{m.centro_costo_nombre || '—'}</td>
                          )}
                          {/* Producto (si no hay filtro) */}
                          {!filters.producto_id && (
                            <td className={tdL}>
                              <p className="font-medium text-slate-800 min-w-[220px]">{m.producto_descripcion}</p>
                              <p className="text-slate-400">{m.sku}</p>
                            </td>
                          )}
                          {/* Categoría (si no hay filtro) */}
                          {!filters.producto_id && (
                            <td className={`${tdL} text-slate-500 max-w-[140px] truncate`}>{m.categoria}</td>
                          )}
                          {/* Almacén (si no hay filtro) */}
                          {!filters.almacen_id && (
                            <td className={tdL}>
                              {m.almacen_destino_nombre ? (
                                <div className="flex items-center gap-1 text-xs">
                                  <span className="font-medium text-slate-700">{m.almacen_nombre}</span>
                                  <span className="text-slate-400">→</span>
                                  <span className="font-medium text-indigo-700">{m.almacen_destino_nombre}</span>
                                </div>
                              ) : (
                                <span className="text-slate-600">{m.almacen_nombre}</span>
                              )}
                            </td>
                          )}

                          {/* ── ENTRADAS ── */}
                          <td className={`${tdBase} border-l border-green-100 text-green-700 font-semibold`}>
                            {esEntrada ? n2(m.cantidad) : ''}
                          </td>
                          <td className={`${tdBase} text-green-600`}>
                            {esEntrada ? S(m.costo_unitario) : ''}
                          </td>
                          <td className={`${tdBase} border-r border-green-100 text-green-700 font-bold`}>
                            {esEntrada ? S(m.valor_total) : ''}
                          </td>

                          {/* ── SALIDAS ── */}
                          <td className={`${tdBase} border-l border-red-100 text-red-600 font-semibold`}>
                            {esSalida ? n2(m.cantidad) : ''}
                          </td>
                          <td className={`${tdBase} text-red-500`}>
                            {esSalida ? S(m.costo_unitario) : ''}
                          </td>
                          <td className={`${tdBase} border-r border-red-100 text-red-600 font-bold`}>
                            {esSalida ? S(m.valor_total) : ''}
                          </td>

                          {/* ── SALDO ── */}
                          <td className={`${tdBase} border-l border-blue-100 text-slate-800 font-semibold`}>
                            {n2(m.saldo_cantidad)}
                          </td>
                          <td className={`${tdBase} text-slate-600`}>
                            {S(m.saldo_costo_unitario)}
                          </td>
                          <td className={`${tdBase} border-r border-blue-100 text-blue-700 font-bold`}>
                            {S(m.saldo_valor)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>

                  {/* Totales */}
                  {movimientos.length > 0 && (() => {
                    const totEnt = movimientos.filter(m => m.movimiento === 'entrada').reduce((s, m) => s + parseFloat(m.valor_total || 0), 0)
                    const totSal = movimientos.filter(m => m.movimiento === 'salida').reduce((s, m) => s + parseFloat(m.valor_total || 0), 0)
                    return (
                      <tfoot>
                        <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                          <td colSpan={4 + (!filters.producto_id ? 3 : 0) + (!filters.almacen_id ? 1 : 0)}
                            className="px-3 py-2 text-xs text-slate-600 text-right">TOTALES</td>
                          <td className="px-3 py-2 text-xs text-right border-l border-green-200"></td>
                          <td className="px-3 py-2 text-xs text-right"></td>
                          <td className="px-3 py-2 text-xs text-right text-green-700 border-r border-green-200">{S(totEnt)}</td>
                          <td className="px-3 py-2 text-xs text-right border-l border-red-200"></td>
                          <td className="px-3 py-2 text-xs text-right"></td>
                          <td className="px-3 py-2 text-xs text-right text-red-600 border-r border-red-200">{S(totSal)}</td>
                          <td className="px-3 py-2 text-xs text-right border-l border-blue-200"></td>
                          <td className="px-3 py-2 text-xs text-right text-slate-600">
                            {ultimoSaldo ? S(ultimoSaldo.saldo_costo_unitario) : ''}
                          </td>
                          <td className="px-3 py-2 text-xs text-right text-blue-700 border-r border-blue-200">
                            {ultimoSaldo ? S(ultimoSaldo.saldo_valor) : ''}
                          </td>
                        </tr>
                      </tfoot>
                    )
                  })()}
                </table>
              </div>

              {/* Paginación */}
              {total > 100 && (
                <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100">
                  <p className="text-sm text-slate-500">Página {page} de {Math.ceil(total / 100)}</p>
                  <div className="flex gap-2">
                    <button className="btn-secondary py-1.5 text-xs" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
                    <button className="btn-secondary py-1.5 text-xs" disabled={page * 100 >= total} onClick={() => setPage(p => p + 1)}>Siguiente</button>
                  </div>
                </div>
              )}

              {/* Leyenda método */}
              <div className="flex items-center gap-2 px-6 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-400">
                <Scale size={12} />
                <span>Método de Valuación: <strong className="text-slate-600">Promedio Ponderado</strong> — el costo unitario del saldo se recalcula en cada entrada.</span>
              </div>
            </>
          )}
      </div>

      {/* Modal ajuste */}
      <Modal isOpen={ajusteModal} onClose={() => { setAjusteModal(false); ajReset() }} title="Ajuste de Inventario">
        <form onSubmit={ajSubmit(d => ajusteMutation.mutate(d))} className="p-6 space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-sm text-yellow-800">
            Los ajustes quedan registrados en el Kardex con auditoría completa.
          </div>
          <div>
            <label className="label">Producto *</label>
            <select className="select" {...ajReg('producto_id', { required: true })}>
              <option value="">-- Seleccionar --</option>
              {(catalogo || []).map((p: any) => <option key={p.id} value={p.id}>{p.descripcion} ({p.sku})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Almacén *</label>
            <select className="select" {...ajReg('almacen_id', { required: true })}>
              <option value="">-- Seleccionar --</option>
              {(almacenes || []).map((a: any) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Tipo *</label>
              <select className="select" {...ajReg('tipo', { required: true })}>
                <option value="positivo">Positivo (+)</option>
                <option value="negativo">Negativo (−)</option>
              </select>
            </div>
            <div>
              <label className="label">Cantidad *</label>
              <input className="input" type="number" step="0.0001" min="0.0001" {...ajReg('cantidad', { required: true })} />
            </div>
            <div>
              <label className="label">Costo Unitario</label>
              <input className="input" type="number" step="0.0001" {...ajReg('costo_unitario')} />
            </div>
          </div>
          <div>
            <label className="label">Motivo *</label>
            <input className="input" {...ajReg('motivo', { required: true })} placeholder="Conteo físico, merma, rotura..." />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setAjusteModal(false); ajReset() }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Procesando...' : 'Registrar Ajuste'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
