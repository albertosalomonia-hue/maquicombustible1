'use client'

import { useEffect } from 'react'

// Error boundary global: si una pantalla falla al renderizar, se muestra esto en vez de una
// página en blanco y el usuario puede reintentar sin recargar todo el sistema.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-md text-center">
        <h2 className="page-title mb-2">Algo salió mal</h2>
        <p className="page-subtitle mb-5">
          Ocurrió un error inesperado en esta pantalla. Puedes reintentar o volver al inicio.
        </p>
        <div className="flex justify-center gap-3">
          <button className="btn-primary" onClick={() => reset()}>Reintentar</button>
          <a className="btn-secondary" href="/">Ir al inicio</a>
        </div>
      </div>
    </div>
  )
}
