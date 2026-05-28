import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

const AvatarPlaceholder = ({ name, size = 64, borderRadius = '12px' }) => {
  const initials = (name || 'U').slice(0, 1).toUpperCase()
  const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899']
  const colorIndex = name ? name.charCodeAt(0) % colors.length : 0
  const bgColor = colors[colorIndex]

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: borderRadius,
      background: `linear-gradient(135deg, ${bgColor}, ${bgColor}dd)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontSize: size * 0.4,
      fontWeight: 'bold',
      border: '2px solid #e5e7eb',
      flexShrink: 0
    }}>
      {initials}
    </div>
  )
}

export default function QuickRegister() {
  const navigate = useNavigate()
  const auth = getStoredAuth()
  const submittingRef = useRef(false) // 防止重复提交
  const [step, setStep] = useState(1)
  const [departments, setDepartments] = useState([])
  const [loadingDepartments, setLoadingDepartments] = useState(true)
  const [doctors, setDoctors] = useState([])
  const [schedules, setSchedules] = useState([])
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingDoctors, setLoadingDoctors] = useState(false)
  const [loadingSchedules, setLoadingSchedules] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [successData, setSuccessData] = useState(null)

  const [selectedDept, setSelectedDept] = useState(null)
  const [selectedDoctor, setSelectedDoctor] = useState(null)
  const [selectedSchedule, setSelectedSchedule] = useState(null)
  const [patientName, setPatientName] = useState('')
  const [patientPhone, setPatientPhone] = useState('')
  const [notes, setNotes] = useState('')
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    loadDepartments()
    if (auth?.username) {
      loadMyAppointments()
      if (auth.display_name) setPatientName(auth.display_name)
      if (auth.phone) setPatientPhone(auth.phone)
    }
  }, []) // 空依赖，只在组件挂载时执行一次

  const loadDoctorsByDept = useCallback(async (deptId) => {
    setLoadingDoctors(true)
    setDoctors([])
    try {
      const resp = await fetch(`${BASE}/doctors?department_id=${deptId}`)
      if (resp.ok) {
        const data = await resp.json()
        // 过滤掉不接诊的医生
        const available = (data.doctors || []).filter(d => d.accept_consultations !== false)
        setDoctors(available)
      }
    } catch (e) {
      console.error('加载医生失败', e)
    } finally {
      setLoadingDoctors(false)
    }
  }, [])

  const loadDoctorSchedules = useCallback(async (doctorUsername) => {
    setLoadingSchedules(true)
    setSchedules([])
    try {
      const resp = await fetch(`${BASE}/doctors/${doctorUsername}/schedules`)
      if (resp.ok) {
        const data = await resp.json()
        const all = data.schedules || []
        // 过滤有号的排班: max > current 且 is_available !== 0
        const available = all.filter(s => {
          const max = s.max_appointments ?? 10
          const cur = s.current_appointments ?? 0
          const isAvail = (s.is_available ?? 1) !== 0
          const hasSlot = (max - cur) > 0
          // 只显示未来时间
          const scheduleDateTime = new Date(`${s.date} ${s.start_time}`).getTime()
          const now = Date.now()
          return isAvail && hasSlot && scheduleDateTime > now
        })
        setSchedules(available)
      }
    } catch (e) {
      console.error('加载排班失败', e)
    } finally {
      setLoadingSchedules(false)
    }
  }, [])

  useEffect(() => {
    if (selectedDept) {
      loadDoctorsByDept(selectedDept)
    }
  }, [selectedDept, loadDoctorsByDept])

  useEffect(() => {
    if (selectedDoctor) {
      loadDoctorSchedules(selectedDoctor.username)
    }
  }, [selectedDoctor, loadDoctorSchedules])

  async function loadDepartments() {
    setLoadingDepartments(true)
    try {
      const resp = await fetch(`${BASE}/departments`)
      if (resp.ok) {
        const data = await resp.json()
        setDepartments(data.departments || [])
      }
    } catch (e) {
      console.error('加载科室失败', e)
    } finally {
      setLoadingDepartments(false)
    }
  }

  async function loadMyAppointments() {
    if (!auth?.token) return
    try {
      const resp = await fetch(`${BASE}/patient/appointments`, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      })
      if (resp.ok) {
        const data = await resp.json()
        setAppointments(data.appointments || [])
      }
    } catch (e) {
      console.error('加载预约记录失败', e)
    }
  }

  async function handleSubmitAppointment() {
    // 防止重复提交
    if (submittingRef.current) return
    submittingRef.current = true

    if (!auth) {
      submittingRef.current = false
      alert('请先登录')
      navigate('/auth')
      return
    }

    if (!selectedSchedule || !selectedDoctor) {
      submittingRef.current = false
      alert('请选择排班时间')
      return
    }

    if (!patientName.trim() || !patientPhone.trim()) {
      submittingRef.current = false
      alert('请填写姓名和联系电话')
      return
    }

    setLoading(true)

    // 模拟网络请求延迟，让用户看到按钮状态变化
    await new Promise(resolve => setTimeout(resolve, 300))

    try {
      const resp = await fetch(`${BASE}/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.token
        },
        body: JSON.stringify({
          schedule_id: selectedSchedule.id,
          doctor_username: selectedDoctor.username,
          patient_name: patientName,
          patient_phone: patientPhone,
          department_id: selectedDept,
          notes: notes
        })
      })

      const data = await resp.json()
      if (resp.ok) {
        setSuccessData(data.appointment)
        setShowSuccess(true)
        loadMyAppointments()
        loadDoctorSchedules(selectedDoctor.username)
      } else {
        alert(data.error || '预约失败')
      }
    } catch (e) {
      console.error('预约失败', e)
      alert('预约失败，请稍后重试')
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }

  async function handleCancelAppointment(appointmentId) {
    if (!confirm('确定要取消该预约吗？')) return

    try {
      const resp = await fetch(`${BASE}/appointments/${appointmentId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + auth.token }
      })
      if (resp.ok) {
        alert('取消成功')
        loadMyAppointments()
      } else {
        const data = await resp.json()
        alert(data.error || '取消失败')
      }
    } catch (e) {
      console.error('取消预约失败', e)
      alert('取消失败')
    }
  }

  function resetForm() {
    setStep(1)
    setSelectedDept(null)
    setSelectedDoctor(null)
    setSelectedSchedule(null)
    setPatientName(auth?.display_name || '')
    setPatientPhone(auth?.phone || '')
    setNotes('')
    setShowSuccess(false)
    setSuccessData(null)
  }

  function goBack() {
    if (step === 4) {
      // 从步骤4返回时刷新排班
      if (selectedDoctor) loadDoctorSchedules(selectedDoctor.username)
      setStep(3)
    } else if (step === 3) {
      setStep(2)
    } else if (step === 2) {
      setStep(1)
    }
  }

  function selectDoctor(doc) {
    setSelectedDoctor(doc)
    setSelectedSchedule(null)
    setStep(3)
  }

  function selectSchedule(schedule) {
    setSelectedSchedule(schedule)
    setStep(4)
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

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      {showSuccess && (
        <div style={{
          position: 'fixed', left: 0, top: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: '#fff', padding: '32px', borderRadius: '16px', width: '420px',
            textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
            <h2 style={{ color: '#10b981', marginBottom: '16px' }}>预约成功!</h2>
            {successData && (
              <div style={{ textAlign: 'left', background: '#f9fafb', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                <div style={{ marginBottom: '8px' }}><strong>医生：</strong>{selectedDoctor?.display_name}</div>
                <div style={{ marginBottom: '8px' }}><strong>科室：</strong>{departments.find(d => d.id === selectedDept)?.name}</div>
                <div style={{ marginBottom: '8px' }}><strong>日期：</strong>{successData.date}</div>
                <div><strong>时间：</strong>{successData.start_time} - {successData.end_time}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button className="btn-ghost" onClick={resetForm}>继续预约</button>
              <button className="btn-primary" onClick={() => { setShowSuccess(false); navigate('/my-appointments') }}>查看我的预约</button>
            </div>
          </div>
        </div>
      )}

      <div style={{display: 'flex', alignItems: 'center', marginBottom: 24}}>
        <button onClick={() => navigate('/profile')} style={{background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 14}}>
          ← 返回
        </button>
        <h2 style={{margin: 0, marginLeft: 16, fontSize: '28px', fontWeight: 700}}>快速挂号</h2>
      </div>

      {/* 我的预约记录 */}
      {auth && appointments.length > 0 && (
        <div style={{ marginBottom: '32px', background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px' }}>我的预约</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {appointments.slice(0, 3).map(apt => (
              <div
                key={apt.id}
                onClick={() => {
                  if (apt.status === 'confirmed' && apt.case_id) {
                    navigate(`/case-detail/${apt.case_id}`)
                  }
                }}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb',
                  cursor: apt.status === 'confirmed' && apt.case_id ? 'pointer' : 'default'
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{apt.doctor_name}</div>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>{apt.date} {apt.start_time} | {apt.patient_name}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {getStatusBadge(apt.status)}
                  {apt.status === 'confirmed' && (
                    <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 500 }}>进入对话 →</span>
                  )}
                  {apt.status !== 'cancelled' && apt.status !== 'completed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCancelAppointment(apt.id) }}
                      style={{ padding: '6px 12px', fontSize: '12px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      取消
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        {/* 步骤指示器 */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
          {[
            { num: 1, text: '选择科室' },
            { num: 2, text: '选择医生' },
            { num: 3, text: '选择时间' },
            { num: 4, text: '确认信息' }
          ].map((s, i) => (
            <React.Fragment key={s.num}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 600, fontSize: '14px',
                  background: step >= s.num ? '#10b981' : '#e5e7eb',
                  color: step >= s.num ? '#fff' : '#6b7280',
                  transition: 'all 0.3s'
                }}>{s.num}</div>
                <div style={{
                  marginLeft: '8px', fontSize: '14px', fontWeight: step === s.num ? 600 : 400,
                  color: step >= s.num ? '#111827' : '#9ca3af'
                }}>{s.text}</div>
              </div>
              {i < 3 && <div style={{ width: '60px', height: '2px', background: step > s.num ? '#10b981' : '#e5e7eb', margin: '0 12px', alignSelf: 'center' }} />}
            </React.Fragment>
          ))}
        </div>

        {/* 步骤1: 选择科室 */}
        {step === 1 && (
          <div>
            <h3 style={{ marginTop: 0, marginBottom: '20px' }}>请选择科室</h3>
            {loadingDepartments ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                <div style={{ marginBottom: '8px' }}>加载中...</div>
                <div style={{ fontSize: '13px', color: '#9ca3af' }}>正在获取科室列表</div>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
                  {departments.map(dept => (
                    <div
                      key={dept.id}
                      onClick={() => { setSelectedDept(dept.id); setSelectedDoctor(null); setSelectedSchedule(null); setStep(2) }}
                      style={{
                        padding: '20px', borderRadius: '12px', border: '2px solid #e5e7eb',
                        textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s',
                        background: selectedDept === dept.id ? '#ecfdf5' : '#fff',
                        borderColor: selectedDept === dept.id ? '#10b981' : '#e5e7eb'
                      }}
                    >
                      <div style={{ fontSize: '32px', marginBottom: '8px' }}>{dept.icon || '🏥'}</div>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>{dept.name}</div>
                    </div>
                  ))}
                </div>
                {departments.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>暂无可用科室</div>
                )}
              </>
            )}
          </div>
        )}

        {/* 步骤2: 选择医生 */}
        {step === 2 && (
          <div>
            <button className="btn-ghost" onClick={() => setStep(1)} style={{ marginBottom: '16px' }}>
              ← 返回科室选择
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>
                {departments.find(d => d.id === selectedDept)?.name} - 选择医生
              </h3>
              <button
                onClick={() => loadDoctorsByDept(selectedDept)}
                style={{
                  padding: '8px 16px', borderRadius: '6px', border: '1px solid #e5e7eb',
                  background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                }}
              >
                🔄 刷新
              </button>
            </div>

            {loadingDoctors ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                <div style={{ marginBottom: '8px' }}>加载中...</div>
                <div style={{ fontSize: '13px', color: '#9ca3af' }}>正在获取医生列表</div>
              </div>
            ) : doctors.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {doctors.map(doc => (
                  <div
                    key={doc.username}
                    onClick={() => selectDoctor(doc)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '16px', padding: '16px',
                      borderRadius: '12px', border: '2px solid #e5e7eb', cursor: 'pointer',
                      background: selectedDoctor?.username === doc.username ? '#ecfdf5' : '#fff',
                      borderColor: selectedDoctor?.username === doc.username ? '#10b981' : '#e5e7eb'
                    }}
                  >
                    {doc.avatar_url ? (
                      <img
                        src={doc.avatar_url}
                        alt={doc.display_name}
                        style={{ width: '60px', height: '60px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                    ) : (
                      <AvatarPlaceholder name={doc.display_name || doc.username} size={60} borderRadius="50%" />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px' }}>
                        {doc.display_name}
                        <span style={{ marginLeft: '8px', fontSize: '13px', color: '#6b7280', fontWeight: 400 }}>
                          {doc.title || '医生'}
                        </span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
                        {doc.clinic}
                      </div>
                      {doc.specialties && (
                        <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 500 }}>
                          擅长：{doc.specialties}
                        </div>
                      )}
                    </div>
                    <div style={{ color: '#10b981', fontSize: '24px' }}>→</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>👨‍⚕️</div>
                <div style={{ color: '#374151', fontWeight: 600, marginBottom: '8px' }}>该科室暂无可用医生</div>
                <div style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '16px' }}>
                  可能原因：医生正在休息或暂无排班
                </div>
                <button
                  onClick={() => loadDoctorsByDept(selectedDept)}
                  style={{
                    padding: '10px 20px', borderRadius: '8px', border: 'none',
                    background: '#10b981', color: '#fff', cursor: 'pointer', fontWeight: 600
                  }}
                >
                  🔄 重新加载
                </button>
              </div>
            )}
          </div>
        )}

        {/* 步骤3: 选择排班时间 */}
        {step === 3 && (
          <div>
            <button className="btn-ghost" onClick={() => setStep(2)} style={{ marginBottom: '16px' }}>
              ← 返回医生选择
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h3 style={{ margin: 0 }}>{selectedDoctor?.display_name} - 选择就诊时间</h3>
              <button
                onClick={() => loadDoctorSchedules(selectedDoctor.username)}
                style={{
                  padding: '8px 16px', borderRadius: '6px', border: '1px solid #e5e7eb',
                  background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                }}
              >
                🔄 刷新
              </button>
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '20px' }}>
              {selectedDoctor?.clinic}
            </div>

            {loadingSchedules ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                <div style={{ marginBottom: '8px' }}>加载中...</div>
                <div style={{ fontSize: '13px', color: '#9ca3af' }}>正在获取可用时段</div>
              </div>
            ) : schedules.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                {schedules.map(schedule => (
                  <div
                    key={schedule.id}
                    onClick={() => selectSchedule(schedule)}
                    style={{
                      padding: '16px', borderRadius: '12px', border: '2px solid #e5e7eb',
                      textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s',
                      background: selectedSchedule?.id === schedule.id ? '#ecfdf5' : '#fff',
                      borderColor: selectedSchedule?.id === schedule.id ? '#10b981' : '#e5e7eb'
                    }}
                  >
                    <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>{schedule.date}</div>
                    <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                      {schedule.start_time} - {schedule.end_time}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: schedule.available > 3 ? '#10b981' : schedule.available > 1 ? '#f59e0b' : '#ef4444',
                      fontWeight: 600
                    }}>
                      剩余 {schedule.available} 个号
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>📅</div>
                <div style={{ color: '#374151', fontWeight: 600, marginBottom: '8px' }}>该医生近期无可用排班</div>
                <div style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '16px' }}>
                  医生可能暂无排班计划，请稍后再试
                </div>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button
                    onClick={() => loadDoctorSchedules(selectedDoctor.username)}
                    style={{
                      padding: '10px 20px', borderRadius: '8px', border: 'none',
                      background: '#10b981', color: '#fff', cursor: 'pointer', fontWeight: 600
                    }}
                  >
                    🔄 重新加载
                  </button>
                  <button
                    onClick={() => { setStep(2); setSelectedDoctor(null) }}
                    style={{
                      padding: '10px 20px', borderRadius: '8px', border: '1px solid #e5e7eb',
                      background: '#fff', cursor: 'pointer'
                    }}
                  >
                    选择其他医生
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 步骤4: 确认信息 */}
        {step === 4 && (
          <div>
            <button className="btn-ghost" onClick={goBack} style={{ marginBottom: '16px' }}>
              ← 返回时间选择
            </button>
            <h3 style={{ marginTop: 0, marginBottom: '24px' }}>确认预约信息</h3>

            <div style={{ background: '#f9fafb', padding: '20px', borderRadius: '12px', marginBottom: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>医生</div>
                  <div style={{ fontWeight: 600 }}>{selectedDoctor?.display_name}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>科室</div>
                  <div style={{ fontWeight: 600 }}>{departments.find(d => d.id === selectedDept)?.name}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>就诊日期</div>
                  <div style={{ fontWeight: 600 }}>{selectedSchedule?.date}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>就诊时间</div>
                  <div style={{ fontWeight: 600 }}>{selectedSchedule?.start_time} - {selectedSchedule?.end_time}</div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>患者姓名 *</label>
                <input
                  type="text"
                  value={patientName}
                  onChange={e => setPatientName(e.target.value)}
                  placeholder="请输入患者姓名"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '14px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>联系电话 *</label>
                <input
                  type="tel"
                  value={patientPhone}
                  onChange={e => setPatientPhone(e.target.value)}
                  placeholder="请输入联系电话"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '14px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>备注（可选）</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="请描述您的症状或需求"
                  rows={3}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '14px', resize: 'vertical' }}
                />
              </div>

              <button
                onClick={handleSubmitAppointment}
                disabled={loading}
                className="btn-primary"
                style={{ marginTop: '16px', padding: '14px', fontSize: '16px', opacity: loading ? 0.7 : 1 }}
              >
                {loading ? '提交中...' : '确认预约'}
              </button>
            </div>
          </div>
        )}
      </div>

      {!auth && (
        <div style={{
          marginTop: '24px', padding: '20px', background: '#fef3c7', borderRadius: '12px',
          textAlign: 'center', border: '1px solid #fcd34d'
        }}>
          <div style={{ marginBottom: '12px', fontWeight: 600, color: '#92400e' }}>请先登录后再预约</div>
          <button className="btn-primary" onClick={() => navigate('/auth')}>立即登录</button>
        </div>
      )}
    </div>
  )
}
