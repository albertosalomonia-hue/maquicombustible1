import RequiereAcceso from '@/components/auth/RequiereAcceso'
import ReportesPage from '@/features/Reportes/ReportesPage'

export default function Page() {
  return (
    <RequiereAcceso modulo="reportes">
      <ReportesPage />
    </RequiereAcceso>
  )
}
