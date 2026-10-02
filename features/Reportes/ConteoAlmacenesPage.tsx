'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Warehouse, ChevronLeft, ChevronRight, RefreshCw, Download, CheckCircle2, AlertTriangle, Circle, Save, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { PageLoader } from '../../components/ui/Spinner'

const cn = (n: any) => n == null ? '—' : parseFloat(String(n)).toFixed(4).replace(/\.?0+$/, '').replace(/\.$/, '')

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
}

type FiltroEstado = 'todos' | 'pendientes' | 'desfase' | 'igualdad'

type ConteoGuardado = {
  producto_id: number
  almacen_id: number
  cantidad_contada: number
}

function claveFila(f: { producto_id: number; almacen_id: number }) {
  return `${f.producto_id}-${f.almacen_id}`
}

export default function ConteoAlmacenesPage() {
  const qc = useQueryClient()
  const [almacenSel, setAlmacenSel] = useState<string>('')
  const [filtroTexto, setFiltroTexto] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos')
  const [borradores, setBorradores] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState<Record<string, boolean>>({})

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['reporte-saldos-inventario'],
    queryFn: () => api.get('/reportes/saldos-inventario').then(r => r.data),
  })

  const { data: conteoData, isLoading: isLoadingConteo } = useQuery({
    queryKey: ['conteo-almacenes'],
    queryFn: () => api.get('/reportes/conteo-almacenes').then(r => r.data),
  })

  const conteos = useMemo(() => {
    const mapa: Record<string, string> = {}
    for (const c of (conteoData?.data || []) as ConteoGuardado[]) {
      mapa[claveFila(c)] = String(c.cantidad_contada)
    }
    return mapa
  }, [conteoData])

  const mutation = useMutation({
    mutationFn: (payload: { producto_id: number; almacen_id: number; cantidad_contada: string }) =>
      api.post('/reportes/conteo-almacenes', payload).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conteo-almacenes'] })
    },
    onError: () => {
      toast.error('No se pudo guardar el conteo, intenta de nuevo')
    },
  })

  const todasFilas: Fila[] = data?.data || []

  const almacenes = useMemo(() => {
    const mapa = new Map<string, { nombre: string; tipo: string; total: number; contados: number; desfases: number }>()
    for (const f of todasFilas) {
      if (!mapa.has(f.almacen)) mapa.set(f.almacen, { nombre: f.almacen, tipo: f.almacen_tipo, total: 0, contados: 0, desfases: 0 })
      const a = mapa.get(f.almacen)!
      a.total++
      const valor = conteos[claveFila(f)]
      if (valor !== undefined && valor !== '') {
        a.contados++
        if (Math.abs(parseFloat(valor) - Number(f.cantidad)) > 0.009) a.desfases++
      }
    }
    return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [todasFilas, conteos])

  const filasAlmacen = useMemo(() => todasFilas.filter(f => f.almacen === almacenSel), [todasFilas, almacenSel])

  const filasFiltradas = filasAlmacen.filter(f => {
    if (filtroTexto) {
      const t = filtroTexto.toLowerCase()
      if (![f.sku, f.descripcion, f.categoria].some(c => c?.toLowerCase().includes(t))) return false
    }
    const valor = conteos[claveFila(f)]
    const contado = valor !== undefined && valor !== ''
    const desfasado = contado && Math.abs(parseFloat(valor) - Number(f.cantidad)) > 0.009
    if (filtroEstado === 'pendientes' && contado) return false
    if (filtroEstado === 'desfase' && !desfasado) return false
    if (filtroEstado === 'igualdad' && !(contado && !desfasado)) return false
    return true
  }).sort((a, b) => a.descripcion.localeCompare(b.descripcion))

  const almacenActual = almacenes.find(a => a.nombre === almacenSel)

  const exportar = async () => {
    const XLSX = await import('xlsx')
    const rows = filasAlmacen.map(f => {
      const valor = conteos[claveFila(f)]
      const contado = valor !== undefined && valor !== ''
      const conteoNum = contado ? parseFloat(valor) : null
      const desfasado = contado && Math.abs((conteoNum as number) - Number(f.cantidad)) > 0.009
      return {
        'SKU': f.sku,
        'Producto': f.descripcion,
        'Categoría': f.categoria,
        'Unidad': f.unidad || '',
        'Almacén': f.almacen,
        'Cantidad Sistema': Number(f.cantidad),
        'Conteo Físico': conteoNum ?? '',
        'Diferencia': contado ? Math.round(((conteoNum as number) - Number(f.cantidad)) * 10000) / 10000 : '',
        'Estado': !contado ? 'PENDIENTE' : (desfasado ? 'DESFASE' : 'IGUALDAD'),
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Array(9).fill({ wch: 20 })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Conteo')
    XLSX.writeFile(wb, `conteo_${almacenSel.replace(/[^a-z0-9]+/gi, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (isLoading || isLoadingConteo) return <PageLoader />

  return (
    <div className="fade-in space-y-4 -m-6 p-3 sm:p-6">
      <div className="hidden sm:flex justify-end">
        <button className="btn-secondary !px-2.5" onClick={() => refetch()} disabled={isFetching} title="Actualizar">
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {!almacenSel ? (
        /* Paso 1: elegir almacén */
        <div className="space-y-2">
          {almacenes.map(a => (
            <button
              key={a.nombre}
              onClick={() => setAlmacenSel(a.nombre)}
              className="w-full card p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
            >
              <div className="p-2 bg-blue-50 rounded-lg shrink-0">
                <Warehouse size={18} className="text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate">{a.nombre}</p>
                <p className="text-xs text-slate-400">{a.tipo} · {a.total} ítems</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${a.contados === a.total ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {a.contados}/{a.total}
                </span>
                {a.desfases > 0 && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{a.desfases} desfase{a.desfases > 1 ? 's' : ''}</span>
                )}
              </div>
              <ChevronRight size={18} className="text-slate-300 shrink-0" />
            </button>
          ))}
          {!almacenes.length && (
            <div className="card p-8 text-center text-slate-400 text-sm">No hay almacenes con stock para contar</div>
          )}
        </div>
      ) : (
        /* Paso 2: contar productos del almacén elegido */
        <div className="space-y-3">
          <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur -mx-3 sm:-mx-6 px-3 sm:px-6 pt-1 pb-2 space-y-2 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <button className="btn-secondary !px-2.5 shrink-0" onClick={() => { setAlmacenSel(''); setFiltroTexto(''); setFiltroEstado('todos') }}>
                <ChevronLeft size={16} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 truncate">{almacenSel}</p>
                <p className="text-[11px] text-slate-400">
                  {almacenActual?.contados || 0}/{almacenActual?.total || 0} contados
                  {(almacenActual?.desfases ?? 0) > 0 && <span className="text-red-600 font-semibold"> · {almacenActual?.desfases} desfase{(almacenActual?.desfases ?? 0) > 1 ? 's' : ''}</span>}
                </p>
              </div>
              <button className="hidden sm:inline-flex btn-secondary !px-2.5 shrink-0" onClick={exportar} title="Exportar Excel">
                <Download size={15} />
              </button>
            </div>

            {/* Barra de progreso */}
            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${almacenActual?.total ? (almacenActual.contados / almacenActual.total) * 100 : 0}%` }}
              />
            </div>

            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                className="input pl-9 w-full"
                placeholder="Buscar SKU o producto..."
                value={filtroTexto}
                onChange={e => setFiltroTexto(e.target.value)}
              />
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {([
                ['todos', 'Todos'],
                ['pendientes', 'Pendientes'],
                ['desfase', 'Desfase'],
                ['igualdad', 'Igualdad'],
              ] as [FiltroEstado, string][]).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setFiltroEstado(val)}
                  className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                    filtroEstado === val
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Lista de productos a contar */}
          <div className="space-y-2.5">
            {filasFiltradas.map(f => {
              const clave = claveFila(f)
              const valorGuardado = conteos[clave] ?? ''
              const draft = borradores[clave]
              const valorInput = draft !== undefined ? draft : valorGuardado
              const sinGuardar = draft !== undefined && draft !== valorGuardado

              const contado = valorInput !== ''
              const conteoNum = contado ? parseFloat(valorInput) : null
              const desfasado = contado && conteoNum !== null && !isNaN(conteoNum) && Math.abs(conteoNum - Number(f.cantidad)) > 0.009
              const igual = contado && conteoNum !== null && !isNaN(conteoNum) && !desfasado

              const estaGuardando = !!guardando[clave]

              const guardar = () => {
                if (estaGuardando) return
                setGuardando(prev => ({ ...prev, [clave]: true }))
                mutation.mutate(
                  { producto_id: f.producto_id, almacen_id: f.almacen_id, cantidad_contada: valorInput },
                  {
                    onSuccess: () => {
                      setBorradores(prev => {
                        const next = { ...prev }
                        delete next[clave]
                        return next
                      })
                    },
                    onSettled: () => {
                      setGuardando(prev => {
                        const next = { ...prev }
                        delete next[clave]
                        return next
                      })
                    },
                  }
                )
              }

              return (
                <div
                  key={clave}
                  className={`card p-3.5 border-l-4 ${
                    !contado ? 'border-l-slate-200' : desfasado ? 'border-l-red-500 bg-red-50/30' : 'border-l-emerald-500 bg-emerald-50/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] font-bold text-blue-700">{f.sku}</p>
                      <p className="font-semibold text-slate-800 text-sm leading-tight">{f.descripcion}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{f.categoria}{f.unidad ? ` · ${f.unidad}` : ''}</p>
                    </div>
                    {!contado && <Circle size={18} className="text-slate-200 shrink-0 mt-0.5" />}
                    {igual && <CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" />}
                    {desfasado && <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">Sistema</p>
                      <p className="text-lg font-bold text-slate-700">{cn(f.cantidad)}</p>
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Conteo físico</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          className="input flex-1 text-lg font-bold text-center py-2"
                          placeholder="—"
                          value={valorInput}
                          onChange={e => setBorradores(prev => ({ ...prev, [clave]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); guardar() } }}
                        />
                        <button
                          onClick={guardar}
                          disabled={estaGuardando}
                          title="Guardar conteo"
                          className={`shrink-0 p-2.5 rounded-lg transition-colors disabled:opacity-60 ${
                            sinGuardar ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          <Save size={18} className={estaGuardando ? 'animate-pulse' : ''} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {contado && (
                    <div className="mt-2 flex items-center justify-between">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full ${
                        desfasado ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {desfasado ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                        {desfasado ? 'DESFASE' : 'IGUALDAD'}
                      </span>
                      {desfasado && conteoNum !== null && (
                        <span className="text-xs font-semibold text-red-600">
                          Dif: {conteoNum - Number(f.cantidad) > 0 ? '+' : ''}{cn(conteoNum - Number(f.cantidad))}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {!filasFiltradas.length && (
              <div className="card p-8 text-center text-slate-400 text-sm">Sin productos para los filtros seleccionados</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
