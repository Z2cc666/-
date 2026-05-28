import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

const STATUS_CONFIG = {
  scheduled:  { label: '待确认',   color: '#f59e0b', bg: '#fffbeb' },
  confirmed:  { label: '已确认',   color: '#10b981', bg: '#ecfdf5' },
  completed:  { label: '已完成',   color: '#6b7280', bg: '#f3f4f6' },
  cancelled:  { label: '已取消',   color: '#ef4444', bg: '#fef2f2' },
}

export default function MyAppointments() {
  const auth = getStoredAuth()
  const navigate = useNavigate()
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [cancelLoading, setCancelLoading] = useState(null)

  useEffect(() => {
    loadAppointments()
  }, [])

  async function loadAppointments() {
    if (!auth?.token) return
    setLoading(true)
    try {
      const resp = await fetch(`${BASE}/patient/appointments`, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      })
      if (resp.ok) {
        const data = await resp.json()
        setAppointments(data.appointments || [])
      }
    } catch (e) {
      console.error('加载预约记录失败', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleCancel(aid) {
    if (!confirm('确定要取消该预约吗？')) return
    setCancelLoading(aid)
    try {
      const resp = await fetch(`${BASE}/appointments/${aid}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + auth.token }
      })
      const data = await resp.json()
      if (resp.ok) {
        setAppointments(prev => prev.map(a => a.id === aid ? { ...a, status: 'cancelled' } : a))
      } else {
        alert(data.error || '取消失败')
      }
    } catch (e) {
      alert('网络错误')
    } finally {
      setCancelLoading(null)
    }
  }

  const filtered = appointments.filter(a => {
    if (filter === 'all') return true
    return a.status === filter
  })

  const tabs = [
    { key: 'all',       label: '全部' },
    { key: 'scheduled', label: '待确认' },
    { key: 'confirmed', label: '已确认' },
    { key: 'completed', label: '已完成' },
    { key: 'cancelled', label: '已取消' },
  ]

  function formatDate(ts) {
    if (!ts) return '—'
    return new Date(ts * 1000).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="my-appointments-page">
      <div className="page-inner">
        {/* Header */}
        <div className="page-header">
          <div className="page-header-left">
            <button className="back-btn" onClick={() => navigate(-1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              返回
            </button>
            <h1 className="page-title">我的预约</h1>
          </div>
          <Link to="/quick-register" className="btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            新建预约
          </Link>
        </div>

        {/* Tabs */}
        <div className="filter-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`filter-tab ${filter === t.key ? 'active' : ''}`}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
              {t.key !== 'all' && (
                <span className="tab-count">
                  {appointments.filter(a => t.key === 'all' || a.status === t.key).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner"/>
            <p>加载中...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <h3>暂无预约记录</h3>
            <p>您还没有预约任何医生</p>
            <Link to="/quick-register" className="btn-primary" style={{ marginTop: 16 }}>立即预约</Link>
          </div>
        ) : (
          <div className="appointment-list">
            {filtered.map(appt => {
              const cfg = STATUS_CONFIG[appt.status] || STATUS_CONFIG.scheduled
              const canCancel = appt.status === 'scheduled' || appt.status === 'confirmed'
              return (
                <div key={appt.id} className="appointment-card">
                  <div className="appt-status-bar" style={{ background: cfg.color }}/>
                  <div className="appt-body">
                    <div className="appt-main">
                      <div className="appt-doctor-row">
                        <div className="doctor-avatar-sm">
                          <img src={appt.doctor_avatar || '/placeholder.png'} alt="" />
                        </div>
                        <div>
                          <div className="appt-doctor-name">{appt.doctor_name || appt.doctor_username}</div>
                          <div className="appt-dept">{appt.department_name || '未知科室'}</div>
                        </div>
                      </div>

                      <div className="appt-info-grid">
                        <div className="appt-info-item">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                          </svg>
                          <span>{formatDate(appt.start_ts)}</span>
                        </div>
                        {appt.notes && (
                          <div className="appt-info-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            <span>{appt.notes}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="appt-right">
                      <span className="appt-status-tag" style={{ color: cfg.color, background: cfg.bg }}>
                        {cfg.label}
                      </span>
                      <div className="appt-actions">
                        {appt.status === 'confirmed' && (
                          <button
                            className="btn-primary btn-sm"
                            onClick={() => {
                              if (appt.case_id) {
                                navigate(`/case-detail/${appt.case_id}`)
                              } else {
                                // 如果没有case_id，显示提示
                                alert('该预约尚未生成问诊记录，请等待医生确认后重试')
                              }
                            }}
                          >
                            进入对话
                          </button>
                        )}
                        {canCancel && (
                          <button
                            className="btn-cancel"
                            onClick={() => handleCancel(appt.id)}
                            disabled={cancelLoading === appt.id}
                          >
                            {cancelLoading === appt.id ? '取消中...' : '取消预约'}
                          </button>
                        )}
                        {appt.doctor_username && (
                          <Link
                            to={`/doctor-detail/${appt.doctor_username}`}
                            className="btn-ghost btn-sm"
                          >
                            查看医生
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
