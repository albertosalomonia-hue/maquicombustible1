'use client'

import React, { createContext, useCallback, useContext, useState } from 'react'
import ConfirmDialog, { ConfirmVariant } from '../components/ui/ConfirmDialog'

export interface ConfirmOptions {
  title: string
  message: React.ReactNode
  variant?: ConfirmVariant
  confirmLabel?: string
  cancelLabel?: string
  requiresPassword?: boolean
  passwordLabel?: string
  /** Devuelve un mensaje de error si la contraseña es inválida, o null si es correcta. */
  validatePassword?: (value: string) => string | null
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>')
  return ctx
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPassword('')
      setPasswordError('')
      setPending({ ...options, resolve })
    })
  }, [])

  const handleCancel = () => {
    pending?.resolve(false)
    setPending(null)
  }

  const handleConfirm = () => {
    if (pending?.requiresPassword && pending.validatePassword) {
      const err = pending.validatePassword(password)
      if (err) { setPasswordError(err); return }
    }
    pending?.resolve(true)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        isOpen={!!pending}
        title={pending?.title || ''}
        message={pending?.message || ''}
        variant={pending?.variant}
        confirmLabel={pending?.confirmLabel}
        cancelLabel={pending?.cancelLabel}
        requiresPassword={pending?.requiresPassword}
        passwordLabel={pending?.passwordLabel}
        passwordValue={password}
        passwordError={passwordError}
        onPasswordChange={(v) => { setPassword(v); setPasswordError('') }}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  )
}
