'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, Unlock, ShieldCheck, CalendarClock, KeyRound } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../context/ConfirmContext'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function fmtFecha(f?: string | null) {
  if (!f) return '—'
  const [y, m, d] = f.split('-')
  return `${d}/${m}/${y}`
}

// Contraseña de confirmación exigida por el backend para cerrar/reabrir un período
// (misma clave usada en otras operaciones sensibles del sistema, p.ej. Trans-Almacenes).
const PASSWORD_CONFIRMACION_CIERRE = '@ayala.com'

function siguientePeriodo(ultimo: { anio: number; mes: number } | null) {
  const hoy = new Date()
  if (!ultimo) {
    // Por defecto, el mes calendario anterior al actual (el último ya finalizado)
    const anio = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear()
    const mes = hoy.getMonth() === 0 ? 12 : hoy.getMonth()
    return { anio, mes }
  }
  return ultimo.mes === 12 ? { anio: ultimo.anio + 1, mes: 1 } : { anio: ultimo.anio, mes: ultimo.mes + 1 }
}

export default function CierrePeriodoPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { user } = useAuth()
  const puedeAdministrarCierres = user?.rol === 'admin' || user?.rol === 'gerente' || user?.rol === 'contador'
  const [modalOpen, setModalOpen] = useState(false)

  const { data: estado, isLoading: loadingEstado } = useQuery({
    queryKey: ['cierres-periodo-estado'],
    queryFn: () => api.get('/cierres-periodo/estado').then(r => r.data),
  })
  const { data: historial, isLoading: loadingHistorial } = useQuery({
    queryKey: ['cierres-periodo'],
    queryFn: () => api.get('/cierres-periodo').then(r => r.data),
    enabled: puedeAdministrarCierres,
  })

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<{ anio: number; mes: number; observaciones: string; password: string }>()

  const cerrarMutation = useMutation({
    mutationFn: (d: any) => api.post('/cierres-periodo/cerrar', d),
    onSuccess: ({ data }: any) => {
      qc.invalidateQueries({ queryKey: ['cierres-periodo'] })
      qc.invalidateQueries({ queryKey: ['cierres-periodo-estado'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      const n = data?.saldos_iniciales_generados ?? 0
      toast.success(`Período cerrado. ${n} saldo${n === 1 ? '' : 's'} inicial${n === 1 ? '' : 'es'} trasladado${n === 1 ? '' : 's'} al mes siguiente.`)
      setModalOpen(false)
      reset()
    },
  })

  const reabrirMutation = useMutation({
    mutationFn: (id: number) => api.post(`/cierres-periodo/${id}/reabrir`, { password: PASSWORD_CONFIRMACION_CIERRE }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cierres-periodo'] })
      qc.invalidateQueries({ queryKey: ['cierres-periodo-estado'] })
      toast.success('Período reabierto')
    },
  })

  const abrirModalCierre = () => {
    const sugerido = siguientePeriodo(estado?.ultimo_cierre ? { anio: estado.ultimo_cierre.anio, mes: estado.ultimo_cierre.mes } : null)
    reset({ anio: sugerido.anio, mes: sugerido.mes, observaciones: '' })
    setModalOpen(true)
  }

  const handleCerrar = async (d: any) => {
    if (d.password !== PASSWORD_CONFIRMACION_CIERRE) {
      toast.error('Contraseña de confirmación incorrecta')
      return
    }
    const ok = await confirm({
      title: 'Cerrar período',
      message: <>Se bloquearán todos los movimientos (recepciones, salidas, transferencias y ajustes) con fecha <strong>{String(d.mes).padStart(2, '0')}/{d.anio}</strong> o anterior, y se guardará una foto de los saldos de inventario como saldo de apertura del mes siguiente. ¿Continuar?</>,
      variant: 'danger',
      confirmLabel: 'Cerrar período',
    })
    if (!ok) return
    cerrarMutation.mutate(d)
  }

  const handleReabrir = async (c: any) => {
    const ok = await confirm({
      title: 'Reabrir período',
      message: <>¿Reabrir el período <strong>{String(c.mes).padStart(2, '0')}/{c.anio}</strong>? Se volverán a permitir movimientos con esa fecha o anteriores hasta el cierre previo.</>,
      variant: 'danger',
      confirmLabel: 'Reabrir',
      requiresPassword: true,
      passwordLabel: 'Contraseña de confirmación',
      validatePassword: (v) => v === PASSWORD_CONFIRMACION_CIERRE ? null : 'Contraseña incorrecta',
    })
    if (!ok) return
    reabrirMutation.mutate(c.id)
  }

  if (loadingEstado) return <PageLoader />

  const ultimoCierre = estado?.ultimo_cierre
  // El backend solo permite reabrir el cierre "cerrado" más reciente (historial ya viene
  // ordenado desc por año/mes), que no necesariamente es la primera fila si esa ya fue reabierta.
  const ultimoCerradoId = (historial || []).find((c: any) => c.estado === 'cerrado')?.id
  const esUltimoCerrado = (c: any) => c.estado === 'cerrado' && c.id === ultimoCerradoId

  return (
    <div className="fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cierre de Período / Cierre Mensual</h1>
          <p className="text-sm text-slate-500 mt-0.5">Bloquea las transacciones del mes que termina y traslada los saldos al mes siguiente.</p>
        </div>
        {puedeAdministrarCierres && (
          <button className="btn-primary" onClick={abrirModalCierre}>
            <Lock size={16} /> Cerrar Período
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        <div className="card flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0">
            <ShieldCheck size={20} />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Movimientos bloqueados hasta</p>
            <p className="text-lg font-bold text-slate-900">{estado?.fecha_limite ? fmtFecha(estado.fecha_limite) : 'Ningún período cerrado'}</p>
            <p className="text-xs text-slate-400 mt-1">
              {estado?.fecha_limite
                ? 'No se pueden registrar ni revertir movimientos con esta fecha o anterior.'
                : 'Todas las fechas están habilitadas para registrar movimientos.'}
            </p>
          </div>
        </div>
        <div className="card flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <CalendarClock size={20} />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Último período cerrado</p>
            <p className="text-lg font-bold text-slate-900">
              {ultimoCierre ? `${MESES[ultimoCierre.mes - 1]} ${ultimoCierre.anio}` : '—'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {ultimoCierre ? `Cerrado el ${fmtFecha(ultimoCierre.fecha_cierre)}` : 'Aún no se ha realizado ningún cierre'}
            </p>
          </div>
        </div>
      </div>

      {puedeAdministrarCierres && (
        <div className="card !p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Historial de cierres</h2>
          </div>
          {loadingHistorial ? <PageLoader /> : !(historial || []).length ? (
            <EmptyState message="Sin cierres registrados" description="Cuando cierres tu primer período, aparecerá aquí." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Fecha de cierre</th>
                    <th>Estado</th>
                    <th>Cerrado por</th>
                    <th>Fecha de registro</th>
                    <th>Reapertura</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(historial || []).map((c: any) => (
                    <tr key={c.id}>
                      <td className="font-medium">{MESES[c.mes - 1]} {c.anio}</td>
                      <td>{fmtFecha(c.fecha_cierre)}</td>
                      <td><Badge value={c.estado} /></td>
                      <td>{c.usuario_cierre_nombre || '—'}</td>
                      <td>{c.fecha_cierre_registro ? new Date(c.fecha_cierre_registro).toLocaleString('es-PE') : '—'}</td>
                      <td>{c.estado === 'reabierto' ? `${c.usuario_reapertura_nombre || '—'} · ${c.fecha_reapertura ? new Date(c.fecha_reapertura).toLocaleString('es-PE') : ''}` : '—'}</td>
                      <td className="text-right">
                        {user?.rol === 'admin' && esUltimoCerrado(c) && (
                          <button
                            className="btn-secondary !py-1.5 !px-3 text-xs"
                            onClick={() => handleReabrir(c)}
                            disabled={reabrirMutation.isPending}
                          >
                            <Unlock size={14} /> Reabrir
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset() }} title="Cerrar período" size="sm">
        <form onSubmit={handleSubmit(handleCerrar)} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Mes *</label>
              <select className="select" {...register('mes', { required: true, valueAsNumber: true })}>
                {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Año *</label>
              <input className="input" type="number" {...register('anio', { required: true, valueAsNumber: true })} />
            </div>
          </div>
          <div>
            <label className="label">Observaciones</label>
            <textarea className="input" rows={3} {...register('observaciones')} placeholder="Notas del cierre (opcional)" />
          </div>
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
            Solo se puede cerrar el mes inmediatamente posterior al último período cerrado, y únicamente si ya terminó.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <label className="label flex items-center gap-1.5"><KeyRound size={14} /> Contraseña de Confirmación *</label>
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder="Ingresa la contraseña para confirmar el cierre"
              {...register('password', { required: true })}
            />
            <p className="text-xs text-amber-700 mt-1">Requerida para autorizar el cierre del período.</p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset() }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || cerrarMutation.isPending}>
              {isSubmitting || cerrarMutation.isPending ? 'Cerrando...' : 'Cerrar período'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
