'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download, FileText, TrendingUp, Package, ArrowLeftRight, Users } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts'
import api from '../../services/api'
import { PageLoader } from '../../components/ui/Spinner'

const fmt = (n: number) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 0 }).format(n)
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899']
const MESES = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export default function ReportesPage() {
  const [activeReport, setActiveReport] = useState<string>('compras-mes')

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
  })
  const { data: inventario } = useQuery({
    queryKey: ['inventario-multi', ''],
    queryFn: () => api.get('/inventario', { params: { limit: 200 } }).then(r => r.data),
  })
  const { data: actividad } = useQuery({
    queryKey: ['actividad-usuarios'],
    queryFn: () => api.get('/reportes/actividad-usuarios').then(r => r.data),
    refetchInterval: 60000,
  })

  if (isLoading) return <PageLoader />

  const comprasChart = (dashboard?.compras_por_mes || []).map((m: any) => ({
    mes: MESES[m.mes],
    total: parseFloat(m.total),
    cantidad: m.cantidad,
  }))

  const ccChart = (dashboard?.consumo_por_cc || []).map((c: any) => ({
    name: c.centro_costo.length > 15 ? c.centro_costo.substring(0, 15) + '...' : c.centro_costo,
    ejecutado: parseFloat(c.ejecutado),
    presupuesto: parseFloat(c.presupuesto_anual),
  }))

  const topProductos = (inventario?.data || [])
    .sort((a: any, b: any) => parseFloat(b.valor_total) - parseFloat(a.valor_total))
    .slice(0, 10)
    .map((p: any) => ({ name: p.descripcion.substring(0, 20), valor: parseFloat(p.valor_total) }))

  const stockAlmacen = (dashboard?.stock_por_almacen || []).map((a: any) => ({
    name: a.nombre.split(' ').slice(0, 2).join(' '),
    valor: parseFloat(a.valor || 0),
    productos: parseInt(a.productos || 0),
  }))

  const reports = [
    { id: 'compras-mes', label: 'Compras por Mes', icon: <TrendingUp size={16} /> },
    { id: 'cc-presupuesto', label: 'Presupuesto por CC', icon: <BarChart3 size={16} /> },
    { id: 'inventario-valor', label: 'Inventario Valorizado', icon: <Package size={16} /> },
    { id: 'stock-almacen', label: 'Stock por Almacén', icon: <ArrowLeftRight size={16} /> },
    { id: 'actividad-usuarios', label: 'Actividad de Usuarios', icon: <Users size={16} /> },
  ]

  return (
    <div className="fade-in space-y-5">
      {/* Report selector */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={18} className="text-blue-500" />
          <h2 className="font-semibold text-slate-900">Centro de Reportes</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {reports.map(r => (
            <button key={r.id} onClick={() => setActiveReport(r.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeReport === r.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {r.icon} {r.label}
            </button>
          ))}
        </div>
      </div>

      {activeReport === 'compras-mes' && (
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-slate-900">Compras por Mes — {new Date().getFullYear()}</h3>
              <p className="text-xs text-slate-400 mt-0.5">Monto total de órdenes de compra por mes</p>
            </div>
            <button className="btn-secondary text-xs py-1.5"><Download size={14} /> Exportar</button>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={comprasChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `S/ ${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => [fmt(Number(v)), 'Total OC']} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
              <Bar dataKey="total" fill="#3b82f6" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <table className="w-full text-sm">
              <thead><tr><th className="text-left text-slate-500 font-medium py-1">Mes</th><th className="text-right text-slate-500 font-medium">Órdenes</th><th className="text-right text-slate-500 font-medium">Total</th></tr></thead>
              <tbody>
                {comprasChart.map((m: any, i: number) => (
                  <tr key={i} className="border-t border-slate-50">
                    <td className="py-1.5">{m.mes}</td>
                    <td className="text-right text-slate-500">{m.cantidad}</td>
                    <td className="text-right font-medium text-blue-600">{fmt(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeReport === 'cc-presupuesto' && (
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-slate-900">Ejecución Presupuestal por Centro de Costo</h3>
              <p className="text-xs text-slate-400 mt-0.5">Comparativo presupuesto vs ejecutado anual</p>
            </div>
            <button className="btn-secondary text-xs py-1.5"><Download size={14} /> Exportar</button>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={ccChart} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `S/ ${(v/1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
              <Legend />
              <Bar dataKey="presupuesto" name="Presupuesto" fill="#dbeafe" radius={[0,4,4,0]} />
              <Bar dataKey="ejecutado" name="Ejecutado" fill="#3b82f6" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {activeReport === 'inventario-valor' && (
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-slate-900">Top 10 Productos por Valor de Inventario</h3>
            <button className="btn-secondary text-xs py-1.5"><Download size={14} /> Exportar</button>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={topProductos} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `S/ ${(v/1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => [fmt(Number(v)), 'Valor']} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
              <Bar dataKey="valor" name="Valor Inventario" fill="#8b5cf6" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {activeReport === 'stock-almacen' && (
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-slate-900">Valor de Stock por Almacén</h3>
            <button className="btn-secondary text-xs py-1.5"><Download size={14} /> Exportar</button>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={stockAlmacen} cx="50%" cy="50%" outerRadius={100} dataKey="valor" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine>
                  {stockAlmacen.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-3">
              {stockAlmacen.map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <div>
                      <p className="font-medium text-sm text-slate-900">{a.name}</p>
                      <p className="text-xs text-slate-400">{a.productos} productos</p>
                    </div>
                  </div>
                  <span className="font-bold text-slate-900">{fmt(a.valor)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {activeReport === 'actividad-usuarios' && (
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-slate-900">Actividad de Usuarios — KardexERP</h3>
              <p className="text-xs text-slate-400 mt-0.5">Ingresos a la aplicación y horas de conexión por usuario</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-slate-500 font-medium py-1">Usuario</th>
                  <th className="text-center text-slate-500 font-medium">Estado</th>
                  <th className="text-right text-slate-500 font-medium">Ingresos</th>
                  <th className="text-right text-slate-500 font-medium">Horas conectado</th>
                  <th className="text-left text-slate-500 font-medium">Último ingreso</th>
                  <th className="text-left text-slate-500 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {(actividad?.data || []).map((u: any, i: number) => (
                  <tr key={i} className="border-t border-slate-50">
                    <td className="py-1.5 font-medium text-slate-800">{u.usuario_nombre}</td>
                    <td className="text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${u.en_linea ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.en_linea ? 'bg-green-500' : 'bg-slate-400'}`} />
                        {u.en_linea ? 'En línea' : 'Desconectado'}
                      </span>
                    </td>
                    <td className="text-right text-slate-600">{u.total_ingresos}</td>
                    <td className="text-right font-medium text-blue-600">{u.horas_conectado.toFixed(2)} h</td>
                    <td className="text-slate-500">{u.ultimo_login ? new Date(u.ultimo_login).toLocaleString('es-PE') : '-'}</td>
                    <td className="text-slate-400">{u.ultima_ip || '-'}</td>
                  </tr>
                ))}
                {!actividad?.data?.length && (
                  <tr><td colSpan={6} className="text-center text-slate-400 py-6">Sin registros de actividad todavía</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Una sesión sin cierre de sesión explícito se considera abierta hasta {actividad?.cap_horas_sesion ?? 8} horas (expiración del token).
          </p>
        </div>
      )}
    </div>
  )
}
