'use client'

import { useQuery } from '@tanstack/react-query'
import api from '../services/api'
import FluidGauge from '../components/ui/FluidGauge'
import { PageLoader } from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'

const gal = (n: number) => `${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GLN`

// Dashboard: solo medidores de tanque cilíndrico por almacén auxiliar. Para cada uno,
// el saldo de RESERVA (el de CONSUMO está oculto por el momento).
export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-gauges'],
    queryFn: () => api.get('/dashboard/gauges').then(r => r.data),
    refetchInterval: 60_000,
  })

  if (isLoading) return <PageLoader />

  const almacenes: any[] = data?.almacenes || []
  const escala: number = data?.escala || 1
  const pct = (v: number) => Math.max(0, Math.min(100, (v / escala) * 100))

  if (!almacenes.length) return <EmptyState message="Sin almacenes auxiliares" description="Crea un almacén auxiliar para ver su medidor." />

  return (
    <div className="fade-in rounded-2xl bg-[#0b3d4b] p-5 min-h-[calc(100vh-9rem)]">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {almacenes.map(a => (
          <div key={a.id} className="rounded-2xl border border-white/10 bg-black/20 p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">{a.nombre}</h3>
                <p className="text-xs text-slate-300">{a.codigo}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-300">Stock físico</p>
                <p className="text-3xl font-black leading-tight text-white">{a.fisico.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs font-semibold text-slate-300">GLN</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {/* Medidor de CONSUMO oculto por el momento: solo se trabaja con RESERVAS.
              <div className="text-center">
                <p className="mb-2 text-xs font-extrabold tracking-wide text-orange-400">CONSUMO</p>
                <FluidGauge tipo="consumo" porcentaje={pct(a.consumo)} />
                <p className="mt-2 text-sm font-bold text-orange-300">{gal(a.consumo)}</p>
              </div>
              */}
              <div className="text-center">
                <p className="mb-2 text-xs font-extrabold tracking-wide text-yellow-400">RESERVA</p>
                <FluidGauge tipo="reserva" porcentaje={pct(a.reserva)} />
                <p className="mt-2 text-sm font-bold text-yellow-300">{gal(a.reserva)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
