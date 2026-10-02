import RequiereAcceso from '@/components/auth/RequiereAcceso'
import UsuariosList from '@/features/Usuarios/UsuariosList'

export default function Page() {
  return (
    <RequiereAcceso modulo="usuarios">
      <UsuariosList />
    </RequiereAcceso>
  )
}
