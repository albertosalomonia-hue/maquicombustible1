import RequiereAcceso from '@/components/auth/RequiereAcceso'
import ReversionesSalidasPage from '@/features/Reportes/ReversionesSalidasPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="reportes/reversiones-salidas">
      <ReversionesSalidasPage />
    </RequiereAcceso>
  )
}
