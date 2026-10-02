'use client'

import { useEffect, useRef } from 'react'

// Medidor de fluido: envuelve la librería javascript-fluid-meter (aarcoraci, MIT), cargada como
// script global /vendor/js-fluid-meter.js, que se inyecta una sola vez bajo demanda.
declare global {
  interface Window { FluidMeter?: any }
}

let scriptPromise: Promise<void> | null = null
function cargarFluidMeter(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('sin window'))
  if (window.FluidMeter) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script')
      el.src = '/vendor/js-fluid-meter.js'
      el.async = true
      el.onload = () => resolve()
      el.onerror = () => { scriptPromise = null; reject(new Error('No se pudo cargar js-fluid-meter')) }
      document.head.appendChild(el)
    })
  }
  return scriptPromise
}

const COLORES = {
  // Consumo = naranja, Reserva = amarillo (mismos colores que los badges de Despacho en Facturas)
  consumo: { frente: '#f97316', fondo: '#fdba74' },
  reserva: { frente: '#eab308', fondo: '#fde047' },
}

export default function FluidGauge({ porcentaje, tipo, size = 150 }: {
  porcentaje: number
  tipo: 'consumo' | 'reserva'
  size?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const meter = useRef<any>(null)
  const ultimo = useRef(porcentaje)
  useEffect(() => { ultimo.current = porcentaje })

  useEffect(() => {
    let cancelado = false
    let fm: any = null
    cargarFluidMeter().then(() => {
      if (cancelado || !ref.current || !window.FluidMeter) return
      fm = new window.FluidMeter()
      fm.init({
      targetContainer: ref.current,
      fillPercentage: ultimo.current,
      options: {
        size,
        borderWidth: 10,
        drawText: false, // el saldo real en galones se escribe debajo, no un porcentaje
        drawBubbles: true,
        backgroundColor: '#1a5a6b',
        foregroundColor: '#072e39',
        foregroundFluidLayer: { fillStyle: COLORES[tipo].frente, angularSpeed: 100, maxAmplitude: 5, frequency: 30, horizontalSpeed: -150 },
        backgroundFluidLayer: { fillStyle: COLORES[tipo].fondo, angularSpeed: 100, maxAmplitude: 3, frequency: 30, horizontalSpeed: 150 },
      },
      })
      meter.current = fm
    }).catch(() => {})
    return () => { cancelado = true; fm?.destroy?.(); meter.current = null }
  }, [tipo, size])

  useEffect(() => { meter.current?.setPercentage(porcentaje) }, [porcentaje])

  return <div ref={ref} style={{ width: size, height: size }} className="mx-auto" />
}
