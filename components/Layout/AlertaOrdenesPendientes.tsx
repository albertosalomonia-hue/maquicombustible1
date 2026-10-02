'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PackageX } from 'lucide-react'
import Modal from '../ui/Modal'
import { useOrdenesPendientesAlerta } from '../../hooks/useOrdenesPendientesAlerta'

// Alerta modal para el rol almacenero: si hay órdenes de compra de Almacén Central aún
// sin recepcionar (total o parcialmente) que no se le hayan mostrado antes, se le avisa.
// Cerrar este modal solo evita que se repita el mismo popup — la campanita del Header
// sigue marcando hasta que la OC de verdad se recepcione (ver useOrdenesPendientesAlerta).
export default function AlertaOrdenesPendientes() {
  const router = useRouter()
  const { habilitado, sinVer, marcarVistas } = useOrdenesPendientesAlerta()
  const [visible, setVisible] = useState(false)
  const [mostrando, setMostrando] = useState<any[]>([])

  useEffect(() => {
    if (sinVer.length) {
      setMostrando(sinVer)
      setVisible(true)
    }
  }, [sinVer])

  const cerrar = () => {
    marcarVistas(mostrando.map(oc => oc.id))
    setVisible(false)
  }

  if (!habilitado) return null

  return (
    <Modal isOpen={visible} onClose={cerrar} title="Órdenes de compra por recepcionar" size="lg">
      <div className="p-6">
        <div className="flex items-start gap-3 mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <PackageX size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Hay <strong>{mostrando.length}</strong> orden(es) de compra del Almacén Central que aún no se han recepcionado.
          </p>
        </div>
        <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="table-header text-left">N° OC</th>
                <th className="table-header text-left">Fecha</th>
                <th className="table-header text-left">Proveedor</th>
                <th className="table-header text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {mostrando.map(oc => (
                <tr key={oc.id} className="border-t border-slate-100">
                  <td className="table-cell font-mono text-xs font-bold text-indigo-700">{oc.numero}</td>
                  <td className="table-cell text-slate-500">{oc.fecha?.slice?.(0, 10) || oc.fecha}</td>
                  <td className="table-cell text-slate-700">{oc.cliente_nombre || '—'}</td>
                  <td className="table-cell text-right font-medium">{oc.moneda} {parseFloat(oc.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button className="btn-secondary" onClick={cerrar}>Entendido</button>
          <button className="btn-primary" onClick={() => { cerrar(); router.push('/ordenes-compra') }}>
            Ir a recepcionar
          </button>
        </div>
      </div>
    </Modal>
  )
}
