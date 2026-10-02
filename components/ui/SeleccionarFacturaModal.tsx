'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import api from '../../services/api'
import Modal from './Modal'
import EmptyState from './EmptyState'

interface SeleccionarFacturaModalProps {
  isOpen: boolean
  onClose: () => void
  productoId: string | number | undefined
  almacenId?: string | number | undefined
  onSelect: (factura: any) => void
}

export default function SeleccionarFacturaModal({ isOpen, onClose, productoId, almacenId, onSelect }: SeleccionarFacturaModalProps) {
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['facturas-producto', productoId, search],
    queryFn: () => api.get('/facturas', { params: { producto_id: productoId, search: search || undefined, limit: 50 } }).then(r => r.data),
    enabled: isOpen && !!productoId,
  })
  const { data: dataSI } = useQuery({
    queryKey: ['facturas-saldo-inicial', productoId, almacenId, search],
    queryFn: () => api.get('/facturas/saldos-iniciales', { params: { producto_id: productoId, almacen_id: almacenId || undefined, search: search || undefined } }).then(r => r.data),
    enabled: isOpen && !!productoId,
  })
  const facturas = [...(dataSI?.data || []), ...(data?.data || [])]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Seleccionar Factura de Diésel" size="lg">
      <div className="p-6 space-y-4">
        {!productoId ? (
          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            Primero selecciona el producto diésel en la línea de la salida.
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-400">
              Solo se muestran facturas cuya orden de compra incluyó este producto.
            </p>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="Buscar por serie, número o cliente..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {isLoading ? (
              <p className="text-sm text-slate-400 px-1">Cargando...</p>
            ) : !facturas.length ? (
              <EmptyState />
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-y-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="table-header text-left">Factura</th>
                      <th className="table-header text-left">Fecha</th>
                      <th className="table-header text-left">OC</th>
                      <th className="table-header text-right">Galones</th>
                      <th className="table-header text-right">Despachado</th>
                      <th className="table-header text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facturas.map((f: any) => {
                      const recibido = parseFloat(f.cantidad_recibida || 0)
                      const despachado = parseFloat(f.cantidad_despachada || 0)
                      const saldo = f.saldo_disponible != null ? parseFloat(f.saldo_disponible) : recibido - despachado
                      const agotado = saldo <= 0
                      return (
                        <tr
                          key={f.id}
                          onClick={() => { onSelect(f); onClose() }}
                          className={`table-row cursor-pointer hover:bg-blue-50 ${agotado ? 'opacity-60' : ''}`}
                        >
                          <td className="table-cell font-mono text-xs font-semibold text-slate-800">{f.es_saldo_inicial ? f.nro_factura : `${f.serie}-${f.numero}`}</td>
                          <td className="table-cell text-slate-500">{f.fecha}</td>
                          <td className="table-cell text-slate-500">{f.es_saldo_inicial ? `Saldo inicial ${f.oc_numero || ''}` : (f.oc_numero || '—')}</td>
                          <td className="table-cell text-right">{recibido.toFixed(2)}</td>
                          <td className="table-cell text-right text-slate-500">{despachado.toFixed(2)}</td>
                          <td className={`table-cell text-right font-semibold ${agotado ? 'text-red-600' : 'text-green-700'}`}>
                            {saldo.toFixed(2)}
                            {agotado && <span className="ml-1 text-[10px] font-normal">(agotado)</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <div className="flex justify-end pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  )
}
