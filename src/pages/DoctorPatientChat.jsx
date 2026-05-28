import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8080'

export default function DoctorPatientChat() {
  const { caseId } = useParams()
  const stored = getStoredAuth()
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [consultation, setConsultation] = useState(null)
  const [patientInfo, setPatientInfo] = useState(null)
  const [prescription, setPrescription] = useState('')
  const [showPrescription, setShowPrescription] = useState(false)
  const [prescriptionImages, setPrescriptionImages] = useState([])
  const [visitFee, setVisitFee] = useState('')
  const [drugs, setDrugs] = useState([])
  const [drugQuery, setDrugQuery] = useState('')
  const [showDrugPicker, setShowDrugPicker] = useState(false)
  const [medInput, setMedInput] = useState('')
  const [medicines, setMedicines] = useState([])
  const [showPreview, setShowPreview] = useState(false)
  const [previewTotals, setPreviewTotals] = useState({ medsTotal: 0, visitFee: 0, total: 0 })
  const [presPayloadForPreview, setPresPayloadForPreview] = useState(null)
  // drug categories for picker (client-side groups)
  const DRUG_CATEGORIES = [
    { key: "all", title: "全部" },
    { key: "analgesic", title: "镇痛/退热" },
    { key: "antibiotic", title: "抗生素" },
    { key: "antihistamine", title: "抗过敏" },
    { key: "cardio", title: "心血管" },
    { key: "digestive", title: "消化系统" },
    { key: "respiratory", title: "呼吸系统" }
  ]
  const [drugCategory, setDrugCategory] = useState("all")
  const [prescriptions, setPrescriptions] = useState([])
  const [showPrescriptionDetail, setShowPrescriptionDetail] = useState(false)
  const [latestPrescription, setLatestPrescription] = useState(null)
  const [billing, setBilling] = useState({ amount: '', description: '' })
  const [showBilling, setShowBilling] = useState(false)
  const messagesRef = useRef(null)
  const intervalRef = useRef(null)
  const lastPrescriptionIdRef = useRef(null)
  const [isNearBottom, setIsNearBottom] = useState(true)

  // 判断是否已签到
  const isCheckedIn = consultation?.assigned_doctor && consultation?.status !== 'pending'

  async function checkIn() {
    try {
      const resp = await fetch(`${BASE}/check-in/${caseId}`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + stored.token }
      })
      if (resp.ok) {
        alert('签到成功！')
        loadCase()
      } else {
        const d = await resp.json().catch(()=>({}))
        alert(d.error || '签到失败')
      }
    } catch (e) {
      alert('网络错误')
    }
  }

  useEffect(() => {
    if (!stored || stored.user_type !== 'doctor') {
      navigate('/auth')
      return
    }
    loadCase()
    // Start polling for new messages
    intervalRef.current = setInterval(loadCase, 3000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [caseId])

  useEffect(() => {
    if (consultation?.owner) {
      loadPatientInfo()
    }
  }, [consultation])
  const isChatBanned = consultation && !!consultation.chat_banned

  // 智能滚动逻辑：只有当用户在底部附近时才自动滚动
  useEffect(() => {
    if (messagesRef.current && isNearBottom) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages, isNearBottom])

  // 监听滚动事件，判断用户是否在底部附近
  useEffect(() => {
    const handleScroll = () => {
      if (messagesRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = messagesRef.current
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight
        setIsNearBottom(distanceFromBottom < 100) // 距离底部100px以内算作"底部附近"
      }
    }

    const messagesContainer = messagesRef.current
    if (messagesContainer) {
      messagesContainer.addEventListener('scroll', handleScroll)
      // 初始化时检查一次
      handleScroll()
    }

    return () => {
      if (messagesContainer) {
        messagesContainer.removeEventListener('scroll', handleScroll)
      }
    }
  }, [])

  async function loadCase() {
    try {
      const resp = await fetch(`${BASE}/cases/${caseId}`, {
        headers: { 'Authorization': 'Bearer ' + stored.token }
      })
      if (!resp.ok) return
      const data = await resp.json()
      console.log('doctor loadCase', { caseId, messages: (data.messages || []).length, prescriptions: (data.prescriptions || []).length })
      setMessages(data.messages || [])
      setConsultation(data)
      setPrescriptions(data.prescriptions || [])
      if ((data.prescriptions || []).length > 0) {
        const last = data.prescriptions[data.prescriptions.length - 1]
        lastPrescriptionIdRef.current = last.id
      }
      setLoading(false)
    } catch (e) {
      console.error('加载病例失败', e)
    }
  }

  async function loadPatientInfo() {
    if (!consultation?.owner) return
    try {
      const resp = await fetch(`${BASE}/patient-info/${consultation.owner}`, {
        headers: { 'Authorization': 'Bearer ' + stored.token }
      })
      if (!resp.ok) return
      const data = await resp.json()
      setPatientInfo(data)
    } catch (e) {
      console.error('加载患者信息失败', e)
    }
  }

  async function loadDrugs(q = '', category = '') {
    try {
      let url = `${BASE}/drugs`
      if (category) {
        url += `?category=${encodeURIComponent(category)}`
      } else if (q) {
        url += `?q=${encodeURIComponent(q)}`
      }
      const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + stored.token } })
      if (!resp.ok) {
        const txt = await resp.text().catch(()=>null)
        console.error('loadDrugs failed', resp.status, txt)
        return
      }
      const data = await resp.json()
      setDrugs(data.drugs || [])
    } catch (e) {
      console.error('加载药物库失败', e)
    }
  }

  async function sendMessage() {
    if (!input.trim() || sending) return
    setSending(true)
    const userMsg = { id: Date.now().toString(36), role: 'doctor', content: input, ts: Date.now() }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')

    // 发送消息后总是滚动到底部，因为用户通常想看到自己刚发送的消息
    setTimeout(() => {
      if (messagesRef.current) {
        messagesRef.current.scrollTop = messagesRef.current.scrollHeight
      }
    }, 100)

    try {
      const resp = await fetch(`${BASE}/cases/${caseId}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + stored.token
        },
        body: JSON.stringify({ message: userMsg })
      })
      if (!resp.ok) {
        alert('发送失败')
      }
    } catch (e) {
      console.error('发送消息失败', e)
      alert('发送失败')
    } finally {
      setSending(false)
    }
  }

  async function submitPrescription() {
    // allow submission if there's text OR medicines OR images
    if (!prescription.trim() && medicines.length === 0 && prescriptionImages.length === 0) {
      alert('请填写处方内容或添加药物/图片后再提交')
      return
    }
    // prepare preview data and show confirmation modal
    const presPayload = {
      content: prescription,
      images: prescriptionImages,
      medicines
    }
    // compute meds subtotal
    const medsTotal = (medicines || []).reduce((sum, m) => {
      const price = parseFloat(m.price || 0) || 0
      const qty = parseFloat(m.qty || 0) || 0
      return sum + price * qty
    }, 0)
    const vf = parseFloat(visitFee || 0) || 0
    const total = Math.round((medsTotal + vf) * 100) / 100
    setPreviewTotals({ medsTotal, visitFee: vf, total })
    setPresPayloadForPreview(presPayload)
    setShowPreview(true)
  }

  async function confirmSubmitPrescription() {
    if (!presPayloadForPreview) return
    try {
      const resp = await fetch(`${BASE}/cases/${caseId}/prescription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + stored.token
        },
        body: JSON.stringify({ prescription: presPayloadForPreview, visit_fee: previewTotals.visitFee || 0 })
      })
      const text = await resp.text().catch(()=>null)
      let json = null
      try { json = text ? JSON.parse(text) : null } catch (_) { json = null }
      if (resp.ok) {
        // clear states and refresh case
        setPrescription('')
        setShowPrescription(false)
        setPrescriptionImages([])
        setMedicines([])
        setShowPreview(false)
        setPresPayloadForPreview(null)
        const fresh = await fetch(`${BASE}/cases/${caseId}`, {
          headers: { 'Authorization': 'Bearer ' + stored.token }
        })
        if (fresh.ok) {
          const data = await fresh.json()
          setPrescriptions(data.prescriptions || [])
          const pres = (data.prescriptions || [])
          if (pres.length > 0) {
            const last = pres[pres.length - 1]
            lastPrescriptionIdRef.current = last.id
            setLatestPrescription(last)
            setShowPrescriptionDetail(true)
          }
        }
      } else {
        console.error('prescription submit failed', resp.status, json || text)
        alert((json && json.error) || `提交失败: ${resp.status}`)
      }
    } catch (e) {
      console.error('confirm submit prescription failed', e)
      alert('提交失败: ' + (e.message || e))
    }
  }

  async function submitBilling() {
    if (!billing.amount || !billing.description.trim()) return
    try {
      const resp = await fetch(`${BASE}/cases/${caseId}/billing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + stored.token
        },
        body: JSON.stringify(billing)
      })
      if (resp.ok) {
        alert('收费提交成功')
        setBilling({ amount: '', description: '' })
        setShowBilling(false)
        // refresh case immediately so billing message appears in chat without waiting for poll
        try {
          const fresh = await fetch(`${BASE}/cases/${caseId}`, {
            headers: { 'Authorization': 'Bearer ' + stored.token }
          })
          if (fresh.ok) {
            const data = await fresh.json()
            setMessages(data.messages || [])
            setConsultation(data)
            setPrescriptions(data.prescriptions || [])
          }
        } catch (e) {
          console.error('刷新会话失败', e)
        }
      } else {
        alert('提交失败')
      }
    } catch (e) {
      console.error('提交收费失败', e)
      alert('提交失败')
    }
  }

  async function completeConsultation() {
    const diagnosis = prompt('请输入诊断结果：')
    if (!diagnosis) return

    try {
      const resp = await fetch(`${BASE}/complete-consultation/${caseId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + stored.token
        },
        body: JSON.stringify({ diagnosis })
      })
      if (resp.ok) {
        alert('病例完成')
        navigate('/doctor-consultations')
      } else {
        alert('完成失败')
      }
    } catch (e) {
      console.error('完成病例失败', e)
      alert('网络错误')
    }
  }

  if (loading) {
    return <div style={{padding: 40, textAlign: 'center'}}>加载中...</div>
  }

  return (
    <div className="chat-layout" style={{height: '100vh', padding: '20px'}}>
      <div style={{display: 'grid', gridTemplateColumns: '260px 1fr 360px', gap: 20, height: 'calc(100vh - 60px)', overflow: 'hidden', alignItems: 'stretch'}}>
        {/* 左侧面板 */}
        <div style={{width: '100%', display: 'flex', flexDirection: 'column', gap: 20, minHeight: 0}}>
          {/* 操作按钮区域 */}
          <div style={{background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb'}}>
            <h3>操作面板</h3>
            <div style={{display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16}}>
              {!isCheckedIn ? (
                <button className="btn-primary" onClick={checkIn} style={{width: '100%', fontSize: '16px', padding: '12px'}}>
                  签到接诊
                </button>
              ) : (
                <>
                  <button className="btn-primary" onClick={() => setShowPrescription(!showPrescription)} style={{width: '100%'}}>
                    {showPrescription ? '取消开处方' : '开处方'}
                  </button>
                  <button className="btn-primary" onClick={() => setShowBilling(!showBilling)} style={{width: '100%'}}>
                    {showBilling ? '取消收费' : '收费'}
                  </button>
                  <button className="btn-success" onClick={completeConsultation} style={{width: '100%'}}>
                    完成咨询
                  </button>
                </>
              )}
              <button className="btn-secondary" onClick={() => navigate('/doctor-consultations')} style={{width: '100%'}}>
                返回列表
              </button>
            </div>
          </div>

          {/* 历史智能问答区域 - 只显示 AI 问答记录 */}
          <div style={{background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb', flex: 1}}>
            <h3>历史智能问答</h3>
            <div style={{marginTop: 16, height: 'calc(100% - 60px)', overflow: 'auto'}}>
              {consultation?.messages && consultation.messages.length > 0 ? (
                consultation.messages
                  .filter(msg => msg.role === 'user' || msg.role === 'assistant')
                  .map((msg, idx) => (
                    <div key={idx} style={{marginBottom: 12, padding: 8, background: '#f9fafb', borderRadius: 6}}>
                      <div style={{fontSize: 12, color: '#6b7280', marginBottom: 4}}>
                        {msg.role === 'user' ? '患者' : 'AI'} · {msg.ts ? new Date(msg.ts * 1000).toLocaleTimeString() : ''}
                      </div>
                      <div style={{fontSize: 14}}>{msg.content}</div>
                    </div>
                  ))
              ) : (
                <div style={{color: '#6b7280', textAlign: 'center', padding: 20}}>
                  暂无历史问答记录
                </div>
              )}
            </div>
          </div>
          {/* 处方历史（调试/显示用） */}
          <div style={{background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e5e7eb', marginTop: 12}}>
            <h3>处方历史</h3>
            {prescriptions && prescriptions.length > 0 ? (
              <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:8, maxHeight:200, overflow:'auto'}}>
                {prescriptions.map((p, i) => (
                  <div key={p.id || i} style={{padding:8, borderRadius:6, background:'#f9fafb', cursor:'pointer'}} onClick={()=>{
                    setLatestPrescription(p); setShowPrescriptionDetail(true)
                  }}>
                    <div style={{fontWeight:700}}>{p.doctor ? `医生：${p.doctor}` : '处方'}</div>
                    <div style={{fontSize:12,color:'#6b7280'}}>{p.created_at ? new Date(p.created_at*1000).toLocaleString() : ''}</div>
                    <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:240}}>{p.content}</div>
                  </div>
                ))}
              </div>
            ) : <div style={{color:'#6b7280',marginTop:8}}>暂无处方</div>}
          </div>

        </div>

        {/* 中间聊天区域 */}
        <div style={{flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0}}>
          {/* 处方弹窗 */}
          {showPrescription && (
            <div style={{background: '#fff', padding: 20, borderRadius: 8, marginBottom: 20, border: '1px solid #e5e7eb'}}>
              <h3>开具处方</h3>
              <textarea
                value={prescription}
                onChange={e => setPrescription(e.target.value)}
                placeholder="请输入处方内容..."
                style={{width: '100%', minHeight: 120, padding: 12, borderRadius: 8, border: '1px solid #d1d5db', marginTop: 12}}
              />
              <div style={{marginTop:12, display:'flex', gap:8, alignItems:'center'}}>
                <label className="btn-ghost" style={{padding:'8px 10px', borderRadius:6, cursor:'pointer'}}>
                  上传处方图片
                  <input type="file" accept="image/*" style={{display:'none'}} onChange={async (e)=>{
                    const f = e.target.files[0]; if (!f) return
                    const fd = new FormData(); fd.append('file', f)
                    try {
                      const up = await fetch(`${BASE}/upload-avatar`, { method: 'POST', body: fd })
                      const d = await up.json()
                      const url = d.url ? (d.url.startsWith('/') ? (BASE + d.url) : d.url) : null
                      if (url) {
                        setPrescriptionImages(prev => [...prev, url])
                      } else alert('上传失败')
                    } catch (err) { console.error(err); alert('上传失败') }
                  }} />
                </label>
                <div style={{display:'flex', gap:8, alignItems:'center'}}>
                  <input value={medInput} onChange={e=>setMedInput(e.target.value)} placeholder="药物名称" style={{padding:8,borderRadius:4,border:'1px solid #d1d5db'}} />
                  <button className="btn-primary" onClick={()=>{ if (!medInput.trim()) return; setMedicines(prev=>[...prev, {name:medInput.trim(), price:0, qty:1}]); setMedInput('') }}>添加药物</button>
                  <button className="btn-ghost" style={{padding:'8px 10px', borderRadius:6}} onClick={()=>{
                    setShowDrugPicker(true)
                    loadDrugs()
                  }}>从药库选择</button>
                </div>
              </div>
              {showDrugPicker && (
                <div
                  onClick={() => setShowDrugPicker(false)}
                  style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1100
                  }}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: 980,
                      maxWidth: '98%',
                      maxHeight: '85vh',
                      overflow: 'auto',
                      background: '#fff',
                      borderRadius: 12,
                      padding: 20,
                      boxShadow: '0 12px 36px rgba(0,0,0,0.24)',
                      position: 'relative'
                    }}
                  >
                    <button
                      onClick={() => setShowDrugPicker(false)}
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: 18,
                        padding: 6
                      }}
                      aria-label="关闭"
                    >
                      ✕
                    </button>

                    {/* categories row */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      {DRUG_CATEGORIES.map((cat) => (
                        <button
                          key={cat.key}
                          onClick={() => {
                            setDrugCategory(cat.key)
                            setDrugQuery('')
                            if (cat.key === 'all') loadDrugs('')
                            else loadDrugs('', cat.key)
                          }}
                          className={drugCategory === cat.key ? 'btn-primary' : 'btn-ghost'}
                          style={{ padding: '6px 10px', borderRadius: 6 }}
                        >
                          {cat.title}
                        </button>
                      ))}
                      <div style={{ flex: 1 }} />
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input
                        placeholder="按名称搜索药物"
                        value={drugQuery}
                        onChange={(e) => setDrugQuery(e.target.value)}
                        style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }}
                      />
                      <button className="btn-primary" onClick={() => loadDrugs(drugQuery)}>搜索</button>
                    </div>

                    <div style={{ maxHeight: 420, overflow: 'auto', borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
                      {drugs.length === 0 ? (
                        <div style={{ color: '#6b7280', textAlign: 'center', padding: 20 }}>未找到药物</div>
                      ) : (
                        drugs.map((d) => (
                          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}>{d.name}</div>
                              <div style={{ fontSize: 12, color: '#6b7280' }}>{d.unit} · ¥{d.price}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span style={{fontSize:13,color:'#374151'}}>每天</span>
                              <input type="number" defaultValue={1} min={1} style={{ width: 72, padding: 6, borderRadius: 6, border: '1px solid #d1d5db' }} id={`times-${d.id}`} title="每日次数" />
                              <span style={{fontSize:13,color:'#374151'}}>次，每次</span>
                              <input type="number" defaultValue={1} min={1} style={{ width: 72, padding: 6, borderRadius: 6, border: '1px solid #d1d5db' }} id={`units-${d.id}`} title="每次剂量(单位数)" />
                              <select id={`unitType-${d.id}`} defaultValue={d.unit || 'unit'} style={{padding:6,borderRadius:6,border:'1px solid #d1d5db'}}>
                                <option value={d.unit || 'unit'}>{d.unit || 'unit'}</option>
                                <option value="mg">mg</option>
                                <option value="g">g</option>
                                <option value="tablet">片</option>
                                <option value="capsule">胶囊</option>
                                <option value="pack">包</option>
                                <option value="vial">瓶</option>
                                <option value="unit">单位</option>
                              </select>
                              <span style={{fontSize:13,color:'#374151'}}>，一共</span>
                              <input type="number" defaultValue={1} min={1} style={{ width: 72, padding: 6, borderRadius: 6, border: '1px solid #d1d5db' }} id={`days-${d.id}`} title="共几天" />
                              <span style={{fontSize:13,color:'#374151'}}>天</span>
                              <button className="btn-primary" onClick={() => {
                              const unitsEl = document.getElementById(`units-${d.id}`)
                              const timesEl = document.getElementById(`times-${d.id}`)
                              const daysEl = document.getElementById(`days-${d.id}`)
                              const unitTypeEl = document.getElementById(`unitType-${d.id}`)
                              const units = unitsEl ? parseInt(unitsEl.value || 1, 10) : 1
                              const times = timesEl ? parseInt(timesEl.value || 1, 10) : 1
                              const days = daysEl ? parseInt(daysEl.value || 1, 10) : 1
                              const unitType = unitTypeEl ? unitTypeEl.value : (d.unit || 'unit')
                              const qty = Math.max(1, (units || 1) * (times || 1) * (days || 1))
                              setMedicines((prev) => {
                                return [...prev, { id: d.id, name: d.name, price: d.price, unit: unitType, qty: qty, unitsPerDose: units, timesPerDay: times, days: days }]
                              })
                              // keep modal open so doctor can add multiple drugs quickly
                            }}>加入处方</button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
              {prescriptionImages.length>0 && (
                <div style={{marginTop:8,display:'flex',gap:8,flexWrap:'wrap'}}>
                  {prescriptionImages.map((u,idx)=>(<img key={idx} src={u} alt="pres" style={{height:64,borderRadius:6}} />))}
                </div>
              )}
              {medicines.length>0 && (
                <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:8}}>
                  {medicines.map((m,idx)=>(
                    <div key={idx} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:6,background:'#f8fafc',borderRadius:6}}>
                      <div>
                        <div style={{fontWeight:700}}>{m.name}</div>
                        <div style={{fontSize:12,color:'#6b7280'}}>数量: {m.qty || 1} · 单价: ¥{m.price || 0} · 小计: ¥{((m.price||0)*(m.qty||1)).toFixed(2)}</div>
                      </div>
                      <div style={{display:'flex',gap:8}}>
                        <button className="btn-ghost" onClick={()=>{
                          setMedicines(prev=>prev.filter((_,i)=>i!==idx))
                        }}>移除</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{marginTop:8}}>
                <label style={{fontSize:13,color:'#374151',marginRight:8}}>就诊费用：</label>
                <input type="number" value={visitFee} onChange={e=>setVisitFee(e.target.value)} placeholder="诊疗费" style={{padding:8,borderRadius:6,border:'1px solid #d1d5db',width:120}} />
              </div>
              <div style={{marginTop: 12, display: 'flex', gap: 12}}>
                <button className="btn-primary" onClick={submitPrescription}>提交处方</button>
                <button className="btn-secondary" onClick={() => setShowPrescription(false)}>取消</button>
              </div>
            </div>
          )}

          {/* 处方费用预览确认弹窗 */}
          {showPreview && presPayloadForPreview && (
            <div style={{position:'fixed',left:'50%',top:'15%',transform:'translateX(-50%)',background:'#fff',padding:20,borderRadius:8,boxShadow:'0 8px 28px rgba(0,0,0,0.18)',zIndex:1100,minWidth:420,maxWidth:'90%'}}>
              <div style={{fontWeight:700,fontSize:18,marginBottom:12}}>处方费用预览</div>
              <div style={{marginBottom:8}}>
                <div style={{fontWeight:600}}>药品小计：<span style={{fontWeight:700}}>¥{previewTotals.medsTotal.toFixed(2)}</span></div>
                <div style={{fontWeight:600}}>诊疗费：<span style={{fontWeight:700}}>¥{(previewTotals.visitFee||0).toFixed(2)}</span></div>
                <div style={{marginTop:8,fontSize:16}}>合计：<span style={{fontWeight:800,fontSize:18}}>¥{previewTotals.total.toFixed(2)}</span></div>
              </div>
              <div style={{maxHeight:240,overflow:'auto',marginBottom:12}}>
                <div style={{fontWeight:700,marginBottom:6}}>处方详情</div>
                <div style={{whiteSpace:'pre-wrap',marginBottom:8}}>{presPayloadForPreview.content}</div>
                {(presPayloadForPreview.medicines||[]).map((m, idx)=> {
                  const label = typeof m === 'string' ? m : (m.name ? `${m.name} — 每次 ${m.unitsPerDose || 1}${m.unit ? m.unit : ''} × ${m.timesPerDay || 1} 次/日 × ${m.days || 1} 天 = ${m.qty || 0}${m.unit ? m.unit : ''}` : JSON.stringify(m))
                  const subtotal = (parseFloat(m.price||0) * (parseFloat(m.qty||0))).toFixed(2)
                  return <div key={idx} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px dashed #eef2f6'}}><div>{label}</div><div style={{fontWeight:700}}>¥{subtotal}</div></div>
                })}
              </div>
              <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
                <button className="btn-secondary" onClick={()=>setShowPreview(false)}>取消</button>
                <button className="btn-primary" onClick={confirmSubmitPrescription}>确认并提交（支付后患者可见）</button>
              </div>
            </div>
          )}

          {/* 收费弹窗 */}
          {showBilling && (
            <div style={{background: '#fff', padding: 20, borderRadius: 8, marginBottom: 20, border: '1px solid #e5e7eb'}}>
              <h3>收费</h3>
              <div style={{display: 'flex', gap: 12, marginBottom: 12}}>
                <input
                  type="number"
                  placeholder="金额"
                  value={billing.amount}
                  onChange={e => setBilling({...billing, amount: e.target.value})}
                  style={{flex: 1, padding: 8, borderRadius: 4, border: '1px solid #d1d5db'}}
                />
                <input
                  type="text"
                  placeholder="费用描述"
                  value={billing.description}
                  onChange={e => setBilling({...billing, description: e.target.value})}
                  style={{flex: 3, padding: 8, borderRadius: 4, border: '1px solid #d1d5db'}}
                />
              </div>
              <div style={{display: 'flex', gap: 12}}>
                <button className="btn-primary" onClick={submitBilling}>提交收费</button>
                <button className="btn-secondary" onClick={() => setShowBilling(false)}>取消</button>
              </div>
            </div>
          )}

          {/* 聊天消息区域 */}
          <div style={{background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', boxSizing: 'border-box'}}>
            <h3 style={{fontSize: 20}}>实时沟通</h3>
            <div
              ref={messagesRef}
              style={{
                flex: 1,
                overflow: 'auto',
                marginTop: 16,
                padding: 12,
                background: '#f9fafb',
                borderRadius: 8,
                border: '1px solid #e5e7eb',
                minHeight: 0
              }}
            >
              {messages.length === 0 ? (
                <div style={{textAlign: 'center', color: '#6b7280', padding: 40}}>
                  暂无消息，开始与患者沟通吧
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} style={{
                    marginBottom: 16,
                    display: 'flex',
                    justifyContent: msg.role === 'doctor' ? 'flex-end' : 'flex-start'
                  }}>
                    {msg.type === 'prescription' ? (
                      <div style={{maxWidth: '80%', padding: 10, borderRadius: 12, background: '#fff', border: '1px solid #d1d5db', color: '#111827', cursor: 'pointer'}} onClick={()=>{
                        setLatestPrescription(msg)
                        setShowPrescriptionDetail(true)
                      }}>
                        <div style={{fontWeight:700, marginBottom:6}}>处方（点击查看）</div>
                        <div style={{whiteSpace:'pre-wrap', maxHeight: 120, overflow: 'hidden', color: '#111827'}}>{msg.content}</div>
                      </div>
                    ) : msg.type === 'billing' ? (
                      <div style={{maxWidth: '80%', padding: 10, borderRadius: 12, background: '#fff', border: '1px solid #d1d5db', color: '#111827'}}>
                        <div style={{fontWeight:700, marginBottom:6}}>收费：{msg.content}</div>
                        <div style={{fontSize:12,color:'#6b7280'}}>账单ID: {msg.billing_id || msg.billingId || ''}</div>
                      </div>
                    ) : msg.type === 'billing_paid' ? (
                      <div style={{maxWidth: '80%', padding: 10, borderRadius: 12, background: '#d1fae5', border: '1px solid #bbf7d0', color: '#065f46'}}>
                        <div style={{fontWeight:700}}>已完成支付</div>
                        <div style={{fontSize:12, marginTop:6}}>{msg.content}</div>
                      </div>
                    ) : (
                  <div style={{
                    maxWidth: '70%',
                    padding: 14,
                    borderRadius: 12,
                    background: msg.role === 'doctor' ? '#10b981' : '#f3f4f6',
                    color: msg.role === 'doctor' ? '#fff' : '#111827',
                    border: msg.role === 'doctor' ? 'none' : '1px solid #e5e7eb',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
                    fontSize: 15,
                    lineHeight: 1.4
                  }}>
                    <div style={{fontSize: 12, opacity: 0.8, marginBottom: 4}}>
                      {msg.role === 'doctor' ? '医生' : '患者'} · {new Date(msg.ts * 1000).toLocaleTimeString()}
                    </div>
                    {msg.type === 'image' ? (
                      <div>
                        <img src={msg.content} alt="图片" style={{maxWidth: '100%', borderRadius: 8}} />
                      </div>
                    ) : (
                      <div style={{whiteSpace: 'pre-wrap'}}>{msg.content}</div>
                    )}
                  </div>
                )}
                  </div>
                ))
              )}
            </div>

            {isChatBanned && (
              <div style={{marginBottom:12,padding:8,background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:6,color:'#7f1d1d'}}>该会话的聊天已被封禁，消息发送已被禁用。</div>
            )}
            <div style={{display: 'flex', gap: 12, alignItems: 'flex-end', marginTop: 16}}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="输入回复内容..."
                style={{
                  flex: 1,
                  minHeight: 80,
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  resize: 'vertical'
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (!isChatBanned) sendMessage()
                  }
                }}
                disabled={isChatBanned}
              />
              <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                <label className="btn-ghost" style={{padding: '8px 10px', borderRadius: 6, display: 'inline-block', cursor: 'pointer', textAlign: 'center'}}>
                  上传图片
                  <input type="file" accept="image/*" style={{display: 'none'}} onChange={async (e) => {
                    const f = e.target.files[0]; if (!f) return
                    const fd = new FormData(); fd.append('file', f)
                    try {
                      const up = await fetch(`${BASE}/upload-avatar`, { method: 'POST', body: fd })
                      const d = await up.json()
                      const url = d.url ? (d.url.startsWith('/') ? BASE + d.url : d.url) : null
                      if (isChatBanned) { alert('该会话已被封禁聊天，图片上传已取消。'); return }
                      if (url) {
                        const imgMsg = { id: Date.now().toString(36), role: 'doctor', content: url, type: 'image', ts: Math.floor(Date.now()/1000) }
                        setMessages(prev => [...prev, imgMsg])
                        await fetch(`${BASE}/cases/${caseId}/message`, {
                          method: 'POST',
                          headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + stored.token},
                          body: JSON.stringify({ message: imgMsg })
                        })
                        setTimeout(()=>{ if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight }, 120)
                      } else alert('上传失败')
                    } catch (err) { console.error(err); alert('上传失败') }
                  }} />
                </label>
                <button
                  className="btn-primary"
                  onClick={() => { if (!isChatBanned) sendMessage() }}
                  disabled={isChatBanned || sending || !input.trim()}
                  style={{height: 40, minWidth: 80}}
                >
                  {sending ? '发送中...' : '发送'}
                </button>
              </div>
            </div>
            {/* 处方详情弹窗（医生端查看） */}
            {showPrescriptionDetail && latestPrescription && (
              <div style={{position:'fixed',left:'50%',top:'4%',transform:'translateX(-50%)',background:'#fff',padding:32,borderRadius:12,boxShadow:'0 14px 40px rgba(0,0,0,0.18)',zIndex:1000,minWidth:760,maxWidth:'96%',maxHeight:'92vh',overflow:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div style={{fontWeight:700,fontSize:18}}>处方详情</div>
                  <div style={{fontSize:12,color:'#6b7280'}}>{latestPrescription.doctor ? `医生：${latestPrescription.doctor}` : ''} {latestPrescription.created_at ? new Date(latestPrescription.created_at*1000).toLocaleString() : latestPrescription.ts ? new Date(latestPrescription.ts*1000).toLocaleString() : ''}</div>
                </div>
                <div style={{whiteSpace:'pre-wrap',marginBottom:12, color:'#111827'}}>{latestPrescription.content}</div>
                    {latestPrescription.medicines && latestPrescription.medicines.length > 0 && (
                <div style={{marginBottom:12}}>
                  <div style={{fontWeight:700,marginBottom:6}}>药物清单</div>
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
                  <button className="btn-secondary" onClick={()=>setShowPrescriptionDetail(false)}>关闭</button>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* 右侧患者信息 */}
        <div style={{width: '100%', minWidth: 320}}>
          <div style={{background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb', height: '100%', overflow: 'auto', boxSizing: 'border-box'}}>
            <h3>患者信息</h3>
            <div style={{marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px'}}>
              <div><strong>用户名：</strong>{consultation?.owner || '未知'}</div>
              <div><strong>状态：</strong>{consultation?.status === 'active' ? '进行中' : consultation?.status}</div>
              <div><strong>性别：</strong>{patientInfo?.gender || '未填写'}</div>
              <div><strong>出生日期：</strong>{patientInfo?.birthday || '未填写'}</div>
              <div><strong>身高：</strong>{patientInfo?.height ? `${patientInfo.height}cm` : '未填写'}</div>
              <div><strong>体重：</strong>{patientInfo?.weight ? `${patientInfo.weight}kg` : '未填写'}</div>
              <div><strong>血型：</strong>{patientInfo?.blood_type || '未填写'}</div>
              <div><strong>创建时间：</strong>{consultation?.created_at ? new Date(consultation.created_at * 1000).toLocaleString() : '未知'}</div>
              {patientInfo?.chronic && (
                <div style={{gridColumn: 'span 2'}}>
                  <strong>慢性病：</strong>
                  <div style={{marginTop: 4, padding: 8, background: '#fef3c7', borderRadius: 4}}>
                    {patientInfo.chronic}
                  </div>
                </div>
              )}
              {patientInfo?.medications && (
                <div style={{gridColumn: 'span 2'}}>
                  <strong>正在服用药物：</strong>
                  <div style={{marginTop: 4, padding: 8, background: '#f9fafb', borderRadius: 4}}>
                    {patientInfo.medications}
                  </div>
                </div>
              )}
              {patientInfo?.allergies && (
                <div style={{gridColumn: 'span 2'}}>
                  <strong>过敏史：</strong>
                  <div style={{marginTop: 4, padding: 8, background: '#fee2e2', borderRadius: 4}}>
                    {patientInfo.allergies}
                  </div>
                </div>
              )}
              {patientInfo?.medical_history && (
                <div style={{gridColumn: 'span 2'}}>
                  <strong>病史：</strong>
                  <div style={{marginTop: 4, padding: 8, background: '#f9fafb', borderRadius: 4, whiteSpace: 'pre-wrap'}}>
                    {patientInfo.medical_history}
                  </div>
                </div>
              )}
              {patientInfo?.emergency_name && (
                <div><strong>紧急联系人：</strong>{patientInfo.emergency_name}</div>
              )}
              {patientInfo?.emergency_phone && (
                <div><strong>紧急联系电话：</strong>{patientInfo.emergency_phone}</div>
              )}
              {patientInfo?.insurance && (
                <div style={{gridColumn: 'span 2'}}>
                  <strong>保险信息：</strong>{patientInfo.insurance}
                </div>
              )}
              {consultation?.symptoms && (
                <div style={{gridColumn: 'span 2'}}>
                  <strong>本次症状描述：</strong>
                  <div style={{marginTop: 4, padding: 8, background: '#f9fafb', borderRadius: 4}}>
                    {consultation.symptoms}
                  </div>
                </div>
              )}
              {consultation?.diagnosis && (
                <div style={{gridColumn: 'span 2'}}>
                  <strong>诊断结果：</strong>
                  <div style={{marginTop: 4, padding: 8, background: '#d1fae5', borderRadius: 4}}>
                    {consultation.diagnosis}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}