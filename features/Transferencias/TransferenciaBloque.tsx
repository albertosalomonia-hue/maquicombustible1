'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, Lock, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import ProductoBuscador from '../../components/ui/ProductoBuscador'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import { useConfirm } from '../../context/ConfirmContext'

export default function TransferenciaBloque() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [productoId, setProductoId] = useState('')
  const [almacenDestinoId, setAlmacenDestinoId] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [observaciones, setObservaciones] = useState('')

  const { data: catalogo, isLoading: loadingCat } = useQuery({
    queryKey: ['catalogo'],
    queryFn: () => api.get('/productos/catalogo').then(r => r.data),
  })
  const { data: almacenes } = useQuery({ queryKey: ['almacenes'], queryFn: () => api.get('/almacenes').then(r => r.data) })
  const almacenesDestino = (almacenes || []).filter((a: any) => a.tipo === 'auxiliar' && a.estado === 'activo')

  const { data: stock, isLoading: loadingStock } = useQuery({
    queryKey: ['bloque-stock', productoId],
    queryFn: () => api.get(`/transferencias/bloque/stock/${productoId}`).then(r => r.data),
    enabled: !!productoId,
  })

  const { data: bloqueados, isLoading: loadingBloqueados } = useQuery({
    queryKey: ['bloque-bloqueados'],
    queryFn: () => api.get('/transferencias/bloque/bloqueados').then(r => r.data),
  })

  const productoSeleccionado = (catalogo || []).find((p: any) => String(p.id) === String(productoId))

  const mutation = useMutation({
    mutationFn: (d: any) => api.post('/transferencias/bloque', d).then(r => r.data),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['transferencias'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      qc.invalidateQueries({ queryKey: ['catalogo'] })
      qc.invalidateQueries({ queryKey: ['catalogo-todos'] })
      qc.invalidateQueries({ queryKey: ['bloque-bloqueados'] })
      qc.invalidateQueries({ queryKey: ['bloque-stock'] })
      toast.success(`Transferencia por bloque completada: ${r.cantidad} unidades en ${r.lotes} lote(s) — ${r.numero}`)
      setProductoId('')
      setAlmacenDestinoId('')
      setObservaciones('')
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al procesar la transferencia por bloque'),
  })

  const desbloquearM = useMutation({
    mutationFn: (id: number) => api.put(`/transferencias/bloque/${id}/desbloquear`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bloque-bloqueados'] })
      qc.invalidateQueries({ queryKey: ['catalogo'] })
      qc.invalidateQueries({ queryKey: ['catalogo-todos'] })
      toast.success('Producto desbloqueado')
    },
    onError: () => toast.error('Error al desbloquear el producto'),
  })

  const handleTransferir = async () => {
    if (!productoId || !almacenDestinoId || !fecha) return
    if (!stock || stock.disponible <= 0) { toast.error('El producto no tiene stock disponible en el Almacén Central'); return }
    const almacenNombre = almacenesDestino.find((a: any) => String(a.id) === String(almacenDestinoId))?.nombre
    const ok = await confirm({
      title: 'Transferencia por Bloque',
      message: (
        <>
          ¿Transferir TODO el stock disponible de <strong>"{productoSeleccionado?.descripcion}"</strong> ({stock.disponible} {productoSeleccionado?.unidad || ''}) desde {stock.almacen_central_nombre} hacia <strong>{almacenNombre}</strong>?
          <br /><br />
          Esto agrupará todas las recepciones de este producto en una sola transferencia y bloqueará las transferencias individuales de este producto en Recepciones.
        </>
      ),
      variant: 'warning',
      confirmLabel: 'Transferir Bloque',
    })
    if (!ok) return
    mutation.mutate({ producto_id: productoId, almacen_destino_id: almacenDestinoId, fecha, observaciones })
  }

  const handleDesbloquear = async (p: any) => {
    const ok = await confirm({
      title: 'Desbloquear producto',
      message: <>¿Desbloquear <strong>"{p.descripcion}"</strong>? Podrá volver a transferirse de forma individual desde Recepciones.</>,
      variant: 'info',
      confirmLabel: 'Desbloquear',
    })
    if (!ok) return
    desbloquearM.mutate(p.id)
  }

  if (loadingCat) return <PageLoader />

  return (
    <div className="fade-in space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <Layers size={20} className="text-purple-500" />
          <div>
            <h2 className="font-semibold text-slate-900">Transferencia por Bloque</h2>
            <p className="text-xs text-slate-400">Agrupa todo el stock recibido de un producto (todas sus recepciones) y lo transfiere de una sola vez a un Almacén Auxiliar, como un solo contenedor.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Producto *</label>
            <ProductoBuscador
              productos={catalogo || []}
              value={productoId}
              onChange={(id) => setProductoId(id)}
              placeholder="Ej: AGUA MINERAL X 20 LT CAJA..."
            />
          </div>

          {productoId && (
            <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-3 ${
              loadingStock ? 'bg-slate-50 border-slate-200 text-slate-400'
                : stock?.bloqueado ? 'bg-red-50 border-red-200 text-red-700'
                : (stock?.disponible ?? 0) <= 0 ? 'bg-slate-50 border-slate-200 text-slate-400'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}>
              {loadingStock ? 'Consultando stock...' : stock?.bloqueado ? (
                <><Lock size={16} className="shrink-0" /> Este producto ya está bloqueado por una Transferencia por Bloque previa.</>
              ) : (stock?.disponible ?? 0) <= 0 ? (
                <>Sin stock disponible en {stock?.almacen_central_nombre}.</>
              ) : (
                <>
                  <span className="font-bold">{stock?.disponible} {productoSeleccionado?.unidad}</span>
                  disponibles en {stock?.almacen_central_nombre}
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Almacén Auxiliar (Destino) *</label>
              <select className="select" value={almacenDestinoId} onChange={e => setAlmacenDestinoId(e.target.value)}>
                <option value="">-- Seleccionar --</option>
                {almacenesDestino.map((a: any) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Fecha *</label>
              <input className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Observaciones</label>
            <input className="input" value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Opcional" />
          </div>

          <div className="flex justify-end pt-2">
            <button
              className="btn-primary"
              disabled={!productoId || !almacenDestinoId || !fecha || mutation.isPending || loadingStock || (stock?.disponible ?? 0) <= 0 || stock?.bloqueado}
              onClick={handleTransferir}
            >
              {mutation.isPending ? 'Procesando...' : 'Transferir Bloque Completo'}
            </button>
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Lock size={18} className="text-red-500" />
          <span className="font-semibold text-slate-900">Productos Bloqueados</span>
          <span className="ml-auto text-sm text-slate-400">{bloqueados?.length ?? 0} producto(s)</span>
        </div>
        {loadingBloqueados ? (
          <div className="px-6 py-4 text-sm text-slate-400">Cargando...</div>
        ) : !bloqueados?.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header text-left">SKU</th>
                  <th className="table-header text-left">Producto</th>
                  <th className="table-header text-left">Bloqueado el</th>
                  <th className="table-header text-left">Por</th>
                  <th className="table-header text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {bloqueados.map((p: any) => (
                  <tr key={p.id} className="table-row">
                    <td className="table-cell font-mono text-xs text-slate-500">{p.sku}</td>
                    <td className="table-cell font-medium text-slate-900">{p.descripcion}</td>
                    <td className="table-cell text-slate-500 text-xs">{p.bloqueado_transferencia_fecha}</td>
                    <td className="table-cell text-slate-500 text-xs">{p.usuario_nombre || '—'}</td>
                    <td className="table-cell text-center">
                      <button
                        onClick={() => handleDesbloquear(p)}
                        disabled={desbloquearM.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Unlock size={13} /> Desbloquear
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
