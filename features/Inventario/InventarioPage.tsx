'use client'

import React, { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Search, Boxes, ChevronDown, ChevronRight, AlertTriangle, Download } from 'lucide-react'
import api from '../../services/api'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'
import { useAuth } from '../../context/AuthContext'

const fmt = (n: number) => `S/ ${parseFloat(String(n) || '0').toFixed(2)}`

export default function InventarioPage() {
  const { almacenId, esSupervisor } = useAuth()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [view, setView] = useState<'inventario' | 'resumen' | 'criticos'>('inventario')
  const [filterAlmacenId, setFilterAlmacenId] = useState('')

  const { data: almacenes } = useQuery({ queryKey: ['almacenes'], queryFn: () => api.get('/almacenes').then(r => r.data) })

  const invParams: any = { search, limit: 2000 }
  if (almacenId && !esSupervisor) invParams.almacen_id = almacenId
  else if (filterAlmacenId) invParams.almacen_id = filterAlmacenId

  const almacenFiltrado = (almacenes || []).find((a: any) => String(a.id) === String(filterAlmacenId))

  const { data, isLoading } = useQuery({
    queryKey: ['inventario-multi', invParams],
    queryFn: () => api.get('/inventario', { params: invParams }).then(r => r.data),
    enabled: view === 'inventario',
    placeholderData: keepPreviousData,
  })
  const { data: resumen } = useQuery({
    queryKey: ['inventario-resumen'],
    queryFn: () => api.get('/inventario/resumen').then(r => r.data),
    enabled: view === 'resumen',
  })
  const { data: criticos } = useQuery({
    queryKey: ['inventario-criticos'],
    queryFn: () => api.get('/inventario/criticos').then(r => r.data),
    enabled: view === 'criticos',
  })

  const exportarExcel = async () => {
    const XLSX = await import('xlsx')
    const rows: any[] = []
    sortedProductos.forEach((p: any) => {
      const almacenes: any[] = p.erp_almacenes || p.almacenes || []
      if (almacenes.length === 0) {
        rows.push({
          'SKU':           p.sku,
          'Descripción':   p.descripcion,
          'Categoría':     p.categoria_nombre || '',
          'Almacén':       '',
          'Tipo Almacén':  '',
          'Stock Físico':  parseFloat(p.stock_total || 0),
          'Disponible':    parseFloat(p.disponible_total || 0),
          'Costo Prom.':   '',
          'Valor Total':   parseFloat(p.valor_total || 0),
          'Estado':        p.estado_stock || '',
        })
      } else {
        almacenes.forEach((a: any) => {
          rows.push({
            'SKU':           p.sku,
            'Descripción':   p.descripcion,
            'Categoría':     p.categoria_nombre || '',
            'Almacén':       a.almacen_nombre,
            'Tipo Almacén':  a.almacen_tipo || '',
            'Stock Físico':  parseFloat(a.stock_fisico || 0),
            'Disponible':    parseFloat(a.disponible || 0),
            'Costo Prom.':   parseFloat(a.costo_promedio || 0),
            'Valor Total':   parseFloat(a.valor || 0),
            'Estado':        p.estado_stock || '',
          })
        })
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 22 }, { wch: 40 }, { wch: 20 }, { wch: 22 }, { wch: 14 },
                   { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
    XLSX.writeFile(wb, `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const productos = data?.data || []
  const { sorted: sortedProductos, sortCol: invSortCol, sortDir: invSortDir, toggle: invToggle } = useSortTable(productos, 'descripcion', 'asc')
  const { sorted: sortedCriticos, sortCol: critSortCol, sortDir: critSortDir, toggle: critToggle } = useSortTable(criticos || [], 'disponible', 'asc')

  if (isLoading) return <PageLoader />

  const valorTotal = productos.reduce((s: number, p: any) => s + parseFloat(p.valor_total || 0), 0)

  return (
    <div className="fade-in space-y-5">
      {/* View switcher */}
      <div className="flex items-center gap-2">
        {(['inventario', 'resumen', 'criticos'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === v ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            {v === 'inventario' ? 'Inventario General' : v === 'resumen' ? 'Por Almacén' : 'Stock Crítico'}
          </button>
        ))}
      </div>

      {view === 'inventario' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="Buscar por SKU, descripción..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {esSupervisor && (
              <select className="select w-56" value={filterAlmacenId} onChange={e => { setFilterAlmacenId(e.target.value); setExpanded(new Set()) }}>
                <option value="">Todos los almacenes</option>
                {(almacenes || []).map((a: any) => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
              </select>
            )}
            <div className="card !p-3 flex items-center gap-2 text-sm shrink-0">
              <Boxes size={16} className="text-blue-500" />
              <span className="text-slate-500">Valor total:</span>
              <span className="font-bold text-slate-900">{fmt(valorTotal)}</span>
            </div>
            <button onClick={exportarExcel} className="btn-secondary flex items-center gap-2 text-sm shrink-0">
              <Download size={15} />
              Exportar Excel
            </button>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
              <Boxes size={18} className="text-blue-500" />
              <span className="font-semibold text-slate-900">Inventario Multialmacén</span>
              <span className="ml-auto text-sm text-slate-400">{productos.length} productos</span>
            </div>
            {!productos.length ? <EmptyState /> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header w-10"></th>
                      <SortableTh col="sku" label="SKU" sortCol={invSortCol} sortDir={invSortDir} onSort={invToggle} />
                      <SortableTh col="centro_costo_nombre" label="C.Costo" sortCol={invSortCol} sortDir={invSortDir} onSort={invToggle} />
                      <SortableTh col="descripcion" label="Descripción" sortCol={invSortCol} sortDir={invSortDir} onSort={invToggle} />
                      <SortableTh col="categoria_nombre" label="Categoría" sortCol={invSortCol} sortDir={invSortDir} onSort={invToggle} />
                      <th className="table-header text-left">Almacén</th>
                      <SortableTh col="stock_total" label="Stock" sortCol={invSortCol} sortDir={invSortDir} onSort={invToggle} align="right" />
                      <SortableTh col="disponible_total" label="Disponible" sortCol={invSortCol} sortDir={invSortDir} onSort={invToggle} align="right" />
                      <SortableTh col="valor_total" label="Valor Total" sortCol={invSortCol} sortDir={invSortDir} onSort={invToggle} align="right" />
                      <SortableTh col="estado_stock" label="Estado" sortCol={invSortCol} sortDir={invSortDir} onSort={invToggle} align="center" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProductos.map((p: any) => (
                      <React.Fragment key={p.id}>
                        <tr className={`table-row cursor-pointer ${expanded.has(p.id) ? 'bg-blue-50/50' : ''}`} onClick={() => toggle(p.id)}>
                          <td className="table-cell text-center text-slate-400">
                            {expanded.has(p.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </td>
                          <td className="table-cell font-mono text-xs font-medium text-slate-700">{p.sku}</td>
                          <td className="table-cell text-xs text-slate-500 max-w-[140px] truncate">{p.centro_costo_nombre || '—'}</td>
                          <td className="table-cell font-medium text-slate-900">{p.descripcion}</td>
                          <td className="table-cell text-xs text-slate-400">{p.categoria_nombre || '-'}</td>
                          <td className="table-cell">
                            {filterAlmacenId && almacenFiltrado ? (
                              <div className="flex items-center gap-1.5">
                                <Badge value={almacenFiltrado.tipo} />
                                <span className="text-xs font-medium text-slate-700">{almacenFiltrado.nombre}</span>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {(p.erp_almacenes || p.almacenes || []).slice(0, 2).map((a: any) => (
                                  <span key={a.almacen_id} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm font-medium">{a.almacen_nombre}</span>
                                ))}
                                {(p.erp_almacenes || p.almacenes || []).length > 2 && (
                                  <span className="text-[10px] text-slate-400">+{(p.erp_almacenes || p.almacenes || []).length - 2}</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="table-cell text-right">{parseFloat(p.stock_total || 0).toFixed(2)} <span className="text-xs text-slate-400">{p.unidad}</span></td>
                          <td className="table-cell text-right font-medium">
                            <span className={parseFloat(p.disponible_total || 0) <= 0 ? 'text-red-600' : ''}>{parseFloat(p.disponible_total || 0).toFixed(2)}</span>
                          </td>
                          <td className="table-cell text-right font-bold text-blue-600">{fmt(p.valor_total)}</td>
                          <td className="table-cell text-center"><Badge value={p.estado_stock} /></td>
                        </tr>
                        {expanded.has(p.id) && (p.erp_almacenes || []).map((a: any) => (
                          <tr key={`${p.id}-${a.almacen_id}`} className="bg-slate-50 border-b border-slate-100">
                            <td className="px-4 py-2 text-xs text-slate-300 text-center">└</td>
                            <td colSpan={4}></td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-1.5">
                                <Badge value={a.almacen_tipo} />
                                <span className="text-xs font-medium text-slate-700">{a.almacen_nombre}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-right text-sm">{parseFloat(a.stock_fisico || 0).toFixed(2)}</td>
                            <td className="px-4 py-2 text-right text-sm text-green-600">{parseFloat(a.disponible || 0).toFixed(2)}</td>
                            <td className="px-4 py-2 text-right text-sm text-slate-600">{fmt(a.valor)}</td>
                            <td className="px-4 py-2 text-center text-xs text-slate-400">C.P.: S/{parseFloat(a.costo_promedio || 0).toFixed(4)}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {view === 'resumen' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {(resumen || []).map((a: any) => (
            <div key={a.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-slate-900">{a.nombre}</p>
                  <Badge value={a.tipo} className="mt-1" />
                </div>
              </div>
              <div className="space-y-2 text-sm mt-4">
                <div className="flex justify-between"><span className="text-slate-500">Productos</span><span className="font-medium">{a.total_productos}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Stock total</span><span className="font-medium">{parseFloat(a.stock_total || 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Valor total</span><span className="font-bold text-blue-600">{fmt(a.valor_total)}</span></div>
                {parseInt(a.productos_criticos) > 0 && (
                  <div className="flex items-center gap-1 text-red-600 text-xs mt-2 pt-2 border-t border-slate-100">
                    <AlertTriangle size={14} />
                    <span>{a.productos_criticos} producto(s) con stock crítico</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'criticos' && (
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
            <AlertTriangle size={18} className="text-red-500" />
            <span className="font-semibold text-slate-900">Productos con Stock Crítico</span>
          </div>
          {!(criticos || []).length ? (
            <EmptyState message="Sin productos críticos" description="Todos los productos tienen stock suficiente." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <SortableTh col="sku" label="SKU" sortCol={critSortCol} sortDir={critSortDir} onSort={critToggle} />
                    <SortableTh col="descripcion" label="Producto" sortCol={critSortCol} sortDir={critSortDir} onSort={critToggle} />
                    <SortableTh col="almacen_nombre" label="Almacén" sortCol={critSortCol} sortDir={critSortDir} onSort={critToggle} />
                    <SortableTh col="disponible" label="Disponible" sortCol={critSortCol} sortDir={critSortDir} onSort={critToggle} align="right" />
                    <SortableTh col="stock_minimo" label="Stock Mínimo" sortCol={critSortCol} sortDir={critSortDir} onSort={critToggle} align="right" />
                    <SortableTh col="punto_reposicion" label="Punto Repo." sortCol={critSortCol} sortDir={critSortDir} onSort={critToggle} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortedCriticos.map((c: any, i: number) => (
                    <tr key={i} className="table-row">
                      <td className="table-cell font-mono text-xs">{c.sku}</td>
                      <td className="table-cell font-medium text-slate-900">{c.descripcion}</td>
                      <td className="table-cell text-slate-500">{c.almacen_nombre}</td>
                      <td className="table-cell text-right font-bold text-red-600">{parseFloat(c.disponible || 0).toFixed(2)} {c.unidad}</td>
                      <td className="table-cell text-right text-slate-500">{c.stock_minimo}</td>
                      <td className="table-cell text-right text-slate-500">{c.punto_reposicion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
