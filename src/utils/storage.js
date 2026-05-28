const CHATS_KEY = "react_medical_chats_v1";
const CURRENT_CHAT_KEY = "react_medical_current_chat_v1";

export function loadChats() {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function saveChats(chats) {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch (e) {
    console.error('保存失败:', e);
  }
}

export function createChat(title = "新聊天") {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  return { id, title, messages: [] };
}

export function addMessageToChat(chats, chatId, message) {
  const idx = chats.findIndex(c => c.id === chatId);
  if (idx === -1) return chats;
  // avoid mutating caller state: create shallow copies
  const nextChats = chats.map(c => ({ ...c, messages: c.messages ? [...c.messages] : [] }));
  nextChats[idx].messages.push(message);
  return nextChats;
}

export function saveCurrentChatId(id) {
  try {
    if (id) localStorage.setItem(CURRENT_CHAT_KEY, id);
    else localStorage.removeItem(CURRENT_CHAT_KEY);
  } catch (e) {}
}

export function loadCurrentChatId() {
  try {
    return localStorage.getItem(CURRENT_CHAT_KEY);
  } catch (e) {
    return null;
  }
}

/** 更新某个聊天的标题 */
export function updateChatTitle(chats, chatId, newTitle) {
  const idx = chats.findIndex(c => c.id === chatId);
  if (idx === -1) return chats;
  const next = chats.map((c, i) => i === idx ? { ...c, title: newTitle || c.title } : { ...c });
  return next;
}

/** 删除某个聊天 */
export function deleteChat(chats, chatId) {
  return chats.filter(c => c.id !== chatId);
}

