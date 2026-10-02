import RequiereAcceso from '@/components/auth/RequiereAcceso'
import FacturasList from '@/features/Facturas/FacturasList'

export default function Page() {
  return (
    <RequiereAcceso modulo="facturas">
      <FacturasList />
    </RequiereAcceso>
  )
}
