'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderTree, Search, ChevronDown, ChevronUp } from 'lucide-react'
import api from '../../services/api'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'

const SIN_FAMILIA = 'Sin familia'

// Lista los productos agrupados por su campo "familia" (sincronizado desde el
// sistema anterior — ver erp_productos.familia). No es un módulo CRUD: es un
// listado de solo lectura para ver de un vistazo qué productos caen en cada grupo.
export default function FamiliasList() {
  const [search, setSearch] = useState('')
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['productos-familias'],
    queryFn: () => api.get('/productos', { params: { limit: 5000 } }).then(r => r.data),
  })

  const grupos = useMemo(() => {
    const productos: any[] = data?.data || []
    const q = search.trim().toLowerCase()
    const filtrados = q
      ? productos.filter(p =>
          (p.familia || SIN_FAMILIA).toLowerCase().includes(q) ||
          (p.descripcion || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.codigo_interno || '').toLowerCase().includes(q)
        )
      : productos

    const mapa = new Map<string, any[]>()
    filtrados.forEach(p => {
      const familia = p.familia || SIN_FAMILIA
      if (!mapa.has(familia)) mapa.set(familia, [])
      mapa.get(familia)!.push(p)
    })

    return [...mapa.entries()]
      .map(([familia, items]) => ({ familia, items: items.sort((a, b) => (a.descripcion || '').localeCompare(b.descripcion || '')) }))
      .sort((a, b) => {
        if (a.familia === SIN_FAMILIA) return 1
        if (b.familia === SIN_FAMILIA) return -1
        return b.items.length - a.items.length
      })
  }, [data, search])

  const totalProductos = data?.data?.length || 0

  const toggle = (familia: string) => setExpandidas(prev => {
    const next = new Set(prev)
    next.has(familia) ? next.delete(familia) : next.add(familia)
    return next
  })

  const expandirTodo = () => setExpandidas(new Set(grupos.map(g => g.familia)))
  const colapsarTodo = () => setExpandidas(new Set())

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar por familia, producto o SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button className="btn-secondary" onClick={expandirTodo}>Expandir todo</button>
        <button className="btn-secondary" onClick={colapsarTodo}>Colapsar todo</button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <FolderTree size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Familias de Productos</span>
          <span className="ml-auto text-sm text-slate-400">{grupos.length} familias · {totalProductos} productos</span>
        </div>

        {!grupos.length ? <EmptyState /> : (
          <div className="divide-y divide-slate-100">
            {grupos.map(g => {
              const isOpen = expandidas.has(g.familia)
              return (
                <div key={g.familia}>
                  <button
                    onClick={() => toggle(g.familia)}
                    className={`w-full flex items-center gap-3 px-6 py-3.5 text-left transition-colors ${isOpen ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}
                  >
                    {isOpen ? <ChevronUp size={15} className="text-blue-500 shrink-0" /> : <ChevronDown size={15} className="text-slate-400 shrink-0" />}
                    <span className={`font-semibold ${g.familia === SIN_FAMILIA ? 'text-slate-400 italic' : 'text-slate-900'}`}>{g.familia}</span>
                    <span className="ml-auto text-xs font-mono bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{g.items.length}</span>
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-4 bg-orange-50/40 border-t border-orange-100">
                      <div className="overflow-x-auto rounded-lg border border-orange-200 mt-3">
                        <table className="w-full text-xs">
                          <thead className="bg-orange-100">
                            <tr>
                              <th className="table-header text-left">SKU</th>
                              <th className="table-header text-left">Código</th>
                              <th className="table-header text-left">Descripción</th>
                              <th className="table-header text-left">U/M</th>
                              <th className="table-header text-right">Precio Costo</th>
                              <th className="table-header text-center">Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.items.map((p: any) => (
                              <tr key={p.id} className="border-t border-orange-100 bg-white/60 hover:bg-orange-50/60">
                                <td className="table-cell font-mono text-slate-500">{p.sku || '—'}</td>
                                <td className="table-cell font-mono text-slate-400">{p.codigo_interno || '—'}</td>
                                <td className="table-cell font-medium text-slate-800">{p.descripcion}</td>
                                <td className="table-cell text-slate-500">{p.unidad_codigo || '—'}</td>
                                <td className="table-cell text-right text-slate-700">{parseFloat(p.precio_costo || 0).toFixed(2)}</td>
                                <td className="table-cell text-center"><Badge value={p.estado} /></td>
                              </tr>
                            ))}
                          </tbody>
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
