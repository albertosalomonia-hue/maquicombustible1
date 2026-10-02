import RequiereAcceso from '@/components/auth/RequiereAcceso'
import ConteoAlmacenesPage from '@/features/Reportes/ConteoAlmacenesPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="reportes/conteo-almacenes">
      <ConteoAlmacenesPage />
    </RequiereAcceso>
  )
}
