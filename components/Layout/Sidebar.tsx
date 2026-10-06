'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, Package, Warehouse, Target,
  ShoppingCart, Receipt, Truck, ArrowLeftRight,
  BookOpen, BarChart3, LogOut, ChevronRight,
  Boxes, ClipboardList, TrendingUp, PackageMinus, UserCog, Scale, FileBarChart2, ShoppingCart as ShoppingCartIcon,
  Tags, Ruler, Award, Layers, Tag, ArrowRightLeft, FileSearch, FolderTree, Lock, Undo2, LayoutGrid, ClipboardCheck,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import clsx from 'clsx'

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const { user, logout, puedeGestionarMaestros, puedeGestionarCompras, tieneAcceso } = useAuth()
  const pathname = usePathname()

  const isActive = (to: string) => {
    if (to === '/') return pathname === '/'
    return pathname.startsWith(to)
  }

  type NavItem = { to: string; icon: React.ReactNode; label: string }
  type NavGroup = { title: string; items: NavItem[]; visible?: boolean }

  const navGroups: NavGroup[] = [
    {
      title: 'Principal',
      items: [
        { to: '/', icon: <LayoutDashboard size={18} />, label: 'Dashboard' },
      ],
    },
    {
      title: 'Maestros',
      visible: puedeGestionarMaestros,
      items: [
        { to: '/clientes',      icon: <Users size={18} />,     label: 'Clientes' },
        { to: '/productos',     icon: <Package size={18} />,   label: 'Productos' },
        { to: '/placas',        icon: <Tag size={18} />,       label: 'Vehículos y Maquinaria' },
        { to: '/categorias',    icon: <Tags size={18} />,      label: 'Categorías' },
        { to: '/familias',      icon: <FolderTree size={18} />, label: 'Familias' },
        { to: '/unidades-medida', icon: <Ruler size={18} />,   label: 'Unidad de Medida' },
        { to: '/marcas',        icon: <Award size={18} />,     label: 'Marca' },
        { to: '/almacenes',     icon: <Warehouse size={18} />, label: 'Almacenes' },
        { to: '/centros-costo', icon: <Target size={18} />,    label: 'Centros de Costo' },
        { to: '/usuarios', icon: <UserCog size={18} />, label: 'Usuarios' },
      ],
    },
    {
      title: 'Compras',
      visible: puedeGestionarCompras,
      items: [
        { to: '/ordenes-compra',icon: <ShoppingCart size={18} />,label: 'Órdenes de Compra' },
        { to: '/control-facturas', icon: <FileSearch size={18} />, label: 'CONTROL-FACTURAS' },
        { to: '/facturas',      icon: <Receipt size={18} />,     label: 'Facturas' },
      ],
    },
    {
      title: 'Logística',
      items: [
        ...(puedeGestionarCompras ? [{ to: '/recepciones', icon: <Truck size={18} />, label: 'Recepciones' }] : []),
        { to: '/transferencias', icon: <ArrowLeftRight size={18} />, label: 'Transferencias' },
        // "Transferencia por Bloque" fuera del menú: el stock ya entra directo al almacén desde la recepción.
        { to: '/trans-almacenes', icon: <ArrowRightLeft size={18} />, label: 'Trans-Almacenes' },
        { to: '/salidas',        icon: <PackageMinus size={18} />,   label: 'Salidas' },
        { to: '/solicitudes',    icon: <ClipboardList size={18} />,  label: 'Solicitudes' },
      ],
    },
    {
      title: 'Inventario',
      items: [
        { to: '/inventario',       icon: <Boxes size={18} />,    label: 'Inventario' },
        { to: '/kardex',           icon: <BookOpen size={18} />, label: 'Kardex' },
        { to: '/saldos-iniciales', icon: <Scale size={18} />,    label: 'Saldos Iniciales' },
        { to: '/cierre-periodo',   icon: <Lock size={18} />,     label: 'Cierre de Período' },
      ],
    },
    {
      title: 'Reportes',
      items: [
        { to: '/reportes', icon: <BarChart3 size={18} />, label: 'Reportes' },
        { to: '/reportes/saldos-inventario',      icon: <FileBarChart2 size={18} />,       label: 'Saldos Inventarios' },
        { to: '/reportes/conteo-almacenes',       icon: <ClipboardCheck size={18} />,      label: 'Conteo Almacenes' },
        { to: '/reportes/detalle-ordenes-compra', icon: <ShoppingCartIcon size={18} />,    label: 'Detalle OC' },
        { to: '/reportes/reversiones-salidas',    icon: <Undo2 size={18} />,               label: 'Reversiones de Salidas' },
        { to: '/reportes/salidas-por-familia',    icon: <LayoutGrid size={18} />,          label: 'Reporte por Familias' },
        { to: '/reportes/facturas-vs-stock',      icon: <Scale size={18} />,               label: 'Facturas vs Stock' },
      ],
    },
  ]

  // Filtra por el checklist de acceso configurado por usuario (además de los filtros
  // por rol ya existentes arriba). El Dashboard ("/") siempre queda visible.
  const visibleGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(i => i.to === '/' || tieneAcceso(i.to.slice(1))) }))
    .filter(g => g.visible !== false && g.items.length > 0)

  return (
    <div className="flex flex-col h-full bg-[#0b3d4b] text-white">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center shrink-0 shadow-lg">
          <TrendingUp size={20} className="text-white" />
        </div>
        <div>
          <p className="font-bold text-white text-sm leading-tight">KardexERP-DIESEL</p>
          <p className="text-xs text-slate-300">2026 · Logística & Inventarios</p>
        </div>
      </div>

      {/* Almacén badge (si el usuario tiene uno asignado) */}
      {user?.almacen_nombre && (
        <div className="mx-3 mt-3 px-3 py-2 bg-black/20 border border-white/10 rounded-xl">
          <p className="text-xs text-teal-200 font-medium truncate">
            <Warehouse size={11} className="inline mr-1 opacity-70" />
            {user.almacen_nombre}
          </p>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {visibleGroups.map((group) => (
          <div key={group.title}>
            <p className="sidebar-group-title">{group.title}</p>
            {group.items.map((item) => (
              <Link
                key={item.to}
                href={item.to}
                onClick={onClose}
                className={clsx('sidebar-link', isActive(item.to) && 'active')}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {isActive(item.to) && <ChevronRight size={14} className="opacity-60" />}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-green-600 flex items-center justify-center text-sm font-bold shrink-0">
            {user?.nombre?.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.nombre}</p>
            <p className="text-xs text-slate-400 capitalize">{user?.rol}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          <LogOut size={16} />
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
