'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../context/AuthContext'
import { PageLoader } from '../ui/Spinner'
import Login from '../../features/Login'

// Si ya hay sesión, /login redirige al dashboard.
export default function LoginGate() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace('/')
  }, [isLoading, isAuthenticated, router])

  if (isLoading || isAuthenticated) {
    return <div className="flex items-center justify-center h-screen"><PageLoader /></div>
  }
  return <Login />
}
