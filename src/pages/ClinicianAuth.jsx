import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { saveAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function ClinicianAuth({ onAuth }) {
  const [mode, setMode] = useState('login') // login | register
  const [contact, setContact] = useState('')
  const [pw, setPw] = useState('')
  const [license, setLicense] = useState('')
  const [hospital, setHospital] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [uploadingLicense, setUploadingLicense] = useState(false)
  const [licenseUploaded, setLicenseUploaded] = useState(false)
  const navigate = useNavigate()

  async function handlePasswordAuth(e) {
    e.preventDefault()
    setError('')
    try {
      const url = mode === 'login' ? `${BASE}/doctor-login` : `${BASE}/doctor-register`
      const body = mode === 'login'
        ? { username: contact, password: pw }
        : { username: contact, password: pw, license_number: license, clinic: hospital }

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || '失败')
        return
      }
      saveAuth({ token: data.token, username: data.username, user_type: data.user_type })
      onAuth && onAuth({ token: data.token, username: data.username, user_type: data.user_type })
      // 跳转到医生专属个人中心
      navigate('/doctor/profile')
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
        body: JSON.stringify({ contact, method: contact.includes('@') ? 'email' : 'sms' })
      })
      const data = await resp.json()
      setSending(false)
      if (!resp.ok) {
        setError(data.error || '发送失败')
        return
      }
      alert('验证码已发送（开发环境返回 dev_code，可查看 Network）')
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
        body: JSON.stringify({ contact, method: contact.includes('@') ? 'email' : 'sms', code })
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || '校验失败')
        return
      }
      saveAuth({ token: data.token, username: data.username, user_type: 'doctor' })
      onAuth && onAuth({ token: data.token, username: data.username, user_type: 'doctor' })
      // 跳转到医生专属个人中心
      navigate('/doctor/profile')
    } catch (e) {
      setError('网络错误')
    }
  }

  async function handleLicenseUpload(file) {
    if (!file) return

    setUploadingLicense(true)
    setError('')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('username', contact || 'temp_user')

    try {
      const resp = await fetch(`${BASE}/upload-doctor-license`, {
        method: 'POST',
        body: formData
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || '上传失败')
        return
      }
      setLicenseUploaded(true)
      alert('资质文件上传成功！')
    } catch (e) {
      setError('上传失败，请重试')
    } finally {
      setUploadingLicense(false)
    }
  }

  function triggerFileSelect() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.jpg,.jpeg,.png,.gif'
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (file) {
        handleLicenseUpload(file)
      }
    }
    input.click()
  }

  return (
    <div className="auth-page">
      <div className="auth-card auth-card--large">
        <div className="auth-side">
          <h1>医生 / 临床专家登录</h1>
          <p className="lead">为医生与临床专家提供专属入口，需填写执业证号与工作机构以供认证。注册后后台可触发资质审核流程。</p>
          <div style={{marginTop:12}}>
            <Link to="/auth" className="btn-ghost">返回患者入口</Link>
          </div>
        </div>
        <div className="auth-form">
          <div className="tabs">
            <div></div>
            <div className="mode-switch">
              <button className={`tab ${mode==='login'?'active':''}`} onClick={()=>setMode('login')}>登录</button>
              <button className={`tab ${mode==='register'?'active':''}`} onClick={()=>setMode('register')}>注册</button>
            </div>
          </div>

          {mode === 'register' && (
            <>
              <div className="field">
                <label>执业证号</label>
                <input value={license} onChange={e=>setLicense(e.target.value)} placeholder="医生执业证/医师证号" />
              </div>
              <div className="field">
                <label>工作机构</label>
                <input value={hospital} onChange={e=>setHospital(e.target.value)} placeholder="医院/诊所名称" />
              </div>
            </>
          )}

          <form onSubmit={pw ? handlePasswordAuth : (e=>e.preventDefault())}>
            <div className="field">
              <label>邮箱 / 手机</label>
              <input value={contact} onChange={e=>setContact(e.target.value)} placeholder="you@hospital.org 或 +8613800..." />
            </div>

            <div className="field row">
              <div style={{flex:1}}>
                <label>密码（可选）</label>
                <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="使用密码登录" />
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
            </div>

            {error && <div className="auth-error" style={{marginTop:10}}>{error}</div>}
          </form>

          <div style={{marginTop:18}}>
            <label>上传资质（可选）</label>
            <div style={{marginTop:8}}>
              <button
                className="upload-avatar-btn"
                onClick={triggerFileSelect}
                disabled={uploadingLicense}
              >
                {uploadingLicense ? '上传中...' : licenseUploaded ? '已上传 ✓' : '上传执业证/资质'}
              </button>
              <div style={{fontSize:'12px', color:'#666', marginTop:4}}>
                支持格式：PDF、JPG、PNG、GIF
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


