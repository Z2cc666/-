import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { saveAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState('login') // login | register
  const [method, setMethod] = useState('email') // email | phone
  const [contact, setContact] = useState('')
  const [pw, setPw] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function handlePasswordAuth(e) {
    e.preventDefault()
    setError('')
    try {
      const url = mode === 'login' ? `${BASE}/login` : `${BASE}/register`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: contact, password: pw })
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || '失败')
        return
      }
      // mark as patient user_type explicitly to avoid leftover doctor/admin state
      saveAuth({ token: data.token, username: data.username, avatar: data.avatar_url, user_type: 'patient' })
      onAuth && onAuth({ token: data.token, username: data.username, avatar: data.avatar_url, user_type: 'patient' })
      navigate('/profile')
    } catch (err) {
      setError('网络错误')
    }
  }

  async function handleSendCode() {
    if (!contact.trim()) {
      setError('请输入邮箱或手机号')
      return
    }
    setError('')
    setSending(true)
    try {
      const resp = await fetch(`${BASE}/send_code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact, method: method === 'email' ? 'email' : 'sms' })
      })
      const data = await resp.json()
      setSending(false)
      if (!resp.ok) {
        setError(data.error || '发送失败')
        return
      }
      // In dev the API returns dev_code; show mild hint
      alert('验证码已发送（开发环境会在响应中返回，可检查 Network）')
    } catch (e) {
      setSending(false)
      setError('网络错误')
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault()
    setError('')
    if (!code.trim() || !contact.trim()) {
      setError('请输入 contact 与 code')
      return
    }
    try {
      const resp = await fetch(`${BASE}/verify_code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact, method: method === 'email' ? 'email' : 'sms', code })
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || '校验失败')
        return
      }
      // mark as patient user_type explicitly to avoid leftover doctor/admin state
      saveAuth({ token: data.token, username: data.username, user_type: 'patient' })
      onAuth && onAuth({ token: data.token, username: data.username, user_type: 'patient' })
      navigate('/profile')
    } catch (e) {
      setError('网络错误')
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card auth-card--large">
        <div className="auth-side">
          <h1>医疗智能问诊</h1>
          <p className="lead">快速、安全、可信的智能问诊助手。支持邮箱/手机号登录，或使用验证码一键登录。</p>
          <div className="oauth-buttons">
            <button className="btn-ghost">微信一键登录（占位）</button>
            <button className="btn-ghost">Apple/Google（占位）</button>
          </div>
          <div style={{marginTop:12, display:'flex', gap:8}}>
            <Link to="/clinician-auth" className="btn-ghost">医生 / 临床专家入口</Link>
            <Link to="/admin-auth" className="btn-ghost">系统管理员入口</Link>
          </div>
        </div>
        <div className="auth-form">
          <div className="tabs">
            <button className={`tab ${method==='email'?'active':''}`} onClick={()=>setMethod('email')}>邮箱</button>
            <button className={`tab ${method==='phone'?'active':''}`} onClick={()=>setMethod('phone')}>手机号</button>
            <div className="mode-switch">
              <button className={`tab ${mode==='login'?'active':''}`} onClick={()=>setMode('login')}>登录</button>
              <button className={`tab ${mode==='register'?'active':''}`} onClick={()=>setMode('register')}>注册</button>
            </div>
          </div>

          {mode === 'register' && (
            <div className="field">
              <label>姓名（显示名）</label>
              <input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="真实姓名或昵称，可选" />
            </div>
          )}

          <form onSubmit={pw ? handlePasswordAuth : (e=>e.preventDefault())}>
            <div className="field">
              <label>{method==='email'?'邮箱':'手机号'}</label>
              <input value={contact} onChange={e=>setContact(e.target.value)} placeholder={method==='email'?'you@example.com':'13800138000'} />
            </div>

            <div className="field row">
              <div style={{flex:1}}>
                <label>密码（可选）</label>
                <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="使用密码登录或注册" />
              </div>
              <div style={{width:140,marginLeft:12}}>
                <label>验证码</label>
                <div style={{display:'flex',gap:8}}>
                  <input value={code} onChange={e=>setCode(e.target.value)} placeholder="6位验证码" />
                  <button type="button" className="btn-ghost" onClick={handleSendCode} disabled={sending}>{sending?'发送中':'发送'}</button>
                </div>
              </div>
            </div>

            <div className="auth-actions" style={{marginTop:18}}>
              {pw && <button className="btn-primary ripple" onClick={handlePasswordAuth}>{mode==='login'?'密码登录':'注册并登录'}</button>}
              <button className="btn-primary ripple" onClick={handleVerifyCode} style={{marginLeft:8}}>验证码登录/注册</button>
              <button type="button" className="btn-ghost" onClick={()=>{ setMode(mode==='login'?'register':'login') }}>{mode==='login'?'去注册':'去登录'}</button>
            </div>

            {error && <div className="auth-error" style={{marginTop:10}}>{error}</div>}
          </form>
        </div>
      </div>
    </div>
  )
}



