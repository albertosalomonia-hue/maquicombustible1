'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Scale, Upload, Download, CheckCircle, FileSpreadsheet, Trash2, Wand2, Pencil, Check, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import { useConfirm } from '../../context/ConfirmContext'

const n2 = (n: any) => parseFloat(String(n) || '0').toFixed(2)
const S  = (n: any) => `S/ ${n2(n)}`

type ImportRow = {
  sku: string; almacen: string; fecha: string
  cantidad: number; costo_unitario: number
  numeracion?: string; documento?: string; ruc?: string; producto_archivo?: string
  producto?: string; almacen_nombre?: string
  estado?: 'importado' | 'omitido' | 'error'; mensaje?: string; numero?: string
}

export default function SaldosInicialesPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [modalOpen, setModalOpen]     = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [resultOpen, setResultOpen]   = useState(false)
  const [preview, setPreview]         = useState<ImportRow[]>([])
  const [resultado, setResultado]     = useState<any>(null)
  const [fileName, setFileName]       = useState('')
  const [filterProducto, setFilterProducto] = useState('')
  const [filterAlmacen, setFilterAlmacen]   = useState('')

  const { data: catalogo }  = useQuery({ queryKey: ['catalogo'],  queryFn: () => api.get('/productos/catalogo').then(r => r.data) })
  const { data: almacenes } = useQuery({ queryKey: ['almacenes'], queryFn: () => api.get('/almacenes').then(r => r.data) })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['saldos-iniciales-lista'],
    queryFn: () => api.get('/kardex/saldo-inicial/lista', { params: { limit: 1000 } }).then(r => r.data),
  })

  const todosLosSaldos: any[] = data?.data || []
  const saldos = todosLosSaldos.filter(s => {
    if (filterAlmacen && !s.almacen?.toLowerCase().includes(filterAlmacen.toLowerCase())) return false
    if (filterProducto && !s.descripcion_producto?.toLowerCase().includes(filterProducto.toLowerCase()) &&
        !s.codigo_producto?.toLowerCase().includes(filterProducto.toLowerCase())) return false
    return true
  })

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<any>({
    defaultValues: { producto_id: '', almacen_id: '', fecha: '', cantidad: '', costo_unitario: '', nro_factura: '' }
  })

  // Mutación individual
  const mutation = useMutation({
    mutationFn: (d: any) => api.post('/kardex/saldo-inicial', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saldos-iniciales'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      qc.invalidateQueries({ queryKey: ['inventario-multi'] })
      toast.success('Saldo inicial registrado')
      setModalOpen(false); reset(); refetch()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al registrar'),
  })

  // Mutación eliminar
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/kardex/saldo-inicial/lista/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saldos-iniciales-lista'] })
      toast.success('Registro eliminado')
      refetch()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al eliminar'),
  })

  const handleDelete = async (s: any) => {
    const ok = await confirm({
      title: 'Eliminar saldo inicial',
      message: <>¿Eliminar el registro <strong>"{s.codigo_producto} - {s.descripcion_producto}"</strong>?</>,
      variant: 'danger',
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    deleteMutation.mutate(s.id)
  }

  // Estado edición inline de SKU
  const [editingSkuId, setEditingSkuId] = useState<number | null>(null)
  const [editingSkuVal, setEditingSkuVal] = useState('')

  // Mutación generar SKUs automáticamente
  const generarSkusMutation = useMutation({
    mutationFn: () => api.post('/reportes/saldos-inventario/generar-skus'),
    onSuccess: (res) => {
      toast.success(res.data.mensaje)
      refetch()
    },
    onError: () => toast.error('Error al generar SKUs'),
  })

  // Mutación actualizar SKU individual
  const updateSkuMutation = useMutation({
    mutationFn: ({ id, sku }: { id: number; sku: string }) =>
      api.patch(`/reportes/saldos-inventario/sku/${id}`, { sku }),
    onSuccess: () => { setEditingSkuId(null); refetch() },
    onError: () => toast.error('Error al guardar SKU'),
  })

  // Mutación importación directa (sin validación de productos)
  const importMutation = useMutation({
    mutationFn: (d: any) => api.post('/kardex/saldo-inicial/importar-directo', d),
    onSuccess: (res) => {
      setResultado(res.data)
      setPreviewOpen(false)
      setResultOpen(true)
      qc.invalidateQueries({ queryKey: ['saldos-iniciales-lista'] })
      refetch()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error en la importación'),
  })

  // Parsear Excel — robusto: case-insensitive, tildes, fechas seriales de Excel
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const XLSX = await import('xlsx')
      const data = new Uint8Array(ev.target?.result as ArrayBuffer)
      const wb = XLSX.read(data, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      if (rawRows.length < 2) { setPreview([]); setPreviewOpen(true); return }

      const norm = (s: any) => String(s).trim().toLowerCase()
        .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i').replace(/ó/g,'o').replace(/ú/g,'u')
      const headers = rawRows[0].map(norm)
      const col = (...names: string[]) => names.reduce((f, n) => f >= 0 ? f : headers.indexOf(n), -1)

      const numIdx   = col('numeracion', 'numeración', 'num', 'n°', 'nro', 'numero', 'id')
      const skuIdx   = col('codigo producto', 'cod. producto', 'cod producto', 'codigo', 'sku', 'code', 'item', 'articulo')
      const almIdx   = col('almacen', 'almacén', 'almacen_nombre', 'deposito', 'warehouse', 'bodega', 'ubicacion')
      const fechaIdx = col('fecha inicio', 'fecha', 'fecha_saldo', 'fecha inicial', 'date', 'fecha saldo')
      const cantIdx  = col('cantidad inicial', 'cantidad', 'cant', 'qty', 'quantity', 'stock inicial', 'unidades')
      const costoIdx = col('costo unitario (s/)', 'costo unitario', 'costo_unitario', 'costo', 'precio unitario', 'precio', 'unit cost', 'p. unitario')
      const docIdx   = col('documento', 'doc', 'referencia', 'nro documento', 'orden')
      const rucIdx   = col('ruc', 'rut', 'nif', 'proveedor ruc')
      const prodIdx  = col('producto', 'descripcion', 'description', 'nombre producto', 'nombre')

      const fmtDate = (v: any): string => {
        if (!v && v !== 0) return ''
        if (v instanceof Date) return v.toISOString().slice(0, 10)
        const s = String(v).trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
          const [d, m, y] = s.split('/')
          return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
        }
        return s
      }

      const parsed: ImportRow[] = rawRows.slice(1)
        .filter(row => row.some((c: any) => String(c).trim() !== ''))
        .filter(row => skuIdx >= 0 && String(row[skuIdx] || '').trim() !== '')
        .map(row => ({
          sku:             String(row[skuIdx] || '').trim(),
          almacen:         almIdx   >= 0 ? String(row[almIdx]   || '').trim() : '',
          fecha:           fmtDate(fechaIdx >= 0 ? row[fechaIdx] : ''),
          cantidad:        cantIdx  >= 0 ? parseFloat(String(row[cantIdx]  || 0)) || 0 : 0,
          costo_unitario:  costoIdx >= 0 ? parseFloat(String(row[costoIdx] || 0)) || 0 : 0,
          numeracion:      numIdx   >= 0 ? String(row[numIdx]   || '').trim() : undefined,
          documento:       docIdx   >= 0 ? String(row[docIdx]   || '').trim() : undefined,
          ruc:             rucIdx   >= 0 ? String(row[rucIdx]   || '').trim() : undefined,
          producto_archivo: prodIdx >= 0 ? String(row[prodIdx]  || '').trim() : undefined,
        }))

      setPreview(parsed)
      setPreviewOpen(true)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  // Descargar plantilla
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([
      ['SKU', 'Almacen', 'Fecha', 'Cantidad', 'Costo Unitario'],
      ['PAP-A4-75G', 'Almacén Central', '2024-12-31', 100, 12.50],
      ['LAP-NEGRO',  'Almacén Central', '2024-12-31', 200, 1.20],
    ])
    ws['!cols'] = [{ wch: 20 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Saldos Iniciales')
    XLSX.writeFile(wb, 'plantilla_saldos_iniciales.xlsx')
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in space-y-5">
      {/* Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 flex items-start gap-3">
        <Scale size={20} className="text-blue-500 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          <p className="font-bold mb-1">Saldos Iniciales de Inventario</p>
          <p>Registra el stock inicial de períodos anteriores. Aparecen como <strong>primera línea del Kardex</strong> por producto/almacén. No se permiten duplicados.</p>
        </div>
      </div>

      {/* Filtros + Botones */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Buscar por producto o código..."
          value={filterProducto}
          onChange={e => setFilterProducto(e.target.value)}
        />
        <select className="select w-52" value={filterAlmacen} onChange={e => setFilterAlmacen(e.target.value)}>
          <option value="">Todos los almacenes</option>
          {(almacenes || []).map((a: any) => <option key={a.id} value={a.nombre}>{a.nombre}</option>)}
        </select>
        <button
          className="btn-secondary shrink-0 bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100"
          onClick={async () => {
            const ok = await confirm({
              title: 'Generar SKUs automáticamente',
              message: '¿Generar SKUs automáticamente para todos los saldos? Esto actualizará los registros sin SKU.',
              variant: 'warning',
              confirmLabel: 'Generar',
            })
            if (ok) generarSkusMutation.mutate()
          }}
          disabled={generarSkusMutation.isPending}
          title="Cruza por descripción exacta y asigna el SKU del sistema"
        >
          <Wand2 size={15} /> {generarSkusMutation.isPending ? 'Generando...' : 'Generar SKUs'}
        </button>
        <button className="btn-secondary shrink-0" onClick={downloadTemplate}>
          <Download size={15} /> Plantilla Excel
        </button>
        <button className="btn-secondary shrink-0" onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> Importar Excel
        </button>
        <button className="btn-primary shrink-0" onClick={() => { reset(); setModalOpen(true) }}>
          <Plus size={16} /> Nuevo Manual
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      </div>

      {/* Tabla de saldos */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Scale size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Saldos Iniciales Registrados</span>
          <span className="ml-auto text-sm text-slate-400">{saldos.length} registros</span>
        </div>
        {!saldos.length ? (
          <EmptyState message="Sin saldos iniciales" description="Importa un Excel o agrega manualmente." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-header text-left">Numer.</th>
                  <th className="table-header text-left">Cód. Producto</th>
                  <th className="table-header text-left bg-violet-50 text-violet-700">SKU</th>
                  <th className="table-header text-left">Producto</th>
                  <th className="table-header text-left">Almacén</th>
                  <th className="table-header text-left">Fecha</th>
                  <th className="table-header text-left">N° Factura / Doc.</th>
                  <th className="table-header text-left">RUC</th>
                  <th className="table-header text-right">Cantidad</th>
                  <th className="table-header text-right">Costo Unit.</th>
                  <th className="table-header text-right">Costo Total</th>
                  <th className="table-header w-10"></th>
                </tr>
              </thead>
              <tbody>
                {saldos.map((s: any) => (
                  <tr key={s.id} className="table-row">
                    <td className="table-cell font-mono text-xs text-slate-500">{s.numeracion || '—'}</td>
                    <td className="table-cell font-mono text-xs font-bold text-blue-700">{s.codigo_producto}</td>

                    {/* SKU editable inline */}
                    <td className="table-cell bg-violet-50/40 min-w-[130px]">
                      {editingSkuId === s.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            className="input py-0.5 px-1.5 text-xs h-7 w-28"
                            value={editingSkuVal}
                            onChange={e => setEditingSkuVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') updateSkuMutation.mutate({ id: s.id, sku: editingSkuVal })
                              if (e.key === 'Escape') setEditingSkuId(null)
                            }}
                          />
                          <button onClick={() => updateSkuMutation.mutate({ id: s.id, sku: editingSkuVal })} className="text-emerald-600 hover:text-emerald-700"><Check size={13} /></button>
                          <button onClick={() => setEditingSkuId(null)} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 group">
                          <span className={`font-mono text-xs font-semibold ${s.sku ? 'text-violet-700' : 'text-slate-300 italic'}`}>
                            {s.sku || 'sin SKU'}
                          </span>
                          <button
                            onClick={() => { setEditingSkuId(s.id); setEditingSkuVal(s.sku || '') }}
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-violet-600 transition-opacity"
                            title="Editar SKU"
                          >
                            <Pencil size={11} />
                          </button>
                        </div>
                      )}
                    </td>

                    <td className="table-cell font-medium text-slate-900 max-w-[200px] truncate" title={s.descripcion_producto}>{s.descripcion_producto}</td>
                    <td className="table-cell text-slate-600">{s.almacen}</td>
                    <td className="table-cell text-slate-500 whitespace-nowrap">{s.fecha}</td>
                    <td className="table-cell font-mono text-xs text-slate-500">{s.documento || '—'}</td>
                    <td className="table-cell text-xs text-slate-500">{s.ruc || '—'}</td>
                    <td className="table-cell text-right font-semibold">{n2(s.cantidad)}</td>
                    <td className="table-cell text-right text-slate-600">{S(s.costo_unitario)}</td>
                    <td className="table-cell text-right font-bold text-blue-700">{S(s.costo_total)}</td>
                    <td className="table-cell text-center">
                      <button
                        onClick={() => handleDelete(s)}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                        title="Eliminar"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-300">
                  <td colSpan={10} className="px-3 py-2 text-xs text-slate-600 text-right font-bold">COSTO TOTAL INVENTARIO INICIAL</td>
                  <td className="px-3 py-2 text-right font-bold text-blue-700">
                    {S(saldos.reduce((acc: number, r: any) => acc + parseFloat(r.costo_total || 0), 0))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Modal Manual */}
      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset() }} title="Nuevo Saldo Inicial Manual">
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            Solo se permite <strong>un saldo inicial</strong> por producto/almacén.
          </div>
          <div>
            <label className="label">Producto *</label>
            <select className="select" {...register('producto_id', { required: true })}>
              <option value="">-- Seleccionar --</option>
              {(catalogo || []).map((p: any) => <option key={p.id} value={p.id}>{p.descripcion} ({p.sku})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Almacén *</label>
            <select className="select" {...register('almacen_id', { required: true })}>
              <option value="">-- Seleccionar --</option>
              {(almacenes || []).map((a: any) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Fecha del Saldo *</label>
            <input className="input" type="date" {...register('fecha', { required: true })} />
            <p className="text-xs text-slate-400 mt-1">Ej. fecha de cierre del período anterior: 31/12/2024</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Cantidad *</label>
              <input className="input" type="number" step="0.0001" min="0.0001" {...register('cantidad', { required: true })} />
            </div>
            <div>
              <label className="label">Costo Unitario (S/) *</label>
              <input className="input" type="number" step="0.0001" min="0" {...register('costo_unitario', { required: true })} />
            </div>
          </div>
          <div>
            <label className="label">N° Factura asociada</label>
            <input className="input" type="text" placeholder="Ej. F001-00001234" {...register('nro_factura')} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset() }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Registrando...' : 'Registrar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Preview Excel */}
      <Modal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} title={`Vista previa: ${fileName}`} size="2xl">
        <div className="p-6 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
            <FileSpreadsheet size={16} />
            <span><strong>{preview.length}</strong> registros detectados en el archivo. Revisa y confirma la importación.</span>
          </div>
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="table-header text-left">#</th>
                    {preview[0]?.numeracion !== undefined && <th className="table-header text-left">Numeración</th>}
                    <th className="table-header text-left">Cód. Producto</th>
                    {preview[0]?.producto_archivo !== undefined && <th className="table-header text-left">Producto</th>}
                    <th className="table-header text-left">Almacén</th>
                    <th className="table-header text-left">Fecha</th>
                    {preview[0]?.documento !== undefined && <th className="table-header text-left">Documento</th>}
                    {preview[0]?.ruc !== undefined && <th className="table-header text-left">RUC</th>}
                    <th className="table-header text-right">Cantidad</th>
                    <th className="table-header text-right">Costo Unit.</th>
                    <th className="table-header text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => {
                    const valido = r.sku && r.almacen && r.fecha && r.cantidad > 0 && r.costo_unitario >= 0
                    return (
                      <tr key={i} className={`border-t border-slate-100 ${!valido ? 'bg-red-50' : ''}`}>
                        <td className="table-cell text-slate-400">{i + 1}</td>
                        {r.numeracion !== undefined && <td className="table-cell text-slate-500 font-mono">{r.numeracion}</td>}
                        <td className="table-cell font-mono font-semibold text-slate-800">{r.sku || <span className="text-red-500">—</span>}</td>
                        {r.producto_archivo !== undefined && <td className="table-cell text-slate-700 max-w-[160px] truncate" title={r.producto_archivo}>{r.producto_archivo || '—'}</td>}
                        <td className="table-cell text-slate-600">{r.almacen || <span className="text-red-500">—</span>}</td>
                        <td className="table-cell text-slate-500">{r.fecha || <span className="text-red-500">—</span>}</td>
                        {r.documento !== undefined && <td className="table-cell font-mono text-xs text-slate-500">{r.documento}</td>}
                        {r.ruc !== undefined && <td className="table-cell text-slate-500">{r.ruc}</td>}
                        <td className="table-cell text-right">{r.cantidad}</td>
                        <td className="table-cell text-right">{S(r.costo_unitario)}</td>
                        <td className="table-cell text-right font-semibold text-blue-700">{S(r.cantidad * r.costo_unitario)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setPreviewOpen(false)}>Cancelar</button>
            <button
              className="btn-primary"
              disabled={importMutation.isPending}
              onClick={() => importMutation.mutate({ registros: preview, archivo_nombre: fileName })}
            >
              {importMutation.isPending ? 'Importando...' : `Confirmar Importación (${preview.length} registros)`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Resultado */}
      <Modal isOpen={resultOpen} onClose={() => setResultOpen(false)} title="Resultado de la Importación">
        {resultado && (
          <div className="p-6 space-y-5">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
              <CheckCircle size={40} className="text-emerald-500 mx-auto mb-3" />
              <p className="text-4xl font-bold text-emerald-700">{resultado.importados}</p>
              <p className="text-sm text-emerald-600 font-medium mt-1">registros importados correctamente</p>
              <p className="text-xs text-emerald-500 mt-1">de {resultado.total} filas en el archivo</p>
            </div>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setResultOpen(false)}>Cerrar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
