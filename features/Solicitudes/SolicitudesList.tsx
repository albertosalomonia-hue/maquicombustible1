'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, ClipboardList, Trash2 } from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'

export default function SolicitudesList() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['solicitudes', search],
    queryFn: () => api.get('/solicitudes', { params: { search, limit: 100 } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })
  const { data: almacenes } = useQuery({
    queryKey: ['almacenes'],
    queryFn: () => api.get('/almacenes').then(r => r.data),
  })
  const { data: catalogo } = useQuery({
    queryKey: ['catalogo'],
    queryFn: () => api.get('/productos/catalogo').then(r => r.data),
  })

  const { register, handleSubmit, reset, control, formState: { isSubmitting } } = useForm<any>({
    defaultValues: {
      almacen_solicitante_id: '',
      almacen_proveedor_id: '',
      fecha: new Date().toISOString().slice(0, 10),
      urgencia: 'normal',
      observaciones: '',
      detalles: [{ producto_id: '', cantidad_solicitada: 1 }],
    },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'detalles' })

  const mutation = useMutation({
    mutationFn: (d: any) => api.post('/solicitudes', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['solicitudes'] })
      toast.success('Solicitud de abastecimiento registrada')
      setModalOpen(false)
      reset()
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al registrar solicitud')
    },
  })

  const cambiarEstado = useMutation({
    mutationFn: ({ id, estado }: any) => api.put(`/solicitudes/${id}/estado`, { estado }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['solicitudes'] }); toast.success('Estado actualizado') },
  })

  const solicitudes = data?.data || []
  const { sorted, sortCol, sortDir, toggle } = useSortTable(solicitudes, 'fecha', 'desc')

  if (isLoading) return <PageLoader />

  const urgenciaColor: Record<string, string> = {
    normal: 'text-slate-600 bg-slate-100',
    urgente: 'text-orange-700 bg-orange-100',
    critico: 'text-red-700 bg-red-100',
  }

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar solicitudes..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={() => { reset(); setModalOpen(true) }}>
          <Plus size={16} /> Nueva Solicitud
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <ClipboardList size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Solicitudes de Abastecimiento</span>
          <span className="ml-auto text-sm text-slate-400">{solicitudes.length} registros</span>
        </div>
        {!solicitudes.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableTh col="numero" label="Número" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="fecha" label="Fecha" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="solicitante_nombre" label="Solicitante" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="proveedor_nombre" label="Proveedor" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="urgencia" label="Urgencia" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="estado" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <th className="table-header text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s: any) => (
                  <tr key={s.id} className="table-row">
                    <td className="table-cell font-mono text-xs font-bold text-indigo-700">{s.numero}</td>
                    <td className="table-cell text-slate-500">{s.fecha}</td>
                    <td className="table-cell font-medium text-slate-900">{s.solicitante_nombre}</td>
                    <td className="table-cell text-slate-600">{s.proveedor_nombre}</td>
                    <td className="table-cell text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${urgenciaColor[s.urgencia] || urgenciaColor.normal}`}>
                        {s.urgencia}
                      </span>
                    </td>
                    <td className="table-cell text-center"><Badge value={s.estado} /></td>
                    <td className="table-cell text-center">
                      {s.estado === 'pendiente' && (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => cambiarEstado.mutate({ id: s.id, estado: 'aprobada' })}
                            className="text-xs px-2 py-1 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg transition-colors"
                          >Aprobar</button>
                          <button
                            onClick={() => cambiarEstado.mutate({ id: s.id, estado: 'rechazada' })}
                            className="text-xs px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg transition-colors"
                          >Rechazar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset() }} title="Nueva Solicitud de Abastecimiento" size="xl">
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Almacén Solicitante *</label>
              <select className="select" {...register('almacen_solicitante_id', { required: true })}>
                <option value="">-- Seleccionar --</option>
                {(almacenes || []).filter((a: any) => a.tipo === 'auxiliar').map((a: any) => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Almacén Proveedor *</label>
              <select className="select" {...register('almacen_proveedor_id', { required: true })}>
                <option value="">-- Seleccionar --</option>
                {(almacenes || []).filter((a: any) => a.tipo === 'central').map((a: any) => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Fecha</label>
              <input className="input" type="date" {...register('fecha')} />
            </div>
            <div>
              <label className="label">Urgencia</label>
              <select className="select" {...register('urgencia')}>
                <option value="normal">Normal</option>
                <option value="urgente">Urgente</option>
                <option value="critico">Crítico</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="font-medium text-slate-900 text-sm">Productos Solicitados</label>
              <button type="button" onClick={() => append({ producto_id: '', cantidad_solicitada: 1 })} className="btn-secondary text-xs py-1.5">
                <Plus size={14} /> Agregar
              </button>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="table-header text-left">Producto</th>
                    <th className="table-header text-right w-32">Cantidad</th>
                    <th className="table-header w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, i) => (
                    <tr key={f.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <select className="select text-sm" {...register(`detalles.${i}.producto_id`, { required: true })}>
                          <option value="">-- Producto --</option>
                          {(catalogo || []).map((p: any) => (
                            <option key={p.id} value={p.id}>{p.descripcion} ({p.sku})</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input className="input text-right text-sm" type="number" step="0.01" min="0.01"
                          {...register(`detalles.${i}.cantidad_solicitada`, { required: true })} />
                      </td>
                      <td className="px-2 py-2">
                        {fields.length > 1 && (
                          <button type="button" onClick={() => remove(i)} className="p-1 text-red-400 hover:text-red-600">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <label className="label">Observaciones</label>
            <textarea className="input h-16 resize-none" {...register('observaciones')} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset() }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Enviando...' : 'Enviar Solicitud'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
