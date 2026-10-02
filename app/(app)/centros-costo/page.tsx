import RequiereAcceso from '@/components/auth/RequiereAcceso'
import CentrosCostoList from '@/features/CentrosCosto/CentrosCostoList'

export default function Page() {
  return (
    <RequiereAcceso modulo="centros-costo">
      <CentrosCostoList />
    </RequiereAcceso>
  )
}
