import RequiereAcceso from '@/components/auth/RequiereAcceso'
import SalidasList from '@/features/Salidas/SalidasList'

export default function Page() {
  return (
    <RequiereAcceso modulo="salidas">
      <SalidasList />
    </RequiereAcceso>
  )
}
