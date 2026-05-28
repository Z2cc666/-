import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { loadChats } from '../utils/storage'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

function useQuery() {
  return new URLSearchParams(useLocation().search)
}

export default function RequestConsultation() {
  const query = useQuery()
  const navigate = useNavigate()
  const chatId = query.get('chatId')
  const preselectedDoctor = query.get('doctor')
  const [chat, setChat] = useState(null)
  const [extra, setExtra] = useState('')
  const [doctors, setDoctors] = useState([])
  const [selectedDoctor, setSelectedDoctor] = useState(preselectedDoctor || '')
  const [attachments, setAttachments] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    try {
      const cs = loadChats()
      const c = cs.find(x => x.id === chatId)
      setChat(c || { messages: [] })
    } catch (e) {
      setError(e.message)
      setChat({ messages: [] })
    }
  }, [chatId])

  useEffect(() => {
    async function loadDoctors(){
      try{
        const resp = await fetch(`${BASE}/doctors`)
        if(!resp.ok) return
        const data = await resp.json()
        setDoctors(data.doctors || data || [])
      }catch(e){
        console.error('加载医生失败:', e)
      }
    }
    loadDoctors()
  },[])

  if (error) {
    return (
      <div style={{padding:24}}>
        <button className="btn-ghost" onClick={()=>navigate('/consultation-square')}>返回问诊广场</button>
        <h2>提交求助医生问诊</h2>
        <div style={{color:'red',padding:20}}>加载出错: {error}</div>
      </div>
    )
  }

  async function handleAttach(file){
    const fd = new FormData()
    fd.append('file', file)
    const auth = getStoredAuth()
    const headers = {}
    if(auth?.token) {
      headers['Authorization'] = 'Bearer ' + auth.token
    }
    try{
      const resp = await fetch(`${BASE}/upload-avatar`, { method: 'POST', headers, body: fd })
      const d = await resp.json()
      const url = d.url ? (d.url.startsWith('/') ? BASE + d.url : d.url) : null
      if(url) setAttachments(a => [...a, url])
    }catch(e){
      alert('上传失败')
    }
  }

  async function handleSubmit(){
    if(!chat) return
    setSubmitting(true)
    try{
      const auth = getStoredAuth()
      const payload = {
        title: `患者求助 - ${chat.title || ''}`,
        messages: chat.messages || [],
        extra_info: extra,
        requested_doctor: selectedDoctor || null,
        attachments
      }
      const headers = {'Content-Type':'application/json'}
      if(auth?.token) {
        headers['Authorization'] = 'Bearer ' + auth.token
      }
      const resp = await fetch(`${BASE}/submit_request`, { method: 'POST', headers, body: JSON.stringify(payload) })
      if(!resp.ok){ alert('提交失败'); setSubmitting(false); return }
      const data = await resp.json()
      alert('提交成功，case id: ' + (data.case_id || ''))
      navigate('/profile')
    }catch(e){
      alert('提交失败')
    }finally{
      setSubmitting(false)
    }
  }

  return (
    <div style={{padding:24}}>
      <div style={{display: 'flex', alignItems: 'center', marginBottom: 16}}>
        <button onClick={() => navigate('/profile')} style={{background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 14}}>
          ← 返回
        </button>
      </div>
      <h2>提交求助医生问诊</h2>
      {preselectedDoctor && (
        <div style={{
          background: '#dbeafe',
          color: '#1e40af',
          padding: '12px',
          borderRadius: '8px',
          marginBottom: '16px',
          border: '1px solid #bfdbfe'
        }}>
          💡 已为您预选医生，如需更换可在下方修改
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'1fr 360px',gap:18}}>
        <div>
          <h3>我刚刚的智能问答记录</h3>
          <div style={{background:'#fff',padding:12,borderRadius:8,minHeight:320,overflow:'auto'}}>
            {(chat && chat.messages && chat.messages.length) ? chat.messages.map(m=>(
              <div key={m.id} style={{marginBottom:8}}>
                <div style={{fontWeight:600}}>{m.role}</div>
                <div>{m.content}</div>
              </div>
            )) : <div style={{color:'#6b7280'}}>暂无消息</div>}
          </div>

          <h3 style={{marginTop:18}}>补充说明（可选）</h3>
          <textarea value={extra} onChange={e=>setExtra(e.target.value)} placeholder="补充你的症状/期望/就诊时间等" style={{width:'100%',minHeight:120,padding:12,borderRadius:8}} />

          <div style={{marginTop:12, display:'flex',gap:8,alignItems:'center'}}>
            <label className="btn-ghost">上传照片/报告
              <input type="file" style={{display:'none'}} onChange={e=>handleAttach(e.target.files[0])} />
            </label>
            <div>
              {attachments.map((a,i)=>(<a key={i} href={a} target="_blank" rel="noreferrer" style={{marginRight:8}}>附件{i+1}</a>))}
            </div>
          </div>

          <div style={{marginTop:18}}>
            <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? '提交中...' : '提交到就诊广场'}</button>
          </div>
        </div>
        <aside style={{background:'#fff',padding:12,borderRadius:8}}>
          <h3>选择医生（可选）</h3>
          <select value={selectedDoctor} onChange={e=>setSelectedDoctor(e.target.value)} style={{width:'100%',padding:10,borderRadius:8}}>
            <option value=''>不选择，等候医生接单</option>
            {doctors.map(d=>(
              <option key={d.username} value={d.username}>{d.display_name || d.username} {d.clinic ? `- ${d.clinic}` : ''}</option>
            ))}
          </select>
          <div style={{marginTop:12}}>
            <h4>医生列表</h4>
            <div style={{maxHeight:320,overflow:'auto'}}>
              {doctors.map(d=>(
                <div key={d.username} style={{padding:8, borderBottom:'1px solid #eee'}}>
                  <div style={{fontWeight:700}}>{d.display_name || d.username}</div>
                  <div style={{fontSize:12,color:'#6b7280'}}>{d.clinic || ''} {d.specialties ? `· ${d.specialties}` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}


