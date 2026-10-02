'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

interface CentroCosto {
  id: number
  codigo: string
  nombre: string
}

interface CentroCostoBuscadorProps {
  centrosCosto: CentroCosto[]
  value: string | number | undefined
  onChange: (id: string) => void
  placeholder?: string
}

function normalizar(s: string) {
  return (s || '').toString().toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
}

export default function CentroCostoBuscador({ centrosCosto, value, onChange, placeholder }: CentroCostoBuscadorProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const seleccionado = centrosCosto.find(c => String(c.id) === String(value))

  useEffect(() => {
    if (!open) setQuery(seleccionado ? `${seleccionado.codigo} - ${seleccionado.nombre}` : '')
  }, [seleccionado?.id, open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const q = normalizar(query)
  const resultados = (q
    ? centrosCosto.filter(c =>
        normalizar(c.codigo).includes(q) ||
        normalizar(c.nombre).includes(q)
      )
    : centrosCosto
  ).slice(0, 40)

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          className="input text-sm pl-8 pr-7"
          placeholder={placeholder || 'Escribe para buscar centro de costo...'}
          value={query}
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={e => { setQuery(e.target.value); setOpen(true); onChange('') }}
        />
        {seleccionado && !open && (
          <button
            type="button"
            onClick={() => { onChange(''); setQuery('') }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-500"
            title="Quitar centro de costo"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl">
          {resultados.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Sin resultados</div>
          ) : resultados.map(c => (
            <button
              type="button"
              key={c.id}
              onClick={() => { onChange(String(c.id)); setOpen(false); setQuery(`${c.codigo} - ${c.nombre}`) }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex flex-col border-b border-slate-50 last:border-0"
            >
              <span className="font-mono font-semibold text-blue-700">{c.codigo}</span>
              <span className="text-slate-600 truncate">{c.nombre}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
