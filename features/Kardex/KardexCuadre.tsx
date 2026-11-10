'use client'

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import api from '../../services/api'

const num = (n: any) => parseFloat(String(n) || '0').toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sol = (n: any) => `S/ ${num(n)}`

// Cuadro de verificación sobre el Kardex filtrado (se recalcula al cambiar fechas/almacén/producto):
//   Saldo inicial + Entradas − Inventario final = Total salidas
export default function KardexCuadre({ params }: { params: Record<string, any> }) {
  const { page: _p, limit: _l, ...filtros } = params
  const { data } = useQuery({
    queryKey: ['kardex-cuadre', filtros],
    queryFn: () => api.get('/kardex/cuadre', { params: filtros }).then(r => r.data),
    placeholderData: keepPreviousData,
  })
  if (!data?.aplica) return null

  const cuadra: boolean = data.cuadra
  const piezas: { label: string; signo?: string; d: { cantidad: number; valor: number }; color: string }[] = [
    { label: 'Saldo inicial', d: data.inicial, color: 'text-slate-800' },
    { label: 'Entradas', signo: '+', d: data.entradas, color: 'text-green-700' },
    { label: 'Inventario final', signo: '−', d: data.final, color: 'text-blue-700' },
    { label: 'Total salidas', signo: '=', d: data.salidas_calculadas, color: 'text-red-600' },
  ]

  return (
    <div className={`card p-4 border ${cuadra ? 'border-green-200 bg-green-50/30' : 'border-red-300 bg-red-50/40'}`}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {cuadra ? <CheckCircle2 size={18} className="text-green-600" /> : <AlertTriangle size={18} className="text-red-600" />}
        <p className="font-bold text-slate-900 text-sm">Cuadre del Kardex</p>
        <span className="text-xs text-slate-500">Saldo inicial + Entradas − Inventario final = Total salidas</span>
        <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${cuadra ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {cuadra ? 'CUADRA' : 'NO CUADRA'}
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {piezas.map(p => (
          <div key={p.label} className="rounded-lg bg-white border border-slate-200 px-3 py-2">
            <p className="text-[11px] text-slate-500">{p.signo && <span className="font-bold mr-1">{p.signo}</span>}{p.label}</p>
            <p className={`text-base font-bold ${p.color}`}>{num(p.d.cantidad)}</p>
            <p className="text-xs text-slate-500">{sol(p.d.valor)}</p>
          </div>
        ))}
        <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
          <p className="text-[11px] text-slate-500">Salidas registradas en el Kardex</p>
          <p className="text-base font-bold text-red-600">{num(data.salidas.cantidad)}</p>
          <p className="text-xs text-slate-500">{sol(data.salidas.valor)}</p>
          {!cuadra && (
            <p className="text-xs font-semibold text-red-600 mt-1">
              Diferencia: {num(data.diferencia.cantidad)} u. / {sol(data.diferencia.valor)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
