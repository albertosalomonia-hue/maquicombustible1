'use client'

import { Menu, Bell } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { usePathname, useRouter } from 'next/navigation'
import { useOrdenesPendientesAlerta } from '../../hooks/useOrdenesPendientesAlerta'

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/clientes': 'Clientes',
  '/productos': 'Productos',
  '/almacenes': 'Almacenes',
  '/centros-costo': 'Centros de Costo',
  '/ordenes-compra': 'Órdenes de Compra',
  '/facturas': 'Facturas',
  '/recepciones': 'Recepciones',
  '/transferencias': 'Transferencias',
  '/solicitudes': 'Solicitudes de Abastecimiento',
  '/inventario': 'Inventario Multialmacén',
  '/kardex': 'Kardex',
  '/reportes': 'Reportes',
}

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const { habilitado: tieneAlertaOC, pendientes } = useOrdenesPendientesAlerta()
  const hayPendientes = tieneAlertaOC && pendientes.length > 0

  const getTitle = () => {
    for (const [path, title] of Object.entries(titles)) {
      if (path !== '/' && pathname.startsWith(path)) return title
    }
    return titles[pathname] || 'KardexERP-DIESEL 2026'
  }

  return (
    <header className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
        >
          <Menu size={20} />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{getTitle()}</h1>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => hayPendientes && router.push('/ordenes-compra')}
          className={`relative p-2 rounded-lg transition-colors ${
            hayPendientes ? 'text-red-500 hover:bg-red-50 animate-pulse' : 'text-slate-400 hover:bg-slate-100'
          }`}
          title={hayPendientes ? `${pendientes.length} orden(es) de compra por recepcionar` : undefined}
        >
          <Bell size={18} />
          {hayPendientes && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
              {pendientes.length}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2 pl-3 border-l border-slate-100">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
            {user?.nombre?.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium text-slate-700 hidden sm:block">{user?.nombre}</span>
        </div>
      </div>
    </header>
  )
}
