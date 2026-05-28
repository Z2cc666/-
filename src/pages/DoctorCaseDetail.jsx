import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function DoctorCaseDetail() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const auth = getStoredAuth()
  const [caseData, setCaseData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [prescriptionModal, setPrescriptionModal] = useState(false)
  const [billingModal, setBillingModal] = useState(false)
  const [prescriptionText, setPrescriptionText] = useState('')
  const [billingAmount, setBillingAmount] = useState('')
  const [billingDesc, setBillingDesc] = useState('')
  const [tags, setTags] = useState([])
  const [newTag, setNewTag] = useState('')
  const messagesRef = useRef(null)

  useEffect(() => {
    load()
    const iv = setInterval(load, 3000)
    return () => clearInterval(iv)
  }, [caseId])

  async function load() {
    setLoading(true)
    try {
      const resp = await fetch(`${BASE}/cases/${caseId}`, { headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {} })
      if (!resp.ok) { setLoading(false); return }
      const data = await resp.json()
      setCaseData(data)
      // fetch tags for this case
      try {
        const r = await fetch(`${BASE}/cases/${caseId}/tags`, { headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {} })
        if (r.ok) {
          const tdata = await r.json()
          setTags(tdata || [])
        }
      } catch (e) { console.error('fetch case tags failed', e) }
    } catch (e) {
      console.error('load case failed', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [caseData?.messages?.length])

  async function submitPrescription() {
    if (!prescriptionText.trim()) return
    try {
      const payload = { prescription: { content: prescriptionText } }
      const resp = await fetch(`${BASE}/cases/${caseId}/prescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}) },
        body: JSON.stringify(payload)
      })
      if (resp.ok) {
        setPrescriptionText('')
        setPrescriptionModal(false)
        await load()
      } else {
        const d = await resp.json().catch(()=>({}))
        alert(d.error || '提交处方失败')
      }
    } catch (e) {
      console.error(e); alert('网络错误')
    }
  }

  async function submitBilling() {
    if (!billingAmount || !billingDesc.trim()) return
    try {
      const payload = { amount: billingAmount, description: billingDesc }
      const resp = await fetch(`${BASE}/cases/${caseId}/billing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}) },
        body: JSON.stringify(payload)
      })
      if (resp.ok) {
        setBillingAmount(''); setBillingDesc(''); setBillingModal(false)
        await load()
      } else {
        const d = await resp.json().catch(()=>({}))
        alert(d.error || '提交收费失败')
      }
    } catch (e) {
      console.error(e); alert('网络错误')
    }
  }

  if (loading) return <div style={{padding:24}}>加载中...</div>
  if (!caseData) return <div style={{padding:24}}>未找到该会话</div>

  return (
    <div style={{padding:24}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button className="btn-ghost" onClick={() => navigate('/doctor/profile')}>
            ← 返回
          </button>
          <h2>病例详情 — {caseData.title}</h2>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <button style={{background:'transparent',border:'none',cursor:'pointer',fontSize:18}} onClick={async ()=>{
            const stored = getStoredAuth()
            if (!stored) return alert('请先登录')
            try {
              const method = caseData.favorite ? 'DELETE' : 'POST'
              const url = `${BASE}/cases/${caseId}/favorite`
              const r = await fetch(url, { method, headers: { 'Authorization': 'Bearer ' + (stored.token || '') } })
              if (r.ok) {
                setCaseData(prev => ({ ...prev, favorite: !prev.favorite }))
              } else {
                const d = await r.json().catch(()=>({}))
                alert(d.error || '操作失败')
              }
            } catch (e) { console.error(e); alert('网络错误') }
          }}>{caseData.favorite ? '★ 已收藏' : '☆ 收藏'}</button>
          <div style={{display:'flex',gap:8,alignItems:'center',paddingLeft:8}}>
            {tags.map(t=>(
              <div key={t} style={{background:'#eef2ff',padding:'4px 8px',borderRadius:12,display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12}}>{t}</span>
                <button onClick={async ()=>{
                  try {
                    const stored = getStoredAuth(); if(!stored) return alert('请先登录')
                    const r = await fetch(`${BASE}/cases/${caseId}/tags/${encodeURIComponent(t)}`, { method:'DELETE', headers: { 'Authorization': 'Bearer ' + stored.token } })
                    if (r.ok) {
                      setTags(prev => prev.filter(x=>x!==t))
                    } else {
                      const d = await r.json().catch(()=>({})); alert(d.error || '删除标签失败')
                    }
                  } catch (e) { console.error(e); alert('网络错误') }
                }} style={{border:'none',background:'transparent',cursor:'pointer'}}>✕</button>
              </div>
            ))}
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              <input placeholder="新增标签" value={newTag} onChange={e=>setNewTag(e.target.value)} style={{padding:'6px',borderRadius:6,border:'1px solid #e5e7eb'}} />
              <button onClick={async ()=>{
                if (!newTag.trim()) return
                try {
                  const stored = getStoredAuth(); if(!stored) return alert('请先登录')
                  const r = await fetch(`${BASE}/cases/${caseId}/tags`, { method:'POST', headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + stored.token }, body: JSON.stringify({ tag: newTag.trim() }) })
                  if (r.ok) {
                    setTags(prev => [...prev, newTag.trim()])
                    setNewTag('')
                  } else {
                    const d = await r.json().catch(()=>({})); alert(d.error || '添加标签失败')
                  }
                } catch (e) { console.error(e); alert('网络错误') }
              }} className="btn-primary">添加</button>
            </div>
          </div>
          <button className="btn-primary" onClick={()=>navigate(`/doctor-patient-chat/${caseId}`)}>打开聊天</button>
          <button className="btn-primary" onClick={()=>setPrescriptionModal(true)}>开处方</button>
          <button className="btn-primary" onClick={()=>setBillingModal(true)}>收费</button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'320px 1fr 320px',gap:12}}>
        <aside style={{background:'#fff',padding:12,borderRadius:8}}>
          <h3>患者信息</h3>
          <div>用户名：{caseData.owner}</div>
          <div>状态：{caseData.status}</div>
        </aside>

        <main style={{background:'#fff',padding:12,borderRadius:8,display:'flex',flexDirection:'column'}}>
          <h3>消息</h3>
          <div ref={messagesRef} style={{flex:1,overflow:'auto',padding:8,background:'#f9fafb',borderRadius:6}}>
            {(caseData.messages||[]).map((m,idx)=>(
              <div key={idx} style={{marginBottom:8}}>
                <div style={{fontSize:12,color:'#6b7280'}}>{m.role} · {new Date((m.ts||Date.now())).toLocaleString()}</div>
                <div style={{padding:8,background:'#fff',borderRadius:6}}>{m.type === 'image' ? <img src={m.content} alt="" style={{maxWidth:200}} /> : m.content}</div>
              </div>
            ))}
          </div>
        </main>

        <aside style={{background:'#fff',padding:12,borderRadius:8}}>
          <h3>处方历史</h3>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {(caseData.prescriptions||[]).length === 0 ? <div style={{color:'#6b7280'}}>暂无处方</div> : caseData.prescriptions.map(p=>(
              <div key={p.id} style={{padding:8,background:'#f9fafb',borderRadius:6}}>
                <div style={{fontWeight:700}}>{p.doctor} · {new Date(p.created_at*1000).toLocaleString()}</div>
                <div style={{whiteSpace:'pre-wrap'}}>{p.content}</div>
              </div>
            ))}
          </div>
          <h3 style={{marginTop:12}}>收费历史</h3>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {(caseData.billings||[]).length === 0 ? <div style={{color:'#6b7280'}}>暂无收费</div> : caseData.billings.map(b=>(
              <div key={b.id} style={{padding:8,background:'#f9fafb',borderRadius:6}}>
                <div>{b.amount} 元 · {b.description} · {b.status}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* 处方模态 */}
      {prescriptionModal && (
        <div style={{position:'fixed',left:'50%',top:'20%',transform:'translateX(-50%)',background:'#fff',padding:20,borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:1000}}>
          <h3>开处方</h3>
          <textarea value={prescriptionText} onChange={e=>setPrescriptionText(e.target.value)} style={{width:480,height:160}} />
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:12}}>
            <button className="btn-secondary" onClick={()=>setPrescriptionModal(false)}>取消</button>
            <button className="btn-primary" onClick={submitPrescription}>提交</button>
          </div>
        </div>
      )}

      {/* 收费模态 */}
      {billingModal && (
        <div style={{position:'fixed',left:'50%',top:'20%',transform:'translateX(-50%)',background:'#fff',padding:20,borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:1000}}>
          <h3>收费</h3>
          <div style={{marginBottom:8}}>金额（元）</div>
          <input value={billingAmount} onChange={e=>setBillingAmount(e.target.value)} />
          <div style={{marginTop:8}}>说明</div>
          <input value={billingDesc} onChange={e=>setBillingDesc(e.target.value)} style={{width:480}} />
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:12}}>
            <button className="btn-secondary" onClick={()=>setBillingModal(false)}>取消</button>
            <button className="btn-primary" onClick={submitBilling}>提交</button>
          </div>
        </div>
      )}
    </div>
  )
}


