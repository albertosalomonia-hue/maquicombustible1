import RequiereAcceso from '@/components/auth/RequiereAcceso'
import RecepcionesList from '@/features/Recepciones/RecepcionesList'

export default function Page() {
  return (
    <RequiereAcceso modulo="recepciones">
      <RecepcionesList />
    </RequiereAcceso>
  )
}
