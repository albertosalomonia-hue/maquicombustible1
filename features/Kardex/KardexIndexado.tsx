'use client'

import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ListOrdered, FileDown } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import EmptyState from '../../components/ui/EmptyState'

const n2 = (n: any) => parseFloat(String(n) || '0').toFixed(2)
const S  = (n: any) => `S/ ${n2(n)}`

// Reporte "Indexado": una sola línea por producto con sus entradas, salidas y saldo
// acumulados en el rango filtrado (sin fecha, solo el movimiento del producto).
export default function KardexIndexado({ params }: { params: Record<string, any> }) {
  const [exportando, setExportando] = useState(false)
  const { page: _p, limit: _l, ...filtros } = params

  const { data, isLoading } = useQuery({
    queryKey: ['kardex-indexado', filtros],
    queryFn: () => api.get('/kardex/indexado', { params: filtros }).then(r => r.data),
    placeholderData: keepPreviousData,
  })
  const filas: any[] = data?.data || []

  const tot = filas.reduce((a, f) => ({
    ent: a.ent + parseFloat(f.entrada_valor || 0),
    sal: a.sal + parseFloat(f.salida_valor || 0),
    saldo: a.saldo + parseFloat(f.saldo_valor || 0),
  }), { ent: 0, sal: 0, saldo: 0 })

  const handleExport = async () => {
    if (!filas.length) { toast.error('No hay datos para exportar'); return }
    setExportando(true)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      wb.creator = 'KardexERP 2026'
      const ws = wb.addWorksheet('Indexado', { views: [{ state: 'frozen', ySplit: 2 }] })
      ws.columns = [16, 38, 20, 10, 11, 11, 13, 11, 11, 13, 11, 13, 13].map(width => ({ width }))

      const simples: [string, string][] = [['A', 'SKU'], ['B', 'Producto'], ['C', 'Categoría'], ['D', 'Unidad']]
      simples.forEach(([c, l]) => { ws.mergeCells(`${c}1:${c}2`); ws.getCell(`${c}1`).value = l })
      ws.mergeCells('E1:G1'); ws.getCell('E1').value = 'ENTRADAS'
      ws.mergeCells('H1:J1'); ws.getCell('H1').value = 'SALIDAS'
      ws.mergeCells('K1:M1'); ws.getCell('K1').value = 'SALDO'
      const subs: Record<string, string> = {
        E2: 'Cant.', F2: 'P.U.', G2: 'Total', H2: 'Cant.', I2: 'P.U.', J2: 'Total',
        K2: 'Cant.', L2: 'C.U. Prom.', M2: 'Total',
      }
      Object.entries(subs).forEach(([a, v]) => { ws.getCell(a).value = v })

      const grupos: [string[], string][] = [
        [['A1', 'B1', 'C1', 'D1'], 'FF1E293B'],
        [['E1', 'F1', 'G1', 'E2', 'F2', 'G2'], 'FF15803D'],
        [['H1', 'I1', 'J1', 'H2', 'I2', 'J2'], 'FFB91C1C'],
        [['K1', 'L1', 'M1', 'K2', 'L2', 'M2'], 'FF1D4ED8'],
      ]
      grupos.forEach(([addrs, bg]) => addrs.forEach(a => {
        const c = ws.getCell(a)
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        c.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 }
        c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      }))

      filas.forEach(f => {
        const row = ws.addRow([
          f.sku, f.producto_descripcion, f.categoria, f.unidad || '',
          parseFloat(f.entrada_cantidad), parseFloat(f.entrada_costo_unitario), parseFloat(f.entrada_valor),
          parseFloat(f.salida_cantidad), parseFloat(f.salida_costo_unitario), parseFloat(f.salida_valor),
          parseFloat(f.saldo_cantidad), parseFloat(f.saldo_costo_unitario), parseFloat(f.saldo_valor),
        ])
        ;[6, 7, 9, 10, 12, 13].forEach(c => { row.getCell(c).numFmt = '"S/ "#,##0.00' })
        ;[5, 8, 11].forEach(c => { row.getCell(c).numFmt = '#,##0.00' })
      })
      const t = ws.addRow(['', '', '', 'TOTALES', '', '', tot.ent, '', '', tot.sal, '', '', tot.saldo])
      t.font = { bold: true }
      ;[7, 10, 13].forEach(c => { t.getCell(c).numFmt = '"S/ "#,##0.00' })
      ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 13 } }

      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `kardex_indexado_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      toast.error('Error al exportar el reporte')
    } finally {
      setExportando(false)
    }
  }

  const thL = 'px-3 py-2 text-xs font-semibold text-slate-600 text-left bg-slate-50 border-b border-slate-200 whitespace-nowrap'
  const th  = 'px-3 py-2 text-xs font-semibold text-slate-600 text-right border-b border-slate-200 whitespace-nowrap'
  const td  = 'px-3 py-2 text-xs text-right align-middle'
  const tdL = 'px-3 py-2 text-xs text-left align-middle'

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-6 py-4 border-b border-slate-100 bg-white">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg"><ListOrdered size={18} className="text-blue-600" /></div>
          <div>
            <p className="font-bold text-slate-900 text-base">Kardex Indexado</p>
            <p className="text-xs text-slate-500 mt-0.5">Una línea por producto: entradas, salidas y saldo acumulados</p>
          </div>
        </div>
        <div className="sm:ml-auto flex items-center gap-3">
          <span className="text-sm text-slate-400">{filas.length} productos</span>
          <button className="btn-secondary text-xs py-1.5" onClick={handleExport} disabled={exportando || !filas.length}>
            <FileDown size={14} /> {exportando ? 'Exportando...' : 'Exportar Excel'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="p-6 text-sm text-slate-400">Cargando...</p>
      ) : !filas.length ? (
        <EmptyState message="Sin movimientos" description="No hay movimientos para los filtros seleccionados." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className={thL} rowSpan={2}>SKU</th>
                <th className={thL} rowSpan={2}>Producto</th>
                <th className={thL} rowSpan={2}>Categoría</th>
                <th className={thL} rowSpan={2}>Unidad</th>
                <th colSpan={3} className="px-3 py-1.5 text-xs font-bold text-green-700 bg-green-50 text-center border-x border-green-200">ENTRADAS</th>
                <th colSpan={3} className="px-3 py-1.5 text-xs font-bold text-red-700 bg-red-50 text-center border-x border-red-200">SALIDAS</th>
                <th colSpan={3} className="px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 text-center border-x border-blue-200">SALDO</th>
              </tr>
              <tr className="border-b border-slate-200">
                <th className={`${th} bg-green-50 border-l border-green-200`}>Cant.</th>
                <th className={`${th} bg-green-50`}>P.U.</th>
                <th className={`${th} bg-green-50 border-r border-green-200`}>Total</th>
                <th className={`${th} bg-red-50 border-l border-red-200`}>Cant.</th>
                <th className={`${th} bg-red-50`}>P.U.</th>
                <th className={`${th} bg-red-50 border-r border-red-200`}>Total</th>
                <th className={`${th} bg-blue-50 border-l border-blue-200`}>Cant.</th>
                <th className={`${th} bg-blue-50`}>C.U. Prom.</th>
                <th className={`${th} bg-blue-50 border-r border-blue-200`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, idx) => (
                <tr key={f.producto_id} className={`border-b border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-blue-50/30`}>
                  <td className={`${tdL} font-mono text-slate-500`}>{f.sku}</td>
                  <td className={`${tdL} font-medium text-slate-800 min-w-[220px]`}>{f.producto_descripcion}</td>
                  <td className={`${tdL} text-slate-500`}>{f.categoria}</td>
                  <td className={`${tdL} text-slate-500`}>{f.unidad || '—'}</td>
                  <td className={`${td} border-l border-green-100 text-green-700 font-semibold`}>{n2(f.entrada_cantidad)}</td>
                  <td className={`${td} text-green-600`}>{S(f.entrada_costo_unitario)}</td>
                  <td className={`${td} border-r border-green-100 text-green-700 font-bold`}>{S(f.entrada_valor)}</td>
                  <td className={`${td} border-l border-red-100 text-red-600 font-semibold`}>{n2(f.salida_cantidad)}</td>
                  <td className={`${td} text-red-500`}>{S(f.salida_costo_unitario)}</td>
                  <td className={`${td} border-r border-red-100 text-red-600 font-bold`}>{S(f.salida_valor)}</td>
                  <td className={`${td} border-l border-blue-100 text-slate-800 font-semibold`}>{n2(f.saldo_cantidad)}</td>
                  <td className={`${td} text-slate-600`}>{S(f.saldo_costo_unitario)}</td>
                  <td className={`${td} border-r border-blue-100 text-blue-700 font-bold`}>{S(f.saldo_valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                <td colSpan={6} className="px-3 py-2 text-xs text-slate-600 text-right">TOTALES</td>
                <td className="px-3 py-2 text-xs text-right text-green-700">{S(tot.ent)}</td>
                <td colSpan={2}></td>
                <td className="px-3 py-2 text-xs text-right text-red-600">{S(tot.sal)}</td>
                <td colSpan={2}></td>
                <td className="px-3 py-2 text-xs text-right text-blue-700">{S(tot.saldo)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
