import RequiereAcceso from '@/components/auth/RequiereAcceso'
import AlmacenesList from '@/features/Almacenes/AlmacenesList'

export default function Page() {
  return (
    <RequiereAcceso modulo="almacenes">
      <AlmacenesList />
    </RequiereAcceso>
  )
}
