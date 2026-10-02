'use client'

import { PackageOpen } from 'lucide-react'

interface EmptyStateProps {
  message?: string
  description?: string
}

export default function EmptyState({ message = 'Sin registros', description = 'No se encontraron datos.' }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <PackageOpen size={48} strokeWidth={1} className="mb-4" />
      <p className="text-base font-medium text-slate-600">{message}</p>
      <p className="text-sm mt-1">{description}</p>
    </div>
  )
}
