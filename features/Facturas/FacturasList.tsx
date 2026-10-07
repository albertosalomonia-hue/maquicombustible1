'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, Receipt, CheckCircle, Trash2, ExternalLink, Download, Undo2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'
import { useConfirm } from '../../context/ConfirmContext'

export default function FacturasList() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const [empresaId, setEmpresaId] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['facturas', search, empresaId],
    queryFn: () => api.get('/facturas', { params: { search, cliente_id: empresaId || undefined, limit: 5000, incluir_anuladas: 1, incluir_reserva: 1 } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })
  const { data: clientes } = useQuery({ queryKey: ['clientes-sel'], queryFn: () => api.get('/clientes', { params: { limit: 500 } }).then(r => r.data.data) })
  const { data: ocs } = useQuery({
    queryKey: ['ocs-emitidas'],
    queryFn: () => api.get('/ordenes-compra', { params: { estado: 'emitida', limit: 200 } }).then(r => r.data.data),
  })

  const { register, handleSubmit, reset, watch, formState: { isSubmitting } } = useForm<any>({ defaultValues: { serie: '', numero: '', tipo: 'factura', fecha: '', cliente_id: '', orden_compra_id: '', subtotal: '', igv: 0, observaciones: '' } })
  const subtotal = parseFloat(watch('subtotal') || '0')
  const igvPct = 18
  const igvCalc = subtotal * igvPct / 100
  const totalCalc = subtotal + igvCalc

  const mutation = useMutation({
    mutationFn: (d: any) => api.post('/facturas', { ...d, igv: igvCalc, total: totalCalc }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['facturas'] }); toast.success('Factura registrada'); setModalOpen(false); reset() },
  })

  const validar = useMutation({
    mutationFn: (id: number) => api.put(`/facturas/${id}/estado`, { estado: 'validada' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['facturas'] }); toast.success('Factura validada') },
  })

  const CLAVE_ELIMINAR = '@ayala.com'

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/facturas/${id}`, { data: { password: CLAVE_ELIMINAR } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facturas'] })
      qc.invalidateQueries({ queryKey: ['ordenes-compra'] })
      toast.success('Factura anulada')
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al anular la factura'),
  })

  const retornarMutation = useMutation({
    mutationFn: (id: number) => api.post(`/facturas/${id}/retornar`, { password: CLAVE_ELIMINAR }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facturas'] })
      qc.invalidateQueries({ queryKey: ['ordenes-compra'] })
      toast.success('Factura retornada correctamente')
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al retornar la factura'),
  })

  const handleDelete = async (f: any) => {
    const ok = await confirm({
      title: 'Eliminar factura',
      message: <>¿Eliminar la factura <strong>{f.serie}-{f.numero}</strong>? Quedará anulada, marcada en rojo en el listado (no se borra físicamente y puede retornarse).</>,
      variant: 'danger',
      confirmLabel: 'Eliminar',
      requiresPassword: true,
      passwordLabel: 'Contraseña de confirmación',
      validatePassword: (v) => v === CLAVE_ELIMINAR ? null : 'Contraseña incorrecta',
    })
    if (!ok) return
    deleteMutation.mutate(f.id)
  }

  const handleRetornar = async (f: any) => {
    const ok = await confirm({
      title: 'Retornar factura',
      message: <>¿Retornar la factura <strong>{f.serie}-{f.numero}</strong>? Volverá a su estado anterior a la eliminación.</>,
      variant: 'danger',
      confirmLabel: 'Retornar',
      requiresPassword: true,
      passwordLabel: 'Contraseña de confirmación',
      validatePassword: (v) => v === CLAVE_ELIMINAR ? null : 'Contraseña incorrecta',
    })
    if (!ok) return
    retornarMutation.mutate(f.id)
  }

  const facturas = data?.data || []
  const { sorted, sortCol, sortDir, toggle } = useSortTable(facturas, 'fecha', 'desc')

  const ESTADO_COLOR: Record<string, { bg: string; text: string }> = {
    registrada: { bg: 'FFDBEAFE', text: 'FF1D4ED8' },
    validada:   { bg: 'FFDCFCE7', text: 'FF15803D' },
    anulada:    { bg: 'FFFEE2E2', text: 'FFB91C1C' },
  }

  const exportarExcel = async () => {
    if (!sorted.length) return

    const COLOR = {
      header: 'FF1E293B', headerText: 'FFFFFFFF',
      filaPar: 'FFFFFFFF', filaImpar: 'FFF8FAFC', borde: 'FFE2E8F0',
      totalBg: 'FFF1F5F9', totalBorde: 'FF94A3B8',
    }
    const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
    const thinBorder = { style: 'thin' as const, color: { argb: COLOR.borde } }

    const { default: ExcelJS } = await import('exceljs')

    const wb = new ExcelJS.Workbook()
    wb.creator = 'KardexERP 2026'
    wb.created = new Date()
    const ws = wb.addWorksheet('Facturas', { views: [{ state: 'frozen', ySplit: 1 }] })

    ws.columns = [
      { header: 'Serie-Número',    key: 'serie',   width: 18 },
      { header: 'Fecha',           key: 'fecha',   width: 13 },
      { header: 'Cliente',         key: 'cliente', width: 34 },
      { header: 'Tipo',            key: 'tipo',    width: 16 },
      { header: 'Orden de Compra', key: 'oc',      width: 18 },
      { header: 'Subtotal',        key: 'subtotal',width: 15 },
      { header: 'IGV',             key: 'igv',     width: 13 },
      { header: 'Total',           key: 'total',   width: 15 },
      { header: 'Estado',          key: 'estado',  width: 16 },
    ]

    const headerRow = ws.getRow(1)
    headerRow.height = 20
    headerRow.eachCell(cell => {
      cell.fill = fill(COLOR.header)
      cell.font = { color: { argb: COLOR.headerText }, bold: true, size: 11 }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
    })

    sorted.forEach((f: any, idx: number) => {
      const row = ws.addRow({
        serie: `${f.serie}-${f.numero}`,
        fecha: f.fecha ? f.fecha.slice(0, 10) : '',
        cliente: f.cliente_nombre || '',
        tipo: f.tipo.replace(/_/g, ' '),
        oc: f.oc_numero || '',
        subtotal: parseFloat(f.subtotal || 0),
        igv: parseFloat(f.igv || 0),
        total: parseFloat(f.total || 0),
        estado: f.estado,
      })
      const bgFila = idx % 2 === 0 ? COLOR.filaPar : COLOR.filaImpar
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.fill = fill(bgFila)
        cell.border = { bottom: thinBorder }
        cell.alignment = { vertical: 'middle', horizontal: colNumber >= 6 && colNumber <= 8 ? 'right' : 'left' }
      })
      ;['subtotal', 'igv', 'total'].forEach(k => { row.getCell(k).numFmt = '"S/ "#,##0.00' })
      row.getCell('total').font = { bold: true }
      row.getCell('tipo').alignment = { vertical: 'middle', horizontal: 'left' }

      const estadoStyle = ESTADO_COLOR[f.estado] || { bg: 'FFF1F5F9', text: 'FF475569' }
      const estadoCell = row.getCell('estado')
      estadoCell.fill = fill(estadoStyle.bg)
      estadoCell.font = { color: { argb: estadoStyle.text }, bold: true }
      estadoCell.alignment = { vertical: 'middle', horizontal: 'center' }
    })

    const totSubtotal = sorted.reduce((s: number, f: any) => s + parseFloat(f.subtotal || 0), 0)
    const totIgv = sorted.reduce((s: number, f: any) => s + parseFloat(f.igv || 0), 0)
    const totTotal = sorted.reduce((s: number, f: any) => s + parseFloat(f.total || 0), 0)
    const filaTotal = ws.addRow({ cliente: 'TOTALES', subtotal: totSubtotal, igv: totIgv, total: totTotal })
    ws.mergeCells(`A${filaTotal.number}:C${filaTotal.number}`)
    filaTotal.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.fill = fill(COLOR.totalBg)
      cell.font = { bold: true, size: 11 }
      cell.border = { top: { style: 'medium', color: { argb: COLOR.totalBorde } } }
      if (colNumber === 3) cell.alignment = { horizontal: 'right' }
      if ([6, 7, 8].includes(colNumber)) { cell.numFmt = '"S/ "#,##0.00'; cell.alignment = { horizontal: 'right' } }
    })

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } }

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `facturas_${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar por número, RUC o proveedor..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="select sm:w-64" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
          <option value="">Todas las empresas</option>
          {(clientes || []).map((c: any) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
        </select>
        <button className="btn-secondary" onClick={exportarExcel} disabled={!sorted.length}><Download size={16} /> Exportar Excel</button>
        <button className="btn-primary" onClick={() => { reset(); setModalOpen(true) }}><Plus size={16} /> Registrar Factura</button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Receipt size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Facturas</span>
          <span className="ml-auto text-sm text-slate-400">{facturas.length} registros</span>
        </div>
        {!facturas.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableTh col="numero" label="Serie-Número" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="fecha" label="Fecha" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="cliente_nombre" label="Cliente" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="tipo" label="Tipo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="subtotal" label="Subtotal" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortableTh col="igv" label="IGV" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortableTh col="total" label="Total" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortableTh col="es_reserva" label="Despacho" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="estado" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <th className="table-header text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((f: any) => (
                  <tr key={f.id} className={f.estado === 'anulada' ? 'table-row bg-red-50 border-l-4 border-l-red-500' : 'table-row'}>
                    <td className="table-cell font-mono text-xs font-bold text-blue-700">
                      <div className="flex items-center gap-1.5">
                        <span>{f.serie}-{f.numero}</span>
                        {(f.pdf_url || f.oc_url_factura) ? (
                          <a href={f.pdf_url || f.oc_url_factura} target="_blank" rel="noopener noreferrer"
                             className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-1.5 py-0.5 rounded-sm transition-colors"
                             title="Ver PDF de la factura" onClick={e => e.stopPropagation()}>
                            <ExternalLink size={9} /> Factura
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-sm"
                                title="No hay PDF de factura vinculado">
                            SIN FACTURA
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="table-cell text-slate-500">{f.fecha}</td>
                    <td className="table-cell font-medium text-slate-900">{f.cliente_nombre}</td>
                    <td className="table-cell capitalize text-slate-500 text-xs">{f.tipo.replace(/_/g,' ')}</td>
                    <td className="table-cell text-right text-slate-600">S/ {parseFloat(f.subtotal).toFixed(2)}</td>
                    <td className="table-cell text-right text-slate-500">S/ {parseFloat(f.igv).toFixed(2)}</td>
                    <td className="table-cell text-right font-bold text-slate-900">S/ {parseFloat(f.total).toFixed(2)}</td>
                    <td className="table-cell text-center">
                      {Number(f.es_reserva) === 1
                        ? <span className="inline-block rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300 px-2.5 py-0.5 text-xs font-semibold">Reserva</span>
                        : <span className="inline-block rounded-full bg-orange-100 text-orange-800 border border-orange-300 px-2.5 py-0.5 text-xs font-semibold">Consumo</span>}
                    </td>
                    <td className="table-cell text-center"><Badge value={f.estado} /></td>
                    <td className="table-cell text-center">
                      <div className="flex items-center justify-center gap-1">
                        {f.estado === 'registrada' && (
                          <button onClick={() => validar.mutate(f.id)} className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Validar">
                            <CheckCircle size={16} />
                          </button>
                        )}
                        {f.estado === 'anulada' ? (
                          <button
                            onClick={() => handleRetornar(f)}
                            disabled={retornarMutation.isPending}
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-40"
                            title="Retornar factura (restaura su estado anterior)"
                          >
                            <Undo2 size={15} />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDelete(f)}
                            disabled={deleteMutation.isPending}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                            title="Eliminar factura"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset() }} title="Registrar Factura" size="lg">
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Serie *</label>
              <input className="input" {...register('serie', { required: true })} placeholder="F001" />
            </div>
            <div>
              <label className="label">Número *</label>
              <input className="input" {...register('numero', { required: true })} placeholder="00001234" />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select className="select" {...register('tipo')}>
                <option value="factura">Factura</option>
                <option value="boleta">Boleta</option>
                <option value="nota_credito">Nota de Crédito</option>
                <option value="nota_debito">Nota de Débito</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Fecha *</label>
              <input className="input" type="date" {...register('fecha', { required: true })} defaultValue={new Date().toISOString().slice(0,10)} />
            </div>
            <div>
              <label className="label">Cliente *</label>
              <select className="select" {...register('cliente_id', { required: true })}>
                <option value="">-- Seleccionar --</option>
                {(clientes || []).map((c: any) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Orden de Compra relacionada</label>
            <select className="select" {...register('orden_compra_id')}>
              <option value="">-- Sin OC vinculada --</option>
              {(ocs || []).map((oc: any) => <option key={oc.id} value={oc.id}>{oc.numero} — {oc.cliente_nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Subtotal (sin IGV) *</label>
            <input className="input" type="number" step="0.01" {...register('subtotal', { required: true })} />
          </div>
          <div className="bg-slate-50 rounded-xl p-4 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">IGV (18%):</span><span>S/ {igvCalc.toFixed(2)}</span></div>
            <div className="flex justify-between font-bold"><span>Total:</span><span className="text-blue-600">S/ {totalCalc.toFixed(2)}</span></div>
          </div>
          <div>
            <label className="label">Observaciones</label>
            <textarea className="input h-16 resize-none" {...register('observaciones')} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset() }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Guardando...' : 'Registrar Factura'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
