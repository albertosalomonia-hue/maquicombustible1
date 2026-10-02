'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Layers, Search, Download, RefreshCw, ChevronDown, ChevronUp, Package, Building2, DollarSign } from 'lucide-react'
import api from '../../services/api'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'

type Obra = {
  centro_costo_id: number | null
  obra: string
  nivel1: string
  meses: Record<string, { cantidad: number; valor: number }>
  total_cantidad: number
  total_valor: number
}
type Item = {
  producto_id: number
  sku: string
  descripcion: string
  unidad: string | null
  obras: Obra[]
  total_cantidad: number
  total_valor: number
}
type Familia = {
  familia: string
  items: Item[]
  total_cantidad: number
  total_valor: number
}

const n2 = (n: number) => new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n || 0)
const S  = (n: number) => `S/ ${new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)}`
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const labelPeriodo = (p: string) => {
  const [y, m] = p.split('-')
  return `${MESES[parseInt(m, 10) - 1]} ${y}`
}

export default function SalidasPorFamiliaPage() {
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [familiaSel, setFamiliaSel] = useState('')
  const [nivel1Sel, setNivel1Sel] = useState('')
  const [obraSel, setObraSel] = useState('')
  const [search, setSearch] = useState('')
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [exportando, setExportando] = useState(false)

  const params: any = {}
  if (fechaDesde) params.fecha_desde = fechaDesde
  if (fechaHasta) params.fecha_hasta = fechaHasta

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['reporte-salidas-por-familia', fechaDesde, fechaHasta],
    queryFn: () => api.get('/reportes/salidas-por-familia', { params }).then(r => r.data),
  })

  const periodos: string[] = data?.periodos || []
  const todasFamilias: Familia[] = data?.familias || []

  const familiasOpciones = useMemo(() => todasFamilias.map(f => f.familia), [todasFamilias])
  const nivel1Opciones = useMemo(() => {
    const set = new Set<string>()
    todasFamilias.forEach(f => f.items.forEach(i => i.obras.forEach(o => set.add(o.nivel1))))
    return [...set].sort()
  }, [todasFamilias])
  const obrasOpciones = useMemo(() => {
    const set = new Set<string>()
    todasFamilias.forEach(f => f.items.forEach(i => i.obras.forEach(o => {
      if (!nivel1Sel || o.nivel1 === nivel1Sel) set.add(o.obra)
    })))
    return [...set].sort()
  }, [todasFamilias, nivel1Sel])

  // Filtro de familia/nivel1/obra/texto se aplica en el navegador: los datos ya vienen
  // agrupados desde el backend, y recortar sobre esa estructura anidada evita ida y vuelta
  // al servidor por cada cambio de filtro.
  const familias = useMemo(() => {
    const q = search.trim().toLowerCase()
    return todasFamilias
      .filter(f => !familiaSel || f.familia === familiaSel)
      .map(f => {
        const items = f.items
          .map(item => ({
            ...item,
            obras: item.obras.filter(o => (!nivel1Sel || o.nivel1 === nivel1Sel) && (!obraSel || o.obra === obraSel)),
          }))
          .filter(item => {
            if (!item.obras.length) return false
            if (!q) return true
            return item.sku?.toLowerCase().includes(q) || item.descripcion?.toLowerCase().includes(q) ||
              item.obras.some(o => o.obra.toLowerCase().includes(q) || o.nivel1.toLowerCase().includes(q))
          })
        return { ...f, items }
      })
      .filter(f => f.items.length > 0)
  }, [todasFamilias, familiaSel, nivel1Sel, obraSel, search])

  const totalesVisibles = useMemo(() => {
    let cantidad = 0, valor = 0, items = 0
    const obrasSet = new Set<string>()
    familias.forEach(f => f.items.forEach(i => {
      items++
      i.obras.forEach(o => { cantidad += o.total_cantidad; valor += o.total_valor; obrasSet.add(o.obra) })
    }))
    return { cantidad, valor, items, obras: obrasSet.size, familias: familias.length }
  }, [familias])

  const toggle = (familia: string) => setExpandidas(prev => {
    const next = new Set(prev)
    next.has(familia) ? next.delete(familia) : next.add(familia)
    return next
  })
  const expandirTodo = () => setExpandidas(new Set(familias.map(f => f.familia)))
  const colapsarTodo = () => setExpandidas(new Set())

  const limpiarFiltros = () => { setFechaDesde(''); setFechaHasta(''); setFamiliaSel(''); setNivel1Sel(''); setObraSel(''); setSearch('') }
  const hayFiltros = !!(fechaDesde || fechaHasta || familiaSel || nivel1Sel || obraSel || search)

  const exportarExcel = async () => {
    if (!familias.length) return
    setExportando(true)
    try {
      const COLOR = {
        header: 'FF1E293B', familiaBg: 'FF1D4ED8', familiaText: 'FFFFFFFF',
        subheader: 'FF334155', filaPar: 'FFFFFFFF', filaImpar: 'FFF8FAFC',
        borde: 'FFE2E8F0', subtotalBg: 'FFDBEAFE', totalBg: 'FF0F172A',
      }
      const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
      const thinBorder = { style: 'thin' as const, color: { argb: COLOR.borde } }

      const { default: ExcelJS } = await import('exceljs')

      const wb = new ExcelJS.Workbook()
      wb.creator = 'KardexERP 2026'
      wb.created = new Date()
      const ws = wb.addWorksheet('Reporte por Familias', { views: [{ state: 'frozen', ySplit: 4 }] })

      const colsFijas = ['SKU', 'Producto', 'U/M', 'Nivel 1', 'Obra (Centro de Costo)']
      const colsPeriodo = periodos.map(labelPeriodo)
      const colsFinales = ['Total Cantidad', 'Total Valor (S/)']
      const totalCols = colsFijas.length + colsPeriodo.length + colsFinales.length

      // Título
      ws.mergeCells(1, 1, 1, totalCols)
      const tituloCell = ws.getCell(1, 1)
      tituloCell.value = 'REPORTE POR FAMILIAS — Salidas de Inventario por Ítem, Obra y Mes'
      tituloCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
      tituloCell.alignment = { vertical: 'middle', horizontal: 'center' }
      tituloCell.fill = fill(COLOR.header)
      ws.getRow(1).height = 26

      ws.mergeCells(2, 1, 2, totalCols)
      const subCell = ws.getCell(2, 1)
      const filtrosTxt = [
        fechaDesde ? `Desde ${fechaDesde}` : null,
        fechaHasta ? `Hasta ${fechaHasta}` : null,
        familiaSel ? `Familia: ${familiaSel}` : null,
        nivel1Sel ? `Nivel 1: ${nivel1Sel}` : null,
        obraSel ? `Obra: ${obraSel}` : null,
        search ? `Búsqueda: "${search}"` : null,
      ].filter(Boolean).join('  ·  ') || 'Sin filtros'
      subCell.value = `Generado: ${new Date().toLocaleString('es-PE')}   ·   ${filtrosTxt}`
      subCell.font = { italic: true, size: 9, color: { argb: 'FFFFFFFF' } }
      subCell.alignment = { vertical: 'middle', horizontal: 'center' }
      subCell.fill = fill(COLOR.header)
      ws.getRow(2).height = 18

      ws.getRow(3).height = 4 // separador

      // Encabezado de columnas
      const headerRow = ws.getRow(4)
      const headers = [...colsFijas, ...colsPeriodo, ...colsFinales]
      headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
      headerRow.eachCell(cell => {
        cell.fill = fill(COLOR.subheader)
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF0F172A' } } }
      })
      headerRow.height = 24

      const idxPeriodoStart = colsFijas.length + 1
      const idxTotalCant = colsFijas.length + colsPeriodo.length + 1
      const idxTotalValor = idxTotalCant + 1

      let rowNum = 5
      let grandTotalCant = 0, grandTotalValor = 0

      for (const fam of familias) {
        // Header de familia
        ws.mergeCells(rowNum, 1, rowNum, totalCols)
        const famCell = ws.getCell(rowNum, 1)
        const famTotalCant = fam.items.reduce((s, i) => s + i.obras.reduce((s2, o) => s2 + o.total_cantidad, 0), 0)
        const famTotalValor = fam.items.reduce((s, i) => s + i.obras.reduce((s2, o) => s2 + o.total_valor, 0), 0)
        famCell.value = `${fam.familia}   (${fam.items.length} ítem${fam.items.length === 1 ? '' : 's'} · ${n2(famTotalCant)} unid. · ${S(famTotalValor)})`
        famCell.font = { bold: true, color: { argb: COLOR.familiaText }, size: 11 }
        famCell.fill = fill(COLOR.familiaBg)
        famCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
        ws.getRow(rowNum).height = 20
        rowNum++

        let idxFila = 0
        for (const item of fam.items) {
          for (const obra of item.obras) {
            const row = ws.getRow(rowNum)
            row.getCell(1).value = item.sku || ''
            row.getCell(2).value = item.descripcion || ''
            row.getCell(3).value = item.unidad || ''
            row.getCell(4).value = obra.nivel1 || ''
            row.getCell(5).value = obra.obra || ''
            periodos.forEach((p, pi) => {
              const m = obra.meses[p]
              row.getCell(idxPeriodoStart + pi).value = m ? m.cantidad : null
            })
            row.getCell(idxTotalCant).value = obra.total_cantidad
            row.getCell(idxTotalValor).value = obra.total_valor

            const bg = idxFila % 2 === 0 ? COLOR.filaPar : COLOR.filaImpar
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
              cell.fill = fill(bg)
              cell.border = { bottom: thinBorder }
              cell.font = { size: 9.5 }
              cell.alignment = { vertical: 'middle', horizontal: colNumber <= 5 ? 'left' : 'right' }
            })
            row.getCell(idxTotalCant).numFmt = '#,##0.0000'
            row.getCell(idxTotalCant).font = { bold: true, size: 9.5 }
            row.getCell(idxTotalValor).numFmt = '"S/ "#,##0.00'
            row.getCell(idxTotalValor).font = { bold: true, size: 9.5, color: { argb: 'FF1D4ED8' } }
            for (let pi = 0; pi < periodos.length; pi++) {
              row.getCell(idxPeriodoStart + pi).numFmt = '#,##0.00'
            }
            idxFila++
            rowNum++
          }
        }

        // Subtotal de familia
        const subRow = ws.getRow(rowNum)
        ws.mergeCells(rowNum, 1, rowNum, idxTotalCant - 1)
        subRow.getCell(1).value = `Subtotal ${fam.familia}`
        subRow.getCell(idxTotalCant).value = famTotalCant
        subRow.getCell(idxTotalValor).value = famTotalValor
        subRow.eachCell({ includeEmpty: true }, cell => {
          cell.fill = fill(COLOR.subtotalBg)
          cell.font = { bold: true, size: 10 }
          cell.border = { top: { style: 'medium', color: { argb: 'FF93C5FD' } } }
        })
        subRow.getCell(1).alignment = { horizontal: 'right' }
        subRow.getCell(idxTotalCant).numFmt = '#,##0.0000'
        subRow.getCell(idxTotalCant).alignment = { horizontal: 'right' }
        subRow.getCell(idxTotalValor).numFmt = '"S/ "#,##0.00'
        subRow.getCell(idxTotalValor).alignment = { horizontal: 'right' }
        subRow.getCell(idxTotalValor).font = { bold: true, size: 10, color: { argb: 'FF1D4ED8' } }
        rowNum++

        grandTotalCant += famTotalCant
        grandTotalValor += famTotalValor

        rowNum++ // fila en blanco entre familias
      }

      // Total general
      ws.mergeCells(rowNum, 1, rowNum, idxTotalCant - 1)
      const totRow = ws.getRow(rowNum)
      totRow.getCell(1).value = 'TOTAL GENERAL'
      totRow.getCell(idxTotalCant).value = grandTotalCant
      totRow.getCell(idxTotalValor).value = grandTotalValor
      totRow.eachCell({ includeEmpty: true }, cell => {
        cell.fill = fill(COLOR.totalBg)
        cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
      })
      totRow.getCell(1).alignment = { horizontal: 'right' }
      totRow.getCell(idxTotalCant).numFmt = '#,##0.0000'
      totRow.getCell(idxTotalCant).alignment = { horizontal: 'right' }
      totRow.getCell(idxTotalValor).numFmt = '"S/ "#,##0.00'
      totRow.getCell(idxTotalValor).alignment = { horizontal: 'right' }
      totRow.height = 22

      // Anchos de columna
      ws.getColumn(1).width = 20
      ws.getColumn(2).width = 42
      ws.getColumn(3).width = 8
      ws.getColumn(4).width = 14
      ws.getColumn(5).width = 20
      periodos.forEach((_, pi) => { ws.getColumn(idxPeriodoStart + pi).width = 11 })
      ws.getColumn(idxTotalCant).width = 15
      ws.getColumn(idxTotalValor).width = 16

      ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: totalCols } }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reporte_por_familias_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setExportando(false)
    }
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-100 rounded-xl">
            <Layers size={22} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Reporte por Familias</h1>
            <p className="text-xs text-slate-400 mt-0.5">Salidas de inventario agrupadas por familia, ítem, obra (centro de costo) y mes</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button className="btn-primary" onClick={exportarExcel} disabled={exportando || !familias.length}>
            <Download size={15} /> {exportando ? 'Exportando...' : 'Exportar Excel'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card !p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <Layers size={18} className="text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Familias</p>
            <p className="text-xl font-bold text-slate-900">{totalesVisibles.familias}</p>
          </div>
        </div>
        <div className="card !p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <Package size={18} className="text-violet-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Ítems</p>
            <p className="text-xl font-bold text-slate-900">{totalesVisibles.items}</p>
          </div>
        </div>
        <div className="card !p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Building2 size={18} className="text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Obras (Centros de Costo)</p>
            <p className="text-xl font-bold text-slate-900">{totalesVisibles.obras}</p>
          </div>
        </div>
        <div className="card !p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
            <DollarSign size={18} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Valor Total</p>
            <p className="text-lg font-bold text-slate-900">{S(totalesVisibles.valor)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Fecha desde</label>
            <input className="input" type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
          </div>
          <div>
            <label className="label">Fecha hasta</label>
            <input className="input" type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
          </div>
          <div>
            <label className="label">Familia</label>
            <select className="select w-48" value={familiaSel} onChange={e => setFamiliaSel(e.target.value)}>
              <option value="">Todas las familias</option>
              {familiasOpciones.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Nivel 1 (Obra)</label>
            <select
              className="select w-52"
              value={nivel1Sel}
              onChange={e => { setNivel1Sel(e.target.value); setObraSel('') }}
            >
              <option value="">Todos los Nivel 1</option>
              {nivel1Opciones.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Obra (Centro de Costo)</label>
            <select className="select w-52" value={obraSel} onChange={e => setObraSel(e.target.value)}>
              <option value="">Todas las obras</option>
              {obrasOpciones.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <label className="label">Buscar</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="SKU, producto u obra..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          {hayFiltros && <button className="btn-secondary" onClick={limpiarFiltros}>Limpiar filtros</button>}
          <button className="btn-secondary" onClick={expandirTodo}>Expandir todo</button>
          <button className="btn-secondary" onClick={colapsarTodo}>Colapsar todo</button>
        </div>
      </div>

      {/* Acordeón por familia */}
      <div className="card p-0 overflow-hidden">
        {!familias.length ? (
          <EmptyState message="Sin resultados" description="No hay salidas registradas con los filtros seleccionados." />
        ) : (
          <div className="divide-y divide-slate-100">
            {familias.map(fam => {
              const isOpen = expandidas.has(fam.familia)
              const famTotalCant = fam.items.reduce((s, i) => s + i.obras.reduce((s2, o) => s2 + o.total_cantidad, 0), 0)
              const famTotalValor = fam.items.reduce((s, i) => s + i.obras.reduce((s2, o) => s2 + o.total_valor, 0), 0)
              const filas = fam.items.flatMap(item => item.obras.map(obra => ({ item, obra })))

              return (
                <div key={fam.familia}>
                  <button
                    onClick={() => toggle(fam.familia)}
                    className={`w-full flex items-center gap-3 px-6 py-3.5 text-left transition-colors ${isOpen ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}
                  >
                    {isOpen ? <ChevronUp size={15} className="text-blue-500 shrink-0" /> : <ChevronDown size={15} className="text-slate-400 shrink-0" />}
                    <span className="font-semibold text-slate-900">{fam.familia}</span>
                    <span className="text-xs font-mono bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{fam.items.length} ítems</span>
                    <span className="ml-auto flex items-center gap-4 text-xs">
                      <span className="text-slate-500">{n2(famTotalCant)} unid.</span>
                      <span className="font-bold text-blue-700">{S(famTotalValor)}</span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-5 bg-blue-50/30 border-t border-blue-100">
                      <div className="overflow-x-auto rounded-lg border border-blue-200 mt-3">
                        <table className="w-full text-[10.5px] leading-tight">
                          <thead className="bg-blue-100 sticky top-0">
                            <tr>
                              <th className="px-1.5 py-1.5 text-left font-semibold text-slate-600 uppercase tracking-wide">SKU</th>
                              <th className="px-1.5 py-1.5 text-left font-semibold text-slate-600 uppercase tracking-wide min-w-[160px]">Producto</th>
                              <th className="px-1.5 py-1.5 text-left font-semibold text-slate-600 uppercase tracking-wide">U/M</th>
                              <th className="px-1.5 py-1.5 text-left font-semibold text-slate-600 uppercase tracking-wide">Nivel 1</th>
                              <th className="px-1.5 py-1.5 text-left font-semibold text-slate-600 uppercase tracking-wide">Obra (C. Costo)</th>
                              {periodos.map(p => (
                                <th key={p} className="px-1.5 py-1.5 text-right font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">{labelPeriodo(p)}</th>
                              ))}
                              <th className="px-1.5 py-1.5 text-right font-semibold text-slate-600 uppercase tracking-wide">Total Cant.</th>
                              <th className="px-1.5 py-1.5 text-right font-semibold text-slate-600 uppercase tracking-wide">Total Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filas.map(({ item, obra }, i) => {
                              const nuevoItem = i === 0 || filas[i - 1].item.producto_id !== item.producto_id
                              return (
                                <tr key={`${item.producto_id}-${obra.centro_costo_id ?? 'sin-cc'}`}
                                    className={`border-t ${nuevoItem ? 'border-blue-200' : 'border-blue-50'} bg-white/70 hover:bg-blue-50/60`}>
                                  <td className="px-1.5 py-1 font-mono text-slate-500 whitespace-nowrap">{nuevoItem ? (item.sku || '—') : ''}</td>
                                  <td className="px-1.5 py-1 font-medium text-slate-800">{nuevoItem ? item.descripcion : ''}</td>
                                  <td className="px-1.5 py-1 text-slate-500">{nuevoItem ? (item.unidad || '—') : ''}</td>
                                  <td className="px-1.5 py-1 font-semibold text-blue-800">{obra.nivel1}</td>
                                  <td className="px-1.5 py-1 text-slate-700">{obra.obra}</td>
                                  {periodos.map(p => (
                                    <td key={p} className="px-1.5 py-1 text-right tabular-nums text-slate-600">
                                      {obra.meses[p] ? n2(obra.meses[p].cantidad) : '—'}
                                    </td>
                                  ))}
                                  <td className="px-1.5 py-1 text-right font-semibold text-slate-900">{n2(obra.total_cantidad)}</td>
                                  <td className="px-1.5 py-1 text-right font-semibold text-blue-700">{S(obra.total_valor)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="bg-blue-100 border-t-2 border-blue-300 font-bold">
                              <td colSpan={5 + periodos.length} className="px-1.5 py-1.5 text-right text-slate-700">
                                Subtotal {fam.familia}
                              </td>
                              <td className="px-1.5 py-1.5 text-right text-slate-800">{n2(famTotalCant)}</td>
                              <td className="px-1.5 py-1.5 text-right text-blue-800">{S(famTotalValor)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
