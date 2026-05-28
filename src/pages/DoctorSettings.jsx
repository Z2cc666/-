import React, { useEffect, useState } from 'react'
import { getStoredAuth } from '../utils/auth'
import { useNavigate } from 'react-router-dom'

const BASE = 'http://127.0.0.1:8080'

export default function DoctorSettings() {
  const auth = getStoredAuth()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')

  const [settings, setSettings] = useState({
    // 基本设置
    notification_email: '',
    work_start: '09:00',
    work_end: '18:00',
    accept_consultations: true,
    timezone: '',
    // 账户设置
    payment_account: '',
    payment_qrcode: '',
    // 隐私设置
    show_online_status: true,
    allow_review: true,
    // 通知设置
    email_consultation: true,
    email_prescription: true,
    email_billing: true,
  })
  const [uploadingQR, setUploadingQR] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const resp = await fetch(`${BASE}/doctor-settings`, { headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {} })
      if (resp.ok) {
        const data = await resp.json()
        setSettings(s => ({...s, ...(data.settings || {})}))
      }
    } catch (e) { console.error('load settings failed', e) }
    setLoading(false)
  }

  async function save() {
    setSaving(true)
    try {
      const resp = await fetch(`${BASE}/doctor-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}) },
        body: JSON.stringify(settings)
      })
      if (resp.ok) {
        alert('设置已保存')
      } else {
        const d = await resp.json().catch(() => ({}))
        alert(d.error || '保存失败')
      }
    } catch (e) {
      console.error(e)
      alert('网络错误')
    }
    setSaving(false)
  }

  async function uploadQRCode(file) {
    if (!file) return
    setUploadingQR(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const resp = await fetch(`${BASE}/upload-image`, { method: 'POST', body: fd })
      const d = await resp.json()
      if (d.url) {
        const url = d.url.startsWith('/') ? BASE + d.url : d.url
        setSettings(s => ({ ...s, payment_qrcode: url }))
      }
    } catch (e) {
      alert('上传失败')
    }
    setUploadingQR(false)
  }

  function SettingSection({ title, icon, children }) {
    return (
      <div style={{
        background: '#fff',
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: '1px solid #eee'
        }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <h3 style={{ margin: 0, fontSize: 16, color: '#1f2937' }}>{title}</h3>
        </div>
        {children}
      </div>
    )
  }

  function SettingRow({ label, desc, children }) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 0',
        borderBottom: '1px solid #f3f4f6'
      }}>
        <div>
          <div style={{ fontWeight: 500, color: '#374151' }}>{label}</div>
          {desc && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{desc}</div>}
        </div>
        <div style={{ flexShrink: 0 }}>{children}</div>
      </div>
    )
  }

  function Toggle({ checked, onChange, disabled }) {
    return (
      <button
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          border: 'none',
          background: checked ? '#10b981' : '#d1d5db',
          cursor: disabled ? 'not-allowed' : 'pointer',
          position: 'relative',
          transition: 'background 0.2s',
          opacity: disabled ? 0.6 : 1
        }}
      >
        <div style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          transition: 'left 0.2s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
        }} />
      </button>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ color: '#6b7280' }}>加载中...</div>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      {/* 页面标题 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚙️</span> 系统设置
          </h2>
          <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: 14 }}>管理您的个人信息和偏好设置</p>
        </div>
        <button className="btn-ghost" onClick={() => nav('/doctor/profile')}>
          ← 返回
        </button>
      </div>

      {/* Tab 切换 */}
      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: 20,
        background: '#f3f4f6',
        padding: 4,
        borderRadius: 10
      }}>
        {[
          { key: 'basic', label: '基本设置', icon: '🏠' },
          { key: 'account', label: '账户设置', icon: '💳' },
          { key: 'privacy', label: '隐私设置', icon: '🔒' },
          { key: 'notification', label: '通知设置', icon: '🔔' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              borderRadius: 8,
              background: activeTab === tab.key ? '#fff' : 'transparent',
              color: activeTab === tab.key ? '#1f2937' : '#6b7280',
              fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.2s',
              boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 基本设置 */}
      {activeTab === 'basic' && (
        <SettingSection title="工作设置" icon="🏠">
          <SettingRow label="接收在线求助" desc="开启后，患者可以向您发起求助">
            <Toggle
              checked={!!settings.accept_consultations}
              onChange={v => setSettings(s => ({ ...s, accept_consultations: v }))}
            />
          </SettingRow>

          <SettingRow label="工作时间段" desc="设置您的工作时间范围">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="time"
                value={settings.work_start}
                onChange={e => setSettings(s => ({ ...s, work_start: e.target.value }))}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
              />
              <span style={{ color: '#6b7280' }}>至</span>
              <input
                type="time"
                value={settings.work_end}
                onChange={e => setSettings(s => ({ ...s, work_end: e.target.value }))}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
              />
            </div>
          </SettingRow>

          <SettingRow label="通知邮箱" desc="用于接收系统通知和患者消息提醒">
            <input
              type="email"
              value={settings.notification_email || ''}
              onChange={e => setSettings(s => ({ ...s, notification_email: e.target.value }))}
              placeholder="your@email.com"
              style={{
                width: 240,
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: 14
              }}
            />
          </SettingRow>

          <SettingRow label="时区设置" desc="用于显示正确的时间">
            <input
              value={settings.timezone || ''}
              onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}
              placeholder="Asia/Shanghai"
              style={{
                width: 200,
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: 14
              }}
            />
          </SettingRow>
        </SettingSection>
      )}

      {/* 账户设置 */}
      {activeTab === 'account' && (
        <>
          <SettingSection title="收款方式" icon="💳">
            <SettingRow label="收款账户" desc="银行账号或支付宝账号">
              <input
                value={settings.payment_account || ''}
                onChange={e => setSettings(s => ({ ...s, payment_account: e.target.value }))}
                placeholder="请输入收款账户"
                style={{
                  width: 280,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #d1d5db',
                  fontSize: 14
                }}
              />
            </SettingRow>

            <SettingRow label="收款二维码" desc="上传微信/支付宝收款二维码">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {settings.payment_qrcode ? (
                  <div style={{ position: 'relative' }}>
                    <img
                      src={settings.payment_qrcode}
                      alt="收款码"
                      style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover' }}
                    />
                    <button
                      onClick={() => setSettings(s => ({ ...s, payment_qrcode: '' }))}
                      style={{
                        position: 'absolute',
                        top: -8,
                        right: -8,
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        border: 'none',
                        background: '#ef4444',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 12
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                <label style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  background: '#f3f4f6',
                  color: '#374151',
                  cursor: 'pointer',
                  fontSize: 14
                }}>
                  {uploadingQR ? '上传中...' : (settings.payment_qrcode ? '更换图片' : '上传图片')}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => uploadQRCode(e.target.files[0])}
                    disabled={uploadingQR}
                  />
                </label>
              </div>
            </SettingRow>
          </SettingSection>
        </>
      )}

      {/* 隐私设置 */}
      {activeTab === 'privacy' && (
        <SettingSection title="隐私控制" icon="🔒">
          <SettingRow label="显示在线状态" desc="允许患者看到您是否在线">
            <Toggle
              checked={!!settings.show_online_status}
              onChange={v => setSettings(s => ({ ...s, show_online_status: v }))}
            />
          </SettingRow>

          <SettingRow label="允许患者评价" desc="允许患者在咨询结束后对您进行评价">
            <Toggle
              checked={!!settings.allow_review}
              onChange={v => setSettings(s => ({ ...s, allow_review: v }))}
            />
          </SettingRow>
        </SettingSection>
      )}

      {/* 通知设置 */}
      {activeTab === 'notification' && (
        <SettingSection title="通知偏好" icon="🔔">
          <SettingRow label="新求助通知" desc="有新患者发起求助时发送邮件通知">
            <Toggle
              checked={!!settings.email_consultation}
              onChange={v => setSettings(s => ({ ...s, email_consultation: v }))}
            />
          </SettingRow>

          <SettingRow label="处方完成通知" desc="患者确认处方后发送邮件通知">
            <Toggle
              checked={!!settings.email_prescription}
              onChange={v => setSettings(s => ({ ...s, email_prescription: v }))}
            />
          </SettingRow>

          <SettingRow label="收款通知" desc="收到新订单付款时发送邮件通知">
            <Toggle
              checked={!!settings.email_billing}
              onChange={v => setSettings(s => ({ ...s, email_billing: v }))}
            />
          </SettingRow>
        </SettingSection>
      )}

      {/* 保存按钮 */}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 12,
        marginTop: 24,
        padding: '16px 0'
      }}>
        <button
          className="btn-secondary"
          onClick={load}
          disabled={saving}
          style={{ padding: '10px 24px' }}
        >
          重置
        </button>
        <button
          className="btn-primary"
          onClick={save}
          disabled={saving}
          style={{ padding: '10px 32px' }}
        >
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </div>
  )
}
