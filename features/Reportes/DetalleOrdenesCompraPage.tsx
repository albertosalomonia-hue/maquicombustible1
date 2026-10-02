'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../../services/api'
import { ShoppingCart, Search, Download, Building2, Package, FileText, DollarSign } from 'lucide-react'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'

const fmt = (n: number) =>
  new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 }).format(n)

const fmtNum = (n: number) =>
  new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)

const ESTADOS = ['aprobada', 'emitida', 'parcialmente_recibida', 'completada']

const ESTADO_LABEL: Record<string, string> = {
  aprobada:               'Aprobada',
  emitida:                'Emitida',
  parcialmente_recibida:  'Parc. Recibida',
  completada:             'Completada',
}

const ESTADO_CLS: Record<string, string> = {
  aprobada:              'bg-blue-100 text-blue-700',
  emitida:               'bg-amber-100 text-amber-700',
  parcialmente_recibida: 'bg-violet-100 text-violet-700',
  completada:            'bg-emerald-100 text-emerald-700',
}

export default function DetalleOrdenesCompraPage() {
  const [search, setSearch]       = useState('')
  const [filterEstado, setFilterEstado]         = useState('')
  const [filterCentral, setFilterCentral]       = useState('')

  const params: any = {}
  if (filterEstado)  params.estado         = filterEstado
  if (filterCentral) params.almacen_central = filterCentral

  const { data, isLoading } = useQuery({
    queryKey: ['reporte-detalle-oc', filterEstado, filterCentral],
    queryFn: () => api.get('/reportes/detalle-ordenes-compra', { params }).then(r => r.data),
  })

  const allRows: any[] = data?.data || []
  const resumen = data?.resumen || {}

  const rowsFiltradas = useMemo(() => {
    if (!search) return allRows
    const q = search.toLowerCase()
    return allRows.filter(r =>
      r.sku?.toLowerCase().includes(q) ||
      r.descripcion?.toLowerCase().includes(q) ||
      r.oc_numero?.toLowerCase().includes(q) ||
      r.proveedor?.toLowerCase().includes(q) ||
      r.nro_factura?.toLowerCase().includes(q)
    )
  }, [allRows, search])

  const { sorted: rows, sortCol, sortDir, toggle } = useSortTable(rowsFiltradas, '', 'asc')

  const exportarExcel = async () => {
    const XLSX = await import('xlsx')
    const sheet = rows.map(r => ({
      'N° OC':             r.oc_numero,
      'Fecha':             r.fecha ? r.fecha.slice(0, 10) : '',
      'N° Factura':        r.nro_factura || '',
      'Proveedor':         r.proveedor || '',
      'Centro Costo':      r.centro_costo || '',
      'SKU':               r.sku || '',
      'Descripción':       r.descripcion || '',
      'Cant. Pedida':      parseFloat(r.cantidad_pedida  || 0),
      'Cant. Recibida':    parseFloat(r.cantidad_recibida || 0),
      'Precio Unit.':      parseFloat(r.precio_unitario   || 0),
      'Desc. %':           parseFloat(r.descuento_pct     || 0),
      'IGV %':             parseFloat(r.igv_pct           || 0),
      'Subtotal':          parseFloat(r.subtotal          || 0),
      'Moneda':            r.moneda || 'PEN',
      'Estado':            ESTADO_LABEL[r.estado] || r.estado,
      'Almacén Central':   r.almacen_central ? 'Sí' : 'No',
    }))
    const ws = XLSX.utils.json_to_sheet(sheet)
    ws['!cols'] = [
      { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 30 }, { wch: 22 },
      { wch: 18 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
      { wch: 8 },  { wch: 8 },  { wch: 14 }, { wch: 8 },  { wch: 18 }, { wch: 16 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Detalle OC')
    XLSX.writeFile(wb, `detalle_ordenes_compra_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="fade-in space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card !p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <FileText size={18} className="text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">N° Órdenes</p>
            <p className="text-xl font-bold text-slate-900">{resumen.total_ordenes ?? 0}</p>
          </div>
        </div>
        <div className="card !p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <Package size={18} className="text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Líneas de Producto</p>
            <p className="text-xl font-bold text-slate-900">{resumen.total_lineas ?? 0}</p>
          </div>
        </div>
        <div className="card !p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
            <DollarSign size={18} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Valor Total</p>
            <p className="text-lg font-bold text-slate-900">{fmt(resumen.valor_total ?? 0)}</p>
          </div>
        </div>
        <div className="card !p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <Building2 size={18} className="text-violet-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Valor Almacén Central</p>
            <p className="text-lg font-bold text-slate-900">{fmt(resumen.valor_central ?? 0)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar por SKU, descripción, N° OC, proveedor, N° factura..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="select w-52" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS.map(e => (
            <option key={e} value={e}>{ESTADO_LABEL[e]}</option>
          ))}
        </select>
        <select className="select w-52" value={filterCentral} onChange={e => setFilterCentral(e.target.value)}>
          <option value="">Todos los almacenes</option>
          <option value="1">Solo Almacén Central</option>
        </select>
        <button onClick={exportarExcel} className="btn-secondary flex items-center gap-2 text-sm shrink-0">
          <Download size={15} />
          Exportar Excel
        </button>
      </div>

      {/* Tabla */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <ShoppingCart size={18} className="text-amber-500" />
          <span className="font-semibold text-slate-900">Productos por Órdenes de Compra</span>
          <span className="ml-auto text-sm text-slate-400">
            {rows.length} {rows.length === 1 ? 'línea' : 'líneas'}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Cargando...</div>
        ) : !rows.length ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Sin resultados</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <SortableTh col="oc_numero" label="N° OC" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="fecha" label="Fecha" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="nro_factura" label="N° Factura" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="proveedor" label="Proveedor" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="sku" label="SKU" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="descripcion" label="Descripción" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="cantidad_pedida" label="Cant. Pedida" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortableTh col="cantidad_recibida" label="Cant. Recibida" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortableTh col="precio_unitario" label="Precio Unit." sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortableTh col="subtotal" label="Subtotal" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortableTh col="estado" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="almacen_central" label="Alm. Central" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r: any) => {
                  const pedida   = parseFloat(r.cantidad_pedida   || 0)
                  const recibida = parseFloat(r.cantidad_recibida || 0)
                  const pctRec   = pedida > 0 ? Math.min(100, (recibida / pedida) * 100) : 0
                  return (
                    <tr key={r.detalle_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-blue-700 font-semibold whitespace-nowrap">
                        {r.oc_numero}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {r.fecha ? r.fecha.slice(0, 10) : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 max-w-[130px] truncate">
                        {r.nro_factura || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-[180px] truncate" title={r.proveedor}>
                        {r.proveedor || '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                        {r.sku || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-800 max-w-[240px]" title={r.descripcion}>
                        <div className="truncate">{r.descripcion}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {fmtNum(pedida)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={recibida >= pedida ? 'text-emerald-600 font-medium' : 'text-amber-600'}>
                            {fmtNum(recibida)}
                          </span>
                          {pedida > 0 && (
                            <div className="w-16 h-1 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${pctRec >= 100 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                                style={{ width: `${pctRec}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {fmt(parseFloat(r.precio_unitario || 0))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                        {fmt(parseFloat(r.subtotal || 0))}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_CLS[r.estado] || 'bg-slate-100 text-slate-600'}`}>
                          {ESTADO_LABEL[r.estado] || r.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.almacen_central ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
                            <Building2 size={11} />
                            Central
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-slate-800">
                  <td colSpan={9} className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-500">
                    Total ({rows.length} líneas)
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmt(rows.reduce((s: number, r: any) => s + parseFloat(r.subtotal || 0), 0))}
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
