'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, Edit, Users, Building2, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'
import { useConfirm } from '../../context/ConfirmContext'

const TIPOS_DOC = ['RUC', 'DNI', 'CE', 'PASSPORT']
const MEDIOS_PAGO = ['transferencia', 'deposito', 'tarjeta', 'efectivo', 'yape', 'plin', 'cheque']

export default function ClientesList() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['clientes', search],
    queryFn: () => api.get('/clientes', { params: { search, limit: 100 } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm()

  const mutation = useMutation({
    mutationFn: (formData: any) =>
      editing
        ? api.put(`/clientes/${editing.id}`, formData)
        : api.post('/clientes', formData),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clientes'] })
      toast.success(editing ? 'Cliente actualizado' : 'Cliente registrado')
      setModalOpen(false)
      reset()
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/clientes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clientes'] }); toast.success('Cliente eliminado') },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al eliminar'),
  })

  const handleDelete = async (c: any) => {
    const ok = await confirm({
      title: 'Eliminar cliente',
      message: <>¿Eliminar el cliente <strong>"{c.razon_social}"</strong>?</>,
      variant: 'danger',
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    deleteMutation.mutate(c.id)
  }

  const openCreate = () => { reset(); setEditing(null); setModalOpen(true) }
  const openEdit = (c: any) => {
    setEditing(c)
    Object.entries(c).forEach(([k, v]) => setValue(k as any, v))
    setModalOpen(true)
  }

  const clientes = data?.data || []
  const { sorted, sortCol, sortDir, toggle } = useSortTable(clientes, 'razon_social', 'asc')

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar por RUC, nombre..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={16} /> Nuevo Cliente
        </button>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Users size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Clientes Registrados</span>
          <span className="ml-auto text-sm text-slate-400">{clientes.length} registros</span>
        </div>
        {!clientes.length ? <EmptyState message="Sin clientes" description="Registra el primer cliente." /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableTh col="tipo_documento" label="Tipo/Documento" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="razon_social" label="Razón Social" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="nombre_comercial" label="Nombre Comercial" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="contacto" label="Contacto" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="correo" label="Correo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="estado" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <th className="table-header text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c: any) => (
                  <tr key={c.id} className="table-row">
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <Building2 size={14} className="text-slate-400" />
                        <div>
                          <p className="font-medium text-slate-900">{c.numero_documento}</p>
                          <p className="text-xs text-slate-400">{c.tipo_documento}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell font-medium text-slate-900">{c.razon_social}</td>
                    <td className="table-cell text-slate-500">{c.nombre_comercial || '-'}</td>
                    <td className="table-cell text-slate-500">{c.contacto || '-'}</td>
                    <td className="table-cell text-slate-500">{c.correo || '-'}</td>
                    <td className="table-cell"><Badge value={c.estado} /></td>
                    <td className="table-cell text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(c)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
                          <Edit size={16} />
                        </button>
                        <button onClick={() => handleDelete(c)} disabled={deleteMutation.isPending} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40" title="Eliminar">
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

      {/* Modal */}
      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset(); setEditing(null) }} title={editing ? 'Editar Cliente' : 'Nuevo Cliente'} size="lg">
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Tipo Documento *</label>
              <select className="select" {...register('tipo_documento', { required: true })}>
                {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Número Documento *</label>
              <input className="input" {...register('numero_documento', { required: 'Requerido' })} disabled={!!editing} />
              {errors.numero_documento && <p className="text-red-500 text-xs mt-1">Requerido</p>}
            </div>
          </div>
          <div>
            <label className="label">Razón Social *</label>
            <input className="input" {...register('razon_social', { required: true })} />
          </div>
          <div>
            <label className="label">Nombre Comercial</label>
            <input className="input" {...register('nombre_comercial')} />
          </div>
          <div>
            <label className="label">Dirección</label>
            <input className="input" {...register('direccion')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Contacto</label>
              <input className="input" {...register('contacto')} />
            </div>
            <div>
              <label className="label">Teléfono</label>
              <input className="input" {...register('telefono')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Correo</label>
              <input className="input" type="email" {...register('correo')} />
            </div>
            <div>
              <label className="label">Límite de Crédito (S/)</label>
              <input className="input" type="number" step="0.01" {...register('limite_credito')} />
            </div>
          </div>
          <div>
            <label className="label">Condiciones Comerciales</label>
            <textarea className="input h-20 resize-none" {...register('condicion_comercial')} />
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
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : editing ? 'Actualizar' : 'Registrar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
