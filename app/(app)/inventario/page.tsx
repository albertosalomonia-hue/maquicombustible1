import RequiereAcceso from '@/components/auth/RequiereAcceso'
import InventarioPage from '@/features/Inventario/InventarioPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="inventario">
      <InventarioPage />
    </RequiereAcceso>
  )
}
