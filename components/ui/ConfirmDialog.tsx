'use client'

import { AlertTriangle, ShieldAlert, Info } from 'lucide-react'

export type ConfirmVariant = 'danger' | 'warning' | 'info'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: React.ReactNode
  variant?: ConfirmVariant
  confirmLabel?: string
  cancelLabel?: string
  requiresPassword?: boolean
  passwordLabel?: string
  passwordValue?: string
  passwordError?: string
  onPasswordChange?: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
}

const VARIANT_STYLES: Record<ConfirmVariant, { icon: typeof AlertTriangle; ring: string; btn: string }> = {
  danger:  { icon: AlertTriangle, ring: 'bg-red-100 text-red-600',   btn: 'bg-red-600 hover:bg-red-700 shadow-red-200' },
  warning: { icon: ShieldAlert,   ring: 'bg-amber-100 text-amber-600', btn: 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' },
  info:    { icon: Info,          ring: 'bg-blue-100 text-blue-600',  btn: 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' },
}

export default function ConfirmDialog({
  isOpen, title, message, variant = 'danger', confirmLabel, cancelLabel,
  requiresPassword, passwordLabel, passwordValue, passwordError, onPasswordChange,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null
  const V = VARIANT_STYLES[variant]
  const Icon = V.icon

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm fade-in overflow-hidden">
        <div className="px-6 pt-6 pb-2 text-center">
          <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${V.ring}`}>
            <Icon size={24} />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1.5">{title}</h3>
          <div className="text-sm text-slate-500 leading-relaxed">{message}</div>

          {requiresPassword && (
            <div className="mt-4 text-left">
              <input
                type="password"
                autoFocus
                className="input w-full"
                placeholder={passwordLabel || 'Contraseña'}
                value={passwordValue ?? ''}
                onChange={e => onPasswordChange?.(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onConfirm()}
              />
              {passwordError && <p className="text-xs text-red-600 mt-1.5 font-medium">{passwordError}</p>}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100 mt-4">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">
            {cancelLabel || 'Cancelar'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-bold rounded-xl text-white shadow-md transition-all duration-150 ${V.btn}`}
          >
            {confirmLabel || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
