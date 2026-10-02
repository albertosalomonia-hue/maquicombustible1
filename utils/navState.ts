// Next.js no tiene `location.state` como react-router. Para pasar datos de una pantalla a
// otra (p. ej. "Recepcionar" desde una OC) se guardan en sessionStorage y la pantalla
// destino los consume una sola vez al montarse.
const PREFIJO = 'navState:'

export function setNavState(destino: string, estado: unknown) {
  try {
    sessionStorage.setItem(PREFIJO + destino, JSON.stringify(estado))
  } catch {
    /* sessionStorage no disponible: la pantalla destino abre sin prellenado */
  }
}

export function consumeNavState<T>(destino: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIJO + destino)
    if (!raw) return null
    sessionStorage.removeItem(PREFIJO + destino)
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
