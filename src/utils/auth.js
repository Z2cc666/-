export function getStoredAuth() {
  const token = localStorage.getItem('auth_token')
  if (!token) return null
  return {
    token,
    username: localStorage.getItem('auth_user'),
    avatar: localStorage.getItem('auth_avatar'),
    user_type: localStorage.getItem('auth_user_type')
  }
}

export function saveAuth({ token, username, avatar, user_type }) {
  if (token) localStorage.setItem('auth_token', token)
  if (username) localStorage.setItem('auth_user', username)
  if (avatar) localStorage.setItem('auth_avatar', avatar)
  if (user_type) localStorage.setItem('auth_user_type', user_type)
}

export function clearAuth() {
  localStorage.removeItem('auth_token')
  localStorage.removeItem('auth_user')
  localStorage.removeItem('auth_avatar')
}



