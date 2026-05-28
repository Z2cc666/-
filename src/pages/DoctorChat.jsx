import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

// 模型来源选项
const MODEL_OPTIONS = [
  { value: 'ds', label: 'DeepSeek' },
  { value: 'qwen', label: '千问' },
  { value: 'rag', label: '本地RAG检索' }
]

export default function DoctorChat() {
  const stored = getStoredAuth()
  const navigate = useNavigate()
  const [messages, setMessages] = useState([]) // {role, text}
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [consultations, setConsultations] = useState([])
  const [selectedCaseId, setSelectedCaseId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [pendingImage, setPendingImage] = useState(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recognition, setRecognition] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [notificationsRead, setNotificationsRead] = useState(false)
  const [modelSource, setModelSource] = useState('ds') // 默认使用 DeepSeek
  const fileInputRef = useRef(null)
  const listRef = useRef(null)

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

  // 打开通知时标记为已读
  function handleOpenNotifications() {
    setShowNotifications(!showNotifications)
    setNotificationsRead(true)
  }

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    loadConsultations()
    // 初始化语音识别
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      const rec = new SpeechRecognition()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'zh-CN'
      rec.onresult = (event) => {
        let transcript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript
        }
        setInput(transcript)
      }
      rec.onend = () => setIsRecording(false)
      rec.onerror = () => setIsRecording(false)
      setRecognition(rec)
    }
  }, [])

  function startRecording() {
    if (!recognition) {
      alert('您的浏览器不支持语音输入')
      return
    }
    recognition.start()
    setIsRecording(true)
  }

  function stopRecording() {
    if (recognition) {
      recognition.stop()
      setIsRecording(false)
    }
  }

  useEffect(() => {
    loadConsultations()
  }, [])

  async function loadConsultations() {
    if (!stored) return
    try {
      const resp = await fetch(`${BASE}/doctor-consultations`, {
        headers: { 'Authorization': 'Bearer ' + (stored?.token || '') }
      })
      if (!resp.ok) return
      const data = await resp.json()
      // 只保留医生端创建的会话（医生提问）
      const doctorCases = (data || []).filter(c => c.owner === stored?.username)
      setConsultations(doctorCases)
    } catch (e) {
      console.error('加载接诊列表失败', e)
    }
  }

  async function loadCase(caseId) {
    try {
      const resp = await fetch(`${BASE}/cases/${caseId}`)
      if (!resp.ok) return
      const d = await resp.json()
      setMessages(d.messages || [])
      setSelectedCaseId(caseId)
    } catch (e) {
      console.error('加载会话失败', e)
    }
  }

  async function deleteConsultation(caseId, e) {
    e.stopPropagation()
    if (!confirm('确定要删除这条对话吗？')) return
    try {
      const resp = await fetch(`${BASE}/cases/${caseId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + (stored?.token || '')
        }
      })
      if (resp.ok) {
        setConsultations(prev => prev.filter(c => c.id !== caseId))
        if (selectedCaseId === caseId) {
          setMessages([])
          setSelectedCaseId(null)
        }
      }
    } catch (e) {
      console.error('删除失败', e)
    }
  }

  function startEdit(c, e) {
    e.stopPropagation()
    setEditingId(c.id)
    setEditingTitle(c.title || '病例咨询')
  }

  async function saveEdit(e) {
    e.stopPropagation()
    if (!editingTitle.trim() || !editingId) return
    try {
      const resp = await fetch(`${BASE}/cases/${editingId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (stored?.token || '')
        },
        body: JSON.stringify({ title: editingTitle.trim() })
      })
      if (resp.ok) {
        setConsultations(prev => prev.map(c =>
          c.id === editingId ? { ...c, title: editingTitle.trim() } : c
        ))
        setEditingId(null)
        setEditingTitle('')
      }
    } catch (e) {
      console.error('编辑失败', e)
    }
  }

  function cancelEdit(e) {
    e.stopPropagation()
    setEditingId(null)
    setEditingTitle('')
  }

  async function uploadImage(file) {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const resp = await fetch(`${BASE}/upload-image`, { method: 'POST', body: fd })
      const d = await resp.json()
      if (d.error) { alert('上传失败: ' + d.error); return null }
      return d.url ? (d.url.startsWith('/') ? BASE + d.url : d.url) : null
    } catch (err) {
      console.error(err)
      alert('上传失败')
      return null
    }
  }

  async function handleSend() {
    const text = input.trim()
    const hasImage = !!pendingImage

    if (!text && !hasImage) return

    setSending(true)
    setInput('')

    try {
      let botText = ''

      if (hasImage) {
        // 先发送图片消息
        const imgMsg = { role: 'user', content: pendingImage, type: 'image', ts: Date.now() }
        setMessages(m => [...m, imgMsg, { role: 'assistant', text: '' }])

        // 调用图片分析 API
        const fd = new FormData()
        const imgResp = await fetch(pendingImage)
        const blob = await imgResp.blob()
        fd.append('file', blob, 'image.jpg')
        fd.append('question', text || '请分析这张图片中的医学内容并给出建议')

        const resp = await fetch(`${BASE}/ask_image_stream`, { method: 'POST', body: fd })
        if (!resp.body) throw new Error('no stream')

        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let done = false
        let acc = ''

        while (!done) {
          const { value, done: d } = await reader.read()
          done = d
          if (value) {
            const chunk = decoder.decode(value)
            acc += chunk
            setMessages(m => {
              const copy = [...m]
              copy[copy.length - 1] = { role: 'assistant', text: acc }
              return copy
            })
          }
        }
        botText = acc
      } else {
        // 发送文本消息
        const userMsg = { role: 'user', text }
        setMessages(m => [...m, userMsg, { role: 'assistant', text: '' }])

        const resp = await fetch(`${BASE}/doctor-ask_stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (stored?.token || '')
          },
          body: JSON.stringify({ question: text, source: modelSource })
        })

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'error' }))
          setMessages(m => {
            const copy = [...m]
            copy[copy.length - 1] = { role: 'assistant', text: '请求失败：' + (err.error || resp.status) }
            return copy
          })
          setSending(false)
          return
        }

        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let done = false
        let acc = ''

        while (!done) {
          const { value, done: d } = await reader.read()
          done = d
          if (value) {
            const chunk = decoder.decode(value)
            acc += chunk
            setMessages(m => {
              const copy = [...m]
              copy[copy.length - 1] = { role: 'assistant', text: acc }
              return copy
            })
          }
        }
        botText = acc
      }

      // 保存到数据库
      const title = text.slice(0, 30) + (text.length > 30 ? '...' : (hasImage ? '图片问诊' : ''))
      await fetch(`${BASE}/cases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (stored?.token || '')
        },
        body: JSON.stringify({
          title: title || '图片问诊',
          messages: [...messages, ...(hasImage ? [{ role: 'user', content: pendingImage, type: 'image', ts: Date.now() }, { role: 'assistant', text: botText }] : [{ role: 'user', text }, { role: 'assistant', text: botText }])]
        })
      })
      setPendingImage(null)
      loadConsultations()
    } catch (e) {
      setMessages(m => {
        const copy = [...m]
        if (copy.length > 0) copy[copy.length - 1] = { role: 'assistant', text: '网络错误' }
        return copy
      })
    } finally {
      setSending(false)
    }
  }

  async function handleFileChange(e) {
    const f = e.target.files[0]
    if (!f) return
    const url = await uploadImage(f)
    if (url) setPendingImage(url)
    e.target.value = ''
  }

  return (
    <div className="chat-layout" style={{ height: '100vh', padding: '24px' }}>
      {/* 左侧历史会话 */}
      <div className="chat-sidebar" style={{
        width: 320, padding: '18px', background: 'rgba(255,255,255,0.95)',
        borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12
      }}>
        <div>
          <h3>历史会话</h3>
          <p style={{ color: '#47535b', margin: 0, fontSize: 13 }}>医生端提问记录</p>
        </div>
        <div style={{ flex: 1, overflow: 'auto', marginTop: 8 }}>
          {consultations.length === 0 ? (
            <div style={{ color: '#6b7280' }}>暂无会话</div>
          ) : (
            consultations.map(c => (
              <div
                key={c.id}
                onClick={() => loadCase(c.id)}
                style={{
                  padding: '10px',
                  borderRadius: 8,
                  marginBottom: 8,
                  background: c.id === selectedCaseId ? 'linear-gradient(90deg,#e6ffef,#f0fff7)' : '#fff',
                  cursor: 'pointer',
                  border: '1px solid rgba(2,6,23,0.04)',
                  position: 'relative'
                }}
              >
                {editingId === c.id ? (
                  <div onClick={e => e.stopPropagation()}>
                    <input
                      value={editingTitle}
                      onChange={e => setEditingTitle(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: '1px solid #d1d5db',
                        marginBottom: 6,
                        fontSize: 13
                      }}
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && saveEdit(e)}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={saveEdit}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 4,
                          border: 'none',
                          background: '#10b981',
                          color: '#fff',
                          fontSize: 12,
                          cursor: 'pointer'
                        }}
                      >
                        保存
                      </button>
                      <button
                        onClick={cancelEdit}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 4,
                          border: 'none',
                          background: '#9ca3af',
                          color: '#fff',
                          fontSize: 12,
                          cursor: 'pointer'
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{
                      fontWeight: 600,
                      fontSize: 14,
                      marginBottom: 4,
                      paddingRight: 50
                    }}>
                      {c.title || '病例咨询'}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {new Date((c.created_at || 0) * 1000).toLocaleString()}
                    </div>
                    <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
                      <button
                        onClick={(e) => startEdit(c, e)}
                        title="编辑"
                        style={{
                          padding: '4px 6px',
                          borderRadius: 4,
                          border: 'none',
                          background: '#f3f4f6',
                          color: '#6b7280',
                          fontSize: 12,
                          cursor: 'pointer'
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={(e) => deleteConsultation(c.id, e)}
                        title="删除"
                        style={{
                          padding: '4px 6px',
                          borderRadius: 4,
                          border: 'none',
                          background: '#fef2f2',
                          color: '#ef4444',
                          fontSize: 12,
                          cursor: 'pointer'
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
        <div style={{ marginTop: 8 }}>
          <button className="btn-primary" onClick={() => { setMessages([]); setSelectedCaseId(null); setPendingImage(null); }}>
            新建对话
          </button>
        </div>
      </div>

      {/* 右侧聊天区域 */}
      <div className="chat-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0 }}>AI 智能问答</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {notifications.length > 0 && (
              <button
                onClick={handleOpenNotifications}
                style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, padding: 4 }}
                title="查看通知"
              >
                🔔
                {!notificationsRead && notifications.filter(n => n.is_pinned).length > 0 && (
                  <span style={{ position: 'absolute', top: 0, right: 0, background: '#ef4444', color: 'white', borderRadius: '50%', width: 16, height: 16, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {notifications.filter(n => n.is_pinned).length}
                  </span>
                )}
              </button>
            )}
            <button className="btn-secondary" onClick={() => navigate('/doctor/profile')} style={{ marginRight: 8 }}>
              返回个人中心
            </button>
          </div>
        </div>

        {/* 通知面板 */}
        {showNotifications && (
          <div style={{ position: 'absolute', top: 80, right: 20, background: 'white', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', width: 360, maxHeight: 400, overflow: 'auto', zIndex: 100, padding: 16 }}>
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

        {/* 消息列表 */}
        <div className="chat-list-panel" ref={listRef} style={{
          overflow: 'auto',
          padding: 12,
          background: 'rgba(255,255,255,0.9)',
          borderRadius: 12,
          flex: 1
        }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: 40 }}>
              输入问题开始 AI 问答，支持语音输入和图片分析
            </div>
          )}
          {messages.map((m, idx) => (
            <div key={idx} className={`message-row ${m.role === 'user' ? 'user' : ''}`}>
              {m.type === 'image' ? (
                <div className="bubble">
                  <img src={m.content} alt="图片" style={{ maxWidth: 300, maxHeight: 300, borderRadius: 8 }} />
                </div>
              ) : (
                <div className="bubble">{m.text}</div>
              )}
            </div>
          ))}
        </div>

        {/* 待发送图片预览 */}
        {pendingImage && (
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: 200 }}>
            <img src={pendingImage} alt="待发送" style={{ maxWidth: '100%', borderRadius: 8, border: '2px solid #4CAF50' }} />
            <button
              onClick={() => setPendingImage(null)}
              style={{
                position: 'absolute', top: -8, right: -8, borderRadius: '50%',
                width: 24, height: 24, border: 'none', background: '#f44336',
                color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
              title="取消图片"
            >
              ×
            </button>
          </div>
        )}

        {/* 输入区域 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* 图片上传按钮 */}
            <label style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: 'none',
              background: pendingImage ? '#e6ffef' : '#f3f4f6',
              color: pendingImage ? '#10b981' : '#6b7280',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 14
            }}>
              {pendingImage ? '✓ 已选图片' : '📷 图片'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </label>

            {/* 语音输入按钮 */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: 'none',
                background: isRecording ? '#ef4444' : '#f3f4f6',
                color: isRecording ? '#fff' : '#6b7280',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14,
                transition: 'all 0.2s'
              }}
              title={isRecording ? '停止录音' : '开始语音输入'}
            >
              {isRecording ? '🔴 停止' : '🎤 语音'}
            </button>

            {/* 模型选择 */}
            <select
              value={modelSource}
              onChange={e => setModelSource(e.target.value)}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#fff',
                fontSize: 14,
                cursor: 'pointer'
              }}
              title="选择AI模型来源"
            >
              {MODEL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={pendingImage ? "请输入关于图片的问题..." : "输入问题... (支持语音输入)"}
            style={{ flex: 1, minHeight: 80, padding: 12, borderRadius: 8 }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className="btn-primary"
              onClick={handleSend}
              disabled={sending || (!input.trim() && !pendingImage)}
            >
              {sending ? '发送中...' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


