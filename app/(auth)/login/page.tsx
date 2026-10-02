import type { Metadata } from 'next'
import LoginGate from '@/components/auth/LoginGate'

export const metadata: Metadata = { title: 'Iniciar sesión | KardexERP-DIESEL 2026' }

export default function Page() {
  return <LoginGate />
}
