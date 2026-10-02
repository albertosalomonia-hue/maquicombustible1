'use client'

import { useState, useMemo } from 'react'

export type SortDir = 'asc' | 'desc'

export function useSortTable<T = any>(data: T[], defaultCol = '', defaultDir: SortDir = 'asc') {
  const [sortCol, setSortCol] = useState(defaultCol)
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir)

  const toggle = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const esNumerico = (v: any) => v !== null && v !== undefined && v !== '' && /^-?\d+(\.\d+)?$/.test(String(v).trim())

  const sorted = useMemo(() => {
    if (!sortCol) return data
    return [...data].sort((a: any, b: any) => {
      let va = a[sortCol] ?? ''
      let vb = b[sortCol] ?? ''
      if (esNumerico(va) && esNumerico(vb)) {
        va = parseFloat(va); vb = parseFloat(vb)
      } else {
        va = String(va).toLowerCase()
        vb = String(vb).toLowerCase()
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [data, sortCol, sortDir])

  return { sorted, sortCol, sortDir, toggle }
}
