'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Users, Edit, Key, Trash2 } from 'lucide-react'
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

const ROLES = [
  { value: 'admin',      label: 'Administrador' },
  { value: 'gerente',    label: 'Gerente' },
  { value: 'almacenero', label: 'Almacenero' },
  { value: 'supervisor', label: 'Supervisor' },
]

const ROL_COLORS: Record<string, string> = {
  admin:      'bg-red-100 text-red-700',
  gerente:    'bg-purple-100 text-purple-700',
  almacenero: 'bg-blue-100 text-blue-700',
  supervisor: 'bg-amber-100 text-amber-700',
}

// Mismos módulos y agrupación que el Sidebar (client/src/components/Layout/Sidebar.tsx),
// usando la ruta (sin el "/" inicial) como valor. "Usuarios" no aparece: solo admin/gerente
// pueden gestionarlo, sin importar este checklist (ver AuthContext.tieneAcceso).
const MODULOS_POR_GRUPO: { grupo: string; items: { value: string; label: string }[] }[] = [
  { grupo: 'Maestros', items: [
    { value: 'clientes', label: 'Clientes' },
    { value: 'productos', label: 'Productos' },
    { value: 'placas', label: 'Placas de Equipos' },
    { value: 'categorias', label: 'Categorías' },
    { value: 'familias', label: 'Familias' },
    { value: 'unidades-medida', label: 'Unidad de Medida' },
    { value: 'marcas', label: 'Marca' },
    { value: 'almacenes', label: 'Almacenes' },
    { value: 'centros-costo', label: 'Centros de Costo' },
  ] },
  { grupo: 'Compras', items: [
    { value: 'ordenes-compra', label: 'Órdenes de Compra' },
    { value: 'control-facturas', label: 'CONTROL-FACTURAS' },
    { value: 'facturas', label: 'Facturas' },
  ] },
  { grupo: 'Logística', items: [
    { value: 'recepciones', label: 'Recepciones' },
    { value: 'transferencias', label: 'Transferencias' },
    { value: 'transferencia-bloque', label: 'Transferencia por Bloque' },
    { value: 'trans-almacenes', label: 'Trans-Almacenes' },
    { value: 'salidas', label: 'Salidas' },
    { value: 'solicitudes', label: 'Solicitudes' },
  ] },
  { grupo: 'Inventario', items: [
    { value: 'inventario', label: 'Inventario' },
    { value: 'kardex', label: 'Kardex' },
    { value: 'saldos-iniciales', label: 'Saldos Iniciales' },
    { value: 'cierre-periodo', label: 'Cierre de Período' },
  ] },
  { grupo: 'Reportes', items: [
    { value: 'reportes', label: 'Reportes' },
    { value: 'reportes/saldos-inventario', label: 'Saldos Inventarios' },
    { value: 'reportes/conteo-almacenes', label: 'Conteo Almacenes' },
    { value: 'reportes/detalle-ordenes-compra', label: 'Detalle OC' },
    { value: 'reportes/reversiones-salidas', label: 'Reversiones de Salidas' },
    { value: 'reportes/salidas-por-familia', label: 'Reporte por Familias' },
  ] },
]

