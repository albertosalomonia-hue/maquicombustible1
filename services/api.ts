import axios from 'axios'
import toast from 'react-hot-toast'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Evita duplicados por doble clic: si ya hay una petición de escritura idéntica
// (mismo método, URL y cuerpo) en curso, se reutiliza en vez de enviarla otra vez.
const baseAdapter = axios.getAdapter(api.defaults.adapter)
const enVuelo = new Map<string, Promise<any>>()
const COLA_MS = 1000

api.defaults.adapter = (config) => {
  const metodo = (config.method || 'get').toLowerCase()
  if (metodo === 'get' || metodo === 'head' || metodo === 'options') return baseAdapter(config)

  const cuerpo = typeof config.data === 'string' ? config.data : JSON.stringify(config.data ?? null)
  const key = `${metodo} ${config.baseURL || ''}${config.url} ${cuerpo}`
  const existente = enVuelo.get(key)
  if (existente) return existente

  const p = baseAdapter(config)
  enVuelo.set(key, p)
  const liberar = () => setTimeout(() => enVuelo.delete(key), COLA_MS)
  p.then(liberar, liberar)
  return p
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      // Recarga completa a propósito: descarta todo el estado en memoria de la sesión caducada.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/login'
    }
    const message = err.response?.data?.error || 'Error de conexión'
    toast.error(message, { id: message })
    return Promise.reject(err)
  }
)

export default api
