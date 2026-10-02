import RequiereAcceso from '@/components/auth/RequiereAcceso'
import ControlFacturasList from '@/features/ControlFacturas/ControlFacturasList'

export default function Page() {
  return (
    <RequiereAcceso modulo="control-facturas">
      <ControlFacturasList />
    </RequiereAcceso>
  )
}
