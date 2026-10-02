import RequiereAcceso from '@/components/auth/RequiereAcceso'
import SaldosInventarioPage from '@/features/Reportes/SaldosInventarioPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="reportes/saldos-inventario">
      <SaldosInventarioPage />
    </RequiereAcceso>
  )
}
