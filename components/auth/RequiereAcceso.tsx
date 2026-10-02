'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../context/AuthContext'

// Bloquea la navegación directa por URL a un módulo que el usuario no tiene habilitado
// en su checklist de acceso (Usuarios), aunque no lo vea en el Sidebar.
export default function RequiereAcceso({ modulo, children }: { modulo: string; children: React.ReactNode }) {
  const { tieneAcceso } = useAuth()
  const permitido = tieneAcceso(modulo)
  const router = useRouter()

  useEffect(() => {
    if (!permitido) router.replace('/')
  }, [permitido, router])

  return permitido ? <>{children}</> : null
}
