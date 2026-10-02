import RequiereAcceso from '@/components/auth/RequiereAcceso'
import PlacasList from '@/features/Placas/PlacasList'

export default function Page() {
  return (
    <RequiereAcceso modulo="placas">
      <PlacasList />
    </RequiereAcceso>
  )
}
