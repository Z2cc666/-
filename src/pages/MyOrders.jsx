import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function MyOrders() {
  const auth = getStoredAuth()
  const navigate = useNavigate()
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    if (!auth) {
      navigate('/auth')
      return
    }
    loadCases()
  }, [])

  async function loadCases() {
    try {
      const resp = await fetch(`${BASE}/users/${auth.username}/cases`, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      })
      if (!resp.ok) return
      const data = await resp.json()
      setCases(data.cases || [])
    } catch (e) {
      console.error('加载问诊记录失败', e)
    } finally {
      setLoading(false)
    }
  }

  const getStatusText = (status) => {
    switch (status) {
      case 'pending': return '待接诊'
      case 'active': return '进行中'
      case 'completed': return '已完成'
      case 'assigned': return '已分配'
      case 'in_progress': return '进行中'
      default: return '未知'
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return '#f59e0b'
      case 'active': return '#10b981'
      case 'completed': return '#6b7280'
      case 'assigned': return '#3b82f6'
      case 'in_progress': return '#10b981'
      default: return '#6b7280'
    }
  }

  if (loading) {
    return (
      <div style={{padding: 40, textAlign: 'center'}}>
        加载中...
      </div>
    )
  }

  // 只显示有医生分配的记录（预约问诊 + 求助医生）
  const filteredCases = cases.filter(c => c.assigned_doctor)

  return (
    <div style={{padding: 24}}>
      <div style={{display: 'flex', alignItems: 'center', marginBottom: 16}}>
        <button onClick={() => navigate('/profile')} style={{background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 14}}>
          ← 返回
        </button>
      </div>
      <h2>我的订单</h2>
      <p style={{color: '#6b7280', marginBottom: 24}}>显示预约问诊和求助医生的订单</p>

      {filteredCases.length === 0 ? (
        <div style={{textAlign: 'center', padding: 40, color: '#6b7280'}}>
          <h3>暂无订单记录</h3>
          <p>您还没有预约或求助医生的记录</p>
        </div>
      ) : (
        <div style={{display: 'grid', gap: 16}}>
          {filteredCases.map(caseItem => (
            <div key={caseItem.id} style={{
              background: '#fff',
              borderRadius: 12,
              padding: 20,
              border: '1px solid #e5e7eb',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12}}>
                <div>
                  <h3 style={{margin: 0, marginBottom: 4}}>{caseItem.title}</h3>
                  <p style={{margin: 0, color: '#6b7280', fontSize: 14}}>
                    创建时间: {new Date(caseItem.created_at * 1000).toLocaleString()}
                  </p>
                </div>
                <span style={{
                  backgroundColor: getStatusColor(caseItem.status),
                  color: '#fff',
                  padding: '4px 12px',
                  borderRadius: 16,
                  fontSize: 12,
                  fontWeight: 500
                }}>
                  {getStatusText(caseItem.status)}
                </span>
              </div>

              <div style={{marginBottom: 16}}>
                <p style={{margin: 0, color: '#374151'}}>
                  <strong>症状描述:</strong> {caseItem.symptoms || '暂无'}
                </p>
                {caseItem.diagnosis && (
                  <p style={{margin: '8px 0 0 0', color: '#059669'}}>
                    <strong>诊断结果:</strong> {caseItem.diagnosis}
                  </p>
                )}
              </div>

              <div style={{display: 'flex', gap: 12, alignItems: 'center'}}>
                {caseItem.status === 'active' && caseItem.assigned_doctor && (
                  <button
                    className="btn-primary"
                    onClick={() => navigate(`/patient-doctor-chat/${caseItem.id}`)}
                  >
                    与医生对话
                  </button>
                )}
                {caseItem.status === 'pending' && (
                  <span style={{color: '#f59e0b', fontSize: 14}}>
                    等待医生接诊...
                  </span>
                )}
                {caseItem.status === 'completed' && (
                  <span style={{color: '#6b7280', fontSize: 14}}>
                    问诊已完成
                  </span>
                )}
                <button
                  className="btn-secondary"
                  onClick={() => navigate(`/case-detail/${caseItem.id}`)}
                  style={{marginLeft: 'auto'}}
                >
                  查看详情
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
