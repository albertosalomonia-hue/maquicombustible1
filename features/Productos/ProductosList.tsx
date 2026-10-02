'use client'

import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, Edit, Package, Trash2, Upload, FileDown, Download, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
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

export default function ProductosList() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 100
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewRows, setPreviewRows] = useState<any[]>([])
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [confirming, setConfirming] = useState(false)
  const [exporting, setExporting] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['productos', search, fechaDesde, fechaHasta, page],
    queryFn: () => api.get('/productos', { params: { search, fecha_desde: fechaDesde || undefined, fecha_hasta: fechaHasta || undefined, limit: PAGE_SIZE, page } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const handleSearchChange = (v: string) => { setSearch(v); setPage(1) }
  const handleFechaDesdeChange = (v: string) => { setFechaDesde(v); setPage(1) }
  const handleFechaHastaChange = (v: string) => { setFechaHasta(v); setPage(1) }
  const totalRegistros = data?.total ?? 0
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / PAGE_SIZE))
  const { data: familias } = useQuery({ queryKey: ['familias'], queryFn: () => api.get('/familias').then(r => r.data) })
  const { data: unidades } = useQuery({ queryKey: ['unidades'], queryFn: () => api.get('/productos/meta/unidades').then(r => r.data) })
  const { data: marcas } = useQuery({ queryKey: ['marcas'], queryFn: () => api.get('/marcas').then(r => r.data) })

  const { register, handleSubmit, reset, setValue, formState: { isSubmitting } } = useForm()

  const mutation = useMutation({
    mutationFn: (d: any) => editing ? api.put(`/productos/${editing.id}`, { ...d, sku: editing.sku }) : api.post('/productos', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productos'] })
      toast.success(editing ? 'Producto actualizado' : 'Producto registrado')
      setModalOpen(false); reset(); setEditing(null)
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al guardar el producto'),
  })

  const handleDownloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const headers = ['SKU', 'Código Interno', 'Descripción', 'Precio Costo', 'Fecha']
    const ejemplo = ['', 'CI-100', 'Ejemplo: Papel Bond A4 75gr', 12.5, '2026-07-09']
    const ws = XLSX.utils.aoa_to_sheet([headers, ejemplo])
    ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')
    XLSX.writeFile(wb, 'plantilla_importacion_productos.xlsx')
  }

  const exportarExcel = async () => {
    const XLSX = await import('xlsx')
    setExporting(true)
    try {
      const { data: r } = await api.get('/productos', {
        params: { search, fecha_desde: fechaDesde || undefined, fecha_hasta: fechaHasta || undefined, limit: 1000000, page: 1 },
      })
      const rows = (r.data || []).map((p: any) => ({
        'SKU':                p.sku,
        'Código Interno':     p.codigo_interno || '',
        'Descripción':        p.descripcion,
        'Categoría':          p.familia || '',
        'Marca':              p.marca || '',
        'Unidad':             p.unidad_codigo || '',
        'Unidad Compra':      p.unidad_compra_codigo || '',
        'Factor Conversión':  parseFloat(p.factor_conversion || 1),
        'Precio Costo':       parseFloat(p.precio_costo || 0),
        'Stock Mínimo':       parseFloat(p.stock_minimo || 0),
        'Stock Máximo':       parseFloat(p.stock_maximo || 0),
        'Punto Reposición':   parseFloat(p.punto_reposicion || 0),
        'Método Costeo':      p.metodo_costeo || '',
        'Es Equipo':          p.es_equipo ? 'Sí' : 'No',
        'Fecha':              p.fecha ? new Date(p.fecha).toLocaleDateString('es-PE') : '',
        'Estado':             p.estado || '',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 40 }, { wch: 18 }, { wch: 16 },
                     { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
                     { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Productos')
      XLSX.writeFile(wb, `productos_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (err) {
      toast.error('Error al exportar productos')
    } finally {
      setExporting(false)
    }
  }

  const handleImportClick = () => fileInputRef.current?.click()

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const formData = new FormData()
    formData.append('archivo', file)
    setImporting(true)
    try {
      const { data: r } = await api.post('/productos/importar/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      setPreviewRows(r.filas)
      const sel: Record<number, boolean> = {}
      r.filas.forEach((f: any, i: number) => { sel[i] = f.estado === 'nuevo' })
      setSelected(sel)
      setPreviewOpen(true)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Error al leer el archivo')
    } finally {
      setImporting(false)
    }
  }

  const toggleSelected = (i: number) => setSelected(s => ({ ...s, [i]: !s[i] }))
  const toggleAllNuevos = (checked: boolean) => {
    const sel: Record<number, boolean> = {}
    previewRows.forEach((f, i) => { sel[i] = checked && f.estado === 'nuevo' })
    setSelected(sel)
  }
  const closePreview = () => { setPreviewOpen(false); setPreviewRows([]); setSelected({}) }

  const handleConfirmImport = async () => {
    const filas = previewRows.filter((_, i) => selected[i])
    if (!filas.length) { toast.error('No hay filas seleccionadas para importar'); return }
    setConfirming(true)
    try {
      const { data: r } = await api.post('/productos/importar/confirmar', { filas })
      qc.invalidateQueries({ queryKey: ['productos'] })
      toast.success(`Importación completa: ${r.insertados} creados, ${r.omitidos} omitidos de ${r.total}`)
      if (r.errores?.length) {
        const extra = r.errores.length > 5 ? `... y ${r.errores.length - 5} más` : ''
        toast.error(
          <div className="text-xs">
            {r.errores.slice(0, 5).map((e: string, i: number) => <div key={i}>{e}</div>)}
            {extra && <div>{extra}</div>}
          </div>,
          { duration: 8000 }
        )
      }
      closePreview()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Error al importar el archivo')
    } finally {
      setConfirming(false)
    }
  }

  const sincronizarMutation = useMutation({
    mutationFn: () => api.post('/productos/sincronizar').then(r => r.data),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['catalogo'] })
      if (r.creados > 0) toast.success(`Sincronizado: ${r.creados} producto(s) activo(s) agregado(s) al catálogo`)
      else toast('No hay productos activos pendientes por sincronizar', { icon: 'ℹ️' })
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al sincronizar productos'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/productos/${id}`).then(r => r.data),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['productos'] })
      if (r?.inactivado) toast(r.message, { icon: '⚠️' })
      else toast.success('Producto eliminado')
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al eliminar'),
  })

  const handleDelete = async (p: any) => {
    const ok = await confirm({
      title: 'Eliminar producto',
      message: <>¿Eliminar el producto <strong>"{p.descripcion}"</strong> ({p.sku})?</>,
      variant: 'danger',
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    deleteMutation.mutate(p.id)
  }

  const openCreate = () => { reset(); setEditing(null); setModalOpen(true) }
  const openEdit = (p: any) => {
    setEditing(p)
    Object.entries(p).forEach(([k, v]) => setValue(k as any, v))
    setModalOpen(true)
  }

  const productos = data?.data || []
  const { sorted, sortCol, sortDir, toggle } = useSortTable(productos, 'sku', 'asc')

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar por SKU, descripción..." value={search} onChange={e => handleSearchChange(e.target.value)} />
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
        <button className="btn-secondary" onClick={handleDownloadTemplate} title="Descargar archivo de ejemplo para completar e importar">
          <FileDown size={16} /> Descargar Plantilla
        </button>
        <button className="btn-secondary" onClick={handleImportClick} disabled={importing}>
          <Upload size={16} /> {importing ? 'Importando...' : 'Importar Excel'}
        </button>
        <button className="btn-secondary" onClick={exportarExcel} disabled={exporting}>
          <Download size={16} /> {exporting ? 'Exportando...' : 'Exportar Excel'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => sincronizarMutation.mutate()}
          disabled={sincronizarMutation.isPending}
          title="Traer todos los productos activos del sistema anterior que aún no están en el catálogo"
        >
          <RefreshCw size={16} className={sincronizarMutation.isPending ? 'animate-spin' : ''} />
          {sincronizarMutation.isPending ? 'Sincronizando...' : 'Sincronizar'}
        </button>
        <button className="btn-primary" onClick={openCreate}><Plus size={16} /> Nuevo Producto</button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="label">Fecha desde</label>
          <input className="input" type="date" value={fechaDesde} onChange={e => handleFechaDesdeChange(e.target.value)} />
        </div>
        <div>
          <label className="label">Fecha hasta</label>
          <input className="input" type="date" value={fechaHasta} onChange={e => handleFechaHastaChange(e.target.value)} />
        </div>
        {(fechaDesde || fechaHasta) && (
          <button className="btn-secondary" onClick={() => { setFechaDesde(''); setFechaHasta(''); setPage(1) }}>
            Limpiar filtro de fecha
          </button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Package size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Catálogo de Productos</span>
          <span className="ml-auto text-sm text-slate-400">
            {totalRegistros} producto{totalRegistros === 1 ? '' : 's'}
          </span>
        </div>
        {!productos.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableTh col="sku" label="SKU" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="codigo_interno" label="Código Interno" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="descripcion" label="Descripción" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="familia" label="Categoría" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="marca" label="Marca" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <th className="table-header text-left">Unidad</th>
                  <SortableTh col="precio_costo" label="Precio Costo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortableTh col="stock_minimo" label="Stock Mín." sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="fecha" label="Fecha" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="estado" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <th className="table-header text-center">Equipo</th>
                  <th className="table-header text-center">Acción</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p: any) => (
                  <tr key={p.id} className="table-row">
                    <td className="table-cell font-mono text-xs font-medium text-slate-800">{p.sku}</td>
                    <td className="table-cell font-mono text-xs text-slate-500">{p.codigo_interno || '-'}</td>
                    <td className="table-cell font-medium text-slate-900 max-w-xs truncate">{p.descripcion}</td>
                    <td className="table-cell text-slate-500 text-xs">{p.familia || '-'}</td>
                    <td className="table-cell text-slate-500">{p.marca || '-'}</td>
                    <td className="table-cell text-slate-500">
                      <span>{p.unidad_codigo || '-'}</span>
                      {p.unidad_compra_codigo && p.factor_conversion > 1 && (
                        <span className="ml-1 text-xs text-blue-600 font-medium">
                          · {p.unidad_compra_codigo}×{p.factor_conversion}
                        </span>
                      )}
                    </td>
                    <td className="table-cell text-right font-medium">S/ {parseFloat(p.precio_costo || 0).toFixed(2)}</td>
                    <td className="table-cell text-center text-slate-500">{p.stock_minimo}</td>
                    <td className="table-cell text-slate-500 text-xs">{p.fecha ? new Date(p.fecha).toLocaleDateString('es-PE') : '-'}</td>
                    <td className="table-cell"><Badge value={p.estado} /></td>
                    <td className="table-cell text-center">
                      {p.es_equipo ? <Badge value="activo" label="Equipo" /> : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="table-cell text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(p)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
                          <Edit size={16} />
                        </button>
                        <button onClick={() => handleDelete(p)} disabled={deleteMutation.isPending} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40" title="Eliminar">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100">
            <span className="text-sm text-slate-400">Página {page} de {totalPaginas}</span>
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary px-3 py-1.5"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft size={16} /> Anterior
              </button>
              <button
                className="btn-secondary px-3 py-1.5"
                onClick={() => setPage(p => Math.min(totalPaginas, p + 1))}
                disabled={page >= totalPaginas}
              >
                Siguiente <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset(); setEditing(null) }} title={editing ? 'Editar Producto' : 'Nuevo Producto'} size="xl">
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">SKU *</label>
              <input className="input" {...register('sku', { required: true })} disabled={!!editing} />
            </div>
            <div>
              <label className="label">Código Interno</label>
              <input className="input" {...register('codigo_interno')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Descripción *</label>
              <input className="input" {...register('descripcion', { required: true })} />
            </div>
            <div>
              <label className="label">Fecha</label>
              <input className="input" type="date" {...register('fecha')} />
            </div>
          </div>
          <div>
            <label className="label">Descripción Larga</label>
            <textarea className="input h-16 resize-none" {...register('descripcion_larga')} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Categoría</label>
              <select className="select" {...register('familia')}>
                <option value="">-- Seleccionar --</option>
                {(familias || []).map((f: any) => <option key={f.id} value={f.nombre_familia}>{f.nombre_familia}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Unidad de Medida (inventario)</label>
              <select className="select" {...register('unidad_medida_id')}>
                <option value="">-- Seleccionar --</option>
                {(unidades || []).map((u: any) => <option key={u.id} value={u.id}>{u.codigo} - {u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Marca</label>
              <input className="input" list="marcas-datalist" {...register('marca')} />
              <datalist id="marcas-datalist">
                {(marcas || []).map((m: any) => <option key={m.id} value={m.nombre} />)}
              </datalist>
            </div>
          </div>

          {/* Unidad de compra y factor de conversión */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-blue-800">Empaque / Unidad de Compra</p>
            <p className="text-xs text-blue-600">Si se compra por caja, paquete u otro empaque, configura aquí la equivalencia. Ejemplo: 1 CAJA = 10 UND.</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Unidad de Compra</label>
                <select className="select" {...register('unidad_compra_id')}>
                  <option value="">-- Igual a la unidad de inventario --</option>
                  {(unidades || []).map((u: any) => <option key={u.id} value={u.id}>{u.codigo} - {u.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Factor de Conversión</label>
                <input className="input" type="number" step="0.0001" min="1" placeholder="Ej: 10 (1 caja = 10 und)"
                  {...register('factor_conversion', { min: 1 })} />
                <p className="text-xs text-slate-400 mt-1">¿Cuántas unidades de inventario trae 1 unidad de compra?</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Stock Mínimo</label>
              <input className="input" type="number" step="0.01" {...register('stock_minimo')} />
            </div>
            <div>
              <label className="label">Stock Máximo</label>
              <input className="input" type="number" step="0.01" {...register('stock_maximo')} />
            </div>
            <div>
              <label className="label">Punto Reposición</label>
              <input className="input" type="number" step="0.01" {...register('punto_reposicion')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Precio Costo (S/)</label>
              <input className="input" type="number" step="0.01" {...register('precio_costo')} />
            </div>
            <div>
              <label className="label">Método Costeo</label>
              <select className="select" {...register('metodo_costeo')}>
                <option value="promedio">Promedio Ponderado</option>
                <option value="fifo">FIFO (PEPS)</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="w-4 h-4" {...register('es_equipo')} />
            Es equipo (requiere placa/código al registrar una salida)
          </label>
          {editing && (
            <div>
              <label className="label">Estado</label>
              <select className="select" {...register('estado')}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset(); setEditing(null) }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Guardando...' : editing ? 'Actualizar' : 'Registrar'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={previewOpen} onClose={closePreview} title="Vista previa de importación" size="2xl">
        <div className="p-6 space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge value="activo" label={`Nuevos: ${previewRows.filter(f => f.estado === 'nuevo').length}`} />
            <Badge value="pendiente" label={`Duplicados: ${previewRows.filter(f => f.estado === 'duplicado').length}`} />
            <Badge value="rechazada" label={`Errores: ${previewRows.filter(f => f.estado === 'error').length}`} />
          </div>
          <div className="overflow-x-auto border border-slate-100 rounded-xl max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th className="table-header text-center">
                    <input
                      type="checkbox"
                      checked={previewRows.some(f => f.estado === 'nuevo') && previewRows.every((f, i) => f.estado !== 'nuevo' || selected[i])}
                      onChange={e => toggleAllNuevos(e.target.checked)}
                    />
                  </th>
                  <th className="table-header text-left">Fila</th>
                  <th className="table-header text-left">SKU</th>
                  <th className="table-header text-left">Código Interno</th>
                  <th className="table-header text-left">Descripción</th>
                  <th className="table-header text-right">Precio Costo</th>
                  <th className="table-header text-left">Fecha</th>
                  <th className="table-header text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((f, i) => (
                  <tr key={i} className={`table-row ${f.estado !== 'nuevo' ? 'opacity-60' : ''}`}>
                    <td className="table-cell text-center">
                      <input type="checkbox" disabled={f.estado !== 'nuevo'} checked={!!selected[i]} onChange={() => toggleSelected(i)} />
                    </td>
                    <td className="table-cell text-slate-500">{f.fila}</td>
                    <td className="table-cell font-mono text-xs">
                      {f.sku} {f.generado && <span className="ml-1 text-[10px] text-blue-600 font-semibold">(generado)</span>}
                    </td>
                    <td className="table-cell text-slate-500">{f.codigo_interno || '-'}</td>
                    <td className="table-cell max-w-xs truncate">{f.descripcion || '-'}</td>
                    <td className="table-cell text-right">S/ {parseFloat(f.precio_costo || 0).toFixed(2)}</td>
                    <td className="table-cell text-xs text-slate-500">{f.fecha}</td>
                    <td className="table-cell">
                      {f.estado === 'nuevo' && <Badge value="activo" label="Nuevo" />}
                      {f.estado === 'duplicado' && <Badge value="pendiente" label="Duplicado" />}
                      {f.estado === 'error' && <Badge value="rechazada" label="Error" />}
                      {f.motivo && <p className="text-[11px] text-slate-400 mt-0.5">{f.motivo}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={closePreview}>Cancelar</button>
            <button type="button" className="btn-primary" disabled={confirming} onClick={handleConfirmImport}>
              {confirming ? 'Importando...' : `Confirmar Importación (${previewRows.filter((_, i) => selected[i]).length})`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
