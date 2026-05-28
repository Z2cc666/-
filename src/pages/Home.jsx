import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ChatSidebar from '../components/ChatSidebar'
import MessageList from '../components/MessageList'
import { loadChats, saveChats, createChat, addMessageToChat, loadCurrentChatId, saveCurrentChatId, updateChatTitle, deleteChat } from '../utils/storage'

const ASK_API = 'http://127.0.0.1:8080/ask'

// 模型来源选项
const MODEL_OPTIONS = [
  { value: 'rag', label: '本地RAG检索' },
  { value: 'ds', label: 'DeepSeek' },
  { value: 'qwen', label: '千问' }
]

export default function Home({ auth }) {
  const navigate = useNavigate()
  const [chats, setChats] = useState([])
  const [current, setCurrent] = useState(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingImage, setPendingImage] = useState(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recognition, setRecognition] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [notificationsRead, setNotificationsRead] = useState(false)
  const [modelSource, setModelSource] = useState('rag') // 默认使用本地RAG
  const chatsRef = useRef(chats)
  const currentRef = useRef(current)
  const isLoadCalled = useRef(false)

  // 加载通知
  useEffect(() => {
    async function loadNotifications() {
      try {
        const resp = await fetch('http://127.0.0.1:8080/notifications')
        if (resp.ok) {
          const data = await resp.json()
          setNotifications(data)
        }
      } catch (_) {}
    }
    loadNotifications()
  }, [])

  function handleOpenNotifications() {
    setShowNotifications(!showNotifications)
    setNotificationsRead(true)
  }

  // 初始化语音识别
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      try {
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
        rec.onerror = (event) => {
          console.error('语音识别错误:', event.error)
          setIsRecording(false)
          if (event.error === 'not-allowed') {
            alert('请允许麦克风权限后重试')
          }
        }
        setRecognition(rec)
      } catch (e) {
        console.error('初始化语音识别失败:', e)
      }
    } else {
      console.warn('当前浏览器不支持 Web Speech API')
    }
  }, [])

  function startRecording() {
    if (!recognition) {
      alert('您的浏览器不支持语音输入，请使用 Chrome 或 Edge 浏览器')
      return
    }
    try {
      // 每次开始前重新创建 recognition 对象
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
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
      rec.onerror = (event) => {
        console.error('语音识别错误:', event.error)
        setIsRecording(false)
        if (event.error === 'not-allowed') {
          alert('请允许麦克风权限后重试')
        }
      }
      rec.start()
      setRecognition(rec)
      setIsRecording(true)
    } catch (e) {
      console.error('启动语音识别失败:', e)
      alert('启动语音识别失败，请刷新页面后重试')
    }
  }

  function stopRecording() {
    if (recognition) {
      try {
        recognition.stop()
      } catch (e) {
        console.error('停止语音识别失败:', e)
      }
      setIsRecording(false)
    }
  }

  // 初始化加载聊天记录
  useEffect(() => {
    if (isLoadCalled.current) return // 防止重复执行
    isLoadCalled.current = true
    
    const cs = loadChats()
    if (cs.length === 0) {
      const c = createChat('新聊天')
      cs.push(c)
    }
    setChats(cs)
    const last = loadCurrentChatId()
    const currentId = last || cs[0]?.id
    setCurrent(currentId)
    setIsLoaded(true)
  }, [])
  // 保存聊天记录到 localStorage（当加载完成后）
  useEffect(() => {
    if (!isLoaded) return
    // 只在加载完成后再保存一次，确保数据不丢失
    saveChats(chats)
    saveCurrentChatId(current)
  }, [chats, current, isLoaded])

  // when user logs in (auth becomes available), fetch server-stored cases
  // 只在登录后首次加载时合并本地和服务器数据
  useEffect(() => {
    if (!isLoaded) return  // 等本地加载完成后再处理
    if (!auth?.token || !auth?.username) return
    
    async function loadServerCases() {
      // 先获取本地数据
      const localChats = loadChats()
      
      try {
        const resp = await fetch(`http://127.0.0.1:8080/users/${auth.username}/cases`, {
          headers: { Authorization: 'Bearer ' + auth.token }
        })
        if (!resp.ok) return
        const data = await resp.json()
        
        if (data?.cases && data.cases.length) {
          // 只有在本地没有任何消息时才使用服务器数据
          const hasLocalMessages = localChats.some(c => c.messages && c.messages.length > 0)
          if (!hasLocalMessages && localChats.length > 0) {
            setChats(data.cases)
            setCurrent(data.cases[0].id)
            saveChats(data.cases)
            saveCurrentChatId(data.cases[0].id)
          }
        }
      } catch (e) {
        console.warn('加载服务器会话失败', e)
      }
    }
    loadServerCases()
  }, [auth, isLoaded])

  // keep refs in sync for unload handlers
  useEffect(() => { chatsRef.current = chats }, [chats])
  useEffect(() => { currentRef.current = current }, [current])

  // persist on page unload or when tab becomes hidden (best-effort)
  useEffect(() => {
    const persistNow = () => {
      try {
        saveChats(chatsRef.current)
        saveCurrentChatId(currentRef.current)
      } catch (e) {}
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') persistNow() }
    window.addEventListener('beforeunload', persistNow)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', persistNow)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  function handleNew() {
    const c = createChat('新聊天')
    const ns = [c, ...chats]
    setChats(ns)
    setCurrent(c.id)
    saveChats(ns)
    saveCurrentChatId(c.id)
  }

  function handleSelect(id) {
    setCurrent(id)
    saveCurrentChatId(id)
  }

  /** 根据首条用户消息生成聊天标题 */
  function getAutoTitle(msg) {
    if (msg.type === 'image') return '图片问诊'
    const text = (msg.content || '').trim().replace(/\s+/g, ' ')
    if (!text) return '新聊天'
    return text.length > 20 ? text.slice(0, 20) + '…' : text
  }

  function handleDeleteChat(chatId, e) {
    e?.stopPropagation?.()
    if (!confirm('确定要删除这条聊天记录吗？')) return
    const next = deleteChat(chats, chatId)
    setChats(next)
    saveChats(next)
    if (current === chatId) {
      const nextId = next[0]?.id ?? null
      setCurrent(nextId)
      saveCurrentChatId(nextId)
    }
  }

  function handleRenameChat(chatId, e) {
    e?.stopPropagation?.()
    const chat = chats.find(c => c.id === chatId)
    if (!chat) return
    const newTitle = prompt('修改聊天名称：', chat.title || '新聊天')
    if (newTitle == null || newTitle === chat.title) return
    const next = updateChatTitle(chats, chatId, newTitle.trim() || chat.title)
    setChats(next)
    saveChats(next)
  }

  async function handleSend() {
    if (!input.trim() && !pendingImage && !current) return

    // 如果有待发送的图片，先发送图片消息
    if (pendingImage && current) {
      const imgMsg = { id: Date.now().toString(36), role: 'user', content: pendingImage, type: 'image', ts: Date.now() }
      let updated = addMessageToChat([...chats], current, imgMsg)
      const cur = updated.find(c => c.id === current)
      if (cur && (cur.title === '新聊天' || !cur.title) && cur.messages.length === 1) {
        updated = updateChatTitle(updated, current, input.trim() ? (input.trim().length > 20 ? input.trim().slice(0, 20) + '…' : input.trim()) : '图片问诊')
      }
      const botId = (Date.now()+1).toString(36)
      const botMsg = { id: botId, role: 'bot', content: '', ts: Date.now() }
      const updatedWithBot = addMessageToChat(updated, current, botMsg)
      setChats(updatedWithBot)
      saveChats(updatedWithBot)
      setPendingImage(null)
      setInput('')
      setLoading(true)

      try {
        // 调用图片分析 API
        const fd = new FormData()
        // 将 base64 URL 转换回文件
        const imgResp = await fetch(pendingImage)
        const blob = await imgResp.blob()
        fd.append('file', blob, 'image.jpg')
        fd.append('question', input.trim() || '请分析这张图片中的医学内容并给出建议')

        const resp = await fetch('http://127.0.0.1:8080/ask_image_stream', { method: 'POST', body: fd })
        if (!resp.body) throw new Error('no stream')

        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let done = false
        let acc = ''

        while (!done) {
          const { value, done: d } = await reader.read()
          done = d
          if (value) {
            acc += decoder.decode(value)
            setChats(prev => {
              const next = prev.map(c => ({ ...c, messages: c.messages.map(m => ({ ...m })) }))
              const chat = next.find(c => c.id === current)
              if (!chat) return prev
              const m = chat.messages.find(m => m.id === botId)
              if (m) m.content = acc
              try { saveChats(next) } catch (e) {}
              return next
            })
          }
        }
      } catch (e) {
        setChats(prev => {
          const next = prev.map(c => ({ ...c, messages: c.messages.map(m => ({ ...m })) }))
          const chat = next.find(c => c.id === current)
          if (!chat) return prev
          const m = chat.messages.find(m => m.id === botId)
          if (m) m.content = '网络错误'
          return next
        })
      } finally {
        setLoading(false)
      }
      return
    }

    // 纯文本消息
    const msg = { id: Date.now().toString(36), role: 'user', content: input, ts: Date.now() }
    let updated = addMessageToChat([...chats], current, msg)
    const cur = updated.find(c => c.id === current)
    if (cur && (cur.title === '新聊天' || !cur.title) && cur.messages.length === 1) {
      updated = updateChatTitle(updated, current, getAutoTitle(msg))
    }
    const botId = (Date.now()+1).toString(36)
    const botMsg = { id: botId, role: 'bot', content: '', ts: Date.now() }
    const updatedWithBot = addMessageToChat(updated, current, botMsg)
    setChats(updatedWithBot)
    saveChats(updatedWithBot)
    setInput('')
    setLoading(true)
    
    // 获取当前聊天的历史消息（用于上下文关联）
    const currentChat = chats.find(c => c.id === current)
    const history = currentChat?.messages
      ?.filter(m => m.role && m.content)
      ?.slice(-10)  // 只取最近10条消息，避免超出token限制
      ?.map(m => ({ role: m.role, content: m.content })) || []
    
    try {
      const resp = await fetch(ASK_API.replace('/ask','/ask_stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}) },
        body: JSON.stringify({ question: msg.content, history: history, source: modelSource })
      })
      if (!resp.body) throw new Error('no stream')
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      let acc = ''
      while (!done) {
        const { value, done: d } = await reader.read()
        done = d
        if (value) {
          acc += decoder.decode(value)
          setChats(prev => {
            const next = prev.map(c => ({ ...c, messages: c.messages.map(m => ({ ...m })) }))
            const chat = next.find(c => c.id === current)
            if (!chat) return prev
            const m = chat.messages.find(m => m.id === botId)
            if (m) m.content = acc
            try { saveChats(next) } catch (e) {}
            return next
          })
        }
      }
      try { saveChats(chatsRef.current) } catch (e) {}
      try {
        if (auth?.token && auth?.username) {
          const currentChat = (chatsRef.current || []).find(c => c.id === currentRef.current)
          if (currentChat) {
            await fetch(`http://127.0.0.1:8080/cases`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.token },
              body: JSON.stringify(currentChat)
            })
          }
        }
      } catch (e) {
        console.warn('同步会话到服务器失败', e)
      }
    } catch (e) {
      setChats(prev => {
        const next = prev.map(c => ({ ...c, messages: c.messages.map(m => ({ ...m })) }))
        const chat = next.find(c => c.id === current)
        if (!chat) return prev
        const m = chat.messages.find(m => m.id === botId)
        if (m) m.content = '网络错误'
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  const currentChat = chats.find(c => c.id === current) || { messages: [] }

  return (
    <div className="home-page-bg">
      <div className="chat-layout">
        <ChatSidebar chats={chats} currentId={current} onSelect={handleSelect} onNew={handleNew} onDelete={handleDeleteChat} onRename={handleRenameChat} />
        <section className="chat-area">

          <div className="chat-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center', gap: 12}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <button onClick={() => navigate('/profile')} style={{background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 14}}>
                ← 返回
              </button>
              <span>医疗问诊</span>
            </div>
            {notifications.length > 0 && (
              <button
                onClick={handleOpenNotifications}
                style={{position:'relative',background:'none',border:'none',cursor:'pointer',fontSize:22,padding:4}}
                title="查看通知"
              >
                🔔
                {!notificationsRead && notifications.filter(n => n.is_pinned).length > 0 && (
                  <span style={{position:'absolute',top:0,right:0,background:'#ef4444',color:'white',borderRadius:'50%',width:16,height:16,fontSize:10,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    {notifications.filter(n => n.is_pinned).length}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* 通知面板 */}
          {showNotifications && (
            <div style={{position:'absolute',top:50,right:10,background:'white',borderRadius:12,boxShadow:'0 4px 20px rgba(0,0,0,0.15)',width:360,maxHeight:400,overflow:'auto',zIndex:100,padding:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <strong style={{fontSize:16}}>通知公告</strong>
                <button onClick={() => setShowNotifications(false)} style={{background:'none',border:'none',cursor:'pointer',fontSize:18}}>×</button>
              </div>
              {notifications.map(n => (
                <div key={n.id} style={{padding:'10px 0',borderBottom:'1px solid #f3f4f6'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                    {n.is_pinned && <span style={{color:'#f59e0b'}}>📌</span>}
                    <strong style={{fontSize:14}}>{n.title}</strong>
                  </div>
                  <p style={{margin:0,fontSize:13,color:'#6b7280',whiteSpace:'pre-wrap'}}>{n.content}</p>
                  <div style={{fontSize:11,color:'#9ca3af',marginTop:4}}>
                    {n.created_at ? new Date(n.created_at * 1000).toLocaleDateString('zh-CN') : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          <MessageList messages={currentChat.messages} />
          <div className="chat-composer">
            <div style={{display:'flex',flexDirection:'column',gap:8,flex:1}}>
              {/* 待发送的图片预览 */}
              {pendingImage && (
                <div style={{position: 'relative', display: 'inline-block', maxWidth: '200px'}}>
                  <img src={pendingImage} alt="待发送" style={{maxWidth: '100%', borderRadius: 8, border: '2px solid #4CAF50'}} />
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
              <textarea value={input} onChange={e=>setInput(e.target.value)} placeholder={pendingImage ? "请输入你的问题..." : "请输入你的问题..."} />
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <label className="btn-ghost" style={{display:'inline-flex',alignItems:'center',gap:8}}>
                  上传图片
                  <input type="file" accept="image/*" style={{display:'none'}} onChange={async (e)=>{
                    const f = e.target.files[0]
                    if (!f) return
                    const fd = new FormData()
                    fd.append('file', f)
                    try {
                      // 只上传图片，不分析
                      const resp = await fetch('http://127.0.0.1:8080/upload-image', { method: 'POST', body: fd })
                      const d = await resp.json()
                      if (d.error) { alert('上传失败: ' + d.error); return }
                      const url = d.url ? (d.url.startsWith('/') ? 'http://127.0.0.1:8080'+d.url : d.url) : null
                      if (url && current) {
                        // 保存待发送的图片URL
                        setPendingImage(url)
                      }
                    } catch (err) { console.error(err); alert('上传失败') }
                  }} />
                </label>

                {/* 语音输入按钮 */}
                {isRecording ? (
                  <button className="btn-ghost" onClick={stopRecording} style={{display:'inline-flex',alignItems:'center',gap:8,background:'#ff5722',color:'white'}}>
                    🎙️ 停止录音
                  </button>
                ) : (
                  <button className="btn-ghost" onClick={startRecording} style={{display:'inline-flex',alignItems:'center',gap:8}}>
                    🎤 语音输入
                  </button>
                )}

                {/* 模型选择 */}
                <select
                  value={modelSource}
                  onChange={e => setModelSource(e.target.value)}
                  style={{
                    padding: '8px 12px',
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

                <button className="btn-primary" onClick={handleSend} disabled={loading}>{loading ? '等待...' : '发送'}</button>

                <button className="btn-ghost" onClick={()=>{
                  if (!current) return
                  navigate(`/request-consultation?chatId=${current}`)
                }}>求助医生问诊</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}


