import RequiereAcceso from '@/components/auth/RequiereAcceso'
import FacturasVsStockPage from '@/features/Reportes/FacturasVsStockPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="reportes/facturas-vs-stock">
      <FacturasVsStockPage />
    </RequiereAcceso>
  )
}
