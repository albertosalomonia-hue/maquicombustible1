'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Undo2, PackageMinus, DollarSign, RefreshCw, Download } from 'lucide-react'
import api from '../../services/api'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'

const n2 = (n: any) => n == null ? '—' : parseFloat(String(n)).toFixed(2)
const S  = (n: any) => n == null ? '—' : `S/ ${n2(n)}`
const cn = (n: any) => n == null ? '—' : parseFloat(String(n)).toFixed(4).replace(/\.?0+$/, '')
const fdt = (f: any) => f ? new Date(f).toLocaleDateString('es-PE') : '—'
const fdtHora = (f: any) => f ? new Date(f).toLocaleString('es-PE') : '—'

type Fila = {
  auditoria_id: number
  salida_id: number
  numero: string
  fecha_salida: string
  almacen: string
  solicitante: string | null
  motivo: string | null
  sku: string
  producto: string
  unidad: string | null
  centro_costo: string | null
  placa: string | null
  cantidad: number
  costo_unitario: number
  valor_total: number
  revertido_por: string
  fecha_reversion: string
}

export default function ReversionesSalidasPage() {
  const [filtroAlmacen, setFiltroAlmacen] = useState('')
  const [filtroTexto, setFiltroTexto] = useState('')

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['reporte-reversiones-salidas'],
    queryFn: () => api.get('/reportes/reversiones-salidas').then(r => r.data),
  })

  const resumen = data?.resumen
  const todasFilas: Fila[] = data?.data || []
  const almacenes = [...new Set(todasFilas.map(f => f.almacen))].sort()

  const filasFiltradas = todasFilas.filter(f => {
    if (filtroAlmacen && f.almacen !== filtroAlmacen) return false
    if (filtroTexto) {
      const t = filtroTexto.toLowerCase()
      const campos = [f.numero, f.sku, f.producto, f.solicitante, f.almacen, f.revertido_por]
      if (!campos.some(c => c?.toLowerCase().includes(t))) return false
    }
    return true
  })

  const { sorted: filas, sortCol, sortDir, toggle } = useSortTable(filasFiltradas, 'fecha_reversion', 'desc')

  const exportar = async () => {
    const XLSX = await import('xlsx')
    const rows = filas.map(f => ({
      'N° Salida':          f.numero,
      'Fecha Salida':       f.fecha_salida,
      'Almacén':            f.almacen,
      'Solicitante':        f.solicitante || '',
      'Motivo':             f.motivo || '',
      'SKU':                f.sku,
      'Producto':           f.producto,
      'Unidad':             f.unidad || '',
      'Centro de Costo':    f.centro_costo || '',
      'Cantidad':           f.cantidad,
      'Costo Unitario':     f.costo_unitario,
      'Valor':              f.valor_total,
      'Revertido por':      f.revertido_por,
      'Fecha Reversión':    f.fecha_reversion ? new Date(f.fecha_reversion).toLocaleString('es-PE') : '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Array(14).fill({ wch: 20 })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Reversiones Salidas')
    XLSX.writeFile(wb, `reversiones_salidas_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-100 rounded-xl">
            <Undo2 size={22} className="text-red-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Reversiones de Salidas</h1>
            <p className="text-xs text-slate-400 mt-0.5">Listado de las salidas de inventario que fueron revertidas</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button className="btn-primary" onClick={exportar} disabled={!filas.length}>
            <Download size={15} /> Exportar Excel
          </button>
        </div>
      </div>

      {/* Resumen KPIs */}
      {resumen && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="card text-center p-4">
            <Undo2 size={18} className="text-red-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-slate-800">{resumen.total_reversiones}</p>
            <p className="text-xs text-slate-400 mt-1">Salidas revertidas</p>
          </div>
          <div className="card text-center p-4">
            <PackageMinus size={18} className="text-blue-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-blue-700">{resumen.total_items}</p>
            <p className="text-xs text-slate-400 mt-1">Ítems revertidos</p>
          </div>
          <div className="card text-center p-4">
            <DollarSign size={18} className="text-emerald-500 mx-auto mb-1" />
            <p className="text-lg font-bold text-emerald-700">{S(resumen.valor_total)}</p>
            <p className="text-xs text-slate-400 mt-1">Valor total revertido</p>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Buscar por N° salida, SKU, producto, solicitante, almacén o quién revirtió..."
          value={filtroTexto}
          onChange={e => setFiltroTexto(e.target.value)}
        />
        <select className="select w-52" value={filtroAlmacen} onChange={e => setFiltroAlmacen(e.target.value)}>
          <option value="">Todos los almacenes</option>
          {almacenes.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {(filtroAlmacen || filtroTexto) && (
          <button className="btn-secondary" onClick={() => { setFiltroAlmacen(''); setFiltroTexto('') }}>
            Limpiar filtros
          </button>
        )}
        <span className="self-center text-sm text-slate-400">{filas.length} registros</span>
      </div>

      {/* Tabla */}
      <div className="card p-0 overflow-hidden">
        {!filas.length ? <EmptyState message="Sin reversiones registradas" description="Todavía no se revirtió ninguna salida." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <SortableTh col="numero" label="N° Salida" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="fecha_salida" label="Fecha Salida" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="almacen" label="Almacén" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="sku" label="SKU" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="producto" label="Producto" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="centro_costo" label="C. Costo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="cantidad" label="Cantidad" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                <SortableTh col="valor_total" label="Valor" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                <SortableTh col="revertido_por" label="Revertido por" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                <SortableTh col="fecha_reversion" label="Fecha Reversión" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.auditoria_id}-${f.sku}`} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="table-cell font-mono font-bold text-red-700 whitespace-nowrap">{f.numero}</td>
                  <td className="table-cell text-slate-500 whitespace-nowrap">{fdt(f.fecha_salida)}</td>
                  <td className="table-cell text-slate-600 whitespace-nowrap">{f.almacen}</td>
                  <td className="table-cell font-mono text-blue-700">{f.sku}</td>
                  <td className="table-cell font-medium text-slate-800 max-w-[220px] truncate" title={f.producto}>{f.producto}</td>
                  <td className="table-cell text-slate-500">{f.centro_costo || '—'}</td>
                  <td className="table-cell text-right font-semibold">{cn(f.cantidad)} {f.unidad || ''}</td>
                  <td className="table-cell text-right font-semibold text-emerald-700">{S(f.valor_total)}</td>
                  <td className="table-cell text-slate-600 whitespace-nowrap">{f.revertido_por}</td>
                  <td className="table-cell text-slate-500 whitespace-nowrap">{fdtHora(f.fecha_reversion)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                <td colSpan={6} className="px-3 py-2 text-right text-xs text-slate-600">TOTALES</td>
                <td className="px-3 py-2 text-right text-xs text-slate-700">
                  {cn(filas.reduce((a, f) => a + (Number(f.cantidad) || 0), 0))}
                </td>
                <td className="px-3 py-2 text-right text-xs text-emerald-700">
                  {S(filas.reduce((a, f) => a + (Number(f.valor_total) || 0), 0))}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        )}
      </div>
    </div>
  )
}
