'use client'

import clsx from 'clsx'

const variants: Record<string, string> = {
  // Estados cotizaciones/OC
  borrador: 'bg-slate-100 text-slate-600',
  enviada: 'bg-blue-100 text-blue-700',
  aprobada: 'bg-green-100 text-green-700',
  rechazada: 'bg-red-100 text-red-700',
  vencida: 'bg-orange-100 text-orange-700',
  convertida: 'bg-purple-100 text-purple-700',
  emitida: 'bg-red-100 text-red-700 font-bold',
  emitida_con_factura: 'bg-amber-100 text-amber-700 font-bold',
  parcialmente_recibida: 'bg-yellow-100 text-yellow-700',
  completada: 'bg-green-100 text-green-700',
  anulada: 'bg-red-100 text-red-600 line-through',
  // Estados pago
  pendiente: 'bg-yellow-100 text-yellow-700',
  parcial: 'bg-orange-100 text-orange-700',
  pagado: 'bg-green-100 text-green-700',
  verificado: 'bg-emerald-100 text-emerald-700',
  // Estados factura
  registrada: 'bg-blue-100 text-blue-700',
  validada: 'bg-green-100 text-green-700',
  // Tipos almacén
  principal: 'bg-indigo-100 text-indigo-700',
  central: 'bg-purple-100 text-purple-700',
  auxiliar: 'bg-teal-100 text-teal-700',
  // Estados stock
  normal: 'bg-green-100 text-green-700',
  bajo: 'bg-yellow-100 text-yellow-700',
  critico: 'bg-red-100 text-red-700',
  sin_stock: 'bg-slate-200 text-slate-600',
  // General
  activo: 'bg-green-100 text-green-700',
  inactivo: 'bg-slate-100 text-slate-500',
  // Kardex
  entrada: 'bg-green-100 text-green-700',
  salida: 'bg-red-100 text-red-600',
  ajuste: 'bg-yellow-100 text-yellow-700',
  // Cierre de período
  cerrado: 'bg-slate-800 text-white',
  reabierto: 'bg-amber-100 text-amber-700',
}

interface BadgeProps {
  value: string
  label?: string
  className?: string
}

const specialLabels: Record<string, string> = {
  emitida: 'EMITIDA · SUBIR FACTURA',
  emitida_con_factura: 'EMITIDA · FACTURA SUBIDA',
  parcialmente_recibida: 'parcialmente recibida',
}

export default function Badge({ value, label, className }: BadgeProps) {
  const style = variants[value] || 'bg-slate-100 text-slate-600'
  return (
    <span className={clsx('badge', style, className)}>
      {label || specialLabels[value] || value.replace(/_/g, ' ')}
    </span>
  )
}
