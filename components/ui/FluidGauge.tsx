'use client'

import { useId } from 'react'

// Medidor de fluido en forma de tanque cilíndrico (SVG): el nivel sube/baja con transición suave
// y la superficie del líquido tiene ondas animadas.
const COLORES = {
  // Consumo = naranja, Reserva = amarillo (mismos colores que los badges de Despacho en Facturas)
  consumo: { frente: '#f97316', fondo: '#fdba74' },
  reserva: { frente: '#eab308', fondo: '#fde047' },
}

const W = 100
const H = 150
const RY = 11 // radio vertical de las elipses (tapas)
const TOP = RY + 2
const BOT = H - RY - 2
const ALTO = BOT - TOP

export default function FluidGauge({ porcentaje, tipo, size = 150 }: {
  porcentaje: number
  tipo: 'consumo' | 'reserva'
  size?: number
}) {
  const uid = useId().replace(/:/g, '')
  const c = COLORES[tipo]
  const pct = Math.max(0, Math.min(100, porcentaje))
  const nivel = BOT - (ALTO * pct) / 100 // y de la superficie
  const ancho = (size * W) / H

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={ancho} height={size} className="mx-auto block" role="img" aria-label={`${pct.toFixed(0)}%`}>
      <defs>
        <clipPath id={`cuerpo-${uid}`}>
          <path d={`M2 ${TOP} A48 ${RY} 0 0 1 98 ${TOP} V${BOT} A48 ${RY} 0 0 1 2 ${BOT} Z`} />
        </clipPath>
        <linearGradient id={`vidrio-${uid}`} x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.25" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="0.75" stopColor="#000" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.35" />
        </linearGradient>
        <style>{`
          @keyframes ola-a-${uid}{from{transform:translateX(0)}to{transform:translateX(-50px)}}
          @keyframes ola-b-${uid}{from{transform:translateX(-50px)}to{transform:translateX(0)}}
        `}</style>
      </defs>

      {/* interior vacío */}
      <path d={`M2 ${TOP} A48 ${RY} 0 0 1 98 ${TOP} V${BOT} A48 ${RY} 0 0 1 2 ${BOT} Z`} fill="#072e39" />

      {/* líquido */}
      <g clipPath={`url(#cuerpo-${uid})`}>
        <g style={{ transform: `translateY(${nivel}px)`, transition: 'transform 1s ease-out' }}>
          <g style={{ animation: `ola-b-${uid} 3.2s linear infinite` }}>
            <path d="M0 0 Q12.5 -5 25 0 T50 0 T75 0 T100 0 T125 0 T150 0 V170 H0 Z" fill={c.fondo} opacity="0.85" />
          </g>
          <g style={{ animation: `ola-a-${uid} 2.4s linear infinite` }}>
            <path d="M0 2 Q12.5 -3 25 2 T50 2 T75 2 T100 2 T125 2 T150 2 V170 H0 Z" fill={c.frente} />
          </g>
        </g>
      </g>

      {/* cristal, brillo y tapas */}
      <path d={`M2 ${TOP} A48 ${RY} 0 0 1 98 ${TOP} V${BOT} A48 ${RY} 0 0 1 2 ${BOT} Z`} fill={`url(#vidrio-${uid})`} />
      <ellipse cx="50" cy={TOP} rx="48" ry={RY} fill="#ffffff" fillOpacity="0.12" stroke="#cbd5e1" strokeWidth="2" />
      <path d={`M2 ${TOP} V${BOT} A48 ${RY} 0 0 0 98 ${BOT} V${TOP}`} fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="10" y={TOP + 10} width="5" height={ALTO - 14} rx="2.5" fill="#fff" fillOpacity="0.25" />
    </svg>
  )
}
