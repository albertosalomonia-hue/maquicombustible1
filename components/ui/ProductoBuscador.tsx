'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

interface Producto {
  id: number
  sku: string
  codigo_interno?: string
  descripcion: string
  estado?: string
}

interface ProductoBuscadorProps {
  productos: Producto[]
  value: string | number | undefined
  onChange: (id: string) => void
  placeholder?: string
  /** Máximo de resultados a mostrar en el listado. Por defecto 40. */
  maxResultados?: number
}

export function normalizar(s: string) {
  return (s || '').toString().toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
}

export default function ProductoBuscador({ productos, value, onChange, placeholder, maxResultados = 40 }: ProductoBuscadorProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const seleccionado = productos.find(p => String(p.id) === String(value))

  useEffect(() => {
    if (!open) setQuery(seleccionado ? `${seleccionado.sku} - ${seleccionado.descripcion}` : '')
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
    ? productos.filter(p =>
        normalizar(p.sku).includes(q) ||
        normalizar(p.codigo_interno || '').includes(q) ||
        normalizar(p.descripcion).includes(q)
      )
    : productos
  ).slice(0, maxResultados)

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          className="input text-xs pl-6 pr-6"
          placeholder={placeholder || 'Buscar por N°, SKU o producto...'}
          value={query}
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
        />
        {seleccionado && !open && (
          <button
            type="button"
            onClick={() => { onChange(''); setQuery(''); }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-500"
            title="Quitar producto"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-96 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl">
          {resultados.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Sin resultados</div>
          ) : resultados.map(p => (
            <button
              type="button"
              key={p.id}
              onClick={() => { onChange(String(p.id)); setOpen(false); setQuery(`${p.sku} - ${p.descripcion}`) }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex flex-col border-b border-slate-50 last:border-0"
            >
              <span className="font-mono font-semibold text-blue-700">
                {p.sku}{p.codigo_interno ? ` · ${p.codigo_interno}` : ''}
                {p.estado === 'inactivo' && <span className="ml-1 text-[10px] font-sans font-normal text-slate-400">(inactivo)</span>}
              </span>
              <span className="text-slate-600 truncate">{p.descripcion}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
