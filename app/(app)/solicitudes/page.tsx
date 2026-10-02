import RequiereAcceso from '@/components/auth/RequiereAcceso'
import SolicitudesList from '@/features/Solicitudes/SolicitudesList'

export default function Page() {
  return (
    <RequiereAcceso modulo="solicitudes">
      <SolicitudesList />
    </RequiereAcceso>
  )
}
