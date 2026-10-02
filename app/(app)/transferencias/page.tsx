import RequiereAcceso from '@/components/auth/RequiereAcceso'
import TransferenciasList from '@/features/Transferencias/TransferenciasList'

export default function Page() {
  return (
    <RequiereAcceso modulo="transferencias">
      <TransferenciasList />
    </RequiereAcceso>
  )
}
