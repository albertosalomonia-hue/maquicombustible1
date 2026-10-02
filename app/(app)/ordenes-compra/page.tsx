import RequiereAcceso from '@/components/auth/RequiereAcceso'
import OrdenesCompraList from '@/features/OrdenesCompra/OrdenesCompraList'

export default function Page() {
  return (
    <RequiereAcceso modulo="ordenes-compra">
      <OrdenesCompraList />
    </RequiereAcceso>
  )
}
