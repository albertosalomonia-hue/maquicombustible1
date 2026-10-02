import RequiereAcceso from '@/components/auth/RequiereAcceso'
import SalidasPorFamiliaPage from '@/features/Reportes/SalidasPorFamiliaPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="reportes/salidas-por-familia">
      <SalidasPorFamiliaPage />
    </RequiereAcceso>
  )
}
