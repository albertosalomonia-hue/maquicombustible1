'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Scale, RefreshCw, Download, ArrowLeftRight, LogOut, PackagePlus, MapPin, ChevronDown, ChevronUp } from 'lucide-react'
import api from '../../services/api'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'

const n2 = (n: any) => n == null ? '—' : parseFloat(String(n)).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
const fdt = (f: any) => f ? String(f).slice(0, 10).split('-').reverse().join('/') : '—'

type Movimiento = {
  tipo: 'transferencia' | 'salida'
  numero: string
  fecha: string
  detalle: string
  centro_costo?: string | null
  cantidad: number
  queda: number
}
type Factura = {
  id: number
  factura: string | null
  oc: string
  recepcion: string
  fecha_recepcion: string
  almacen_recepcion: string
  sku: string
  producto: string
  unidad: string | null
  recibido: number
  transferido: number
  salido: number
  queda: number
  ubicacion: { almacen: string; cantidad: number }[]
  movimientos: Movimiento[]
}

const nombreFactura = (f: Factura) => f.factura || `Sin factura (${f.recepcion})`

export default function FacturasVsStockPage() {
  const [texto, setTexto] = useState('')
  const [soloSaldo, setSoloSaldo] = useState(false)
  const [abiertas, setAbiertas] = useState<Set<number>>(new Set())
  const alternar = (id: number) => setAbiertas(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['reporte-facturas-vs-stock'],
    queryFn: () => api.get('/reportes/facturas-vs-stock').then(r => r.data),
  })

  const todas: Factura[] = data?.data || []
  const resumen = data?.resumen

  const filtradas = todas.filter(f => {
    if (soloSaldo && f.queda <= 0.00005) return false
    if (texto) {
      const t = texto.toLowerCase()
      if (![nombreFactura(f), f.producto, f.sku, f.recepcion, f.oc].some(c => c?.toLowerCase().includes(t))) return false
    }
    return true
  })

  const exportar = async () => {
    const XLSX = await import('xlsx')
    const filas: any[] = []
    for (const f of filtradas) {
      filas.push({ 'Factura': nombreFactura(f), 'Recepción': f.recepcion, 'Producto': f.producto, 'Movimiento': 'INGRESO', 'Documento': f.recepcion, 'Detalle': `Ingreso a ${f.almacen_recepcion}`, 'Fecha': fdt(f.fecha_recepcion), 'Cantidad': f.recibido, 'Queda': f.recibido })
      for (const m of f.movimientos) {
        filas.push({ 'Factura': nombreFactura(f), 'Recepción': f.recepcion, 'Producto': f.producto, 'Movimiento': m.tipo === 'salida' ? 'SALIDA' : 'TRANSFERENCIA', 'Documento': m.numero, 'Detalle': m.detalle, 'Fecha': fdt(m.fecha), 'Cantidad': m.tipo === 'salida' ? -m.cantidad : m.cantidad, 'Queda': m.queda })
      }
    }
    const ws = XLSX.utils.json_to_sheet(filas)
    ws['!cols'] = [22, 16, 28, 14, 18, 30, 12, 10, 10].map(wch => ({ wch }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Facturas vs Stock')
    XLSX.writeFile(wb, `facturas_vs_stock_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-100 rounded-xl">
            <Scale size={22} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Facturas vs Stock</h1>
            <p className="text-xs text-slate-400 mt-0.5">Por cada factura de reserva: lo recibido, sus salidas y transferencias, y cuánto queda</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button className="btn-primary" onClick={exportar} disabled={!filtradas.length}>
            <Download size={15} /> Exportar Excel
          </button>
        </div>
      </div>

      {resumen && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card text-center p-4">
            <p className="text-2xl font-bold text-slate-800">{resumen.facturas}</p>
            <p className="text-xs text-slate-400 mt-1">Facturas ({resumen.con_saldo} con saldo)</p>
          </div>
          <div className="card text-center p-4">
            <p className="text-2xl font-bold text-blue-700">{n2(resumen.recibido)}</p>
            <p className="text-xs text-slate-400 mt-1">Recibido</p>
          </div>
          <div className="card text-center p-4">
            <p className="text-2xl font-bold text-red-600">{n2(resumen.salido)}</p>
            <p className="text-xs text-slate-400 mt-1">Salidas</p>
          </div>
          <div className="card text-center p-4">
            <p className="text-2xl font-bold text-emerald-700">{n2(resumen.queda)}</p>
            <p className="text-xs text-slate-400 mt-1">Queda</p>
          </div>
        </div>
      )}

      <div className="flex gap-3 flex-wrap items-center">
        <input
          className="input flex-1 min-w-[220px]"
          placeholder="Buscar por N° de factura, producto, recepción u OC..."
          value={texto}
          onChange={e => setTexto(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={soloSaldo} onChange={e => setSoloSaldo(e.target.checked)} />
          Solo con saldo
        </label>
      </div>

      {!filtradas.length ? <EmptyState /> : (
        <div className="space-y-2">
          {filtradas.map(f => {
            const abierta = abiertas.has(f.id)
            const sinSaldo = f.queda <= 0.00005
            return (
              <div key={f.id} className={`card p-0 overflow-hidden ${abierta ? 'ring-1 ring-amber-300' : ''}`}>
                {/* Cabecera del acordeón: número de factura y totales */}
                <button
                  type="button"
                  onClick={() => alternar(f.id)}
                  className={`w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-slate-50 transition-colors ${abierta ? 'bg-amber-50/60' : ''}`}
                >
                  {abierta ? <ChevronUp size={18} className="text-amber-600 shrink-0" /> : <ChevronDown size={18} className="text-slate-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className={`font-mono text-sm font-bold ${f.factura ? 'text-slate-900' : 'text-slate-400'}`}>{nombreFactura(f)}</p>
                    <p className="text-xs text-slate-500 truncate">{f.producto} · {f.recepcion} · {fdt(f.fecha_recepcion)}</p>
                  </div>
                  <div className="hidden sm:block text-right w-24">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Recibido</p>
                    <p className="text-sm font-semibold text-blue-700">{n2(f.recibido)}</p>
                  </div>
                  <div className="hidden sm:block text-right w-24">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Salió</p>
                    <p className="text-sm font-semibold text-red-600">{n2(f.salido)}</p>
                  </div>
                  <div className="text-right w-24">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Queda</p>
                    <p className={`text-base font-black ${sinSaldo ? 'text-slate-400' : 'text-emerald-700'}`}>{n2(f.queda)}</p>
                  </div>
                </button>

                {/* Detalle desplegado: cuadro de movimientos */}
                {abierta && (
                  <div className="border-t border-slate-100">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="table-header text-left">Fecha</th>
                            <th className="table-header text-left">Movimiento</th>
                            <th className="table-header text-left">Documento</th>
                            <th className="table-header text-left">Detalle</th>
                            <th className="table-header text-right">Cantidad</th>
                            <th className="table-header text-right">Queda</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-slate-100">
                            <td className="table-cell text-slate-500">{fdt(f.fecha_recepcion)}</td>
                            <td className="table-cell">
                              <span className="inline-flex items-center gap-1 text-blue-700 font-semibold"><PackagePlus size={13} /> Ingreso</span>
                            </td>
                            <td className="table-cell font-mono text-xs">{f.recepcion}</td>
                            <td className="table-cell text-slate-600">Ingreso a {f.almacen_recepcion}</td>
                            <td className="table-cell text-right font-semibold text-blue-700">+{n2(f.recibido)}</td>
                            <td className="table-cell text-right font-bold">{n2(f.recibido)}</td>
                          </tr>
                          {f.movimientos.map((m, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="table-cell text-slate-500">{fdt(m.fecha)}</td>
                              <td className="table-cell">
                                {m.tipo === 'salida'
                                  ? <span className="inline-flex items-center gap-1 text-red-600 font-semibold"><LogOut size={13} /> Salida</span>
                                  : <span className="inline-flex items-center gap-1 text-purple-700 font-semibold"><ArrowLeftRight size={13} /> Transferencia</span>}
                              </td>
                              <td className="table-cell font-mono text-xs">{m.numero}</td>
                              <td className="table-cell text-slate-600">
                                {m.detalle}
                                {m.centro_costo && <span className="block text-[11px] text-slate-400">{m.centro_costo}</span>}
                              </td>
                              <td className={`table-cell text-right font-semibold ${m.tipo === 'salida' ? 'text-red-600' : 'text-purple-700'}`}>
                                {m.tipo === 'salida' ? '−' : ''}{n2(m.cantidad)}
                              </td>
                              <td className="table-cell text-right font-bold">{n2(m.queda)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center gap-2 flex-wrap text-xs">
                      <span className="inline-flex items-center gap-1 text-slate-500 font-semibold"><MapPin size={13} /> Dónde está lo que queda:</span>
                      {f.ubicacion.length === 0
                        ? <span className="text-slate-400">Nada: la factura se despachó por completo.</span>
                        : f.ubicacion.map(u => (
                          <span key={u.almacen} className="rounded-full bg-white border border-slate-200 px-2.5 py-0.5 text-slate-700">
                            {u.almacen}: <strong>{n2(u.cantidad)}</strong>
                          </span>
                        ))}
                      <span className="ml-auto text-slate-400">Las transferencias solo mueven el stock entre almacenes; el total baja con las salidas.</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
