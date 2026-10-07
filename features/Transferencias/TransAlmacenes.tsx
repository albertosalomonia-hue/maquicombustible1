'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Warehouse, Plus, Trash2, KeyRound, ArrowRightLeft, Search, Undo2, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import ProductoBuscador, { normalizar } from '../../components/ui/ProductoBuscador'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import { useConfirm } from '../../context/ConfirmContext'

// reserva_id: línea que mueve stock RESERVADO de una factura concreta (cantidad parcial, el resto queda en origen).
type Linea = { producto_id: string; cantidad: string; reserva_id?: string }

// Misma clave de confirmación usada en Salidas, Transferencias y Cierre de Período.
const PASSWORD_CONFIRMACION_REVERSION = '@ayala.com'

export default function TransAlmacenes() {
  const qc = useQueryClient()
  const confirm = useConfirm()

  const [almacenOrigenId, setAlmacenOrigenId] = useState('')
  const [almacenDestinoId, setAlmacenDestinoId] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [observaciones, setObservaciones] = useState('')
  const [password, setPassword] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [dispSearch, setDispSearch] = useState('')

  const { data: almacenes, isLoading: loadingAlmacenes } = useQuery({
    queryKey: ['almacenes'],
    queryFn: () => api.get('/almacenes').then(r => r.data),
  })
  const almacenesActivos = (almacenes || []).filter((a: any) => a.estado === 'activo')
  const almacenesDestino = almacenesActivos.filter((a: any) => String(a.id) !== String(almacenOrigenId))

  const { data: inventarioOrigen } = useQuery({
    queryKey: ['inventario-trans-almacenes', almacenOrigenId],
    queryFn: () => api.get('/inventario', { params: { almacen_id: almacenOrigenId, limit: 1000 } }).then(r => r.data),
    enabled: !!almacenOrigenId,
  })
  // Reservas (facturas) con saldo en el almacén origen: su stock se mueve por reserva.
  const { data: reservasOrigen } = useQuery({
    queryKey: ['reservas-trans-almacenes', almacenOrigenId],
    queryFn: () => api.get('/reservas', { params: { almacen_id: almacenOrigenId, con_saldo: 1 } }).then(r => r.data),
    enabled: !!almacenOrigenId,
  })
  const reservasConSaldo: any[] = reservasOrigen || []
  const getReserva = (id?: string) => id ? reservasConSaldo.find(r => String(r.id) === String(id)) : undefined
  const agregarReserva = (r: any) => {
    setLineas(prev => [...prev.filter(l => l.producto_id || l.reserva_id), { producto_id: String(r.producto_id), cantidad: String(parseFloat(r.saldo)), reserva_id: String(r.id) }])
  }
  const getDisponible = (productoId: string) => {
    const row = (inventarioOrigen?.data as any[] | undefined)?.find(p => String(p.id) === String(productoId))
    return row ? parseFloat(row.disponible_total) : null
  }
  const { data: inventarioDestino } = useQuery({
    queryKey: ['inventario-trans-almacenes', almacenDestinoId],
    queryFn: () => api.get('/inventario', { params: { almacen_id: almacenDestinoId, limit: 1000 } }).then(r => r.data),
    enabled: !!almacenDestinoId,
  })
  const getStockDestino = (productoId: string) => {
    const row = (inventarioDestino?.data as any[] | undefined)?.find(p => String(p.id) === String(productoId))
    return row ? parseFloat(row.stock_total) : 0
  }
  // En el destino se muestra el stock físico (incluye lo reservado), no solo el disponible.
  const productosDestino = ((inventarioDestino?.data as any[] | undefined) || [])
    .filter(p => parseFloat(p.stock_total) > 0.0001)
  // Solo ítems con stock real (> 0) en el almacén origen seleccionado — evita elegir
  // productos que no existen en ese almacén.
  const productosOrigen = ((inventarioOrigen?.data as any[] | undefined) || [])
    .filter(p => parseFloat(p.disponible_total) > 0.0001)
  // Panel informativo: todo lo que hay físicamente en el origen, incluido el stock reservado
  // (que no se puede transferir por esta vía, solo con una salida de RESERVA).
  const productosOrigenInfo = ((inventarioOrigen?.data as any[] | undefined) || [])
    .filter(p => parseFloat(p.stock_total) > 0.0001)

  const qDisp = normalizar(dispSearch)
  const productosOrigenFiltrados = qDisp
    ? productosOrigenInfo.filter(p => normalizar(p.sku).includes(qDisp) || normalizar(p.descripcion).includes(qDisp))
    : productosOrigenInfo

  useEffect(() => { setDispSearch('') }, [almacenOrigenId])

  // Recarga stock de origen/destino, reservas (números de factura) e historial.
  const [refrescando, setRefrescando] = useState(false)
  const refrescar = async () => {
    setRefrescando(true)
    try {
      await Promise.all([
        qc.refetchQueries({ queryKey: ['inventario-trans-almacenes'] }),
        qc.refetchQueries({ queryKey: ['reservas-trans-almacenes'] }),
        qc.refetchQueries({ queryKey: ['trans-almacenes-historial'] }),
      ])
      toast.success('Datos actualizados')
    } catch {
      toast.error('No se pudo actualizar')
    } finally {
      setRefrescando(false)
    }
  }

  const agregarProductoOrigen = (id: number) => {
    setLineas(prev => [...prev, { producto_id: String(id), cantidad: '1' }])
  }

  const { data: historial, isLoading: loadingHist } = useQuery({
    queryKey: ['trans-almacenes-historial'],
    queryFn: () => api.get('/transferencias', { params: { search: 'TALM-', limit: 50 } }).then(r => r.data),
  })

  // Revertir: el stock vuelve al almacén de origen (y la reserva, si salió de una reserva).
  const revertMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/transferencias/${id}`, { data: { password: PASSWORD_CONFIRMACION_REVERSION } }).then(r => r.data),
    onSuccess: () => {
      toast.success('Transferencia revertida: el stock volvió al almacén de origen')
      qc.invalidateQueries({ queryKey: ['transferencias'] })
      qc.invalidateQueries({ queryKey: ['trans-almacenes-historial'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['inventario-trans-almacenes'] })
      qc.invalidateQueries({ queryKey: ['reservas-trans-almacenes'] })
      qc.invalidateQueries({ queryKey: ['reservas'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      qc.invalidateQueries({ queryKey: ['dashboard-gauges'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al revertir la transferencia')
    },
  })

  const handleRevertir = async (t: any) => {
    const ok = await confirm({
      title: 'Revertir transferencia',
      message: <>¿Revertir <strong>{t.numero}</strong>? El stock saldrá de <strong>{t.destino_nombre}</strong> y volverá a <strong>{t.origen_nombre}</strong>, y se eliminarán sus movimientos del Kardex.</>,
      variant: 'danger',
      confirmLabel: 'Revertir',
      requiresPassword: true,
      passwordLabel: 'Contraseña de confirmación',
      validatePassword: (v) => v === PASSWORD_CONFIRMACION_REVERSION ? null : 'Contraseña incorrecta',
    })
    if (!ok) return
    revertMutation.mutate(t.id)
  }

  const mutation = useMutation({
    mutationFn: (d: any) => api.post('/transferencias/entre-almacenes', d).then(r => r.data),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['transferencias'] })
      qc.invalidateQueries({ queryKey: ['trans-almacenes-historial'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['inventario-trans-almacenes'] })
      qc.invalidateQueries({ queryKey: ['reservas-trans-almacenes'] })
      qc.invalidateQueries({ queryKey: ['reservas'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      toast.success(`Transferencia entre almacenes registrada: ${r.numero}`)
      setLineas([])
      setObservaciones('')
      setPassword('')
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al registrar la transferencia'),
  })

  const setLinea = (i: number, patch: Partial<Linea>) => {
    setLineas(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  const agregarLinea = () => setLineas(prev => [...prev, { producto_id: '', cantidad: '' }])
  const quitarLinea = (i: number) => setLineas(prev => prev.filter((_, idx) => idx !== i))

  const lineasValidas = lineas.filter(l => l.producto_id && parseFloat(l.cantidad) > 0)
  const origenNombre = almacenesActivos.find((a: any) => String(a.id) === String(almacenOrigenId))?.nombre
  const destinoNombre = almacenesActivos.find((a: any) => String(a.id) === String(almacenDestinoId))?.nombre

  const handleSubmit = async () => {
    if (!almacenOrigenId || !almacenDestinoId || !fecha || !lineasValidas.length) {
      toast.error('Completa almacén origen, destino, fecha y al menos un producto con cantidad')
      return
    }
    // Verificación de contraseña desactivada temporalmente (por el momento).
    // if (!password) { toast.error('Ingresa la contraseña de confirmación'); return }

    const ok = await confirm({
      title: 'Confirmar Trans-Almacenes',
      message: (
        <>
          ¿Transferir <strong>{lineasValidas.length}</strong> producto(s) desde <strong>{origenNombre}</strong> hacia <strong>{destinoNombre}</strong>?
          <br /><br />
          Esta acción mueve stock real e impacta el Kardex de ambos almacenes.
        </>
      ),
      variant: 'warning',
      confirmLabel: 'Transferir',
    })
    if (!ok) return

    mutation.mutate({
      almacen_origen_id: almacenOrigenId,
      almacen_destino_id: almacenDestinoId,
      fecha,
      observaciones,
      password,
      detalles: lineasValidas.map(l => ({ producto_id: l.producto_id, cantidad: parseFloat(l.cantidad), ...(l.reserva_id ? { reserva_id: l.reserva_id } : {}) })),
    })
  }

  if (loadingAlmacenes) return <PageLoader />

  return (
    <div className="fade-in space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <ArrowRightLeft size={20} className="text-indigo-500" />
          <div>
            <h2 className="font-semibold text-slate-900">Trans-Almacenes</h2>
            <p className="text-xs text-slate-400">Transferencia libre de productos entre cualquier par de almacenes (no solo Central → Auxiliar), protegida con contraseña de confirmación.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Almacén Origen *</label>
              <select
                className="select"
                value={almacenOrigenId}
                onChange={e => {
                  setAlmacenOrigenId(e.target.value)
                  if (e.target.value === almacenDestinoId) setAlmacenDestinoId('')
                  // Los productos elegidos pertenecían al stock del almacén anterior; ya no son válidos.
                  setLineas([])
                }}
              >
                <option value="">-- Seleccionar --</option>
                {almacenesActivos.map((a: any) => <option key={a.id} value={a.id}>{a.nombre} ({a.tipo})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Almacén Destino *</label>
              <select className="select" value={almacenDestinoId} onChange={e => setAlmacenDestinoId(e.target.value)} disabled={!almacenOrigenId}>
                <option value="">-- Seleccionar --</option>
                {almacenesDestino.map((a: any) => <option key={a.id} value={a.id}>{a.nombre} ({a.tipo})</option>)}
              </select>
              {!almacenOrigenId && <p className="text-xs text-slate-400 mt-1">Selecciona el origen primero</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Fecha *</label>
              <input className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
            <div>
              <label className="label">Observaciones</label>
              <input className="input" value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="font-medium text-slate-900 text-sm">Productos a Transferir</label>
              <button type="button" onClick={refrescar} disabled={refrescando} className="btn-secondary text-xs py-1.5 ml-auto mr-2" title="Recargar stock y números de factura">
                <RefreshCw size={14} className={refrescando ? 'animate-spin' : ''} /> Actualizar
              </button>
              {/* Botón "Agregar" oculto: los productos se agregan con el "+" de los paneles de stock. */}
              <button type="button" onClick={agregarLinea} className="btn-secondary text-xs py-1.5 hidden">
                <Plus size={14} /> Agregar
              </button>
            </div>

            {!almacenOrigenId && (
              <p className="text-xs text-slate-400 mb-3">Selecciona el almacén origen para ver sus productos disponibles.</p>
            )}
            {almacenOrigenId && !productosOrigenInfo.length && (
              <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-3">
                Este almacén no tiene productos con stock actualmente.
              </p>
            )}
            {almacenOrigenId && reservasConSaldo.length > 0 && (
              <div className="border border-amber-200 rounded-xl overflow-hidden mb-3">
                <div className="px-3 py-2 bg-amber-50 border-b border-amber-200">
                  <span className="text-xs font-medium text-amber-800">
                    Reservas en {origenNombre} ({reservasConSaldo.length}) — se transfiere la cantidad que indiques; el saldo queda en el origen
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-100">
                        <th className="table-header text-left">Factura</th>
                        <th className="table-header text-left">Producto</th>
                        <th className="table-header text-right">Saldo reserva</th>
                        <th className="table-header w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {reservasConSaldo.map((r: any) => (
                        <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-amber-50/50">
                          <td className="px-3 py-1.5 font-mono text-amber-800 whitespace-nowrap">{r.nro_factura || 'Sin factura'}</td>
                          <td className="px-3 py-1.5 text-slate-700 truncate max-w-[220px]">{r.sku} · {r.producto_descripcion}</td>
                          <td className="px-3 py-1.5 text-right text-amber-700 font-medium whitespace-nowrap">{parseFloat(r.saldo).toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => agregarReserva(r)}
                              className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded-sm"
                              title="Agregar a la transferencia"
                            >
                              <Plus size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {almacenOrigenId && productosOrigenInfo.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden mb-3">
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
                  <span className="text-xs font-medium text-slate-600">
                    Stock en {origenNombre} ({productosOrigenFiltrados.length}{productosOrigenFiltrados.length !== productosOrigenInfo.length ? ` de ${productosOrigenInfo.length}` : ''})
                  </span>
                  <div className="relative w-56">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      className="input text-xs pl-6 py-1"
                      placeholder="Filtrar por SKU o nombre..."
                      value={dispSearch}
                      onChange={e => setDispSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-100">
                        <th className="table-header text-left">SKU</th>
                        <th className="table-header text-left">Producto</th>
                        <th className="table-header text-right">Stock físico</th>
                        <th className="table-header text-right">Reservado</th>
                        <th className="table-header text-right">Disponible</th>
                        <th className="table-header w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {productosOrigenFiltrados.length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-3 text-center text-slate-400">Sin resultados</td></tr>
                      ) : productosOrigenFiltrados.map((p: any) => {
                        const transferible = parseFloat(p.disponible_total) > 0.0001
                        return (
                          <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-blue-50/50">
                            <td className="px-3 py-1.5 font-mono text-blue-700 whitespace-nowrap">{p.sku}</td>
                            <td className="px-3 py-1.5 text-slate-700 truncate max-w-[220px]">{p.descripcion}</td>
                            <td className="px-3 py-1.5 text-right text-slate-700 whitespace-nowrap">{parseFloat(p.stock_total).toFixed(2)} {p.unidad}</td>
                            <td className="px-3 py-1.5 text-right text-amber-700 whitespace-nowrap">{parseFloat(p.reservado_total).toFixed(2)}</td>
                            <td className={`px-3 py-1.5 text-right font-medium whitespace-nowrap ${transferible ? 'text-emerald-700' : 'text-slate-400'}`}>{parseFloat(p.disponible_total).toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-center">
                              {transferible && (
                                <button
                                  type="button"
                                  onClick={() => agregarProductoOrigen(p.id)}
                                  className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded-sm"
                                  title="Agregar a la transferencia"
                                >
                                  <Plus size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {almacenDestinoId && (
              <div className="border border-slate-200 rounded-xl overflow-hidden mb-3">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                  <span className="text-xs font-medium text-slate-600">
                    Stock actual en {destinoNombre} ({productosDestino.length} producto(s) con stock)
                  </span>
                </div>
                {!inventarioDestino ? (
                  <p className="px-3 py-3 text-xs text-slate-400">Cargando...</p>
                ) : !productosDestino.length ? (
                  <p className="px-3 py-3 text-xs text-slate-400">Este almacén no tiene productos con stock actualmente.</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-slate-100">
                          <th className="table-header text-left">SKU</th>
                          <th className="table-header text-left">Producto</th>
                          <th className="table-header text-right">Stock físico</th>
                          <th className="table-header text-right">Reservado</th>
                          <th className="table-header text-right">Disponible</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productosDestino.map((p: any) => (
                          <tr key={p.id} className="border-b border-slate-50 last:border-0">
                            <td className="px-3 py-1.5 font-mono text-blue-700 whitespace-nowrap">{p.sku}</td>
                            <td className="px-3 py-1.5 text-slate-700 truncate max-w-[220px]">{p.descripcion}</td>
                            <td className="px-3 py-1.5 text-right text-slate-700 font-medium whitespace-nowrap">{parseFloat(p.stock_total).toFixed(2)} {p.unidad}</td>
                            <td className="px-3 py-1.5 text-right text-amber-700 whitespace-nowrap">{parseFloat(p.reservado_total).toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right text-emerald-700 whitespace-nowrap">{parseFloat(p.disponible_total).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* La tabla aparece solo cuando se agrega algo con el botón "+" de los paneles de stock. */}
            {lineas.length === 0 && (
              <p className="text-xs text-slate-400 italic">Usa el botón "+" de las filas de stock o de reservas para agregar productos a transferir.</p>
            )}
            {lineas.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-visible">
              <table className="w-full">
                <thead><tr className="bg-slate-50">
                  <th className="table-header text-left">Producto</th>
                  <th className="table-header text-center w-36">Disponible Origen</th>
                  <th className="table-header text-center w-36">Stock Destino</th>
                  <th className="table-header text-right w-32">Cantidad</th>
                  <th className="table-header w-10"></th>
                </tr></thead>
                <tbody>
                  {lineas.map((l, i) => {
                    const reservaLinea = getReserva(l.reserva_id)
                    const disponible = almacenOrigenId
                      ? (l.reserva_id ? (reservaLinea ? parseFloat(reservaLinea.saldo) : null) : getDisponible(l.producto_id))
                      : null
                    const sinStock = disponible !== null && disponible <= 0
                    return (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          {l.reserva_id ? (
                            <div className="text-xs">
                              <span className="rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white mr-2">RESERVA</span>
                              <span className="font-mono text-amber-800">{reservaLinea?.nro_factura || 'Sin factura'}</span>
                              <span className="block text-slate-600 mt-0.5">{reservaLinea?.sku} · {reservaLinea?.producto_descripcion}</span>
                            </div>
                          ) : !almacenOrigenId ? (
                            <p className="text-xs text-slate-400 italic">Selecciona el almacén origen primero</p>
                          ) : !productosOrigen.length ? (
                            <p className="text-xs text-red-500 italic">Este almacén no tiene productos con stock</p>
                          ) : (
                            <ProductoBuscador
                              productos={productosOrigen}
                              value={l.producto_id}
                              onChange={id => setLinea(i, { producto_id: id })}
                              placeholder="Buscar SKU, nombre o código..."
                            />
                          )}
                        </td>
                        <td className="px-2 py-2 w-36 text-center">
                          {!almacenOrigenId ? (
                            <span className="text-xs text-slate-300">Elige origen</span>
                          ) : disponible !== null ? (
                            <span className={`text-sm font-bold ${sinStock ? 'text-red-600' : 'text-emerald-700'}`}>{disponible}</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 w-36 text-center">
                          {!almacenDestinoId || !l.producto_id ? (
                            <span className="text-xs text-slate-300">—</span>
                          ) : (
                            <span className="text-sm font-bold text-slate-700">{getStockDestino(l.producto_id)}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 w-32">
                          <input
                            className="input text-right text-sm"
                            type="number" step="0.0001" min="0.0001"
                            max={disponible !== null && disponible > 0 ? disponible : undefined}
                            value={l.cantidad}
                            onChange={e => setLinea(i, { cantidad: e.target.value })}
                          />
                          {sinStock && <p className="text-[10px] text-red-500 mt-0.5 text-right">Sin stock en origen</p>}
                          {!sinStock && disponible !== null && parseFloat(l.cantidad) > 0 && parseFloat(l.cantidad) <= disponible && (
                            <p className="text-[10px] text-slate-400 mt-0.5 text-right">Queda en origen: {+(disponible - parseFloat(l.cantidad)).toFixed(4)}</p>
                          )}
                        </td>
                        <td className="px-2 py-2 w-10">
                          <button type="button" onClick={() => quitarLinea(i)} className="p-1 text-red-400 hover:text-red-600">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>

          {/* Confirmación con contraseña desactivada temporalmente (por el momento).
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <label className="label flex items-center gap-1.5"><KeyRound size={14} /> Contraseña de Confirmación *</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Ingresa la contraseña para confirmar el movimiento"
              autoComplete="off"
            />
            <p className="text-xs text-amber-700 mt-1">Requerida para autorizar movimientos de stock entre almacenes.</p>
          </div>
          */}

          <div className="flex justify-end pt-2">
            <button
              className="btn-primary"
              disabled={mutation.isPending || !almacenOrigenId || !almacenDestinoId || !fecha || !lineasValidas.length}
              onClick={handleSubmit}
            >
              {mutation.isPending ? 'Procesando...' : 'Transferir'}
            </button>
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Warehouse size={18} className="text-indigo-500" />
          <span className="font-semibold text-slate-900">Historial Trans-Almacenes</span>
          <span className="ml-auto text-sm text-slate-400">{historial?.data?.length ?? 0} registros</span>
        </div>
        {loadingHist ? (
          <div className="px-6 py-4 text-sm text-slate-400">Cargando...</div>
        ) : !historial?.data?.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header text-left">Código</th>
                  <th className="table-header text-left">Fecha</th>
                  <th className="table-header text-left">Origen</th>
                  <th className="table-header text-center">→</th>
                  <th className="table-header text-left">Destino</th>
                  <th className="table-header text-center">Estado</th>
                  <th className="table-header text-left">Responsable</th>
                  <th className="table-header text-center"></th>
                </tr>
              </thead>
              <tbody>
                {historial.data.map((t: any) => (
                  <tr key={t.id} className="table-row">
                    <td className="table-cell font-mono text-xs font-bold text-indigo-700">{t.numero}</td>
                    <td className="table-cell text-slate-500">{t.fecha}</td>
                    <td className="table-cell text-slate-900">{t.origen_nombre}</td>
                    <td className="table-cell text-center text-slate-400">→</td>
                    <td className="table-cell text-slate-900">{t.destino_nombre}</td>
                    <td className="table-cell text-center text-xs text-slate-500">{t.estado}</td>
                    <td className="table-cell text-slate-500">{t.usuario_nombre || '—'}</td>
                    <td className="table-cell text-center">
                      {t.estado === 'completada' && (
                        <button
                          type="button"
                          className="btn-secondary text-xs py-1 px-2 text-red-600"
                          disabled={revertMutation.isPending}
                          onClick={() => handleRevertir(t)}
                        >
                          <Undo2 size={13} /> Revertir
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
    </div>
  )
}
