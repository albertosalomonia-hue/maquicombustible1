'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileBarChart2, Package, Warehouse, DollarSign, Download, RefreshCw } from 'lucide-react'
import api from '../../services/api'
import { PageLoader } from '../../components/ui/Spinner'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'

const n2 = (n: any) => n == null ? '—' : parseFloat(String(n)).toFixed(2)
const S  = (n: any) => n == null ? '—' : `S/ ${n2(n)}`
const cn = (n: any) => n == null ? '—' : parseFloat(String(n)).toFixed(4).replace(/\.?0+$/, '')

type Fila = {
  producto_id: number
  sku: string
  descripcion: string
  categoria: string
  unidad: string | null
  almacen_id: number
  almacen: string
  almacen_tipo: string
  cantidad: number
  costo_promedio: number
  valor: number
  fecha: string
}

export default function SaldosInventarioPage() {
  const [filtroAlmacen, setFiltroAlmacen] = useState('')
  const [filtroTexto, setFiltroTexto] = useState('')
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['reporte-saldos-inventario'],
    queryFn: () => api.get('/reportes/saldos-inventario').then(r => r.data),
  })

  const resumen = data?.resumen
  const todasFilas: Fila[] = data?.data || []
  const almacenes = [...new Set(todasFilas.map(f => f.almacen))].sort()

  const filasFiltradas = todasFilas.filter(f => {
    if (filtroAlmacen && f.almacen !== filtroAlmacen) return false
    if (filtroTexto) {
      const t = filtroTexto.toLowerCase()
      const campos = [f.sku, f.descripcion, f.categoria, f.almacen]
      if (!campos.some(c => c?.toLowerCase().includes(t))) return false
    }
    if (f.fecha) {
      const fechaFila = f.fecha.slice(0, 10)
      if (filtroFechaDesde && fechaFila < filtroFechaDesde) return false
      if (filtroFechaHasta && fechaFila > filtroFechaHasta) return false
    } else if (filtroFechaDesde || filtroFechaHasta) {
      return false
    }
    return true
  })

  const { sorted: filas, sortCol, sortDir, toggle } = useSortTable(filasFiltradas, 'descripcion', 'asc')

  const exportar = async () => {
    const XLSX = await import('xlsx')
    const rows = filas.map(f => ({
      'SKU':             f.sku,
      'Fecha':           f.fecha ? new Date(f.fecha).toLocaleDateString('es-PE') : '',
      'Producto':        f.descripcion,
      'Categoría':       f.categoria,
      'Unidad':          f.unidad || '',
      'Almacén':         f.almacen,
      'Cantidad':        f.cantidad,
      'Costo Promedio':  f.costo_promedio,
      'Valor':           f.valor,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Array(9).fill({ wch: 20 })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Saldos Inventario')
    XLSX.writeFile(wb, `saldos_inventario_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-100 rounded-xl">
            <FileBarChart2 size={22} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Saldos de Inventario</h1>
            <p className="text-xs text-slate-400 mt-0.5">Saldo actual de cada producto por almacén (excluye stock en 0)</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button className="btn-primary" onClick={exportar}>
            <Download size={15} /> Exportar Excel
          </button>
        </div>
      </div>

      {/* Resumen KPIs */}
      {resumen && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="card text-center p-4">
            <Package size={18} className="text-indigo-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-slate-800">{resumen.total_items}</p>
            <p className="text-xs text-slate-400 mt-1">Ítems con stock</p>
          </div>
          <div className="card text-center p-4">
            <Warehouse size={18} className="text-blue-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-blue-700">{resumen.total_almacenes}</p>
            <p className="text-xs text-slate-400 mt-1">Almacenes con stock</p>
          </div>
          <div className="card text-center p-4">
            <DollarSign size={18} className="text-emerald-500 mx-auto mb-1" />
            <p className="text-lg font-bold text-emerald-700">{S(resumen.valor_total)}</p>
            <p className="text-xs text-slate-400 mt-1">Valor total inventario</p>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Buscar por SKU, producto, categoría o almacén..."
          value={filtroTexto}
          onChange={e => setFiltroTexto(e.target.value)}
        />
        <select className="select w-52" value={filtroAlmacen} onChange={e => setFiltroAlmacen(e.target.value)}>
          <option value="">Todos los almacenes</option>
          {almacenes.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 whitespace-nowrap">Desde</label>
          <input
            type="date"
            className="input w-40"
            value={filtroFechaDesde}
            onChange={e => setFiltroFechaDesde(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 whitespace-nowrap">Hasta</label>
          <input
            type="date"
            className="input w-40"
            value={filtroFechaHasta}
            onChange={e => setFiltroFechaHasta(e.target.value)}
          />
        </div>
        {(filtroAlmacen || filtroTexto || filtroFechaDesde || filtroFechaHasta) && (
          <button className="btn-secondary" onClick={() => { setFiltroAlmacen(''); setFiltroTexto(''); setFiltroFechaDesde(''); setFiltroFechaHasta('') }}>
            Limpiar filtros
          </button>
        )}
        <span className="self-center text-sm text-slate-400">{filas.length} registros</span>
      </div>

      {/* Tabla */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <SortableTh col="sku" label="SKU" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="fecha" label="Fecha" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                <SortableTh col="descripcion" label="Producto" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="categoria" label="Categoría" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="unidad" label="Unidad" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                <SortableTh col="almacen" label="Almacén" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="cantidad" label="Cantidad" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                <SortableTh col="costo_promedio" label="Costo Prom." sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                <SortableTh col="valor" label="Valor" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.producto_id}-${f.almacen_id}`} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="table-cell font-mono font-bold text-blue-700">{f.sku}</td>
                  <td className="table-cell text-center text-slate-500 whitespace-nowrap">{f.fecha ? new Date(f.fecha).toLocaleDateString('es-PE') : '—'}</td>
                  <td className="table-cell font-medium text-slate-800 max-w-[220px] truncate" title={f.descripcion}>{f.descripcion}</td>
                  <td className="table-cell text-slate-500">{f.categoria}</td>
                  <td className="table-cell text-center text-slate-500">{f.unidad || '—'}</td>
                  <td className="table-cell text-slate-600 whitespace-nowrap">{f.almacen}</td>
                  <td className="table-cell text-right font-semibold">{cn(f.cantidad)}</td>
                  <td className="table-cell text-right">{S(f.costo_promedio)}</td>
                  <td className="table-cell text-right font-semibold text-emerald-700">{S(f.valor)}</td>
                </tr>
              ))}
              {!filas.length && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 text-sm">Sin registros para los filtros seleccionados</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                <td colSpan={6} className="px-3 py-2 text-right text-xs text-slate-600">TOTALES</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700">
                  {cn(filas.reduce((a, f) => a + (Number(f.cantidad) || 0), 0))}
                </td>
                <td />
                <td className="px-3 py-2 text-right text-xs text-emerald-700">
                  {S(filas.reduce((a, f) => a + (Number(f.valor) || 0), 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
