import React from 'react'

function renderContent(m) {
  if (m.type === 'image' && m.content) {
    return <img src={m.content} alt="用户上传" className="msg-image" />
  }
  // simple linkify: detect URLs and render as link
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts = String(m.content || '').split(urlRegex)
  return parts.map((part, idx) => {
    if (urlRegex.test(part)) {
      return <a key={idx} href={part} target="_blank" rel="noreferrer">{part}</a>
    }
    return <span key={idx}>{part}</span>
  })
}

export default function MessageList({ messages }) {
  return (
    <div className="message-list-panel">
      {messages.map((m) => (
        <div key={m.id} className={`message-row ${m.role === 'user' ? 'user' : 'bot'}`}>
          <div
            className={`bubble ${m.role === 'bot' ? 'bubble-bot' : ''}`}
            style={m.type !== 'image' ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } : undefined}
          >
            {renderContent(m)}
          </div>
          <div className="meta">{m.ts ? new Date(m.ts).toLocaleTimeString() : ''}</div>
        </div>
      ))}
    </div>
  )
}



