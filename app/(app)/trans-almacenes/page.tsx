import RequiereAcceso from '@/components/auth/RequiereAcceso'
import TransAlmacenes from '@/features/Transferencias/TransAlmacenes'

export default function Page() {
  return (
    <RequiereAcceso modulo="trans-almacenes">
      <TransAlmacenes />
    </RequiereAcceso>
  )
}
