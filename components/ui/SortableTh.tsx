'use client'

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

interface Props {
  col: string
  label: string
  sortCol: string
  sortDir: 'asc' | 'desc'
  onSort: (col: string) => void
  align?: 'left' | 'right' | 'center'
  className?: string
}

export default function SortableTh({ col, label, sortCol, sortDir, onSort, align = 'left', className = '' }: Props) {
  const active = sortCol === col
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return (
    <th
      className={`table-header ${alignClass} cursor-pointer select-none group ${className}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors">
        {label}
        {active
          ? sortDir === 'asc'
            ? <ChevronUp size={13} className="text-blue-500 shrink-0" />
            : <ChevronDown size={13} className="text-blue-500 shrink-0" />
          : <ChevronsUpDown size={13} className="text-slate-300 group-hover:text-slate-400 shrink-0" />
        }
      </span>
    </th>
  )
}
