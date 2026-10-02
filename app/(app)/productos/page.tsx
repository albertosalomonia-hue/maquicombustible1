import RequiereAcceso from '@/components/auth/RequiereAcceso'
import ProductosList from '@/features/Productos/ProductosList'

export default function Page() {
  return (
    <RequiereAcceso modulo="productos">
      <ProductosList />
    </RequiereAcceso>
  )
}
