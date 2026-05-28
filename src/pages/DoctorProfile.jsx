import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredAuth, saveAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function DoctorProfile({ auth, onUpdate }) {
  const stored = getStoredAuth()
  const navigate = useNavigate()
  const [doctorData, setDoctorData] = useState({
    username: '',
    display_name: '',
    avatar_url: '',
    clinic: '',
    license_number: '',
    license_expiry: '',
    verified: 0,
    specialties: '',
    bio: '',
    phone: '',
    license_file_urls: [],
    department_id: null
  })
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [consultations, setConsultations] = useState([])
  const [loadingConsultations, setLoadingConsultations] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [notificationsRead, setNotificationsRead] = useState(false)
  const [departments, setDepartments] = useState([])

  // 加载通知
  useEffect(() => {
    async function loadNotifications() {
      try {
        const resp = await fetch(`${BASE}/notifications`)
        if (resp.ok) {
          setNotifications(await resp.json())
        }
      } catch (_) {}
    }
    loadNotifications()
  }, [])

  function handleOpenNotifications() {
    setShowNotifications(!showNotifications)
    setNotificationsRead(true)
  }

  useEffect(() => {
    loadDoctorProfile()
    loadConsultations()
    loadDepartments()
  }, [])

  async function loadConsultations() {
    const storedAuth = getStoredAuth()
    if (!storedAuth) return
    setLoadingConsultations(true)
    try {
      const q = await fetch(BASE + '/doctor-consultations', {
        headers: { 'Authorization': 'Bearer ' + storedAuth.token }
      })
      if (!q.ok) { setConsultations([]); return }
      const d = await q.json()
      setConsultations(d || [])
    } catch (e) {
      console.error('加载接诊列表失败', e)
      setConsultations([])
    } finally {
      setLoadingConsultations(false)
    }
  }

  async function loadDepartments() {
    try {
      const resp = await fetch(BASE + '/departments')
      if (resp.ok) {
        const data = await resp.json()
        setDepartments(data.departments || [])
      }
    } catch (e) {
      console.error('加载科室列表失败', e)
    }
  }

  async function acceptConsult(caseId) {
    const storedAuth = getStoredAuth()
    if (!storedAuth) return alert('请先登录')
    try {
      const r = await fetch(BASE + `/accept-consultation/${caseId}`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + storedAuth.token }
      })
      if (r.ok) {
        alert('接单成功')
        await loadConsultations()
        navigate(`/doctor-patient-chat/${caseId}`)
      } else {
        const data = await r.json().catch(()=>({}))
        alert(data.error || '接单失败')
      }
    } catch (e) {
      console.error('接单失败', e)
      alert('接单失败')
    }
  }

  async function loadDoctorProfile() {
    if (!stored) return
    try {
      const resp = await fetch(BASE + '/doctor-profile', {
        headers: { 'Authorization': 'Bearer ' + stored.token }
      })
      if (resp.ok) {
        const data = await resp.json()
        // normalize license urls (server returns license_file_urls array)
        const license_urls = data.license_file_urls || (data.license_file_url ? [data.license_file_url] : [])
        setDoctorData({ ...data, license_file_urls: license_urls })
      }
    } catch (error) {
      console.error('加载医生资料失败:', error)
    } finally {
      setLoading(false)
    }
  }

  async function uploadFile(file) {
    const fd = new FormData()
    fd.append('file', file)
    const resp = await fetch(BASE + '/upload-avatar', { method: 'POST', body: fd })
    const d = await resp.json()
    return d.url ? (d.url.startsWith('/') ? BASE + d.url : d.url) : null
  }

  async function uploadLicense(file) {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('username', stored.username)
    const resp = await fetch(BASE + '/upload-doctor-license', { method: 'POST', body: fd })
    const d = await resp.json()
    return d.file_url ? (d.file_url.startsWith('/') ? BASE + d.file_url : d.file_url) : null
  }

  async function handleAvatarChange(e) {
    const f = e.target.files[0]
    if (!f) return
    const url = await uploadFile(f)
    if (url) {
      setDoctorData(prev => ({ ...prev, avatar_url: url }))
      await handleSave({ ...doctorData, avatar_url: url })
    }
  }

  async function handleLicenseChange(e) {
    const f = e.target.files[0]
    if (!f) return
    const url = await uploadLicense(f)
    if (url) {
      // append to list locally; server already persisted
      setDoctorData(prev => ({ ...prev, license_file_urls: [...(prev.license_file_urls || []), url] }))
      // refresh from server to ensure DB consistency (optional)
      await loadDoctorProfile()
    }
  }

  async function handleSave(updatedData) {
    setMsg('')
    try {
      const token = stored.token
      const resp = await fetch(BASE + '/doctor-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(updatedData || doctorData)
      })
      if (!resp.ok) {
        setMsg('保存失败')
        return
      }
      setMsg('保存成功')
      saveAuth({
        token: stored.token,
        username: stored.username,
        avatar: updatedData?.avatar_url || doctorData.avatar_url,
        user_type: stored.user_type
      })
      onUpdate && onUpdate({ ...stored, avatar: updatedData?.avatar_url || doctorData.avatar_url })
    } catch (e) {
      setMsg('网络错误')
    }
  }

  if (loading) {
    return (
      <div className="auth-page auth-page--full">
        <div className="auth-card auth-card--large">
          <div style={{ textAlign: 'center', padding: '40px' }}>加载中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page auth-page--full">
      {/* 通知按钮 */}
      {notifications.length > 0 && (
        <button
          onClick={handleOpenNotifications}
          style={{ position: 'fixed', top: 20, left: 220, background: 'white', border: 'none', cursor: 'pointer', fontSize: 24, padding: 8, borderRadius: '50%', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', zIndex: 1000 }}
          title="查看通知"
        >
          🔔
          {!notificationsRead && notifications.filter(n => n.is_pinned).length > 0 && (
            <span style={{ position: 'absolute', top: 0, right: 0, background: '#ef4444', color: 'white', borderRadius: '50%', width: 18, height: 18, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {notifications.filter(n => n.is_pinned).length}
            </span>
          )}
        </button>
      )}

      {/* 通知面板 */}
      {showNotifications && (
        <div style={{ position: 'fixed', top: 70, left: 100, background: 'white', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', width: 360, maxHeight: 400, overflow: 'auto', zIndex: 1001, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <strong style={{ fontSize: 16 }}>通知公告</strong>
            <button onClick={() => setShowNotifications(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
          {notifications.map(n => (
            <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                {n.is_pinned ? <span style={{ color: '#f59e0b' }}>📌</span> : null}
                <strong style={{ fontSize: 14 }}>{n.title}</strong>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#6b7280', whiteSpace: 'pre-wrap' }}>{n.content}</p>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                {n.created_at ? new Date(n.created_at * 1000).toLocaleDateString('zh-CN') : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="auth-card auth-card--large">
        <div className="profile-card">
        <div className="profile-header">
          <h2>医生个人中心</h2>
        </div>

        <div className="profile-content">
          <div className="profile-left">
            <div className="avatar-wrap">
              <img className="avatar" src={doctorData.avatar_url || '/placeholder.png'} alt="avatar" />
              <label className="avatar-overlay" title="上传头像">
                <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </label>
              <div className="label-small">医生姓名</div>
              <input
                className="display-name"
                value={doctorData.display_name}
                onChange={e => setDoctorData(prev => ({ ...prev, display_name: e.target.value }))}
                placeholder="请输入医生姓名"
              />
            </div>

            <div className="verification-status">
              <div className={`status-badge ${doctorData.verified ? 'verified' : 'pending'}`}>
                {doctorData.verified ? '✓ 已认证' : '⏳ 待审核'}
              </div>
            </div>
          {/* 医生功能 */}
          <div className="doctor-functions-left" style={{ position: 'sticky', top: 20 }}>
            <h3 style={{marginTop:0, marginBottom:12}}>医生功能</h3>
            <div className="function-grid" style={{display:'grid', gap:12}}>
              <button className="function-btn" onClick={() => navigate('/doctor-calendar')}>📅 预约管理</button>
              <button className="function-btn" onClick={() => navigate('/doctor-consultations')}>📋 接诊管理</button>
              <button className="function-btn" onClick={() => navigate('/doctor-chat')}>🤖 AI智能问答</button>
              <button className="function-btn" onClick={() => navigate('/doctor-cases')}>📄 病例管理</button>
              <button className="function-btn" onClick={() => navigate('/doctor-stats')}>📊 数据统计</button>
              <button className="function-btn" onClick={() => navigate('/doctor-settings')}>⚙️ 系统设置</button>
            </div>
            </div>
          </div>

          <div className="profile-right">
            <div className="profile-section">
              <h3>基本信息</h3>
              <div className="field">
                <label>用户名</label>
                <input value={doctorData.username} disabled />
              </div>
              <div className="field">
                <label>工作机构</label>
                <input
                  value={doctorData.clinic}
                  onChange={e => setDoctorData(prev => ({ ...prev, clinic: e.target.value }))}
                  placeholder="请输入医院/诊所名称"
                />
              </div>
              <div className="field">
                <label>联系电话</label>
                <input
                  value={doctorData.phone}
                  onChange={e => setDoctorData(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="请输入联系电话"
                />
              </div>
            </div>

            <div className="profile-section">
              <h3>资质认证</h3>
              <div className="field">
                <label>执业证号</label>
                <input
                  value={doctorData.license_number}
                  onChange={e => setDoctorData(prev => ({ ...prev, license_number: e.target.value }))}
                  placeholder="请输入执业证号"
                />
              </div>
              <div className="field">
                <label>执业证到期日期</label>
                <input
                  type="date"
                  value={doctorData.license_expiry}
                  onChange={e => setDoctorData(prev => ({ ...prev, license_expiry: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>专业/科室</label>
                <select
                  value={doctorData.department_id || ''}
                  onChange={e => setDoctorData(prev => ({ ...prev, department_id: e.target.value ? parseInt(e.target.value) : null }))}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
                >
                  <option value="">选择科室</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.icon} {dept.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>专业方向</label>
                <input
                  value={doctorData.specialties}
                  onChange={e => setDoctorData(prev => ({ ...prev, specialties: e.target.value }))}
                  placeholder="请输入专业方向，用逗号分隔"
                />
              </div>
              <div className="field">
                <label>资质文件</label>
                <div className="license-upload">
                  {(doctorData.license_file_urls || []).length > 0 ? (
                    <div className="license-list">
                      {(doctorData.license_file_urls || []).map((u, idx) => (
                        <div key={idx} className="license-preview">
                          <a
                            href={u.startsWith('http') ? u : BASE + u}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            查看资质文件 {idx + 1}
                          </a>
                        </div>
                      ))}
                      <div style={{ marginTop: 8 }}>
                        <label className="license-reupload">
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.gif" onChange={handleLicenseChange} style={{ display: 'none' }} />
                          上传更多资质
                        </label>
                      </div>
                    </div>
                  ) : (
                    <label className="license-upload-btn">
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.gif" onChange={handleLicenseChange} style={{ display: 'none' }} />
                      上传执业证/资质
                    </label>
                  )}
                </div>
              </div>
            </div>

            <div className="profile-section">
              <h3>个人简介</h3>
              <div className="field">
                <textarea
                  value={doctorData.bio}
                  onChange={e => setDoctorData(prev => ({ ...prev, bio: e.target.value }))}
                  placeholder="请输入个人简介..."
                  rows={4}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="profile-actions">
          <button className="btn-primary" onClick={() => handleSave()}>保存资料</button>
          <span className="profile-msg">{msg}</span>
        </div>

      </div>
    </div>
  </div>
  )
}
