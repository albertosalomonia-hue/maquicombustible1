'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../context/AuthContext'
import { PageLoader } from '../ui/Spinner'
import Layout from './Layout'

// Protege todo el grupo (app): sin sesión redirige a /login. El token vive en localStorage,
// así que la comprobación solo puede hacerse en el cliente.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login')
  }, [isLoading, isAuthenticated, router])

  if (isLoading || !isAuthenticated) {
    return <div className="flex items-center justify-center h-screen"><PageLoader /></div>
  }
  return <Layout>{children}</Layout>
}
