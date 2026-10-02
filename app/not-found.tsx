import { redirect } from 'next/navigation'

// Igual que antes: cualquier ruta desconocida vuelve al dashboard.
export default function NotFound() {
  redirect('/')
}
