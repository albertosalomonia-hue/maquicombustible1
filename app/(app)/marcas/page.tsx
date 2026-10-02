import RequiereAcceso from '@/components/auth/RequiereAcceso'
import MarcasList from '@/features/Marcas/MarcasList'

export default function Page() {
  return (
    <RequiereAcceso modulo="marcas">
      <MarcasList />
    </RequiereAcceso>
  )
}
