import React, { useEffect, useState } from 'react'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

// 格式化时间戳
function formatTs(ts) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleDateString('zh-CN')
}

export default function AdminStats() {
  const auth = getStoredAuth()
  const [stats, setStats] = useState({
    patients: 0,
    doctors: 0,
    verifiedDoctors: 0,
    appointments: 0,
    completedAppointments: 0,
    cases: 0,
    departments: 0
  })
  const [departmentStats, setDepartmentStats] = useState([])
  const [appointmentStatus, setAppointmentStatus] = useState([])
  const [recentAppointments, setRecentAppointments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    try {
      const authStored = getStoredAuth()
      const headers = { 'Authorization': 'Bearer ' + (authStored?.token || '') }

      // 获取统计数据
      const [statsRes, deptRes, apptRes] = await Promise.all([
        fetch(`${BASE}/admin/stats`, { headers }),
        fetch(`${BASE}/admin/department-stats`, { headers }),
        fetch(`${BASE}/admin/appointments`, { headers })
      ])

      if (statsRes.ok) {
        const data = await statsRes.json()
        setStats(data)
      }

      if (deptRes.ok) {
        const data = await deptRes.json()
        setDepartmentStats(data)
      }

      if (apptRes.ok) {
        const data = await apptRes.json()
        const appointments = data.appointments || []
        // 统计预约状态
        const statusCount = {}
        appointments.forEach(a => {
          statusCount[a.status] = (statusCount[a.status] || 0) + 1
        })
        setAppointmentStatus(Object.entries(statusCount).map(([status, count]) => ({ status, count })))
        // 获取最近预约
        setRecentAppointments(appointments.slice(0, 10))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // 获取状态颜色
  function getStatusColor(status) {
    const colors = {
      scheduled: '#f59e0b',
      confirmed: '#3b82f6',
      completed: '#10b981',
      cancelled: '#ef4444'
    }
    return colors[status] || '#6b7280'
  }

  // 获取状态名称
  function getStatusName(status) {
    const names = {
      scheduled: '待确认',
      confirmed: '已确认',
      completed: '已完成',
      cancelled: '已取消'
    }
    return names[status] || status
  }

  // 计算百分比
  function getPercentage(count, total) {
    if (total === 0) return 0
    return Math.round((count / total) * 100)
  }

  // 渲染饼图
  function renderPieChart() {
    const total = appointmentStatus.reduce((sum, item) => sum + item.count, 0)
    if (total === 0) {
      return <div style={{ color: '#9ca3af', textAlign: 'center', padding: '40px' }}>暂无数据</div>
    }

    let currentAngle = 0
    const slices = appointmentStatus.map((item, index) => {
      const percentage = getPercentage(item.count, total)
      const angle = (item.count / total) * 360
      const startAngle = currentAngle
      currentAngle += angle

      const radius = 80
      const centerX = 100
      const centerY = 100

      // 计算扇形路径
      const startRad = (startAngle - 90) * Math.PI / 180
      const endRad = (startAngle + angle - 90) * Math.PI / 180

      const x1 = centerX + radius * Math.cos(startRad)
      const y1 = centerY + radius * Math.sin(startRad)
      const x2 = centerX + radius * Math.cos(endRad)
      const y2 = centerY + radius * Math.sin(endRad)

      const largeArc = angle > 180 ? 1 : 0

      const path = angle === 360
        ? `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2 - 0.01} ${y2} Z`
        : `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`

      return (
        <path
          key={item.status}
          d={path}
          fill={getStatusColor(item.status)}
          style={{ transition: 'all 0.3s' }}
        />
      )
    })

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <svg width="200" height="200" viewBox="0 0 200 200">
          {slices}
          <circle cx="100" cy="100" r="40" fill="white" />
          <text x="100" y="105" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#374151">
            {total}
          </text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {appointmentStatus.map(item => (
            <div key={item.status} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '3px',
                backgroundColor: getStatusColor(item.status)
              }} />
              <span style={{ fontSize: '13px', color: '#374151' }}>{getStatusName(item.status)}</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>{item.count}</span>
              <span style={{ fontSize: '12px', color: '#9ca3af' }}>({getPercentage(item.count, total)}%)</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 渲染柱状图
  function renderBarChart() {
    if (!departmentStats || departmentStats.length === 0) {
      return <div style={{ color: '#9ca3af', textAlign: 'center', padding: '40px' }}>暂无数据</div>
    }

    const maxValue = Math.max(...departmentStats.map(d => d.doctor_count || 0), 1)
    const maxHeight = 150

    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: `${maxHeight + 40}px`, padding: '20px 0' }}>
        {departmentStats.map((dept, index) => {
          const height = ((dept.doctor_count || 0) / maxValue) * maxHeight
          return (
            <div key={index} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flex: 1,
              maxWidth: '60px'
            }}>
              <div style={{
                fontSize: '12px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '4px'
              }}>
                {dept.doctor_count || 0}
              </div>
              <div style={{
                width: '100%',
                height: `${Math.max(height, 4)}px`,
                backgroundColor: '#3b82f6',
                borderRadius: '4px 4px 0 0',
                transition: 'all 0.3s',
                minHeight: '4px'
              }} />
              <div style={{
                fontSize: '10px',
                color: '#6b7280',
                marginTop: '4px',
                textAlign: 'center',
                wordBreak: 'break-word'
              }}>
                {dept.name?.slice(0, 3)}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <div style={{ color: '#6b7280' }}>加载中...</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: '#111827' }}>数据统计</h2>
        <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: '14px' }}>平台整体数据概览</p>
      </div>

      {/* 统计卡片 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '16px',
        marginBottom: '24px'
      }}>
        <StatCard
          title="患者总数"
          value={stats.patients}
          icon="👥"
          color="#10b981"
          bgColor="#ecfdf5"
        />
        <StatCard
          title="医生总数"
          value={stats.doctors}
          icon="👨‍⚕️"
          color="#3b82f6"
          bgColor="#eff6ff"
        />
        <StatCard
          title="认证医生"
          value={stats.verifiedDoctors}
          icon="✅"
          color="#8b5cf6"
          bgColor="#f5f3ff"
        />
        <StatCard
          title="预约总数"
          value={stats.appointments}
          icon="📅"
          color="#f59e0b"
          bgColor="#fffbeb"
        />
        <StatCard
          title="已完成预约"
          value={stats.completedAppointments}
          icon="✓"
          color="#10b981"
          bgColor="#ecfdf5"
        />
        <StatCard
          title="咨询病例"
          value={stats.cases}
          icon="💬"
          color="#ec4899"
          bgColor="#fdf2f8"
        />
      </div>

      {/* 图表区域 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
        gap: '24px',
        marginBottom: '24px'
      }}>
        {/* 预约状态分布 */}
        <div style={{
          background: '#fff',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '600', color: '#111827' }}>
            预约状态分布
          </h3>
          {renderPieChart()}
        </div>

        {/* 各科室医生分布 */}
        <div style={{
          background: '#fff',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '600', color: '#111827' }}>
            各科室医生分布
          </h3>
          {renderBarChart()}
        </div>
      </div>

      {/* 近期预约列表 */}
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        padding: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '600', color: '#111827' }}>
          近期预约
        </h3>
        {recentAppointments.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '13px', color: '#6b7280', fontWeight: '600' }}>ID</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '13px', color: '#6b7280', fontWeight: '600' }}>患者</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '13px', color: '#6b7280', fontWeight: '600' }}>医生</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '13px', color: '#6b7280', fontWeight: '600' }}>日期</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '13px', color: '#6b7280', fontWeight: '600' }}>时间</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '13px', color: '#6b7280', fontWeight: '600' }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {recentAppointments.map(apt => (
                <tr key={apt.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '12px', fontSize: '13px' }}>{apt.id}</td>
                  <td style={{ padding: '12px', fontSize: '13px' }}>{apt.patient_name || apt.patient_username || '-'}</td>
                  <td style={{ padding: '12px', fontSize: '13px' }}>{apt.doctor_name || apt.doctor_username || '-'}</td>
                  <td style={{ padding: '12px', fontSize: '13px' }}>{apt.date || apt.start_date || '-'}</td>
                  <td style={{ padding: '12px', fontSize: '13px' }}>
                    {apt.start_time ? `${apt.start_time} - ${apt.end_time || ''}` : apt.start_hour || '-'}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '600',
                      backgroundColor: getStatusColor(apt.status) + '20',
                      color: getStatusColor(apt.status)
                    }}>
                      {getStatusName(apt.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ color: '#9ca3af', textAlign: 'center', padding: '40px' }}>暂无预约数据</div>
        )}
      </div>
    </div>
  )
}

// 统计卡片组件
function StatCard({ title, value, icon, color, bgColor }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      display: 'flex',
      alignItems: 'center',
      gap: '16px'
    }}>
      <div style={{
        width: '48px',
        height: '48px',
        borderRadius: '12px',
        backgroundColor: bgColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px'
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{title}</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: '#111827' }}>{value}</div>
      </div>
    </div>
  )
}
