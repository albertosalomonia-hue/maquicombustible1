import RequiereAcceso from '@/components/auth/RequiereAcceso'
import ClientesList from '@/features/Clientes/ClientesList'

export default function Page() {
  return (
    <RequiereAcceso modulo="clientes">
      <ClientesList />
    </RequiereAcceso>
  )
}