export default function UsuariosList() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]   = useState<any>(null)
  const [restringirAcceso, setRestringirAcceso] = useState(false)
  const [permisosSel, setPermisosSel] = useState<string[]>([])

  const { data: usuarios, isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => api.get('/usuarios').then(r => r.data),
  })
  const { data: almacenes } = useQuery({
    queryKey: ['almacenes'],
    queryFn: () => api.get('/almacenes').then(r => r.data),
  })

  const { register, handleSubmit, reset, setValue, watch, formState: { isSubmitting } } = useForm<any>()
  const rolActual = watch('rol')
  const esSupervisorSel = rolActual === 'admin' || rolActual === 'gerente'

  const mutation = useMutation({
    mutationFn: (d: any) => {
      const payload = { ...d, permisos: restringirAcceso ? permisosSel : null }
      return editing ? api.put(`/usuarios/${editing.id}`, payload) : api.post('/usuarios', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['usuarios'] })
      toast.success(editing ? 'Usuario actualizado' : 'Usuario creado')
      setModalOpen(false); reset(); setEditing(null)
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al guardar usuario')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/usuarios/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); toast.success('Usuario eliminado') },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Error al eliminar'),
  })

  const handleDelete = async (u: any) => {
    const ok = await confirm({
      title: 'Eliminar usuario',
      message: <>¿Eliminar al usuario <strong>"{u.nombre}"</strong>? Perderá acceso al sistema.</>,
      variant: 'danger',
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    deleteMutation.mutate(u.id)
  }

  const openCreate = () => {
    reset({ rol: 'almacenero', activo: true }); setEditing(null)
    setRestringirAcceso(false); setPermisosSel([])
    setModalOpen(true)
  }
  const openEdit = (u: any) => {
    setEditing(u)
    setValue('nombre',     u.nombre)
    setValue('email',      u.email)
    setValue('rol',        u.rol)
    setValue('activo',     u.activo)
    setValue('almacen_id', u.almacen_id || '')
    setValue('password',   '')
    setRestringirAcceso(Array.isArray(u.permisos))
    setPermisosSel(Array.isArray(u.permisos) ? u.permisos : [])
    setModalOpen(true)
  }
  const toggleModulo = (value: string) => {
    setPermisosSel(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  const filtered = (usuarios || []).filter((u: any) =>
    !search || u.nombre.toLowerCase().includes(search.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(search.toLowerCase())
  )
  const { sorted: lista, sortCol, sortDir, toggle } = useSortTable(filtered, 'nombre', 'asc')

  if (isLoading) return <PageLoader />

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar por nombre o email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={openCreate}><Plus size={16} /> Nuevo Usuario</button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Users size={18} className="text-blue-500" />
          <span className="font-semibold text-slate-900">Usuarios del Sistema</span>
          <span className="ml-auto text-sm text-slate-400">{lista.length} registros</span>
        </div>
        {!lista.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <SortableTh col="nombre" label="Nombre (usuario)" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="email" label="Email" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="rol" label="Rol" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <SortableTh col="almacen_nombre" label="Almacén Asignado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} />
                  <SortableTh col="activo" label="Estado" sortCol={sortCol} sortDir={sortDir} onSort={toggle} align="center" />
                  <th className="table-header text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((u: any) => (
                  <tr key={u.id} className="table-row">
                    <td className="table-cell font-semibold text-slate-900">{u.nombre}</td>
                    <td className="table-cell text-slate-500 text-sm">{u.email || <span className="text-slate-300">—</span>}</td>
                    <td className="table-cell text-center">
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${ROL_COLORS[u.rol] || 'bg-slate-100 text-slate-600'}`}>
                        {ROLES.find(r => r.value === u.rol)?.label || u.rol}
                      </span>
                    </td>
                    <td className="table-cell text-slate-600">
                      {u.almacen_nombre
                        ? <span className="text-sm font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg">{u.almacen_nombre}</span>
                        : <span className="text-slate-400 text-xs">Sin almacén</span>}
                    </td>
                    <td className="table-cell text-center"><Badge value={u.activo ? 'activo' : 'inactivo'} /></td>
                    <td className="table-cell text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(u)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
                          <Edit size={16} />
                        </button>
                        <button onClick={() => handleDelete(u)} disabled={deleteMutation.isPending} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40" title="Eliminar">
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
      </div>

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); reset(); setEditing(null) }}
        title={editing ? 'Editar Usuario' : 'Nuevo Usuario'} size="md">
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="label">Nombre completo *</label>
            <input className="input" {...register('nombre', { required: true })} placeholder="Ej: Juan Pérez" />
            <p className="text-xs text-slate-400 mt-1">Este nombre es lo que el usuario escribe para iniciar sesión.</p>
          </div>
          <div>
            <label className="label">Correo electrónico</label>
            <input className="input" type="email" {...register('email')} placeholder="correo@empresa.com (opcional)" />
          </div>
          <div>
            <label className="label">{editing ? 'Nueva Contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}</label>
            <div className="relative">
              <Key size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" type="password" {...register('password', { required: !editing })} placeholder="••••••••" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Rol *</label>
              <select className="select" {...register('rol', { required: true })}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Almacén Asignado</label>
              <select className="select" {...register('almacen_id')}>
                <option value="">-- Sin almacén --</option>
                {(almacenes || []).map((a: any) => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
              </select>
            </div>
          </div>
          {editing && (
            <div>
              <label className="label">Estado</label>
              <select className="select" {...register('activo')}>
                <option value={1 as any}>Activo</option>
                <option value={0 as any}>Inactivo</option>
              </select>
            </div>
          )}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
            El almacén asignado determina desde qué almacén puede registrar salidas este usuario.
          </div>

          <div className="border-t border-slate-100 pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={restringirAcceso}
                onChange={e => setRestringirAcceso(e.target.checked)}
                disabled={esSupervisorSel}
              />
              <span className="label mb-0">Restringir acceso a módulos específicos</span>
            </label>
            {esSupervisorSel ? (
              <p className="text-xs text-slate-400 mt-1">Administrador y Gerente siempre tienen acceso a todo el sistema, sin importar esta selección.</p>
            ) : !restringirAcceso ? (
              <p className="text-xs text-slate-400 mt-1">Sin marcar, este usuario ve todos los módulos del menú.</p>
            ) : (
              <div className="mt-3 space-y-3 max-h-64 overflow-y-auto pr-1">
                {MODULOS_POR_GRUPO.map(g => (
                  <div key={g.grupo}>
                    <p className="text-xs font-semibold text-slate-500 mb-1">{g.grupo}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {g.items.map(item => (
                        <label key={item.value} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                          <input type="checkbox" checked={permisosSel.includes(item.value)} onChange={() => toggleModulo(item.value)} />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setModalOpen(false); reset(); setEditing(null) }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : editing ? 'Actualizar' : 'Crear Usuario'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
