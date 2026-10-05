'use client'

import { Fragment, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, LogOut, Trash2, Eye, FileDown, Fuel, ChevronDown, ChevronUp, Undo2 } from 'lucide-react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../../services/api'
import Modal from '../../components/ui/Modal'
import ProductoBuscador, { normalizar } from '../../components/ui/ProductoBuscador'
import SeleccionarFacturaModal from '../../components/ui/SeleccionarFacturaModal'
import { PageLoader } from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import SortableTh from '../../components/ui/SortableTh'
import { useSortTable } from '../../hooks/useSortTable'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../context/ConfirmContext'
import { generarValeSalidaPDF } from '../../utils/valeSalidaPdf'

// Contraseña de confirmación exigida por el backend para revertir una salida
// (misma clave usada en otras operaciones sensibles del sistema, p.ej. Cierre de Período).
const PASSWORD_CONFIRMACION_REVERSION = '@ayala.com'

export default function SalidasList() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { almacenId, esSupervisor } = useAuth()
  const [search,    setSearch]    = useState('')
  const [almacenF,  setAlmacenF]  = useState(almacenId ? String(almacenId) : '')
  const [modalOpen, setModalOpen] = useState(false)
  const [detModal,  setDetModal]  = useState<any>(null)
  const [generandoValeId, setGenerandoValeId] = useState<number | null>(null)
  const [exportando, setExportando] = useState(false)
  const [facturaModalRow, setFacturaModalRow] = useState<number | null>(null)
  const [dieselAbierto, setDieselAbierto] = useState<Record<string, boolean>>({})
  const [dispSearch, setDispSearch] = useState('')

  const listParams: any = { search, limit: 100 }
  if (almacenF) listParams.almacen_id = almacenF

  const { data, isLoading } = useQuery({
    queryKey: ['salidas', search, almacenF],
    queryFn: () => api.get('/salidas', { params: listParams }).then(r => r.data),
  })
  const { data: almacenes } = useQuery({
    queryKey: ['almacenes'],
    queryFn: () => api.get('/almacenes').then(r => r.data),
  })
  const { data: catalogo } = useQuery({
    queryKey: ['catalogo'],
    queryFn: () => api.get('/productos/catalogo').then(r => r.data),
  })

  const { register, handleSubmit, reset, watch, setValue, control, formState: { isSubmitting } } = useForm<any>({
    defaultValues: {
      almacen_id: almacenId ? String(almacenId) : '',
      fecha: new Date().toISOString().slice(0, 10),
      motivo: '',
      solicitante: '',
      tipo_salida: 'reserva', // CONSUMO en standby: por el momento solo se trabaja con RESERVA
      orden_salida_reserva: '',
      detalles: [] as any[], // { producto_id, cantidad, centro_costo_codigo, placa_id, es_diesel, horometro, fecha_abastecimiento, placa_vehiculo_id, factura_id, factura_label }
    },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'detalles' })

  const almacenSelId = watch('almacen_id')
  const esReservaSal = watch('tipo_salida') === 'reserva'
  // Salida de RESERVA: sale de reservas (cada una ligada a su factura) con saldo en el almacén.
  const { data: reservasDisp } = useQuery({
    queryKey: ['reservas', almacenSelId],
    queryFn: () => api.get('/reservas', { params: { almacen_id: almacenSelId, con_saldo: '1' } }).then(r => r.data),
    enabled: !!almacenSelId && esReservaSal,
  })
  // Número correlativo alfanumérico (SAL-AAAA-00001): lo asigna el servidor al guardar; aquí solo se muestra.
  const { data: siguientes } = useQuery({
    queryKey: ['salida-siguiente-numero', modalOpen],
    queryFn: () => api.get('/salidas/siguiente-numero').then(r => r.data as { numero: string; orden_reserva: string }),
    enabled: modalOpen,
  })
  const siguienteNumero = siguientes?.numero
  const ordenReservaPreview = siguientes?.orden_reserva
  const cambiarTipoSalida = (tipo: 'consumo' | 'reserva') => {
    if (tipo === (watch('tipo_salida') || 'consumo')) return
    setValue('tipo_salida', tipo)
    remove() // las líneas de un tipo no sirven para el otro
  }
  const agregarReserva = (rv: any) => {
    append({
      producto_id: String(rv.producto_id), reserva_id: String(rv.id), reserva_label: rv.nro_factura || `Reserva ${rv.id}`,
      reserva_producto: rv.producto_descripcion, cantidad: parseFloat(rv.saldo), centro_costo_codigo: '',
    })
  }
  const detallesWatch = watch('detalles') || []

  const { data: stockAlmacen, isLoading: cargandoStock } = useQuery({
    queryKey: ['inventario-almacen', almacenSelId],
    queryFn: () => api.get('/inventario', { params: { almacen_id: almacenSelId, limit: 500 } }).then(r => r.data),
    enabled: !!almacenSelId,
  })
  const { data: placasDisponibles } = useQuery({
    queryKey: ['placas-disponibles'],
    queryFn: () => api.get('/placas', { params: { estado: 'disponible' } }).then(r => r.data),
    enabled: !!almacenSelId,
  })
  // Todas las placas (sin filtrar por disponibilidad): para elegir el vehículo que recibe
  // el diésel, que no tiene relación con el estado 'en_uso' de retiro de equipos.
  const { data: placasTodas } = useQuery({
    queryKey: ['placas-todas'],
    queryFn: () => api.get('/placas').then(r => r.data),
    enabled: !!almacenSelId,
  })
  const placasVehiculo = (placasTodas || []).filter((p: any) => p.estado !== 'baja')

  // inventario devuelve: id (producto_id), descripcion, unidad, disponible_total
  const productosDisponibles = (stockAlmacen?.data || []).filter((i: any) =>
    parseFloat(i.disponible_total) > 0
  )
  const q = normalizar(dispSearch)
  const productosDisponiblesFiltrados = q
    ? productosDisponibles.filter((p: any) =>
        normalizar(p.sku).includes(q) || normalizar(p.descripcion).includes(q)
      )
    : productosDisponibles

  useEffect(() => { setDispSearch('') }, [modalOpen, almacenSelId])

  const agregarProductoDisponible = (id: number) => {
    append({
      producto_id: String(id), cantidad: 1, centro_costo_codigo: '', placa_id: '',
      es_diesel: false, horometro: '', fecha_abastecimiento: '', placa_vehiculo_id: '', factura_id: '', factura_label: '', factura_saldo: '',
    })
  }

  const mutation = useMutation({
    mutationFn: (d: any) => api.post('/salidas', d),
    onSuccess: (resp: any) => {
      qc.invalidateQueries({ queryKey: ['salidas'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      qc.invalidateQueries({ queryKey: ['reservas'] })
      qc.invalidateQueries({ queryKey: ['centros-costo'] })
      const salidaCreada = resp?.data
      toast.success((t) => (
        <span className="flex items-center gap-3">
          Salida {salidaCreada?.numero} registrada
          {salidaCreada?.id && (
            <button
              className="rounded-sm bg-red-600 px-2 py-1 text-xs font-semibold text-white"
              onClick={async () => {
                toast.dismiss(t.id)
                try {
                  const full = await api.get(`/salidas/${salidaCreada.id}`).then(r => r.data)
                  await generarValeSalidaPDF(full)
                } catch { toast.error('Error al generar el PDF') }
              }}
            >
              Exportar PDF
            </button>
          )}
        </span>
      ), { duration: 10000 })
      setModalOpen(false)
      reset()
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al registrar salida')
    },
  })

  const revertMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/salidas/${id}`, { data: { password: PASSWORD_CONFIRMACION_REVERSION } }).then(r => r.data),
    onSuccess: () => {
      toast.success('Salida revertida: stock restaurado')
      qc.invalidateQueries({ queryKey: ['salidas'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      qc.invalidateQueries({ queryKey: ['centros-costo'] })
      qc.invalidateQueries({ queryKey: ['placas-disponibles'] })
      setDetModal(null)
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al revertir la salida')
    },
  })

  const handleRevertir = async (s: any) => {
    const ok = await confirm({
      title: 'Revertir salida',
      message: <>¿Revertir la salida <strong>{s.numero}</strong>? El stock, los equipos/placas y el Kardex volverán a su estado anterior a la emisión.</>,
      variant: 'danger',
      confirmLabel: 'Revertir',
      requiresPassword: true,
      passwordLabel: 'Contraseña de confirmación',
      validatePassword: (v) => v === PASSWORD_CONFIRMACION_REVERSION ? null : 'Contraseña incorrecta',
    })
    if (!ok) return
    revertMutation.mutate(s.id)
  }

  const anularReversionMutation = useMutation({
    mutationFn: (id: number) => api.post(`/salidas/${id}/anular-reversion`, { password: PASSWORD_CONFIRMACION_REVERSION }).then(r => r.data),
    onSuccess: () => {
      toast.success('Reversión anulada: la salida vuelve a estar activa')
      qc.invalidateQueries({ queryKey: ['salidas'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['kardex'] })
      qc.invalidateQueries({ queryKey: ['centros-costo'] })
      qc.invalidateQueries({ queryKey: ['placas-disponibles'] })
      setDetModal(null)
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al anular la reversión')
    },
  })

  const handleAnularReversion = async (s: any) => {
    const ok = await confirm({
      title: 'Anular reversión',
      message: <>¿Anular la reversión de la salida <strong>{s.numero}</strong>? Se volverá a descontar el stock, se reactivarán los equipos/placas y el Kardex, dejando la salida activa otra vez.</>,
      variant: 'danger',
      confirmLabel: 'Anular reversión',
      requiresPassword: true,
      passwordLabel: 'Contraseña de confirmación',
      validatePassword: (v) => v === PASSWORD_CONFIRMACION_REVERSION ? null : 'Contraseña incorrecta',
    })
    if (!ok) return
    anularReversionMutation.mutate(s.id)
  }

  const salidas = data?.data || []
  const { sorted, sortCol, sortDir, toggle } = useSortTable(salidas, 'fecha', 'desc')

  const handleExportExcel = async () => {
    setExportando(true)
    try {
      const totalFilas = data?.total || 0
      const { data: full } = await api.get('/salidas', { params: { ...listParams, limit: Math.max(totalFilas, 1), page: 1 } })
      const filas: any[] = full?.data || []
      if (!filas.length) { toast.error('No hay salidas para exportar'); return }

      // Trae el detalle de ítems de cada salida, en lotes para no saturar el pool de conexiones.
      // Si una puntual falla, no debe abortar la exportación completa: se omite y se avisa al final.
      const LOTE = 10
      const detalles: { salida: any; det: any[] }[] = []
      let fallidas = 0
      for (let i = 0; i < filas.length; i += LOTE) {
        const lote = filas.slice(i, i + LOTE)
        const resultados = await Promise.all(
          lote.map(s =>
            api.get(`/salidas/${s.id}`)
              .then(res => ({ salida: s, det: res.data.detalles || [] }))
              .catch(() => { fallidas++; return null })
          )
        )
        detalles.push(...resultados.filter((r): r is { salida: any; det: any[] } => r !== null))
      }
      if (!detalles.length) { toast.error('No se pudo obtener el detalle de ninguna salida'); return }

      const COLOR = { header: 'FF1E293B', filaPar: 'FFFFFFFF', filaImpar: 'FFF8FAFC', borde: 'FFE2E8F0' }
      const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
      const thinBorder = { style: 'thin' as const, color: { argb: COLOR.borde } }
      const estiloHeaderCell = (cell: any, bg: string) => {
        cell.fill = fill(bg)
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
        cell.border = { bottom: { style: 'thin' as const, color: { argb: 'FF0F172A' } } }
      }

      const { default: ExcelJS } = await import('exceljs')

      const wb = new ExcelJS.Workbook()
      wb.creator = 'KardexERP 2026'
      wb.created = new Date()

      const ws = wb.addWorksheet('Salidas', { views: [{ state: 'frozen', ySplit: 1 }] })
      ws.columns = [
        { header: 'N° Salida', key: 'numero', width: 16 },
        { header: 'Fecha', key: 'fecha', width: 12 },
        { header: 'Almacén', key: 'almacen', width: 22 },
        { header: 'Solicitante', key: 'solicitante', width: 20 },
        { header: 'Motivo', key: 'motivo', width: 24 },
        { header: 'SKU', key: 'sku', width: 18 },
        { header: 'Producto', key: 'producto', width: 36 },
        { header: 'C. Costo', key: 'cc', width: 20 },
        { header: 'Placa/Código', key: 'placa', width: 16 },
        { header: 'U/M', key: 'unidad', width: 10 },
        { header: 'Cantidad', key: 'cantidad', width: 14 },
        { header: 'Costo Unitario', key: 'costo', width: 14 },
        { header: 'Total', key: 'total', width: 14 },
        { header: 'Diésel', key: 'diesel', width: 10 },
        { header: 'Vale Diésel', key: 'vale', width: 14 },
        { header: 'Horómetro', key: 'horometro', width: 12 },
        { header: 'Fecha Abast.', key: 'fecha_abast', width: 14 },
        { header: 'Vehículo', key: 'vehiculo', width: 14 },
        { header: 'Factura', key: 'factura', width: 16 },
      ]
      ws.getRow(1).eachCell(cell => estiloHeaderCell(cell, COLOR.header))
      ws.getRow(1).height = 20

      let totalGeneral = 0
      let idxFila = 0
      detalles.forEach(({ salida: s, det }) => {
        det.forEach((d: any) => {
          const cant = parseFloat(d.cantidad) || 0
          const costo = parseFloat(d.costo_unitario) || 0
          const total = parseFloat(d.valor_total) || (cant * costo)
          totalGeneral += total
          const row = ws.addRow({
            numero: s.numero,
            fecha: s.fecha,
            almacen: s.almacen_nombre,
            solicitante: s.solicitante || '',
            motivo: s.motivo || '',
            sku: d.sku || '',
            producto: d.producto_descripcion || '',
            cc: d.centro_costo_nombre || '',
            placa: d.placa || d.placa_vehiculo || '',
            unidad: d.unidad || '',
            cantidad: cant,
            costo,
            total,
            diesel: d.es_diesel ? 'Sí' : 'No',
            vale: d.vale_diesel_numero || '',
            horometro: d.horometro ?? '',
            fecha_abast: d.fecha_abastecimiento || '',
            vehiculo: d.placa_vehiculo || '',
            factura: d.factura_serie ? `${d.factura_serie}-${d.factura_numero}` : (d.reserva_factura || d.saldo_inicial_factura || ''),
          })
          const bgFila = idxFila % 2 === 0 ? COLOR.filaPar : COLOR.filaImpar
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.border = { bottom: thinBorder }
            cell.alignment = { vertical: 'middle', horizontal: [11, 12, 13].includes(colNumber) ? 'right' : [14, 16].includes(colNumber) ? 'center' : 'left' }
            cell.fill = fill(bgFila)
          })
          row.getCell(11).numFmt = '#,##0.0000'
          row.getCell(12).numFmt = '"S/ "#,##0.0000'
          row.getCell(13).numFmt = '"S/ "#,##0.00'
          row.getCell(13).font = { bold: true, color: { argb: 'FFB91C1C' } }
          idxFila++
        })
      })
      const filaTotal = ws.addRow({ numero: '', fecha: '', almacen: '', solicitante: '', motivo: 'TOTAL GENERAL', sku: '', producto: '', cc: '', placa: '', unidad: '', cantidad: '', costo: '', total: totalGeneral, diesel: '', vale: '', horometro: '', fecha_abast: '', vehiculo: '', factura: '' })
      ws.mergeCells(`A${filaTotal.number}:E${filaTotal.number}`)
      filaTotal.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.fill = fill('FFF1F5F9')
        cell.font = { bold: true, size: 10 }
        cell.border = { top: { style: 'medium', color: { argb: 'FF94A3B8' } } }
        if (colNumber === 5) cell.alignment = { horizontal: 'right' }
        if (colNumber === 13) { cell.numFmt = '"S/ "#,##0.00'; cell.alignment = { horizontal: 'right' }; cell.font = { bold: true, color: { argb: 'FFB91C1C' } } }
      })
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 19 } }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `salidas_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      if (fallidas > 0) {
        toast.error(`Excel exportado, pero ${fallidas} salida(s) no se pudieron incluir (falló su detalle)`)
      } else {
        toast.success('Excel exportado correctamente')
      }
    } catch (err) {
      console.error(err)
      toast.error('Error al exportar el Excel')
    } finally {
      setExportando(false)
    }
  }

  const handleDescargarVale = async (id: number) => {
    setGenerandoValeId(id)
    try {
      const { data: full } = await api.get(`/salidas/${id}`)
      await generarValeSalidaPDF(full)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Error al generar el vale')
    } finally {
      setGenerandoValeId(null)
    }
  }

  const { data: stockDetModal } = useQuery({
    queryKey: ['inventario-almacen', detModal?.almacen_id],
    queryFn: () => api.get('/inventario', { params: { almacen_id: detModal.almacen_id, limit: 500 } }).then(r => r.data),
    enabled: !!detModal?.almacen_id,
  })
  const disponiblesDetModal = stockDetModal?.data || []

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar por número o solicitante..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="select w-48" value={almacenF} onChange={e => setAlmacenF(e.target.value)}>
          <option value="">Todos los almacenes</option>
          {(almacenes || []).map((a: any) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <button
          className="btn-secondary"
          onClick={handleExportExcel}
          disabled={exportando || !salidas.length}
          title="Exportar salidas a Excel"
        ><FileDown size={16} /> {exportando ? 'Exportando...' : 'Exportar Excel'}</button>
        <button
          className="btn-primary"
          onClick={() => {
            // El almacén del filtro activo se hereda al abrir el formulario, salvo para
            // usuarios con almacén fijo (no supervisores), que siempre usan el suyo.
            const puedeElegirAlmacen = esSupervisor || !almacenId
            reset({
              almacen_id: puedeElegirAlmacen ? (almacenF || '') : String(almacenId),
              fecha: new Date().toISOString().slice(0, 10),
              motivo: '',
              solicitante: '',
              tipo_salida: 'reserva',
              detalles: [],
            })
            setModalOpen(true)
          }}
        >
          <Plus size={16} /> Nueva Salida
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <LogOut size={18} className="text-red-500" />
          <span className="font-semibold text-slate-900">Salidas de Inventario</span>
          <span className="ml-auto text-sm text-slate-400">{salidas.length} registros</span>
        </div>
        {!salidas.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableTh col="numero" label="Número" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="fecha" label="Fecha" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="almacen_nombre" label="Almacén" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="solicitante" label="Solicitante" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="motivo" label="Motivo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <th className="table-header text-left">Reversión</th>
                  <th className="table-header text-center">Vale / Detalle</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s: any) => (
                  <tr key={s.id} className={s.anulada ? 'table-row bg-red-50 border-l-4 border-l-red-500' : 'table-row'}>
                    <td className="table-cell font-mono text-xs font-bold text-red-700">{s.numero}{s.tipo_salida === 'reserva' && <span className="ml-2 rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">RESERVA</span>}</td>
                    <td className="table-cell text-slate-500">{s.fecha}</td>
                    <td className="table-cell font-medium text-slate-900">{s.almacen_nombre}</td>
                    <td className="table-cell text-slate-600">{s.solicitante || '—'}</td>
                    <td className="table-cell text-slate-500 text-sm max-w-xs truncate">{s.motivo || '—'}</td>
                    <td className="table-cell text-sm">
                      {s.anulada ? (
                        <div className="space-y-0.5">
                          <span className="inline-block px-1.5 py-0.5 rounded-sm text-[10px] font-bold bg-red-600 text-white">REVERSIÓN</span>
                          <p className="text-[11px] text-slate-500 whitespace-nowrap">
                            {s.anulada_en ? new Date(s.anulada_en).toLocaleString('es-PE') : '—'}
                          </p>
                          <p className="text-[11px] text-slate-500">{s.anulada_por_nombre || '—'}</p>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="table-cell text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => api.get(`/salidas/${s.id}`).then(r => setDetModal(r.data))}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Ver detalle"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => handleDescargarVale(s.id)}
                          disabled={generandoValeId === s.id}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                          title="Descargar vale de salida (PDF)"
                        >
                          <FileDown size={16} />
                        </button>
                        {s.anulada ? (
                          <button
                            onClick={() => handleAnularReversion(s)}
                            disabled={anularReversionMutation.isPending}
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-40"
                            title="Anular reversión (restaura la salida a su estado anterior)"
                          >
                            <Undo2 size={16} />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRevertir(s)}
                            disabled={revertMutation.isPending}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                            title="Revertir salida (restaura el stock)"
                          >
                            <Trash2 size={16} />
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

      {/* Modal nueva salida */}
      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset() }} title="Registrar Salida de Inventario" size="2xl">
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-5">
          <div>
            <label className="label">N° de Salida</label>
            <input className="input w-56 bg-slate-100 font-mono font-bold text-red-700 cursor-not-allowed" value={siguienteNumero || 'Generando...'} readOnly tabIndex={-1} />
            <p className="text-xs text-slate-400 mt-1">Se asigna automáticamente al guardar.</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Almacén de Salida *</label>
              <select className="select" disabled={!!(almacenId && !esSupervisor)} {...register('almacen_id', { required: true })}>
                <option value="">-- Seleccionar almacén --</option>
                {(almacenes || []).map((a: any) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Fecha *</label>
              <input className="input" type="date" {...register('fecha', { required: true })} />
            </div>
            <div>
              <label className="label">Solicitante</label>
              <input className="input" {...register('solicitante')} placeholder="Nombre del solicitante" />
            </div>
          </div>
          {/* Tipo de salida: CONSUMO (proceso normal) o RESERVA (sale de una reserva ligada a factura) */}
          <div className="grid grid-cols-3 gap-4 items-end">
            <div>
              <label className="label">Tipo de salida *</label>
              <div className="inline-flex w-full rounded-lg border border-slate-200 overflow-hidden text-sm font-semibold">
                {/* Botón CONSUMO oculto (en standby): solo se trabaja con RESERVA.
                <button type="button" onClick={() => cambiarTipoSalida('consumo')}
                  className={`flex-1 py-2 transition-colors ${!esReservaSal ? 'bg-green-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  CONSUMO
                </button>
                */}
                <button type="button" onClick={() => cambiarTipoSalida('reserva')}
                  className={`flex-1 py-2 transition-colors ${esReservaSal ? 'bg-red-600 text-white' : 'bg-white text-red-600 hover:bg-red-50'}`}>
                  RESERVA
                </button>
              </div>
            </div>
            {esReservaSal && (
              <div className="col-span-2">
                <label className="label">N° Orden de salida de reserva</label>
                <input className="input w-56 bg-slate-100 font-mono font-bold text-red-700 cursor-not-allowed" value={ordenReservaPreview || 'Generando...'} readOnly tabIndex={-1} />
                <p className="text-xs text-slate-400 mt-1">Se asigna automáticamente al guardar.</p>
              </div>
            )}
          </div>
          <div>
            <label className="label">Motivo</label>
            <input className="input" {...register('motivo')} placeholder="Ej: Mantenimiento preventivo, uso en obra, consumo oficina..." />
          </div>

          {/* Tabla de productos */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="font-medium text-slate-900 text-sm">Productos</label>
              {/* Botón "Agregar" oculto por el momento (causa confusión): se agrega con el "+" de las listas. */}
              <button
                type="button"
                disabled={!almacenSelId || cargandoStock || esReservaSal}
                onClick={() => append({
                  producto_id: '', cantidad: 1, centro_costo_codigo: '', placa_id: '',
                  es_diesel: false, horometro: '', fecha_abastecimiento: '', placa_vehiculo_id: '', factura_id: '', factura_label: '', factura_saldo: '',
                })}
                className="btn-secondary text-xs py-1.5 disabled:opacity-40 hidden"
              >
                <Plus size={14} /> Agregar
              </button>
            </div>
            {!almacenSelId && (
              <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                Selecciona un almacén para ver los productos disponibles.
              </p>
            )}
            {esReservaSal && almacenSelId && (
              <div className="border border-amber-200 rounded-xl overflow-hidden mb-3">
                <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs font-medium text-amber-800">
                  Reservas con saldo en este almacén ({(reservasDisp || []).length}) — cada reserva corresponde a una factura
                </div>
                {!(reservasDisp || []).length ? (
                  <p className="px-4 py-3 text-sm text-red-500">No hay reservas con saldo en este almacén. Se crean con una Transferencia marcada como RESERVA.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-white">
                      <tr>
                        <th className="table-header text-left">Factura</th>
                        <th className="table-header text-left">Producto</th>
                        <th className="table-header text-right">Reservado</th>
                        <th className="table-header text-right">Saldo</th>
                        <th className="table-header w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reservasDisp || []).map((rv: any) => {
                        const yaAgregada = detallesWatch.some((d: any) => String(d?.reserva_id) === String(rv.id))
                        return (
                          <tr key={rv.id} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 font-mono">{rv.nro_factura || '—'}</td>
                            <td className="px-3 py-1.5 text-slate-700">{rv.producto_descripcion}</td>
                            <td className="px-3 py-1.5 text-right">{parseFloat(rv.cantidad).toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right text-amber-700 font-medium">{parseFloat(rv.saldo).toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-center">
                              <button type="button" disabled={yaAgregada} onClick={() => agregarReserva(rv)}
                                className="p-1 text-amber-600 hover:bg-amber-100 rounded-sm disabled:opacity-30" title="Agregar a la salida">
                                <Plus size={14} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            {!esReservaSal && almacenSelId && cargandoStock && (
              <p className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                Cargando productos disponibles del almacén...
              </p>
            )}
            {!esReservaSal && almacenSelId && !cargandoStock && productosDisponibles.length === 0 && (
              <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                Este almacén no tiene productos con stock disponible actualmente.
              </p>
            )}
            {!esReservaSal && almacenSelId && !cargandoStock && productosDisponibles.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden mb-3">
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
                  <span className="text-xs font-medium text-slate-600">
                    Disponibles en este almacén ({productosDisponiblesFiltrados.length}{productosDisponiblesFiltrados.length !== productosDisponibles.length ? ` de ${productosDisponibles.length}` : ''})
                  </span>
                  <div className="relative w-56">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      className="input text-xs pl-6 py-1"
                      placeholder="Filtrar por SKU o nombre..."
                      value={dispSearch}
                      onChange={e => setDispSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-100">
                        <th className="table-header text-left">SKU</th>
                        <th className="table-header text-left">Producto</th>
                        <th className="table-header text-right">Disponible</th>
                        <th className="table-header w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {productosDisponiblesFiltrados.length === 0 ? (
                        <tr><td colSpan={4} className="px-3 py-3 text-center text-slate-400">Sin resultados</td></tr>
                      ) : productosDisponiblesFiltrados.map((p: any) => (
                        <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-blue-50/50">
                          <td className="px-3 py-1.5 font-mono text-blue-700 whitespace-nowrap">{p.sku}</td>
                          <td className="px-3 py-1.5 text-slate-700 truncate max-w-[220px]">{p.descripcion}</td>
                          <td className="px-3 py-1.5 text-right text-green-700 font-medium whitespace-nowrap">{parseFloat(p.disponible_total).toFixed(2)} {p.unidad}</td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => agregarProductoDisponible(p.id)}
                              className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded-sm"
                              title="Agregar a la salida"
                            >
                              <Plus size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {almacenSelId && (
              <p className="text-xs text-slate-400 mb-2">
                Escribe el código o nombre del centro de costo de cada producto. Si no existe, se creará automáticamente al registrar la salida.
              </p>
            )}
            {almacenSelId && !cargandoStock && fields.length === 0 && (
              <p className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                Aún no agregaste ningún producto. Haz clic en el "+" de la lista de arriba.
              </p>
            )}
            {almacenSelId && fields.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="table-header text-left min-w-[200px]">Producto</th>
                      <th className="table-header text-left min-w-[130px]">Centro de Costo *</th>
                      <th className="table-header text-left min-w-[160px]">Placa / Vehículo</th>
                      <th className="table-header text-center w-16">Diésel</th>
                      <th className="table-header text-right w-28">Disponible</th>
                      <th className="table-header text-right w-28">Cantidad *</th>
                      <th className="table-header w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f, i) => {
                      const prodId = watch(`detalles.${i}.producto_id`)
                      // inventario devuelve id (=producto_id), descripcion, unidad, disponible_total
                      const inv = productosDisponibles.find((p: any) => String(p.id) === String(prodId))
                      const disponible = inv ? parseFloat(inv.disponible_total) : null
                      const producto = (catalogo || []).find((p: any) => String(p.id) === String(prodId))
                      const esEquipo = !!producto?.es_equipo
                      const placaSeleccionadaId = watch(`detalles.${i}.placa_id`)
                      const otrasSeleccionadas = detallesWatch
                        .filter((_: any, idx: number) => idx !== i)
                        .map((d: any) => d?.placa_id)
                        .filter(Boolean)
                      const placasOpciones = (placasDisponibles || []).filter((p: any) =>
                        !otrasSeleccionadas.includes(String(p.id)) || String(p.id) === String(placaSeleccionadaId)
                      )
                      const esDiesel = !!watch(`detalles.${i}.es_diesel`)
                      const facturaLabel = watch(`detalles.${i}.factura_label`)
                      const facturaIdVal = watch(`detalles.${i}.factura_id`)
                      const facturaSaldoVal = watch(`detalles.${i}.factura_saldo`)
                      // "Disponible" es siempre el stock del ALMACÉN seleccionado. En diésel, además, la
                      // factura elegida tiene su propio saldo (global) y el tope es el menor de los dos.
                      const saldoFacturaDiesel = esDiesel && facturaIdVal && facturaSaldoVal !== '' && facturaSaldoVal != null
                        ? parseFloat(facturaSaldoVal) : null
                      const disponibleMostrado = disponible
                      const topes = [disponible, saldoFacturaDiesel].filter((v): v is number => v !== null)
                      const maxCantidad = topes.length ? Math.min(...topes) : undefined
                      if (esReservaSal) {
                        const rvId = watch(`detalles.${i}.reserva_id`)
                        const rv = (reservasDisp || []).find((x: any) => String(x.id) === String(rvId))
                        const saldo = rv ? parseFloat(rv.saldo) : null
                        const esDieselRv = !!watch(`detalles.${i}.es_diesel`)
                        return (
                          <Fragment key={f.id}>
                          <tr className="border-t border-slate-100 bg-red-50/40">
                            <td className="px-3 py-2 text-sm">
                              <input type="hidden" {...register(`detalles.${i}.producto_id`, { required: true })} />
                              <input type="hidden" {...register(`detalles.${i}.reserva_id`, { required: true })} />
                              <span className="font-medium text-slate-800">{rv?.producto_descripcion || watch(`detalles.${i}.reserva_producto`)}</span>
                            </td>
                            <td className="px-2 py-2">
                              <input className="input text-sm" placeholder="Código o nombre..."
                                {...register(`detalles.${i}.centro_costo_codigo`, { required: true })} />
                            </td>
                            <td className="px-2 py-2">
                              {esDieselRv ? (
                                <select className="select text-sm" {...register(`detalles.${i}.placa_vehiculo_id`, { required: true })}>
                                  <option value="">-- Vehículo --</option>
                                  {placasVehiculo.map((p: any) => (
                                    <option key={p.id} value={p.id}>{p.placa}{p.descripcion ? ` — ${p.descripcion}` : ''}</option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-xs font-mono text-red-700">Factura {rv?.nro_factura || watch(`detalles.${i}.reserva_label`) || '—'}</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <input type="checkbox" className="w-4 h-4" title="Repartir a un vehículo / máquina según su código"
                                {...register(`detalles.${i}.es_diesel`)} />
                            </td>
                            <td className="px-2 py-2 text-right text-sm">
                              {saldo !== null ? <span className="text-amber-700 font-medium">{saldo.toFixed(2)}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-2 py-2">
                              <input className="input text-right text-sm" type="number" step="0.0001" min="0.0001"
                                max={saldo || undefined}
                                {...register(`detalles.${i}.cantidad`, { required: true, min: 0.0001 })} />
                            </td>
                            <td className="px-2 py-2">
                              <button type="button" onClick={() => remove(i)} className="p-1 text-red-400 hover:text-red-600">
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                          {esDieselRv && (
                            <tr className="bg-amber-50/60 border-t border-amber-100">
                              <td colSpan={7} className="px-3 py-2">
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700"><Fuel size={12} /> Datos de abastecimiento (vehículo)</div>
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                  <div>
                                    <label className="text-[10px] font-medium text-slate-600">Horómetro *</label>
                                    <input className="input text-xs px-2 py-1" type="number" step="0.01" min="0"
                                      {...register(`detalles.${i}.horometro`, { required: true })} />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-medium text-slate-600">Fecha Abastecimiento *</label>
                                    <input className="input text-xs px-2 py-1" type="date"
                                      {...register(`detalles.${i}.fecha_abastecimiento`, { required: true })} />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        )
                      }
                      return (
                        <Fragment key={f.id}>
                        <tr className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            <Controller
                              control={control}
                              name={`detalles.${i}.producto_id`}
                              rules={{ required: true }}
                              render={({ field }) => (
                                <ProductoBuscador
                                  productos={productosDisponibles}
                                  value={field.value}
                                  onChange={(id) => {
                                    field.onChange(id)
                                    const p = (catalogo || []).find((c: any) => String(c.id) === String(id))
                                    if (p?.es_equipo) setValue(`detalles.${i}.cantidad`, 1)
                                    setValue(`detalles.${i}.placa_id`, '')
                                  }}
                                  placeholder="Buscar por SKU o nombre entre lo disponible..."
                                  maxResultados={productosDisponibles.length}
                                />
                              )}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              className="input text-sm"
                              placeholder="Código o nombre..."
                              {...register(`detalles.${i}.centro_costo_codigo`, { required: true })}
                            />
                          </td>
                          <td className="px-2 py-2">
                            {esDiesel ? (
                              <select
                                className="select text-sm"
                                disabled={!prodId}
                                {...register(`detalles.${i}.placa_vehiculo_id`, { required: esDiesel })}
                              >
                                <option value="">-- Vehículo --</option>
                                {placasVehiculo.map((p: any) => (
                                  <option key={p.id} value={p.id}>{p.placa}{p.descripcion ? ` — ${p.descripcion}` : ''}</option>
                                ))}
                              </select>
                            ) : esEquipo ? (
                              <Controller
                                control={control}
                                name={`detalles.${i}.placa_id`}
                                rules={{ required: true }}
                                render={({ field }) => (
                                  <select className="select text-sm" {...field} disabled={!prodId}>
                                    <option value="">-- Seleccionar placa --</option>
                                    {placasOpciones.map((p: any) => (
                                      <option key={p.id} value={p.id}>{p.placa}</option>
                                    ))}
                                  </select>
                                )}
                              />
                            ) : (
                              <span className="text-slate-300 text-sm">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4 disabled:opacity-30"
                              disabled={!prodId}
                              title="Repartir a las máquinas según su código"
                              {...register(`detalles.${i}.es_diesel`)}
                            />
                          </td>
                          <td className="px-2 py-2 text-right text-sm">
                            {disponibleMostrado !== null
                              ? <span className="text-green-700 font-medium">{disponibleMostrado.toFixed(2)}</span>
                              : <span className="text-slate-300">—</span>}
                            {esDiesel && (
                              <p className="text-[10px] text-amber-600 mt-0.5">
                                {saldoFacturaDiesel !== null ? `Saldo factura: ${saldoFacturaDiesel.toFixed(2)}` : 'Elige factura'}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <input className="input text-right text-sm" type="number" step="0.0001" min="0.0001"
                              max={maxCantidad || undefined}
                              disabled={esEquipo && !esDiesel}
                              {...register(`detalles.${i}.cantidad`, { required: true, min: 0.0001 })} />
                            {esDiesel && <p className="text-[10px] text-amber-600 text-right mt-0.5">Galones</p>}
                          </td>
                          <td className="px-2 py-2">
                            <button type="button" onClick={() => remove(i)} className="p-1 text-red-400 hover:text-red-600">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                        {esDiesel && (() => {
                          const abierto = dieselAbierto[f.id] ?? true
                          return (
                          <tr className="bg-amber-50/60 border-t border-amber-100">
                            <td colSpan={7} className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => setDieselAbierto(prev => ({ ...prev, [f.id]: !abierto }))}
                                className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 w-full"
                              >
                                <Fuel size={12} /> Datos de abastecimiento de diésel
                                {abierto ? <ChevronUp size={13} className="ml-auto" /> : <ChevronDown size={13} className="ml-auto" />}
                              </button>
                              {abierto && (
                                <div className="grid grid-cols-3 gap-2 mt-2">
                                  <div>
                                    <label className="text-[10px] font-medium text-slate-600">Horómetro *</label>
                                    <input
                                      className="input text-xs px-2 py-1"
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      {...register(`detalles.${i}.horometro`, { required: esDiesel })}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-medium text-slate-600">Fecha Abastecimiento *</label>
                                    <input
                                      className="input text-xs px-2 py-1"
                                      type="date"
                                      {...register(`detalles.${i}.fecha_abastecimiento`, { required: esDiesel })}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-medium text-slate-600">Factura *</label>
                                    <input type="hidden" {...register(`detalles.${i}.factura_id`, { required: esDiesel })} />
                                    <button
                                      type="button"
                                      onClick={() => setFacturaModalRow(i)}
                                      disabled={!prodId}
                                      className="btn-secondary text-xs px-2 py-1 w-full justify-center disabled:opacity-40"
                                    >
                                      {facturaLabel || 'Seleccionar...'}
                                    </button>
                                    {!facturaIdVal && (
                                      <p className="text-[9px] text-red-500 mt-0.5">Debes seleccionar una factura</p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                          )
                        })()}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset() }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || !almacenSelId || fields.length === 0}>
              {isSubmitting ? 'Registrando...' : 'Registrar Salida'}
            </button>
          </div>
        </form>
      </Modal>

      <SeleccionarFacturaModal
        isOpen={facturaModalRow !== null}
        onClose={() => setFacturaModalRow(null)}
        productoId={facturaModalRow !== null ? watch(`detalles.${facturaModalRow}.producto_id`) : undefined}
        almacenId={almacenSelId}
        onSelect={(factura) => {
          if (facturaModalRow === null) return
          setValue(`detalles.${facturaModalRow}.factura_id`, factura.id)
          setValue(`detalles.${facturaModalRow}.factura_label`, factura.es_saldo_inicial ? factura.nro_factura : `${factura.serie}-${factura.numero}`)
          setValue(`detalles.${facturaModalRow}.factura_saldo`, factura.saldo_disponible)
        }}
      />

      {/* Modal detalle salida */}
      <Modal isOpen={!!detModal} onClose={() => setDetModal(null)} title={`Detalle: ${detModal?.numero || ''}`} size="xl">
        {detModal && (
          <div className="p-6 space-y-4">
            {detModal.anulada && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-sm">
                <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-bold bg-red-600 text-white">REVERSIÓN</span>
                <span>
                  Revertida el {detModal.anulada_en ? new Date(detModal.anulada_en).toLocaleString('es-PE') : '—'}
                  {detModal.anulada_por_nombre ? <> por <strong>{detModal.anulada_por_nombre}</strong></> : null}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-slate-400">Almacén:</span> <span className="font-medium">{detModal.almacen_nombre}</span></div>
              <div><span className="text-slate-400">Fecha:</span> <span className="font-medium">{detModal.fecha}</span></div>
              <div><span className="text-slate-400">Solicitante:</span> <span className="font-medium">{detModal.solicitante || '—'}</span></div>
              {detModal.tipo_salida === 'reserva' && <div><span className="text-slate-400">Orden de salida de reserva:</span> <span className="font-medium">{detModal.orden_salida_reserva || '—'}</span></div>}
              {detModal.motivo && <div><span className="text-slate-400">Motivo:</span> <span className="font-medium">{detModal.motivo}</span></div>}
            </div>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="table-header text-left">Producto</th>
                    <th className="table-header text-left">Centro de Costo</th>
                    <th className="table-header text-left">Placa / Código</th>
                    <th className="table-header text-right">Cantidad</th>
                    <th className="table-header text-right">Disponible</th>
                    <th className="table-header text-right">Costo U.</th>
                    <th className="table-header text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(detModal.detalles || []).map((d: any) => {
                    const inv = disponiblesDetModal.find((p: any) => String(p.id) === String(d.producto_id))
                    const disponible = inv ? parseFloat(inv.disponible_total) : null
                    return (
                      <Fragment key={d.id}>
                      <tr className="border-t border-slate-100">
                        <td className="table-cell">
                          <p className="font-medium text-slate-900">{d.producto_descripcion}</p>
                          <p className="text-xs text-slate-400">{d.sku}</p>
                        </td>
                        <td className="table-cell text-slate-600">{d.centro_costo_nombre || '—'}</td>
                        <td className="table-cell text-slate-600 font-mono text-xs">{d.placa || (d.es_diesel ? d.placa_vehiculo : null) || '—'}</td>
                        <td className="table-cell text-right">{parseFloat(d.cantidad).toFixed(2)} {d.unidad}</td>
                        <td className="table-cell text-right">
                          {disponible !== null
                            ? <span className="text-green-700 font-medium">{disponible.toFixed(2)}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="table-cell text-right">S/ {parseFloat(d.costo_unitario || 0).toFixed(2)}</td>
                        <td className="table-cell text-right font-semibold text-red-700">S/ {parseFloat(d.valor_total || 0).toFixed(2)}</td>
                      </tr>
                      {d.es_diesel && (
                        <tr className="bg-amber-50/60 border-t border-amber-100">
                          <td colSpan={7} className="px-4 py-2 text-xs overflow-x-auto">
                            <div className="flex items-center flex-nowrap gap-x-5 gap-y-1 text-slate-600 whitespace-nowrap">
                              <span className="flex items-center gap-1.5 font-semibold text-amber-700">
                                <Fuel size={12} /> Vale {d.vale_diesel_numero}
                              </span>
                              <span><span className="text-slate-400">Horómetro:</span> {d.horometro ?? '—'}</span>
                              <span><span className="text-slate-400">Fecha abast.:</span> {d.fecha_abastecimiento ?? '—'}</span>
                              <span><span className="text-slate-400">Vehículo:</span> {d.placa_vehiculo || '—'}</span>
                              <span>
                                <span className="text-slate-400">Factura:</span>{' '}
                                {d.factura_serie ? `${d.factura_serie}-${d.factura_numero}` : (d.reserva_factura || d.saldo_inicial_factura || '—')}
                                {d.oc_numero && ` (OC ${d.oc_numero})`}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td colSpan={6} className="table-cell text-right font-semibold text-slate-700">Total Valorizado:</td>
                    <td className="table-cell text-right font-bold text-red-700">
                      S/ {(detModal.detalles || []).reduce((s: number, d: any) => s + parseFloat(d.valor_total || 0), 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex justify-end pt-2">
              <button type="button" className="btn-secondary" onClick={() => generarValeSalidaPDF(detModal).catch(() => toast.error('Error al generar el vale'))}>
                <FileDown size={16} /> Descargar Vale (PDF)
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
