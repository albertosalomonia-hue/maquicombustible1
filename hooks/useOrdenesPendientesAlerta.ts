'use client'

import { useQuery } from '@tanstack/react-query'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'

const REFETCH_MS = 2 * 60 * 1000 // revisa cada 2 minutos por si llegan OC nuevas o se recepcionan mientras la app sigue abierta

function claveVistas(usuarioId: number) {
  return `oc_pendientes_notificadas_${usuarioId}`
}

// Fuente única para el aviso de "OC de Almacén Central por recepcionar" del rol
// almacenero, compartida entre la campanita (Header) y el modal (AlertaOrdenesPendientes).
//
// `pendientes` refleja el estado REAL y vigente (se apaga solo cuando la OC ya se
// recepcionó, sin importar si el usuario cerró algún aviso antes) — es lo que debe
// gobernar la campanita, para que siga marcando hasta que de verdad se recepcione.
// `sinVer` es el subconjunto que todavía no se le mostró en el modal (se recuerda en
// localStorage por usuario) — solo sirve para no repetir el mismo popup en cada
// sondeo; no se usa para decidir si la campanita sigue prendida.
export function useOrdenesPendientesAlerta() {
  const { user } = useAuth()
  const habilitado = user?.rol === 'almacenero'

  const { data } = useQuery({
    queryKey: ['ordenes-compra-pendientes-alerta', user?.id],
    queryFn: () => api.get('/ordenes-compra', { params: { almacen_central: 'SI', sin_recepcionar: '1', limit: 100 } }).then(r => r.data),
    enabled: habilitado,
    staleTime: 0,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  })

  const pendientes: any[] = habilitado ? (data?.data || []) : []

  const marcarVistas = (ids: number[]) => {
    if (!user) return
    const vistasRaw = localStorage.getItem(claveVistas(user.id))
    const vistas: number[] = vistasRaw ? JSON.parse(vistasRaw) : []
    localStorage.setItem(claveVistas(user.id), JSON.stringify(Array.from(new Set([...vistas, ...ids]))))
  }

  const sinVer = (() => {
    if (!habilitado || !user || !pendientes.length) return []
    const vistasRaw = localStorage.getItem(claveVistas(user.id))
    const vistas: number[] = vistasRaw ? JSON.parse(vistasRaw) : []
    return pendientes.filter(oc => !vistas.includes(oc.id))
  })()

  return { habilitado, pendientes, sinVer, marcarVistas }
}
