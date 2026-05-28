import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getStoredAuth, saveAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

const QUICK_LINKS = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
    label: '快速挂号',
    desc: '预约医生门诊',
    to: '/quick-register',
    color: '#10b981',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
    label: '预约管理',
    desc: '查看预约时间',
    to: '/my-appointments',
    color: '#0ea5e9',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
    label: 'AI智能问诊',
    desc: '医学知识问答',
    to: '/',
    color: '#f97316',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
    label: '问诊广场',
    desc: '浏览医生列表',
    to: '/consultation-square',
    color: '#8b5cf6',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <line x1="10" y1="9" x2="8" y2="9"/>
      </svg>
    ),
    label: '我的订单',
    desc: '问诊历史记录',
    to: '/my-orders',
    color: '#6b7280',
  },
]

export default function Profile({ auth, onUpdate }) {
  const stored = getStoredAuth()
  const [displayName, setDisplayName] = useState(stored?.username || '')
  const [avatar, setAvatar] = useState(stored?.avatar || '')
  const [healthInfo, setHealthInfo] = useState('')
  const [allergies, setAllergies] = useState('')
  const [gender, setGender] = useState('')
  const [birthday, setBirthday] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [bloodType, setBloodType] = useState('')
  const [chronic, setChronic] = useState('')
  const [medications, setMedications] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [insurance, setInsurance] = useState('')
  const [medicalHistory, setMedicalHistory] = useState('')
  const [cases, setCases] = useState([])
  const [msg, setMsg] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [notificationsRead, setNotificationsRead] = useState(false)

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

  useEffect(() => { load() }, [])
  useEffect(() => { loadCases() }, [])

  async function load() {
    if (!stored) return
    const resp = await fetch(BASE + '/profile', { headers: { 'Authorization': 'Bearer ' + stored.token } })
    if (!resp.ok) return
    const data = await resp.json()
    setDisplayName(data.display_name || '')
    setAvatar(data.avatar_url ? (data.avatar_url.startsWith('/') ? BASE + data.avatar_url : data.avatar_url) : '')
    setHealthInfo(data.health_info || '')
    setAllergies(data.allergies || '')
    setMedicalHistory(data.medical_history || '')
    setGender(data.gender || '')
    setBirthday(data.birthday || '')
    setHeight(data.height || '')
    setWeight(data.weight || '')
    setBloodType(data.blood_type || '')
    setChronic(data.chronic || '')
    setMedications(data.medications || '')
    setEmergencyName(data.emergency_name || '')
    setEmergencyPhone(data.emergency_phone || '')
    setInsurance(data.insurance || '')
  }

  async function uploadFile(file) {
    const fd = new FormData()
    fd.append('file', file)
    const resp = await fetch(BASE + '/upload-avatar', { method: 'POST', body: fd })
    const d = await resp.json()
    return d.url ? (d.url.startsWith('/') ? BASE + d.url : d.url) : null
  }

  async function loadCases() {
    if (!stored) return
    try {
      const resp = await fetch(`${BASE}/users/${stored.username}/cases`, { headers: { 'Authorization': 'Bearer ' + stored.token } })
      if (!resp.ok) return
      const data = await resp.json()
      const list = data.cases || data
      setCases(list || [])
    } catch (e) {
      console.error('加载病例/订单失败', e)
    }
  }

  async function handleSave() {
    setMsg('')
    try {
      const token = stored.token
      const payload = {
        display_name: displayName,
        avatar_url: avatar,
        health_info: healthInfo,
        allergies,
        medical_history: medicalHistory,
        gender, birthday, height, weight, blood_type: bloodType,
        chronic, medications, emergency_name: emergencyName, emergency_phone: emergencyPhone,
        insurance
      }
      const resp = await fetch(BASE + '/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload)
      })
      if (!resp.ok) { setMsg('保存失败'); return }
      setMsg('保存成功')
      saveAuth({ token, username: stored.username, avatar })
      onUpdate && onUpdate({ token, username: stored.username, avatar })
    } catch (e) {
      setMsg('网络错误')
    }
  }

  async function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    const url = await uploadFile(f)
    if (url) {
      setAvatar(url)
      const currentAuth = getStoredAuth()
      if (currentAuth) {
        const newAuth = { token: currentAuth.token, username: currentAuth.username, avatar: url, user_type: currentAuth.user_type }
        saveAuth(newAuth)
        onUpdate && onUpdate(newAuth)
      }
    }
  }

  // 首页视图
  if (!showSettings) {
    return (
      <div className="profile-page">
        <div className="profile-inner">
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

          {/* 用户信息卡片 */}
          <div className="profile-header-card">
            <div className="profile-avatar-wrap">
              <img className="profile-avatar" src={avatar || '/placeholder.png'} alt="avatar" />
              <label className="avatar-upload-btn" title="更换头像">
                <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </label>
            </div>
            <div className="profile-user-info">
              <h2 className="profile-username">{displayName || stored?.username}</h2>
              <p className="profile-usertype">患者</p>
              {bloodType && <span className="profile-badge">血型 {bloodType}</span>}
            </div>
            <button className="profile-edit-btn" onClick={() => setShowSettings(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              编辑资料
            </button>
          </div>

          {/* 健康摘要 */}
          {(healthInfo || allergies || chronic || medicalHistory) && (
            <div className="health-summary-card">
              <h3 className="section-title">健康档案摘要</h3>
              <div className="health-chips">
                {healthInfo && <span className="health-chip chip-green">健康状况: {healthInfo}</span>}
                {allergies && <span className="health-chip chip-red">过敏史: {allergies}</span>}
                {chronic && <span className="health-chip chip-orange">慢病: {chronic}</span>}
                {medicalHistory && <span className="health-chip chip-blue">就医史: {medicalHistory}</span>}
              </div>
            </div>
          )}

          {/* 快速入口 */}
          <div className="quick-links-grid">
            {QUICK_LINKS.map(link => (
              link.action === 'settings' ? (
                <button key={link.label} className="quick-link-card" onClick={() => setShowSettings(true)}>
                  <div className="quick-link-icon" style={{ color: link.color, background: link.color + '18' }}>
                    {link.icon}
                  </div>
                  <div className="quick-link-text">
                    <div className="quick-link-label">{link.label}</div>
                    <div className="quick-link-desc">{link.desc}</div>
                  </div>
                </button>
              ) : (
                <Link key={link.label} to={link.to} className="quick-link-card">
                  <div className="quick-link-icon" style={{ color: link.color, background: link.color + '18' }}>
                    {link.icon}
                  </div>
                  <div className="quick-link-text">
                    <div className="quick-link-label">{link.label}</div>
                    <div className="quick-link-desc">{link.desc}</div>
                  </div>
                </Link>
              )
            ))}
          </div>

          {/* 历史问诊记录 */}
          <div className="profile-history-box">
            <h3 className="section-title">最近问诊记录</h3>
            {cases.length === 0 ? (
              <div className="empty-tip">暂无历史问诊记录</div>
            ) : (
              <div className="cases-list">
                {cases.slice(0, 5).map(c => {
                  let msgs = []
                  try {
                    msgs = Array.isArray(c.messages) ? c.messages : (c.messages ? JSON.parse(c.messages) : [])
                  } catch (e) { msgs = [] }
                  const snippet = msgs.length ? (msgs[msgs.length - 1].text || '') : ''
                  return (
                    <Link key={c.id} to={`/case-detail/${c.id}`} className="case-item">
                      <div className="case-item-left">
                        <div className="case-item-title">{c.title || '问诊记录'}</div>
                        <div className="case-item-snippet">{snippet}</div>
                        <div className="case-item-time">
                          {new Date((c.updated_at || c.created_at || 0) * 1000).toLocaleString()}
                        </div>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#9ca3af', flexShrink: 0 }}>
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </Link>
                  )
                })}
              </div>
            )}
            {cases.length > 5 && (
              <Link to="/my-orders" className="view-more-link">查看全部 {cases.length} 条记录 →</Link>
            )}
          </div>
        </div>
      </div>
    )
  }

  // 设置/编辑资料视图
  return (
    <div className="profile-page">
      <div className="profile-inner">
        <div className="settings-header">
          <button className="back-btn" onClick={() => setShowSettings(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            返回
          </button>
          <h2 className="settings-title">个人资料设置</h2>
        </div>

        <div className="profile-card">
          <div className="profile-left">
            <div className="avatar-wrap">
              <img className="avatar" src={avatar || '/placeholder.png'} alt="avatar" />
              <label className="avatar-overlay" title="上传头像">
                <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </label>
              <div className="label-small">昵称</div>
              <input className="display-name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </div>
          </div>
          <div className="profile-right">
            <div className="field" style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label>性别</label>
                <select value={gender} onChange={e => setGender(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8 }}>
                  <option value="">请选择</option>
                  <option value="male">男</option>
                  <option value="female">女</option>
                  <option value="other">其他</option>
                </select>
              </div>
              <div style={{ width: 180 }}>
                <label>出生日期</label>
                <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8 }} />
              </div>
            </div>

            <div className="field" style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label>身高 (cm)</label>
                <input value={height} onChange={e => setHeight(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8 }} />
              </div>
              <div style={{ width: 140 }}>
                <label>体重 (kg)</label>
                <input value={weight} onChange={e => setWeight(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8 }} />
              </div>
              <div style={{ width: 140 }}>
                <label>血型</label>
                <input value={bloodType} onChange={e => setBloodType(e.target.value)} placeholder="A/B/O/AB" style={{ width: '100%', padding: 8, borderRadius: 8 }} />
              </div>
            </div>

            <div className="field"><label>健康状况</label><textarea value={healthInfo} onChange={e => setHealthInfo(e.target.value)} /></div>
            <div className="field"><label>过敏史</label><textarea value={allergies} onChange={e => setAllergies(e.target.value)} /></div>
            <div className="field"><label>慢性疾病 / 用药</label><textarea value={chronic} onChange={e => setChronic(e.target.value)} placeholder="如：高血压；长期服用药物..." /></div>
            <div className="field"><label>正在服用的药物</label><textarea value={medications} onChange={e => setMedications(e.target.value)} placeholder="每行一个药物" /></div>
            <div className="field"><label>就医史</label><textarea value={medicalHistory} onChange={e => setMedicalHistory(e.target.value)} /></div>

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label>紧急联系人</label>
                <input value={emergencyName} onChange={e => setEmergencyName(e.target.value)} placeholder="姓名" style={{ width: '100%', padding: 8, borderRadius: 8 }} />
              </div>
              <div style={{ width: 220 }}>
                <label>紧急联系电话</label>
                <input value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} placeholder="手机号" style={{ width: '100%', padding: 8, borderRadius: 8 }} />
              </div>
            </div>
            <div className="field"><label>医保 / 保险信息</label><input value={insurance} onChange={e => setInsurance(e.target.value)} placeholder="保险公司 + 卡号" /></div>

            <div className="actions">
              <button className="btn-primary" onClick={handleSave}>保存资料</button>
              <span className="profile-msg" style={{ marginLeft: 12 }}>{msg}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
