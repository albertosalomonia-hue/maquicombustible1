'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Edit, Trash2, Tag } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import { useConfirm } from '../../context/ConfirmContext'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'

export default function PlacasList() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [estadoF, setEstadoF] = useState('')
  const [tipoF, setTipoF] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)

  const params: any = {}
  if (search) params.search = search
  if (estadoF) params.estado = estadoF
  if (tipoF) params.tipo = tipoF

  const { data: placas, isLoading } = useQuery({
    queryKey: ['placas', search, estadoF, tipoF],
    queryFn: () => api.get('/placas', { params }).then(r => r.data),
  })
  // Lista completa sin filtros, solo para detectar duplicados al escribir (los filtros de
  // arriba pueden estar ocultando la placa que choca con la que se está registrando).
  const { data: placasTodas } = useQuery({
    queryKey: ['placas-todas'],
    queryFn: () => api.get('/placas').then(r => r.data),
  })

  const { sorted: placasOrdenadas, sortCol, sortDir, toggle } = useSortTable<any>(placas || [], 'placa')

  const { register, handleSubmit, reset, setValue, watch, formState: { isSubmitting } } = useForm<any>()

  const placaTexto = (watch('placa') || '').trim().toUpperCase()
  const placaDuplicada = !!placaTexto && (placasTodas || []).some((p: any) =>
    p.placa.trim().toUpperCase() === placaTexto && p.id !== editing?.id
  )

  const mutation = useMutation({
    mutationFn: (d: any) => editing ? api.put(`/placas/${editing.id}`, d) : api.post('/placas', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['placas'] })
      qc.invalidateQueries({ queryKey: ['placas-todas'] })
      toast.success(editing ? 'Registro actualizado' : 'Registro creado')
      setModalOpen(false); reset(); setEditing(null)
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al guardar la placa'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/placas/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['placas'] }); toast.success('Placa eliminada') },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al eliminar'),
  })

  const openCreate = () => { reset({ placa: '', tipo: 'vehiculo', descripcion: '', observaciones: '' }); setEditing(null); setModalOpen(true) }
  const openEdit = (p: any) => {
    setEditing(p)
    Object.entries(p).forEach(([k, v]) => setValue(k as any, v as any))
    setModalOpen(true)
  }

  const handleDelete = async (p: any) => {
    const ok = await confirm({
      title: 'Eliminar vehículo / maquinaria',
      message: <>¿Eliminar la placa/código <strong>"{p.placa}"</strong>?</>,
      variant: 'danger',
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    deleteMutation.mutate(p.id)
  }

  const estadoBadge = (estado: string) => {
    if (estado === 'disponible') return <Badge value="activo" label="Disponible" />
    if (estado === 'en_uso') return <Badge value="pendiente" label="En uso" />
    return <Badge value="inactivo" label="Baja" />
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar por placa/código o descripción..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="select w-44" value={tipoF} onChange={e => setTipoF(e.target.value)}>
          <option value="">Vehículos y maquinaria</option>
          <option value="vehiculo">Vehículos</option>
          <option value="maquinaria">Maquinaria</option>
        </select>
        <select className="select w-40" value={estadoF} onChange={e => setEstadoF(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="disponible">Disponible</option>
          <option value="en_uso">En uso</option>
          <option value="baja">Baja</option>
        </select>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={16} /> Nuevo Vehículo / Maquinaria
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Tag size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Vehículos y Maquinaria</span>
          <span className="ml-auto text-sm text-slate-400">{(placas || []).length} registros</span>
        </div>
        {!(placas || []).length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableTh col="placa" label="Placa / Código" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="tipo" label="Tipo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="descripcion" label="Descripción" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="estado" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="observaciones" label="Observaciones" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <th className="table-header text-center">Acción</th>
                </tr>
              </thead>
              <tbody>
                {placasOrdenadas.map((p: any) => (
                  <tr key={p.id} className="table-row">
                    <td className="table-cell font-mono text-xs font-bold text-slate-800">{p.placa}</td>
                    <td className="table-cell text-sm">{p.tipo === 'maquinaria' ? 'Maquinaria' : 'Vehículo'}</td>
                    <td className="table-cell text-sm text-slate-700">{p.descripcion || '—'}</td>
                    <td className="table-cell">{estadoBadge(p.estado)}</td>
                    <td className="table-cell text-slate-500 text-sm max-w-xs truncate">{p.observaciones || '—'}</td>
                    <td className="table-cell text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(p)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
                          <Edit size={16} />
                        </button>
                        <button onClick={() => handleDelete(p)} disabled={deleteMutation.isPending} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40" title="Eliminar">
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

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset(); setEditing(null) }} title={editing ? 'Editar Vehículo / Maquinaria' : 'Nuevo Vehículo / Maquinaria'}>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="label">Tipo *</label>
            <select className="select" {...register('tipo')}>
              <option value="vehiculo">Vehículo</option>
              <option value="maquinaria">Maquinaria</option>
            </select>
          </div>
          <div>
            <label className="label">Placa / Código *</label>
            <input
              className={`input ${placaDuplicada ? 'border-red-400 focus:border-red-400' : ''}`}
              {...register('placa', { required: true })}
              placeholder="Ej: PC-001"
              autoFocus
            />
            {placaDuplicada && (
              <p className="text-xs text-red-500 mt-1">Ya existe una placa registrada con ese código.</p>
            )}
          </div>
          <div>
            <label className="label">Descripción</label>
            <input className="input" {...register('descripcion')} placeholder="Ej: Camión volquete Volvo FMX / Excavadora CAT 320" />
          </div>
          {editing && (
            <div>
              <label className="label">Estado</label>
              <select className="select" {...register('estado')}>
                <option value="disponible">Disponible</option>
                <option value="en_uso">En uso</option>
                <option value="baja">Baja</option>
              </select>
            </div>
          )}
          <div>
            <label className="label">Observaciones</label>
            <textarea className="input h-16 resize-none" {...register('observaciones')} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset(); setEditing(null) }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || placaDuplicada}>{isSubmitting ? 'Guardando...' : editing ? 'Actualizar' : 'Registrar'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
