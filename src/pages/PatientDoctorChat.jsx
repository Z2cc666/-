import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function PatientDoctorChat() {
  const { caseId } = useParams()
  const stored = getStoredAuth()
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [consultation, setConsultation] = useState(null)
  const [doctorInfo, setDoctorInfo] = useState(null)
  const messagesRef = useRef(null)
  const intervalRef = useRef(null)
  const [isNearBottom, setIsNearBottom] = useState(true)

  useEffect(() => {
    if (!stored || stored.user_type !== 'patient') {
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
    // 智能滚动逻辑：只有当用户在底部附近时才自动滚动
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
      // 优先使用 /appointments/:aid/chat API（通过预约ID访问）
      const resp = await fetch(`${BASE}/appointments/${caseId}/chat`, {
        headers: { 'Authorization': 'Bearer ' + stored.token }
      })
      if (resp.ok) {
        const data = await resp.json()
        setConsultation(data.appointment)
        setMessages(data.messages || [])
        // 如果有分配的医生，加载医生信息
        if (data.appointment?.assigned_doctor) {
          loadDoctorInfo(data.appointment.assigned_doctor)
        } else if (data.appointment?.doctor_username) {
          loadDoctorInfo(data.appointment.doctor_username)
        }
        setLoading(false)
        return
      }
      // 如果上述API失败（可能是旧版caseId），尝试原来的API
      const caseResp = await fetch(`${BASE}/cases/${caseId}`, {
        headers: { 'Authorization': 'Bearer ' + stored.token }
      })
      if (!caseResp.ok) return
      const caseData = await caseResp.json()
      setMessages(caseData.messages || [])
      setConsultation(caseData)
      if (caseData.assigned_doctor) {
        loadDoctorInfo(caseData.assigned_doctor)
      }
      setLoading(false)
    } catch (e) {
      console.error('加载病例失败', e)
    }
  }

  async function loadDoctorInfo(doctorUsername) {
    if (!doctorUsername) return
    try {
      const resp = await fetch(`${BASE}/doctor-info/${doctorUsername}`)
      if (!resp.ok) return
      const data = await resp.json()
      setDoctorInfo(data)
    } catch (e) {
      console.error('加载医生信息失败', e)
    }
  }

  async function sendMessage() {
    if (!input.trim() || sending) return
    setSending(true)
    const userMsg = { id: Date.now().toString(36), role: 'patient', content: input, ts: Date.now() }
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

  if (loading) {
    return <div style={{padding: 40, textAlign: 'center'}}>加载中...</div>
  }

  return (
    <div className="chat-layout" style={{height: '100vh', padding: '20px'}}>
      <div style={{marginBottom: 16}}>
        <button onClick={() => navigate('/profile')} style={{background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 14}}>
          ← 返回
        </button>
      </div>
      <div style={{display: 'flex', height: 'calc(100vh - 100px)', gap: 20}}>
        {/* 左侧医生信息区域 */}
        <div style={{width: '35%', display: 'flex', flexDirection: 'column', gap: 20}}>
          {/* 医生信息区域 */}
          <div style={{background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb'}}>
            <h3>医生信息</h3>
            {doctorInfo ? (
              <div style={{marginTop: 16, display: 'grid', gridTemplateColumns: '1fr', gap: '8px'}}>
                <div><strong>姓名：</strong>{doctorInfo.display_name || doctorInfo.username}</div>
                <div><strong>医院：</strong>{doctorInfo.clinic || '未填写'}</div>
                <div><strong>专科：</strong>{doctorInfo.specialties || '未填写'}</div>
                <div><strong>职称：</strong>主治医师</div>
                <div><strong>执业证书：</strong>{doctorInfo.license_number || '未填写'}</div>
                {doctorInfo.bio && (
                  <div style={{gridColumn: 'span 1', marginTop: 12}}>
                    <strong>简介：</strong>
                    <div style={{marginTop: 4, padding: 8, background: '#f9fafb', borderRadius: 4, whiteSpace: 'pre-wrap'}}>
                      {doctorInfo.bio}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{color: '#6b7280', textAlign: 'center', padding: 20}}>
                暂无医生信息
              </div>
            )}
          </div>

          {/* 病例信息区域 */}
          <div style={{background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb'}}>
            <h3>问诊信息</h3>
            <div style={{marginTop: 16, display: 'grid', gridTemplateColumns: '1fr', gap: '8px'}}>
              <div><strong>状态：</strong>{consultation?.status === 'active' ? '进行中' : consultation?.status}</div>
              <div><strong>创建时间：</strong>{consultation?.created_at ? new Date(consultation.created_at * 1000).toLocaleString() : '未知'}</div>
              <div><strong>更新时间：</strong>{consultation?.updated_at ? new Date(consultation.updated_at * 1000).toLocaleString() : '未知'}</div>
              {consultation?.symptoms && (
                <div style={{marginTop: 8}}>
                  <strong>症状描述：</strong>
                  <div style={{marginTop: 4, padding: 8, background: '#f9fafb', borderRadius: 4}}>
                    {consultation.symptoms}
                  </div>
                </div>
              )}
              {consultation?.diagnosis && (
                <div style={{marginTop: 8}}>
                  <strong>诊断结果：</strong>
                  <div style={{marginTop: 4, padding: 8, background: '#d1fae5', borderRadius: 4}}>
                    {consultation.diagnosis}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div style={{background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb'}}>
            <h3>操作</h3>
            <div style={{display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16}}>
              <button className="btn-secondary" onClick={() => navigate('/my-orders')} style={{width: '100%'}}>
                返回问诊记录
              </button>
            </div>
          </div>
        </div>

        {/* 右侧聊天区域 */}
        <div style={{flex: 1, display: 'flex', flexDirection: 'column'}}>
          {/* 聊天消息区域 */}
          <div style={{background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb', flex: 1, display: 'flex', flexDirection: 'column'}}>
            <h3>与医生对话</h3>
            <div
              ref={messagesRef}
              style={{
                flex: 1,
                overflow: 'auto',
                marginTop: 16,
                padding: 12,
                background: '#f9fafb',
                borderRadius: 8,
                border: '1px solid #e5e7eb'
              }}
            >
              {messages.length === 0 ? (
                <div style={{textAlign: 'center', color: '#6b7280', padding: 40}}>
                  暂无消息，开始与医生沟通吧
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} style={{
                    marginBottom: 16,
                    display: 'flex',
                    justifyContent: msg.role === 'doctor' ? 'flex-start' : 'flex-end'
                  }}>
                    <div style={{
                      maxWidth: '70%',
                      padding: 12,
                      borderRadius: 12,
                      background: msg.role === 'doctor' ? '#f3f4f6' : '#10b981',
                      color: msg.role === 'doctor' ? '#111827' : '#fff',
                      border: msg.role === 'doctor' ? '1px solid #e5e7eb' : 'none',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}>
                      <div style={{fontSize: 12, opacity: 0.8, marginBottom: 4}}>
                        {msg.role === 'doctor' ? '医生' : '我'} · {new Date(msg.ts * 1000).toLocaleTimeString()}
                      </div>
                      <div>{msg.content}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

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
                    sendMessage()
                  }
                }}
              />
              <button
                className="btn-primary"
                onClick={sendMessage}
                disabled={sending || !input.trim()}
                style={{height: 40}}
              >
                {sending ? '发送中...' : '发送'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}