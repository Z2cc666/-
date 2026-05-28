import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function CaseDetail() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const auth = getStoredAuth()
  const [caseData, setCaseData] = useState(null)
  const [patientInfo, setPatientInfo] = useState(null)
  const [doctorInfo, setDoctorInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [prescriptions, setPrescriptions] = useState([])
  const [showPrescriptionModal, setShowPrescriptionModal] = useState(false)
  const [latestPrescription, setLatestPrescription] = useState(null)
  const [showBillingPayModal, setShowBillingPayModal] = useState(false)
  const [billingToPay, setBillingToPay] = useState(null)
  const [paymentMethod, setPaymentMethod] = useState('alipay')
  const [paying, setPaying] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const messagesRef = useRef(null)
  const lastPrescriptionIdRef = useRef(null)
  // normalize timestamp (some messages use seconds, some ms)
  function formatTimestamp(ts) {
    const n = Number(ts) || Date.now()
    const ms = n < 1e12 ? n * 1000 : n
    return new Date(ms).toLocaleString()
  }
  const canSend = auth?.username && caseData && (auth.username === caseData.owner || auth.username === caseData.assigned_doctor)
  const showingDoctorLoggedInBanner = auth?.user_type === 'doctor' && caseData && auth.username !== caseData.owner && auth.username !== caseData.assigned_doctor
  const isChatBanned = caseData && !!caseData.chat_banned

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const resp = await fetch(`${BASE}/cases/${caseId}`, { headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {} })
        if (!resp.ok) { setLoading(false); return }
        const data = await resp.json()
        setCaseData(data)
        // prescriptions may be returned by server
        setPrescriptions(data.prescriptions || [])
        if ((data.prescriptions || []).length > 0) {
          const last = data.prescriptions[data.prescriptions.length - 1]
          lastPrescriptionIdRef.current = last.id
        }
        // try load patient info (admin/doctor)
        try {
          const p = await fetch(`${BASE}/patient-info/${data.owner}`, { headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {} })
          if (p.ok) {
            setPatientInfo(await p.json())
          } else {
            setPatientInfo({ username: data.owner })
          }
        } catch (e) {
          setPatientInfo({ username: data.owner })
        }
        // try load doctor info if assigned
        if (data.assigned_doctor) {
          try {
            const d = await fetch(`${BASE}/doctors/${data.assigned_doctor}`, { headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {} })
            if (d.ok) {
              setDoctorInfo(await d.json())
            }
          } catch (e) {
            console.error('load doctor info failed', e)
          }
        }
      } catch (e) {
        console.error('load case failed', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [caseId])

  // poll for case updates (including prescriptions) so patient view sees new prescriptions
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const resp = await fetch(`${BASE}/cases/${caseId}`, { headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {} })
        if (!resp.ok) return
        const data = await resp.json()
        setCaseData(data)
        const pres = data.prescriptions || []
        setPrescriptions(pres)
        if (pres.length > 0) {
          const last = pres[pres.length - 1]
          if (lastPrescriptionIdRef.current && last.id !== lastPrescriptionIdRef.current) {
            // new prescription arrived
            lastPrescriptionIdRef.current = last.id
            setLatestPrescription(last)
            setShowPrescriptionModal(true)
          } else if (!lastPrescriptionIdRef.current) {
            lastPrescriptionIdRef.current = last.id
          }
        }
      } catch (e) { /* ignore */ }
    }, 3000)
    return () => clearInterval(iv)
  }, [caseId, auth?.token])

  // scroll to bottom when messages update
  useEffect(() => {
    if (!messagesRef.current) return
    setTimeout(() => {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }, 100)
  }, [caseData?.messages?.length])

  if (loading) return <div style={{padding:24}}>加载中...</div>
  if (!caseData) return <div style={{padding:24}}>未找到该会话</div>

  return (
    <div style={{padding:24,maxWidth:1100,margin:'0 auto',boxSizing:'border-box'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <button onClick={() => navigate('/profile')} style={{background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 14}}>
          ← 返回
        </button>
        <div style={{display:'flex',gap:8}}>
          <button className="btn-primary" onClick={()=>navigate('/doctor-chat')}>智能问诊</button>
        </div>
      </div>
      <div style={{background:'#fff',padding:12,borderRadius:8,marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:18}}>{caseData.title}</div>
        <div style={{fontSize:12,color:'#6b7280'}}>患者：{caseData.owner} · 状态：{caseData.status}</div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'200px 2.4fr 360px',gap:32,height:'calc(100vh - 200px)',alignItems:'stretch',overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateRows:'auto 1fr',gap:12,minHeight:0}}>
          <aside style={{background:'#fff',padding:12,borderRadius:8,overflow:'auto',maxHeight:'100%'}}>
            <h3>医生信息</h3>
            {doctorInfo ? (
              <div>
                <div style={{display:'flex',alignItems:'center',marginBottom:16}}>
                  <img
                    src={doctorInfo.avatar_url ? (doctorInfo.avatar_url.startsWith('/') ? BASE + doctorInfo.avatar_url : doctorInfo.avatar_url) : '/placeholder.png'}
                    alt={doctorInfo.display_name}
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '12px',
                      objectFit: 'cover',
                      border: '2px solid #e5e7eb',
                      marginRight: '12px'
                    }}
                  />
                  <div>
                    <div style={{fontSize: '18px', fontWeight: 'bold', color: '#1f2937'}}>
                      {doctorInfo.display_name || doctorInfo.username}
                    </div>
                    <div style={{fontSize: '14px', color: '#059669', background: '#dcfce7', padding: '2px 8px', borderRadius: '12px', display: 'inline-block'}}>
                      {doctorInfo.specialties || '全科'}
                    </div>
                  </div>
                </div>

                <div><strong>医院：</strong>{doctorInfo.clinic || '未填写'}</div>
                <div><strong>联系电话：</strong>{doctorInfo.phone || '未填写'}</div>
                <div><strong>执业证书号：</strong>{doctorInfo.license_number || '未填写'}</div>

                {doctorInfo.bio && (
                  <div style={{marginTop:12}}>
                    <strong>医生简介：</strong>
                    <div style={{marginTop:4, fontSize: '14px', color: '#4b5563', lineHeight: '1.5'}}>
                      {doctorInfo.bio.length > 150 ? doctorInfo.bio.substring(0, 150) + '...' : doctorInfo.bio}
                    </div>
                  </div>
                )}
              </div>
            ) : caseData?.assigned_doctor ? (
              <div style={{color:'#6b7280'}}>正在加载医生信息...</div>
            ) : (
              <div style={{color:'#6b7280'}}>未分配医生</div>
            )}
          </aside>

          <aside style={{background:'#fff',padding:12,borderRadius:8,overflow:'auto',minHeight:0,maxHeight:'100%'}}>
            <h3>历史智能问答</h3>
            <div style={{marginTop:8,overflow:'auto',maxHeight:'calc(100% - 36px)'}}>
              {(caseData.messages || [])
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map((m, idx) => (
                <div key={idx} style={{marginBottom:12,padding:8,background:'#f9fafb',borderRadius:6}}>
                  <div style={{fontSize:12,color:'#6b7280',marginBottom:6}}>{m.role === 'user' ? '患者' : 'AI'} · {new Date((m.ts||Date.now())).toLocaleString()}</div>
                  <div style={{whiteSpace:'pre-wrap'}}>{m.content}</div>
                </div>
              ))}
              {(caseData.messages || []).filter(m => m.role === 'user' || m.role === 'assistant').length === 0 && (
                <div style={{color:'#6b7280',textAlign:'center',padding:20}}>暂无智能问答记录</div>
              )}
            </div>
          </aside>
        </div>

        <div style={{background:'#fff',padding:12,borderRadius:8,display:'flex',flexDirection:'column',minHeight:0}}>
          <h3>消息</h3>
          <div ref={messagesRef} style={{flex:1,overflow:'auto',padding:16,minHeight:0,background:'#fff'}}>
            {(caseData.messages || [])
              .filter(m => m.role === 'doctor' || m.role === 'user')
              .length === 0 ? <div style={{color:'#6b7280'}}>暂无消息</div> : caseData.messages
              .filter(m => m.role === 'doctor' || m.role === 'user')
              .map((m,idx)=>(
              <div key={idx} style={{display:'flex',justifyContent: m.role==='user' ? 'flex-end' : 'flex-start', marginBottom:8}}>
              <div style={{maxWidth:'80%',padding:10,borderRadius:8,background:m.role==='user' ? '#3b82f6' : '#f3f4f6', color: m.role==='user' ? '#fff' : '#111827'}}>
                  <div style={{fontSize:12,opacity:0.8,marginBottom:6}}>{m.role === 'user' ? '患者' : '医生'} · {formatTimestamp(m.ts)}</div>
                  {m.type === 'image' ? (
                    <div>
                      <img src={m.content && m.content.startsWith('/') ? BASE + m.content : m.content} alt="图片" style={{maxWidth:'100%',borderRadius:8}} />
                    </div>
                  ) : m.type === 'prescription' ? (
                    <div style={{background:'#fff',padding:8,borderRadius:8,border:'1px solid #d1d5db',cursor:'pointer'}} onClick={()=>{
                      setLatestPrescription({content: m.content, id: m.id, images: m.images || [], medicines: m.medicines || []})
                      setShowPrescriptionModal(true)
                    }}>
                      <div style={{fontWeight:700,marginBottom:6}}>处方（点击查看）</div>
                      <div style={{whiteSpace:'pre-wrap',maxHeight:120,overflow:'hidden'}}>{m.content}</div>
                      <div style={{marginTop:8,display:'flex',gap:8,flexWrap:'wrap'}}>
                        {(m.medicines || []).map((med, mi)=>{
                          const medLabel = typeof med === 'string' ? med : (med && (med.name ? `${med.name}${med.qty ? ` x${med.qty}` : ''}` : JSON.stringify(med)))
                          return (<div key={mi} style={{background:'#eef2ff',padding:'4px 8px',borderRadius:12,fontSize:12}}>{medLabel}</div>)
                        })}
                      </div>
                      <div style={{marginTop:8,display:'flex',gap:8,flexWrap:'wrap'}}>
                        {(m.images || []).map((img, ii)=>(<img key={ii} src={img && img.startsWith('/') ? BASE + img : img} alt="pres" style={{height:48,borderRadius:6}} />))}
                      </div>
                    </div>
                  ) : m.type === 'billing' ? (
                    <div style={{background:'#fff',padding:10,borderRadius:8,border:'1px solid #d1d5db',cursor:'pointer'}} onClick={()=>{
                      setBillingToPay({id: m.billing_id || m.billingId, amount: m.amount || null, description: m.content})
                      setShowBillingPayModal(true)
                    }}>
                      <div style={{fontWeight:700,marginBottom:6}}>请支付</div>
                      <div style={{whiteSpace:'pre-wrap'}}>{m.content}</div>
                    </div>
                  ) : m.type === 'billing_paid' ? (
                    <div style={{background:'#d1fae5',padding:10,borderRadius:8,border:'1px solid #bbf7d0',color:'#065f46'}}>
                      <div style={{fontWeight:700}}>已完成支付</div>
                      <div style={{fontSize:12,marginTop:6}}>{m.content}</div>
                    </div>
                  ) : (
                    <div style={{whiteSpace:'pre-wrap'}}>{m.content}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* 付款弹窗（患者端） */}
          {showBillingPayModal && billingToPay && (
            <div style={{position:'fixed',left:'50%',top:'20%',transform:'translateX(-50%)',background:'#fff',padding:20,borderRadius:8,boxShadow:'0 8px 28px rgba(0,0,0,0.18)',zIndex:1000,minWidth:360}}>
              <div style={{fontWeight:700,fontSize:18,marginBottom:12}}>付款</div>
              <div style={{marginBottom:8}}>金额：<strong>{billingToPay.amount || '未知'} 元</strong></div>
              <div style={{marginBottom:8}}>说明：{billingToPay.description}</div>
              <div style={{marginBottom:12}}>
                <label style={{marginRight:8}}><input type="radio" name="pm" value="alipay" checked={paymentMethod==='alipay'} onChange={()=>setPaymentMethod('alipay')} /> 支付宝</label>
                <label style={{marginRight:8}}><input type="radio" name="pm" value="wechat" checked={paymentMethod==='wechat'} onChange={()=>setPaymentMethod('wechat')} /> 微信</label>
                <label style={{marginRight:8}}><input type="radio" name="pm" value="bank" checked={paymentMethod==='bank'} onChange={()=>setPaymentMethod('bank')} /> 银行转账</label>
              </div>
              <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
                <button className="btn-secondary" onClick={()=>setShowBillingPayModal(false)}>取消</button>
                <button className="btn-primary" onClick={async ()=>{
                  if (paying) return
                  setPaying(true)
                  try {
                    const resp = await fetch(`${BASE}/cases/${caseId}/billing/${billingToPay.id}/pay`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}) },
                      body: JSON.stringify({ method: paymentMethod })
                    })
                    if (resp.ok) {
                      // refresh case
                      const fresh = await fetch(`${BASE}/cases/${caseId}`, { headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {} })
                      if (fresh.ok) {
                        const data = await fresh.json()
                        setCaseData(data)
                        setShowBillingPayModal(false)
                      }
                    } else {
                      alert('支付失败')
                    }
                  } catch (e) {
                    console.error('支付失败', e); alert('支付失败')
                  } finally {
                    setPaying(false)
                  }
                }}>{paying ? '支付中...' : '立即支付'}</button>
              </div>
            </div>
          )}
          {/* 处方详情弹窗 */}
          {showPrescriptionModal && latestPrescription && (
            <div style={{position:'fixed',left:'50%',top:'5%',transform:'translateX(-50%)',background:'#fff',padding:32,borderRadius:12,boxShadow:'0 14px 40px rgba(0,0,0,0.18)',zIndex:1000,minWidth:760,maxWidth:'96%',maxHeight:'92vh',overflow:'auto'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:18}}>处方详情</div>
                <div style={{fontSize:12,color:'#6b7280'}}>{latestPrescription.doctor ? `医生：${latestPrescription.doctor}` : ''} {latestPrescription.created_at ? formatTimestamp(latestPrescription.created_at) : latestPrescription.ts ? formatTimestamp(latestPrescription.ts) : ''}</div>
              </div>
              <div style={{whiteSpace:'pre-wrap',marginBottom:12, color:'#111827'}}>{latestPrescription.content}</div>
              {latestPrescription.medicines && latestPrescription.medicines.length > 0 && (
                <div style={{marginBottom:12}}>
                  <div style={{fontWeight:700,marginBottom:8}}>药物清单</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {latestPrescription.medicines.map((med, i) => {
                      if (typeof med === 'string') {
                        return (<div key={i} style={{background:'#eef2ff',padding:'6px 10px',borderRadius:16,fontSize:13}}>{med}</div>)
                      }
                      const name = med.name || med.title || '药物'
                      const units = med.unitsPerDose || med.units || 1
                      const times = med.timesPerDay || med.timesPerDay || 1
                      const days = med.days || 1
                      const unitType = med.unit || med.unitType || ''
                      const unitMap = { tablet: '片', capsule: '胶囊', pack: '包', vial: '瓶', mg: 'mg', g: 'g', unit: '' }
                      const unitLabel = unitMap[unitType] !== undefined ? unitMap[unitType] : unitType
                      const qty = med.qty || (units * times * days) || 0
                      const price = parseFloat(med.price || 0) || 0
                      const subtotal = (price * qty).toFixed(2)
                      const label = `${name} — 每次 ${units}${unitLabel ? ' ' + unitLabel : ''} × ${times} 次/日 × ${days} 天 = ${qty}${unitLabel ? ' ' + unitLabel : ''}`
                      return (
                        <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',background:'#f8fafc',borderRadius:8}}>
                          <div style={{fontSize:14}}>{label}</div>
                          <div style={{fontWeight:700}}>¥{subtotal}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {latestPrescription.images && latestPrescription.images.length > 0 && (
                <div style={{marginBottom:12}}>
                  <div style={{fontWeight:700,marginBottom:8}}>处方图片</div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    {latestPrescription.images.map((img, ii)=> {
                      const src = img && img.startsWith('/') ? BASE + img : img
                      return (<a key={ii} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`pres-${ii}`} style={{height:96,borderRadius:6}} /></a>)
                    })}
                  </div>
                </div>
              )}
              <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
                <button className="btn-secondary" onClick={()=>setShowPrescriptionModal(false)}>关闭</button>
              </div>
            </div>
          )}
          {showingDoctorLoggedInBanner ? (
            <div style={{marginTop:8,marginBottom:8,padding:8,background:'#fff3cd',border:'1px solid #ffeeba',borderRadius:6,color:'#856404'}}>
              当前以医生账号登录（{auth.username}），若想以患者身份发送请使用患者账号登录或在无痕/另一浏览器窗口打开。为避免误发，发送框已被禁用。
            </div>
          ) : null}
          {isChatBanned && (
            <div style={{marginTop:8,marginBottom:8,padding:8,background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:6,color:'#7f1d1d'}}>
              该会话的聊天已被封禁。消息发送已被禁用。
            </div>
          )}

          <div style={{marginTop:12,display:'flex',gap:8,alignItems:'center'}}>
            <textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="请输入回复内容..." style={{flex:1,minHeight:80,padding:8,borderRadius:6}} disabled={isChatBanned} />
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <button className="btn-primary" disabled={!canSend || sending} onClick={async ()=>{
                if (!canSend) { alert('当前账号不可发送此会话消息，请切换到患者账号或接单医生账号。'); return }
                if (!input.trim() || sending) return
                setSending(true)
                // determine role based on authenticated user vs case owner/assigned doctor
                const authStored = getStoredAuth()
                let role = 'user'
                if (authStored?.username && caseData) {
                  if (authStored.username === caseData.assigned_doctor) role = 'doctor'
                  else if (authStored.username === caseData.owner) role = 'user'
                }
                const msg = { id: Date.now().toString(36), role, content: input.trim(), ts: Math.floor(Date.now()/1000) }
                // optimistic UI
                setCaseData(prev => ({ ...prev, messages: [...(prev.messages||[]), msg] }))
                setInput('')
                try {
                    const resp = await fetch(`${BASE}/cases/${caseId}/message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}) },
                    body: JSON.stringify({ message: msg })
                  })
                  if (!resp.ok) {
                    alert('发送失败')
                  } else {
                    // refresh messages from server for consistency
                    const fresh = await fetch(`${BASE}/cases/${caseId}`)
                    if (fresh.ok) {
                      const data = await fresh.json()
                      setCaseData(data)
                    }
                  }
                } catch (e) {
                  console.error('send message failed', e)
                  alert('发送失败')
                } finally {
                  setSending(false)
                  // scroll to bottom
                  setTimeout(()=>{ if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight }, 120)
                }
              }}>{sending ? '发送中...' : '发送'}</button>

              <label className="btn-ghost" style={{padding:'8px 10px',borderRadius:6,display:'inline-block',cursor:'pointer',textAlign:'center'}}>
                上传图片
                <input type="file" accept="image/*" style={{display:'none'}} onChange={async (e)=>{
                const f = e.target.files[0]; if (!f) return
                  if (isChatBanned) { alert('该会话已被封禁聊天，图片上传已取消。'); return }
                  if (!canSend) { alert('当前账号不可发送此会话消息，图片上传已取消。'); return }
                  const fd = new FormData(); fd.append('file', f)
                  try {
                    // 使用 upload-and-analyze 来上传图片并获取AI分析
                    const up = await fetch(`${BASE}/upload-and-analyze`, { method:'POST', body: fd })
                    const d = await up.json()
                    if (d.error) { alert('分析失败: ' + d.error); return }
                    const url = d.url ? (d.url.startsWith('/') ? 'http://127.0.0.1:8080'+d.url : d.url) : null
                    const answer = d.answer || ''
                    if (url) {
                    // determine role for image message as well
                    const authStored = getStoredAuth()
                    let role = 'user'
                    if (authStored?.username && caseData) {
                      if (authStored.username === caseData.assigned_doctor) role = 'doctor'
                      else if (authStored.username === caseData.owner) role = 'user'
                    }
                    const imgMsg = { id: Date.now().toString(36), role, content: url, type: 'image', ts: Math.floor(Date.now()/1000) }
                      setCaseData(prev => ({ ...prev, messages: [...(prev.messages||[]), imgMsg] }))
                      // send to server (include JSON content-type)
                      const sendResp = await fetch(`${BASE}/cases/${caseId}/message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}) },
                        body: JSON.stringify({ message: imgMsg })
                      })
                      // 如果有AI分析结果，也作为消息发送
                      if (answer && sendResp.ok) {
                        const aiMsg = { id: (Date.now()+1).toString(36), role: 'assistant', content: '【图片分析】\n' + answer, ts: Math.floor(Date.now()/1000) }
                        setCaseData(prev => ({ ...prev, messages: [...(prev.messages||[]), aiMsg] }))
                        const aiResp = await fetch(`${BASE}/cases/${caseId}/message`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}) },
                          body: JSON.stringify({ message: aiMsg })
                        })
                        if (!aiResp.ok) {
                          console.error('AI analysis message send failed')
                        }
                      }
                      if (!sendResp.ok) {
                        console.error('image message send failed', await sendResp.text())
                        alert('图片发送失败，稍后重试')
                      }
                    } else alert('上传失败')
                  } catch (err) { console.error(err); alert('上传失败') }
                }} />
              </label>
            </div>
          </div>
        </div>

        {/* 右侧患者信息 */}
        <div style={{width: '100%', minWidth: 320}}>
          <div style={{background:'#fff',padding:12,borderRadius:8,overflow:'auto',height:'100%',boxSizing:'border-box'}}>
            <h3>患者信息</h3>
            {patientInfo ? (
              <div>
                <div><strong>用户名：</strong>{patientInfo.username}</div>
                <div><strong>姓名：</strong>{patientInfo.display_name || '未填写'}</div>
                <div><strong>联系电话：</strong>{patientInfo.emergency_phone || '未填写'}</div>
                <div><strong>过敏史：</strong>{patientInfo.allergies || '无'}</div>
                <div><strong>性别：</strong>{patientInfo.gender === 'male' ? '男' : patientInfo.gender === 'female' ? '女' : patientInfo.gender || '未填写'}</div>
                <div><strong>出生日期：</strong>{patientInfo.birthday || '未填写'}</div>
                <div><strong>身高：</strong>{patientInfo.height ? `${patientInfo.height}cm` : '未填写'}</div>
                <div><strong>体重：</strong>{patientInfo.weight ? `${patientInfo.weight}kg` : '未填写'}</div>
                <div><strong>血型：</strong>{patientInfo.blood_type || '未填写'}</div>
                <div><strong>慢性疾病：</strong>{patientInfo.chronic || '无'}</div>
                <div><strong>正在服用的药物：</strong>{patientInfo.medications || '无'}</div>
                <div><strong>紧急联系人：</strong>{patientInfo.emergency_name || '未填写'}</div>
                <div><strong>医保信息：</strong>{patientInfo.insurance || '未填写'}</div>
                <div><strong>健康状况：</strong>{patientInfo.health_info || '未填写'}</div>
                <div><strong>就医史：</strong>{patientInfo.medical_history || '无'}</div>
              </div>
            ) : <div style={{color:'#6b7280'}}>无法读取患者信息</div>}
          </div>
        </div>
      </div>
    </div>
  )
}


