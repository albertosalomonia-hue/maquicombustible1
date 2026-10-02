import RequiereAcceso from '@/components/auth/RequiereAcceso'
import CategoriasList from '@/features/Categorias/CategoriasList'

export default function Page() {
  return (
    <RequiereAcceso modulo="categorias">
      <CategoriasList />
    </RequiereAcceso>
  )
}
