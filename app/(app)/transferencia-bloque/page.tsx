import RequiereAcceso from '@/components/auth/RequiereAcceso'
import TransferenciaBloque from '@/features/Transferencias/TransferenciaBloque'

export default function Page() {
  return (
    <RequiereAcceso modulo="transferencia-bloque">
      <TransferenciaBloque />
    </RequiereAcceso>
  )
}
