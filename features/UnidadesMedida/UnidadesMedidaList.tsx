'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit, Ruler, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import { useConfirm } from '../../context/ConfirmContext'

export default function UnidadesMedidaList() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const { data: unidades, isLoading } = useQuery({ queryKey: ['unidades-medida'], queryFn: () => api.get('/unidades-medida').then(r => r.data) })
  const { register, handleSubmit, reset, setValue, formState: { isSubmitting } } = useForm()

  const mutation = useMutation({
    mutationFn: (d: any) => editing ? api.put(`/unidades-medida/${editing.id}`, d) : api.post('/unidades-medida', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['unidades-medida'] }); qc.invalidateQueries({ queryKey: ['unidades'] }); toast.success('Unidad de medida guardada'); setModalOpen(false); reset(); setEditing(null) },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al guardar'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/unidades-medida/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['unidades-medida'] }); qc.invalidateQueries({ queryKey: ['unidades'] }); toast.success('Unidad de medida eliminada') },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al eliminar'),
  })

  const openCreate = () => { reset(); setEditing(null); setModalOpen(true) }
  const openEdit = (u: any) => { setEditing(u); Object.entries(u).forEach(([k, v]) => setValue(k as any, v)); setModalOpen(true) }
  const handleDelete = async (u: any) => {
    const ok = await confirm({
      title: 'Eliminar unidad de medida',
      message: <>¿Eliminar la unidad de medida <strong>"{u.nombre}"</strong>?</>,
      variant: 'danger',
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    deleteMutation.mutate(u.id)
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in">
      <div className="flex justify-end mb-6">
        <button className="btn-primary" onClick={openCreate}><Plus size={16} /> Nueva Unidad de Medida</button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Ruler size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Unidades de Medida</span>
          <span className="ml-auto text-sm text-slate-400">{(unidades || []).length} registros</span>
        </div>
        {!(unidades || []).length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header text-left">Código</th>
                  <th className="table-header text-left">Nombre</th>
                  <th className="table-header text-left">Estado</th>
                  <th className="table-header text-center">Acción</th>
                </tr>
              </thead>
              <tbody>
                {(unidades || []).map((u: any) => (
                  <tr key={u.id} className="table-row">
                    <td className="table-cell font-mono text-xs font-medium text-slate-800">{u.codigo}</td>
                    <td className="table-cell text-slate-900">{u.nombre}</td>
                    <td className="table-cell"><Badge value={u.estado || 'activo'} /></td>
                    <td className="table-cell text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(u)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
                          <Edit size={16} />
                        </button>
                        <button onClick={() => handleDelete(u)} disabled={deleteMutation.isPending} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40" title="Eliminar">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset(); setEditing(null) }} title={editing ? 'Editar Unidad de Medida' : 'Nueva Unidad de Medida'}>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Código *</label>
              <input className="input" {...register('codigo', { required: true })} placeholder="Ej: UND, KG" />
            </div>
            <div>
              <label className="label">Nombre *</label>
              <input className="input" {...register('nombre', { required: true })} placeholder="Ej: Unidad, Kilogramo" />
            </div>
          </div>
          {editing && (
            <div>
              <label className="label">Estado</label>
              <select className="select" {...register('estado')}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
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
