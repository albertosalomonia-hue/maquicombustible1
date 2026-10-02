import RequiereAcceso from '@/components/auth/RequiereAcceso'
import SaldosInicialesPage from '@/features/SaldosIniciales/SaldosInicialesPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="saldos-iniciales">
      <SaldosInicialesPage />
    </RequiereAcceso>
  )
}
