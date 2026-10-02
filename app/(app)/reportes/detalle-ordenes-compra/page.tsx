import RequiereAcceso from '@/components/auth/RequiereAcceso'
import DetalleOrdenesCompraPage from '@/features/Reportes/DetalleOrdenesCompraPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="reportes/detalle-ordenes-compra">
      <DetalleOrdenesCompraPage />
    </RequiereAcceso>
  )
}
