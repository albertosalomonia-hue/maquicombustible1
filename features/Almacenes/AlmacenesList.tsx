'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit, Warehouse, Eye, Trash2 } from 'lucide-react'
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

export default function AlmacenesList() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [inventarioModal, setInventarioModal] = useState<any>(null)
  const [editing, setEditing] = useState<any>(null)

  const { data: almacenes, isLoading } = useQuery({
    queryKey: ['almacenes'],
    queryFn: () => api.get('/almacenes').then(r => r.data),
  })
  const { data: usuarios } = useQuery({ queryKey: ['usuarios'], queryFn: () => api.get('/usuarios').then(r => r.data) })
  const { data: invData } = useQuery({
    queryKey: ['inventario-almacen', inventarioModal?.id],
    queryFn: () => api.get(`/almacenes/${inventarioModal.id}/erp_inventario`).then(r => r.data),
    enabled: !!inventarioModal,
  })

  const { register, handleSubmit, reset, setValue, formState: { isSubmitting } } = useForm()

  const mutation = useMutation({
    mutationFn: (d: any) => editing ? api.put(`/almacenes/${editing.id}`, d) : api.post('/almacenes', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['almacenes'] }); toast.success('Almacén guardado'); setModalOpen(false); reset(); setEditing(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/almacenes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['almacenes'] }); toast.success('Almacén eliminado') },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al eliminar'),
  })

  const handleDelete = async (a: any) => {
    const ok = await confirm({
      title: 'Eliminar almacén',
      message: <>¿Eliminar el almacén <strong>"{a.nombre}"</strong>? Esta acción no se puede deshacer.</>,
      variant: 'danger',
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    deleteMutation.mutate(a.id)
  }

  const openEdit = (a: any) => { setEditing(a); Object.entries(a).forEach(([k, v]) => setValue(k as any, v)); setModalOpen(true) }

  const almacenesArr = almacenes || []
  const { sorted: sortedAlmacenes, sortCol, sortDir, toggle } = useSortTable(almacenesArr, 'codigo', 'asc')

  if (isLoading) return <PageLoader />

  const tiposOrder = ['central', 'auxiliar']

  return (
    <div className="fade-in">
      <div className="flex justify-end mb-6">
        <button className="btn-primary" onClick={() => { reset(); setEditing(null); setModalOpen(true) }}>
          <Plus size={16} /> Nuevo Almacén
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {tiposOrder.map(tipo => {
          const lista = sortedAlmacenes.filter((a: any) => a.tipo === tipo)
          if (!lista.length) return null
          return (
            <div key={tipo} className="card p-0 overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
                <Warehouse size={18} className="text-blue-500" />
                <span className="font-semibold text-slate-900 capitalize">Almacén {tipo}</span>
                <span className="text-sm text-slate-400 ml-auto">{lista.length} almacén(es)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <SortableTh col="codigo" label="Código" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                      <SortableTh col="nombre" label="Nombre" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                      <SortableTh col="responsable_nombre" label="Responsable" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                      <SortableTh col="estado" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                      <th className="table-header text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((a: any) => (
                      <tr key={a.id} className="table-row">
                        <td className="table-cell font-mono text-xs font-medium text-slate-800">{a.codigo}</td>
                        <td className="table-cell">
                          <p className="font-medium text-slate-900">{a.nombre}</p>
                          <p className="text-xs text-slate-400">{a.descripcion}</p>
                        </td>
                        <td className="table-cell text-slate-500">{a.responsable_nombre || 'Sin asignar'}</td>
                        <td className="table-cell"><Badge value={a.estado} /></td>
                        <td className="table-cell text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setInventarioModal(a)} className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Ver inventario">
                              <Eye size={16} />
                            </button>
                            <button onClick={() => openEdit(a)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
                              <Edit size={16} />
                            </button>
                            <button onClick={() => handleDelete(a)} disabled={deleteMutation.isPending} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40" title="Eliminar">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
        {!almacenes?.length && <EmptyState />}
      </div>

      {/* Modal crear/editar */}
      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset(); setEditing(null) }} title={editing ? 'Editar Almacén' : 'Nuevo Almacén'}>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Código *</label>
              <input className="input" {...register('codigo', { required: true })} disabled={!!editing} />
            </div>
            <div>
              <label className="label">Tipo *</label>
              <select className="select" {...register('tipo', { required: true })}>
                <option value="central">Central</option>
                <option value="auxiliar">Auxiliar</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Nombre *</label>
            <input className="input" {...register('nombre', { required: true })} />
          </div>
          <div>
            <label className="label">Descripción</label>
            <textarea className="input h-16 resize-none" {...register('descripcion')} />
          </div>
          <div>
            <label className="label">Responsable</label>
            <select className="select" {...register('responsable_id')}>
              <option value="">-- Sin asignar --</option>
              {(usuarios || []).map((u: any) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
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

      {/* Modal inventario */}
      <Modal isOpen={!!inventarioModal} onClose={() => setInventarioModal(null)} title={`Inventario: ${inventarioModal?.nombre}`} size="xl">
        <div className="p-6">
          {!invData?.length ? (
            <EmptyState message="Sin stock" description="Este almacén no tiene productos registrados." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header text-left">SKU</th>
                    <th className="table-header text-left">Producto</th>
                    <th className="table-header text-right">Stock Físico</th>
                    <th className="table-header text-right">Reservado</th>
                    <th className="table-header text-right">Disponible</th>
                    <th className="table-header text-right">Costo Prom.</th>
                    <th className="table-header text-right">Valor Total</th>
                    <th className="table-header text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {invData.map((i: any) => (
                    <tr key={i.id} className="table-row">
                      <td className="table-cell font-mono text-xs">{i.sku}</td>
                      <td className="table-cell font-medium text-slate-900">{i.descripcion}</td>
                      <td className="table-cell text-right">{parseFloat(i.stock_fisico).toFixed(2)} {i.unidad}</td>
                      <td className="table-cell text-right text-slate-400">{parseFloat(i.stock_reservado).toFixed(2)}</td>
                      <td className="table-cell text-right font-medium">{parseFloat(i.stock_disponible).toFixed(2)}</td>
                      <td className="table-cell text-right">S/ {parseFloat(i.costo_promedio || 0).toFixed(4)}</td>
                      <td className="table-cell text-right font-medium text-blue-600">S/ {parseFloat(i.valor_total || 0).toFixed(2)}</td>
                      <td className="table-cell text-center"><Badge value={i.estado_stock} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
