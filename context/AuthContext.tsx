'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import api from '../services/api'

interface User {
  id: number
  nombre: string
  email: string | null
  rol: string
  almacen_id: number | null
  almacen_tipo: string | null
  almacen_nombre: string | null
  permisos: string[] | null
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (usuario: string, password: string) => Promise<void>
  logout: () => void
  isAuthenticated: boolean
  // Helpers de permisos
  esSupervisor: boolean       // admin o gerente — acceso total
  esPrincipal: boolean        // almacén central o sin almacén asignado
  puedeGestionarMaestros: boolean  // puede crear/editar productos, maestros
  puedeGestionarCompras: boolean   // puede hacer OC, recepciones, facturas
  almacenId: number | null    // almacén asignado al usuario (null = todos)
  // permisos=null = sin restricción configurada (acceso a todo, compatibilidad con
  // usuarios creados antes de esta función). admin/gerente siempre tienen acceso total,
  // salvo "usuarios" que queda reservado solo al rol Administrador.
  tieneAcceso: (modulo: string) => boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

function calcPermisos(user: User | null) {
  const esSupervisor = !!user && (user.rol === 'admin' || user.rol === 'gerente')
  if (!user) {
    return {
      esSupervisor: false, esPrincipal: false, puedeGestionarMaestros: false, puedeGestionarCompras: false,
      almacenId: null, tieneAcceso: () => false,
    }
  }

  // Central = admin/gerente, sin almacén asignado, o con almacén de tipo 'central'
  const esPrincipal  = esSupervisor || !user.almacen_id || user.almacen_tipo === 'central'
  const tieneAcceso = (modulo: string) => {
    // Gestionar usuarios queda reservado solo al rol Administrador — ni Gerente (que
    // sí tiene acceso total al resto de módulos vía esSupervisor) puede crear/editar/
    // eliminar usuarios, para evitar que alguien se otorgue a sí mismo más acceso.
    if (modulo === 'usuarios') return user.rol === 'admin'
    if (esSupervisor) return true
    if (!user.permisos) return true
    return user.permisos.includes(modulo)
  }
  return {
    esSupervisor,
    esPrincipal,
    puedeGestionarMaestros: esPrincipal,
    puedeGestionarCompras:  esPrincipal,
    almacenId: user.almacen_id,
    tieneAcceso,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const savedUser = localStorage.getItem('user')
    const token = localStorage.getItem('token')
    if (savedUser && token) {
      setUser(JSON.parse(savedUser))
    }
    setIsLoading(false)
  }, [])

  const login = async (usuario: string, password: string) => {
    const { data } = await api.post('/auth/login', { usuario, password })
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    setUser(data.user)
  }

  const logout = () => {
    api.post('/auth/logout').catch(() => {})
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  const permisos = calcPermisos(user)

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, isAuthenticated: !!user, ...permisos }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
