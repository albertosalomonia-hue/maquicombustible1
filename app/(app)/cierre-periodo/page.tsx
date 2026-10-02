import RequiereAcceso from '@/components/auth/RequiereAcceso'
import CierrePeriodoPage from '@/features/CierrePeriodo/CierrePeriodoPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="cierre-periodo">
      <CierrePeriodoPage />
    </RequiereAcceso>
  )
}
