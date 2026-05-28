import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function DoctorConsultations() {
  const stored = getStoredAuth()
  const navigate = useNavigate()
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all, pending, active, completed

  useEffect(() => {
    if (!stored || stored.user_type !== 'doctor') {
      navigate('/auth')
      return
    }
    loadConsultations()
  }, [filter])

  async function loadConsultations() {
    try {
      const url = filter === 'all'
        ? `${BASE}/doctor-consultations`
        : `${BASE}/doctor-consultations?status=${filter}`

      const resp = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + stored.token }
      })

      if (resp.ok) {
        const data = await resp.json()
        setConsultations(data)
      }
    } catch (error) {
      console.error('加载接诊列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  async function acceptConsultation(caseId) {
    try {
      const resp = await fetch(`${BASE}/accept-consultation/${caseId}`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + stored.token }
      })
      const body = await resp.json().catch(()=>({}))
      if (resp.ok) {
        // server may return new_case_id for doctor-patient chat
        if (body.new_case_id) {
          // navigate to the new doctor-patient chat
          navigate(`/doctor-patient-chat/${body.new_case_id}`)
          return
        }
        loadConsultations() // 重新加载列表
        alert('已成功接诊该病例')
      } else {
        console.error('accept failed', resp.status, body)
        alert(body.error || '接诊失败，请重试')
      }
    } catch (error) {
      console.error('接诊失败:', error)
      alert('网络错误，请重试')
    }
  }

  async function completeConsultation(caseId) {
    try {
      const diagnosis = prompt('请输入诊断结果：')
      if (!diagnosis) return

      const resp = await fetch(`${BASE}/complete-consultation/${caseId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + stored.token
        },
        body: JSON.stringify({ diagnosis })
      })

      if (resp.ok) {
        loadConsultations() // 重新加载列表
        alert('病例已完成')
      } else {
        alert('完成失败，请重试')
      }
    } catch (error) {
      console.error('完成病例失败:', error)
      alert('网络错误，请重试')
    }
  }

  function getStatusText(status) {
    switch (status) {
      case 'pending': return '待接诊'
      case 'active': return '进行中'
      case 'completed': return '已完成'
      default: return '未知'
    }
  }

  function getStatusColor(status) {
    switch (status) {
      case 'pending': return '#f59e0b'
      case 'active': return '#10b981'
      case 'completed': return '#6b7280'
      default: return '#6b7280'
    }
  }

  if (loading) {
    return (
      <div className="consultations-page">
        <div className="page-header">
          <h1>接诊管理</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px' }}>加载中...</div>
      </div>
    )
  }

  return (
    <div className="consultations-page">
      <div className="page-header">
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button className="btn-ghost" onClick={() => navigate('/doctor/profile')}>
            ← 返回
          </button>
          <h1>接诊管理</h1>
        </div>
      </div>

      <div className="filters">
        <button
          className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          全部 ({consultations.length})
        </button>
        <button
          className={`filter-btn ${filter === 'pending' ? 'active' : ''}`}
          onClick={() => setFilter('pending')}
        >
          待接诊 ({consultations.filter(c => c.status === 'pending').length})
        </button>
        <button
          className={`filter-btn ${filter === 'active' ? 'active' : ''}`}
          onClick={() => setFilter('active')}
        >
          进行中 ({consultations.filter(c => c.status === 'active').length})
        </button>
        <button
          className={`filter-btn ${filter === 'completed' ? 'active' : ''}`}
          onClick={() => setFilter('completed')}
        >
          已完成 ({consultations.filter(c => c.status === 'completed').length})
        </button>
      </div>

      <div className="consultations-list">
        {consultations.length === 0 ? (
          <div className="empty-state">
            <h3>暂无接诊病例</h3>
            <p>当前没有需要处理的病例</p>
          </div>
        ) : (
          consultations.map(consultation => (
            <div key={consultation.id} className="consultation-card">
              <div className="consultation-header">
                <div className="consultation-title">
                  <h3>{consultation.title || '病例咨询'}</h3>
                  <span
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(consultation.status) }}
                  >
                    {getStatusText(consultation.status)}
                  </span>
                </div>
                <div className="consultation-time">
                  {new Date(consultation.created_at * 1000).toLocaleString()}
                </div>
              </div>

              <div className="consultation-info">
                <div className="info-item">
                  <span className="label">患者：</span>
                  <span>{consultation.patient_name || '匿名患者'}</span>
                </div>
                <div className="info-item">
                  <span className="label">症状描述：</span>
                  <span>{consultation.symptoms || '无'}</span>
                </div>
                {consultation.diagnosis && (
                  <div className="info-item">
                    <span className="label">诊断结果：</span>
                    <span>{consultation.diagnosis}</span>
                  </div>
                )}
              </div>

              <div className="consultation-actions">
                {consultation.status === 'pending' && (
                  <button
                    className="btn-primary"
                    onClick={() => acceptConsultation(consultation.id)}
                  >
                    接诊
                  </button>
                )}

                {consultation.status === 'active' && (
                  <>
                    <button
                      className="btn-primary"
                      onClick={() => navigate(`/doctor-patient-chat/${consultation.id}`)}
                    >
                      与患者沟通
                    </button>
                    <button
                      className="btn-success"
                      onClick={() => completeConsultation(consultation.id)}
                    >
                      完成病例
                    </button>
                  </>
                )}

                {consultation.status === 'completed' && (
                  <button
                    className="btn-secondary"
                    onClick={() => navigate(`/doctor-case-view/${consultation.id}`)}
                  >
                    查看详情
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
