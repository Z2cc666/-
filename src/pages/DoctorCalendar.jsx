import React, { useEffect, useState } from 'react'
import { getStoredAuth } from '../utils/auth'
import { useNavigate } from 'react-router-dom'

const BASE = 'http://127.0.0.1:8080'

function startOfWeekTs(refTs) {
  const d = new Date(refTs * 1000)
  const day = d.getDay() // 0 Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday start
  const monday = new Date(d.setDate(diff))
  monday.setHours(0,0,0,0)
  return Math.floor(monday.getTime()/1000)
}

function pad(n){ return String(n).padStart(2,'0') }
function formatDate(d, pattern='yyyy-MM-dd'){
  const dt = (d instanceof Date) ? d : new Date(d)
  const y = dt.getFullYear()
  const m = pad(dt.getMonth()+1)
  const day = pad(dt.getDate())
  if (pattern === 'yyyy-MM-dd') return `${y}-${m}-${day}`
  if (pattern === 'MM-dd EEE'){
    const wk = ['周日','周一','周二','周三','周四','周五','周六']
    return `${m}-${day} ${wk[dt.getDay()]}`
  }
  return `${y}-${m}-${day}`
}

export default function DoctorCalendar() {
  const auth = getStoredAuth()
  const navigate = useNavigate()
  const [baseTs, setBaseTs] = useState(Math.floor(Date.now()/1000))
  const [appointments, setAppointments] = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('appointments') // 'appointments' or 'schedules'
  const [selectedAppointment, setSelectedAppointment] = useState(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [newSchedule, setNewSchedule] = useState({
    date: '',
    start_time: '09:00',
    end_time: '10:00',
    max_appointments: 10
  })
  const [savingSchedule, setSavingSchedule] = useState(false)

  useEffect(()=>{ load() }, [baseTs, viewMode])

  async function load() {
    setLoading(true)
    try {
      if (viewMode === 'appointments') {
        const resp = await fetch(`${BASE}/doctor/appointments`, {
          headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}
        })
        if (!resp.ok) { setAppointments([]); setLoading(false); return }
        const data = await resp.json()
        setAppointments(data.appointments || [])
      } else {
        const resp = await fetch(`${BASE}/doctor/schedules`, {
          headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}
        })
        if (!resp.ok) { setSchedules([]); setLoading(false); return }
        const data = await resp.json()
        setSchedules(data.schedules || [])
      }
    } catch (e) {
      console.error('load failed', e)
      setAppointments([])
      setSchedules([])
    } finally {
      setLoading(false)
    }
  }

  async function handleAddSchedule() {
    if (!newSchedule.date) {
      alert('请选择日期')
      return
    }
    setSavingSchedule(true)
    try {
      const resp = await fetch(`${BASE}/doctor/schedules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + auth.token
        },
        body: JSON.stringify(newSchedule)
      })
      const data = await resp.json()
      if (resp.ok) {
        alert('排班添加成功')
        setShowScheduleModal(false)
        setNewSchedule({
          date: '',
          start_time: '09:00',
          end_time: '10:00',
          max_appointments: 10
        })
        load()
      } else {
        alert(data.error || '添加失败')
      }
    } catch (e) {
      console.error('添加排班失败', e)
      alert('网络错误')
    } finally {
      setSavingSchedule(false)
    }
  }

  async function handleDeleteSchedule(scheduleId) {
    if (!confirm('确定要删除该排班吗？')) return
    try {
      const resp = await fetch(`${BASE}/doctor/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + auth.token }
      })
      if (resp.ok) {
        alert('删除成功')
        load()
      } else {
        const data = await resp.json().catch(()=>({}))
        alert(data.error || '删除失败')
      }
    } catch (e) {
      console.error('删除排班失败', e)
      alert('网络错误')
    }
  }

  function goWeek(delta) {
    setBaseTs(t => t + delta * 7 * 86400)
  }

  function groupByDay() {
    const start = startOfWeekTs(baseTs)
    const days = {}
    for (let i=0;i<7;i++) {
      const ts = start + i*86400
      const key = formatDate(new Date(ts*1000),'yyyy-MM-dd')
      days[key] = []
    }
    ;(appointments||[]).forEach(a=>{
      if (a.status === 'cancelled') return
      const key = a.date
      if (!days[key]) days[key]=[]
      days[key].push(a)
    })
    return days
  }

  async function handleConfirmAppointment(aptId) {
    try {
      const resp = await fetch(`${BASE}/appointments/${aptId}/confirm`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (auth?.token || '') }
      })
      if (resp.ok) {
        alert('已确认预约')
        load()
        setShowDetailModal(false)
      } else {
        const d = await resp.json().catch(()=>({}))
        alert(d.error || '确认失败')
      }
    } catch (e) {
      console.error(e)
      alert('网络错误')
    }
  }

  async function handleCancelAppointment(aptId) {
    if (!confirm('确定要取消该预约吗？')) return
    try {
      const resp = await fetch(`${BASE}/appointments/${aptId}/cancel`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (auth?.token || '') }
      })
      if (resp.ok) {
        alert('已取消预约')
        load()
        setShowDetailModal(false)
      } else {
        const d = await resp.json().catch(()=>({}))
        alert(d.error || '取消失败')
      }
    } catch (e) {
      console.error(e)
      alert('网络错误')
    }
  }

  function openAppointmentDetail(apt) {
    setSelectedAppointment(apt)
    setShowDetailModal(true)
  }

  function goToChat(apt) {
    // 根据预约信息跳转到对话页面
    if (apt.case_id) {
      navigate(`/doctor-patient-chat/${apt.case_id}`)
    } else if (apt.patient_username) {
      // 如果没有case_id，需要先创建一个问诊记录
      navigate(`/doctor-chat?patient=${apt.patient_username}`)
    } else {
      alert('无法获取患者信息')
    }
  }

  const getStatusBadge = (status) => {
    const statusMap = {
      'scheduled': { text: '待确认', color: '#f59e0b', bg: '#fef3c7' },
      'confirmed': { text: '已确认', color: '#10b981', bg: '#d1fae5' },
      'completed': { text: '已完成', color: '#6b7280', bg: '#f3f4f6' },
      'cancelled': { text: '已取消', color: '#ef4444', bg: '#fee2e2' }
    }
    const s = statusMap[status] || { text: status, color: '#6b7280', bg: '#f3f4f6' }
    return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, color: s.color, background: s.bg }}>{s.text}</span>
  }

  const getStatusCount = (status) => {
    return appointments.filter(a => a.status === status).length
  }

  const days = groupByDay()

  return (
    <div style={{padding:24}}>
      <div style={{marginBottom:16}}>
        <button className="btn-ghost" onClick={() => navigate('/doctor/profile')}>
          ← 返回
        </button>
      </div>
      {/* 预约详情弹窗 */}
      {showDetailModal && selectedAppointment && (
        <div style={{
          position: 'fixed', left: 0, top: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: '#fff', padding: '24px', borderRadius: '16px', width: '480px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px' }}>预约详情</h3>

            <div style={{ background: '#f9fafb', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>患者姓名</div>
                  <div style={{ fontWeight: 600 }}>{selectedAppointment.patient_name || '未填写'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>联系电话</div>
                  <div style={{ fontWeight: 600 }}>{selectedAppointment.patient_phone || '未填写'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>预约日期</div>
                  <div style={{ fontWeight: 600 }}>{selectedAppointment.date}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>预约时间</div>
                  <div style={{ fontWeight: 600 }}>{selectedAppointment.start_time} - {selectedAppointment.end_time}</div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>备注</div>
                  <div style={{ fontWeight: 600 }}>{selectedAppointment.notes || '无'}</div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>状态</div>
                  {getStatusBadge(selectedAppointment.status)}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setShowDetailModal(false)}>关闭</button>
              {selectedAppointment.status === 'scheduled' && (
                <>
                  <button
                    onClick={() => handleConfirmAppointment(selectedAppointment.id)}
                    className="btn-primary"
                  >
                    确认预约
                  </button>
                  <button
                    onClick={() => handleCancelAppointment(selectedAppointment.id)}
                    style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    取消预约
                  </button>
                </>
              )}
              {selectedAppointment.status === 'confirmed' && (
                <button
                  onClick={() => goToChat(selectedAppointment)}
                  style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                >
                  进入对话
                </button>
              )}
              {selectedAppointment.status === 'completed' && (
                <button
                  onClick={() => goToChat(selectedAppointment)}
                  style={{ background: '#6b7280', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                >
                  查看对话
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center', marginBottom: '20px'}}>
        <h2>预约管理</h2>
        <div style={{display:'flex', gap: '12px', alignItems: 'center'}}>
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: '8px', padding: '4px' }}>
            <button
              onClick={() => { setViewMode('appointments'); setBaseTs(Math.floor(Date.now()/1000)) }}
              style={{
                padding: '8px 16px', border: 'none', background: viewMode === 'appointments' ? '#fff' : 'transparent',
                borderRadius: '6px', cursor: 'pointer', fontWeight: viewMode === 'appointments' ? 600 : 400,
                boxShadow: viewMode === 'appointments' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              预约管理
            </button>
            <button
              onClick={() => { setViewMode('schedules'); setBaseTs(Math.floor(Date.now()/1000)) }}
              style={{
                padding: '8px 16px', border: 'none', background: viewMode === 'schedules' ? '#fff' : 'transparent',
                borderRadius: '6px', cursor: 'pointer', fontWeight: viewMode === 'schedules' ? 600 : 400,
                boxShadow: viewMode === 'schedules' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              排班管理
            </button>
          </div>
        </div>
      </div>

      {/* 添加排班按钮 */}
      {viewMode === 'schedules' && (
        <div style={{ marginBottom: '20px' }}>
          <button className="btn-primary" onClick={() => setShowScheduleModal(true)}>+ 添加排班</button>
        </div>
      )}

      {/* 排班添加弹窗 */}
      {showScheduleModal && (
        <div style={{
          position: 'fixed', left: 0, top: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: '#fff', padding: '24px', borderRadius: '16px', width: '420px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px' }}>添加排班</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>日期 *</label>
                <input
                  type="date"
                  value={newSchedule.date}
                  onChange={e => setNewSchedule(s => ({ ...s, date: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '14px' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>开始时间</label>
                  <input
                    type="time"
                    value={newSchedule.start_time}
                    onChange={e => setNewSchedule(s => ({ ...s, start_time: e.target.value }))}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '14px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>结束时间</label>
                  <input
                    type="time"
                    value={newSchedule.end_time}
                    onChange={e => setNewSchedule(s => ({ ...s, end_time: e.target.value }))}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '14px' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>可预约人数</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={newSchedule.max_appointments}
                  onChange={e => setNewSchedule(s => ({ ...s, max_appointments: parseInt(e.target.value) || 10 }))}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '14px' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn-ghost" onClick={() => setShowScheduleModal(false)}>取消</button>
              <button className="btn-primary" onClick={handleAddSchedule} disabled={savingSchedule}>
                {savingSchedule ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 统计卡片 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px', marginBottom: '20px'}}>
        <div style={{background:'#fff', padding:'16px', borderRadius:'12px', boxShadow:'0 2px 8px rgba(0,0,0,0.06)'}}>
          <div style={{fontSize:'12px', color:'#6b7280', marginBottom:'4px'}}>待确认</div>
          <div style={{fontSize:'28px', fontWeight:700, color:'#f59e0b'}}>{getStatusCount('scheduled')}</div>
        </div>
        <div style={{background:'#fff', padding:'16px', borderRadius:'12px', boxShadow:'0 2px 8px rgba(0,0,0,0.06)'}}>
          <div style={{fontSize:'12px', color:'#6b7280', marginBottom:'4px'}}>已确认</div>
          <div style={{fontSize:'28px', fontWeight:700, color:'#10b981'}}>{getStatusCount('confirmed')}</div>
        </div>
        <div style={{background:'#fff', padding:'16px', borderRadius:'12px', boxShadow:'0 2px 8px rgba(0,0,0,0.06)'}}>
          <div style={{fontSize:'12px', color:'#6b7280', marginBottom:'4px'}}>已完成</div>
          <div style={{fontSize:'28px', fontWeight:700, color:'#6b7280'}}>{getStatusCount('completed')}</div>
        </div>
        <div style={{background:'#fff', padding:'16px', borderRadius:'12px', boxShadow:'0 2px 8px rgba(0,0,0,0.06)'}}>
          <div style={{fontSize:'12px', color:'#6b7280', marginBottom:'4px'}}>已取消</div>
          <div style={{fontSize:'28px', fontWeight:700, color:'#ef4444'}}>{getStatusCount('cancelled')}</div>
        </div>
      </div>

      {viewMode === 'appointments' ? (
        <>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center', marginBottom: '12px'}}>
            <div style={{display:'flex',gap:8}}>
              <button className="btn-ghost" onClick={()=>goWeek(-1)}>上一周</button>
              <button className="btn-ghost" onClick={()=>setBaseTs(Math.floor(Date.now()/1000))}>本周</button>
              <button className="btn-ghost" onClick={()=>goWeek(1)}>下一周</button>
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:8}}>
            {Object.keys(days).map(d=>{
              return (
                <div key={d} style={{background:'#fff',minHeight:200,padding:12,borderRadius:8}}>
                  <div style={{fontWeight:700,marginBottom:12, paddingBottom:'8px', borderBottom:'1px solid #e5e7eb'}}>{formatDate(new Date(d),'MM-dd EEE')}</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {days[d].length === 0 && (
                      <div style={{color:'#9ca3af', fontSize:'12px', textAlign:'center', padding:'20px 0'}}>无预约</div>
                    )}
                    {days[d].map(a=>(
                      <div
                        key={a.id}
                        onClick={() => openAppointmentDetail(a)}
                        style={{
                          padding:'10px', borderRadius:8, cursor:'pointer',
                          background: a.status === 'scheduled' ? '#fef3c7' : a.status === 'confirmed' ? '#d1fae5' : '#f3f4f6',
                          border: '1px solid',
                          borderColor: a.status === 'scheduled' ? '#fcd34d' : a.status === 'confirmed' ? '#6ee7b7' : '#d1d5db'
                        }}
                      >
                        <div style={{fontWeight:700, fontSize:'13px', marginBottom:'4px'}}>
                          {a.patient_name || a.patient_username}
                        </div>
                        <div style={{fontSize:'11px', color:'#6b7280'}}>
                          {a.start_time} - {a.end_time}
                        </div>
                        <div style={{marginTop:'6px'}}>
                          {getStatusBadge(a.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        // 排班管理视图
        <div style={{background:'#fff', borderRadius:12, overflow:'hidden', boxShadow:'0 2px 8px rgba(0,0,0,0.06)'}}>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'#f9fafb', borderBottom:'1px solid #e5e7eb'}}>
                <th style={{padding:'14px 16px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>日期</th>
                <th style={{padding:'14px 16px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>时间</th>
                <th style={{padding:'14px 16px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>可预约</th>
                <th style={{padding:'14px 16px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>已约</th>
                <th style={{padding:'14px 16px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>状态</th>
                <th style={{padding:'14px 16px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{padding:'40px', textAlign:'center', color:'#9ca3af'}}>加载中...</td></tr>
              ) : schedules.length === 0 ? (
                <tr><td colSpan={6} style={{padding:'40px', textAlign:'center', color:'#9ca3af'}}>暂无排班，请添加排班</td></tr>
              ) : (
                schedules.map(sch => (
                  <tr key={sch.id} style={{borderBottom:'1px solid #f3f4f6'}}>
                    <td style={{padding:'14px 16px', fontWeight:600}}>{sch.date}</td>
                    <td style={{padding:'14px 16px'}}>{sch.start_time} - {sch.end_time}</td>
                    <td style={{padding:'14px 16px'}}>{sch.max_appointments}</td>
                    <td style={{padding:'14px 16px'}}>{sch.current_appointments}</td>
                    <td style={{padding:'14px 16px'}}>
                      <span style={{
                        padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                        color: sch.is_available === 1 ? '#10b981' : '#6b7280',
                        background: sch.is_available === 1 ? '#d1fae5' : '#f3f4f6'
                      }}>
                        {sch.is_available === 1 ? '可预约' : '已停诊'}
                      </span>
                    </td>
                    <td style={{padding:'14px 16px'}}>
                      <button
                        onClick={() => handleDeleteSchedule(sch.id)}
                        style={{padding:'6px 12px', fontSize:'12px', background:'#fee2e2', color:'#dc2626', border:'none', borderRadius:'6px', cursor:'pointer'}}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
