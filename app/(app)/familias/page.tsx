import RequiereAcceso from '@/components/auth/RequiereAcceso'
import FamiliasList from '@/features/Familias/FamiliasList'

export default function Page() {
  return (
    <RequiereAcceso modulo="familias">
      <FamiliasList />
    </RequiereAcceso>
  )
}
