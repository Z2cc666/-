import React from 'react'

export default function ChatSidebar({ chats, currentId, onSelect, onNew, onDelete, onRename }) {
  return (
    <aside className="chat-sidebar">
      <div className="sidebar-top">
        <button className="btn-new" onClick={onNew}>+ 新建聊天</button>
      </div>
      <ul className="chat-list">
        {chats.map(c => (
          <li
            key={c.id}
            className={`chat-item ${c.id === currentId ? 'active' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="chat-item-main">
              <div className="chat-title">{c.title || '未命名会话'}</div>
              <div className="chat-meta">{c.messages.length ? new Date(c.messages[c.messages.length - 1].ts).toLocaleString() : ''}</div>
            </div>
            <div className="chat-item-actions" onClick={e => e.stopPropagation()}>
              {onRename && (
                <button type="button" className="chat-btn chat-btn-rename" title="重命名" onClick={e => onRename(c.id, e)}>✎</button>
              )}
              {onDelete && (
                <button type="button" className="chat-btn chat-btn-delete" title="删除" onClick={e => onDelete(c.id, e)}>×</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}






