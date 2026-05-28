import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function AdminAuth() {
  const [user, setUser] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const navigate = useNavigate()

  async function handleLogin(e) {
    e.preventDefault()
    try {
      const resp = await fetch(`${BASE}/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pw })
      })
      if (!resp.ok) {
        const body = await resp.json().catch(()=>({}))
        setMsg(body.error || '登录失败')
        return
      }
      const d = await resp.json()
      saveAuth({ token: d.token, username: d.username, avatar: d.avatar || '/placeholder.png', user_type: 'admin' })
      navigate('/admin')
    } catch (e) {
      setMsg('网络错误')
    }
  }

  return (
    <div className="auth-page" style={{minHeight:'80vh', display:'flex', alignItems:'center', justifyContent:'center', padding:24}}>
      <div className="auth-card" style={{maxWidth:420, width:'100%'}}>
        <h2 style={{marginTop:0}}>系统管理员登录</h2>
        <form onSubmit={handleLogin}>
          <div className="field">
            <label>用户名</label>
            <input value={user} onChange={e=>setUser(e.target.value)} placeholder="admin" />
          </div>
          <div className="field">
            <label>密码</label>
            <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="admin123" />
          </div>
          {msg && <div style={{color:'red',marginBottom:8}}>{msg}</div>}
          <div style={{display:'flex',gap:8}}>
            <button className="btn-primary" type="submit">登录</button>
            <button className="btn-ghost" type="button" onClick={async ()=>{
              // perform real admin login with seeded credentials
              setUser('123456789'); setPw('123456')
              try {
                const resp = await fetch(`${BASE}/admin-login`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username: '123456789', password: '123456' })
                })
                if (!resp.ok) {
                  setMsg('测试登录失败')
                  return
                }
                const d = await resp.json()
                saveAuth({ token: d.token, username: d.username, avatar: d.avatar || '/placeholder.png', user_type: 'admin' })
                navigate('/admin')
              } catch (e) {
                setMsg('网络错误')
              }
            }}>测试管理员</button>
          </div>
        </form>
      </div>
    </div>
  )
}


