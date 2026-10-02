'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit, Target, TrendingUp } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'

function fmt(n: number) { return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 0 }).format(n) }

export default function CentrosCostoList() {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const { data: centros, isLoading } = useQuery({ queryKey: ['centros-costo'], queryFn: () => api.get('/centros-costo').then(r => r.data) })
  const { register, handleSubmit, reset, setValue, formState: { isSubmitting } } = useForm()

  const mutation = useMutation({
    mutationFn: (d: any) => editing ? api.put(`/centros-costo/${editing.id}`, d) : api.post('/centros-costo', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['centros-costo'] }); toast.success('Centro de costo guardado'); setModalOpen(false); reset(); setEditing(null) },
  })

  const openEdit = (c: any) => { setEditing(c); Object.entries(c).forEach(([k, v]) => setValue(k as any, v)); setModalOpen(true) }

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in">
      <div className="flex justify-end mb-6">
        <button className="btn-primary" onClick={() => { reset(); setEditing(null); setModalOpen(true) }}><Plus size={16} /> Nuevo Centro de Costo</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {!(centros || []).length && <EmptyState />}
        {(centros || []).map((cc: any) => {
          const ejecutado = parseFloat(cc.ejecutado_anual || 0)
          const presupuesto = parseFloat(cc.presupuesto_anual || 0)
          const pct = presupuesto > 0 ? Math.min((ejecutado / presupuesto) * 100, 100) : 0
          const barColor = pct >= 100 ? 'bg-red-500' : pct >= 90 ? 'bg-orange-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-green-500'
          return (
            <div key={cc.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-sm">{cc.codigo}</span>
                    <Badge value={cc.estado} />
                  </div>
                  <p className="font-semibold text-slate-900">{cc.nombre}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{cc.descripcion}</p>
                </div>
                <button onClick={() => openEdit(cc)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                  <Edit size={16} />
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Presupuesto Anual</span>
                  <span className="font-semibold text-slate-900">{fmt(presupuesto)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Ejecutado</span>
                  <span className={`font-semibold ${pct >= 90 ? 'text-red-600' : 'text-slate-900'}`}>{fmt(ejecutado)}</span>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                    <span>Ejecución</span>
                    <span className={pct >= 80 ? 'font-bold text-red-600' : ''}>{pct.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="flex justify-between text-sm border-t border-slate-100 pt-3">
                  <span className="text-slate-500">Disponible</span>
                  <span className={`font-bold ${presupuesto - ejecutado < 0 ? 'text-red-600' : 'text-green-600'}`}>{fmt(presupuesto - ejecutado)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset(); setEditing(null) }} title={editing ? 'Editar Centro de Costo' : 'Nuevo Centro de Costo'}>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Código *</label>
              <input className="input" {...register('codigo', { required: true })} disabled={!!editing} />
            </div>
            <div>
              <label className="label">Nombre *</label>
              <input className="input" {...register('nombre', { required: true })} />
            </div>
          </div>
          <div>
            <label className="label">Descripción</label>
            <input className="input" {...register('descripcion')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Presupuesto Anual (S/)</label>
              <input className="input" type="number" step="0.01" {...register('presupuesto_anual')} />
            </div>
            <div>
              <label className="label">Presupuesto Mensual (S/)</label>
              <input className="input" type="number" step="0.01" {...register('presupuesto_mensual')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Alerta en (%) </label>
              <input className="input" type="number" {...register('alerta_porcentaje')} placeholder="80" />
            </div>
            <div>
              <label className="label">Bloqueo en (%)</label>
              <input className="input" type="number" {...register('bloqueo_porcentaje')} placeholder="100" />
            </div>
          </div>
          {editing && (
            <div>
              <label className="label">Estado</label>
              <select className="select" {...register('estado')}><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset(); setEditing(null) }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
