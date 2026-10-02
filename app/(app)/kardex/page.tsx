import RequiereAcceso from '@/components/auth/RequiereAcceso'
import KardexPage from '@/features/Kardex/KardexPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="kardex">
      <KardexPage />
    </RequiereAcceso>
  )
}
