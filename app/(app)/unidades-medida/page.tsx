import RequiereAcceso from '@/components/auth/RequiereAcceso'
import UnidadesMedidaList from '@/features/UnidadesMedida/UnidadesMedidaList'

export default function Page() {
  return (
    <RequiereAcceso modulo="unidades-medida">
      <UnidadesMedidaList />
    </RequiereAcceso>
  )
}
