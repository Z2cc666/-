import React, { useEffect, useState } from 'react'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function AdminDashboard() {
  const auth = getStoredAuth()
  const [doctors, setDoctors] = useState([])
  const [orders, setOrders] = useState([])
  const [prescriptions, setPrescriptions] = useState([])
  const [appointments, setAppointments] = useState([])
  const [selectedDoctor, setSelectedDoctor] = useState(null)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showChatModal, setShowChatModal] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [selectedDoctorFull, setSelectedDoctorFull] = useState(null)
  const [showDoctorModal, setShowDoctorModal] = useState(false)
  const [selectedCase, setSelectedCase] = useState(null)
  const [selectedPatientInfo, setSelectedPatientInfo] = useState(null)
  const [showPrescriptionModal, setShowPrescriptionModal] = useState(false)
  const [prescriptionDetail, setPrescriptionDetail] = useState(null)
  const [activeTab, setActiveTab] = useState('doctors') // ... | 'schedules' | 'patients' | 'notifications'
  const [statusFilter, setStatusFilter] = useState('')

  // 通知公告相关状态
  const [notifications, setNotifications] = useState([])
  const [showNotifModal, setShowNotifModal] = useState(false)
  const [editingNotif, setEditingNotif] = useState(null)
  const [notifForm, setNotifForm] = useState({
    title: '', content: '', type: 'system', priority: 0, is_pinned: false, is_active: true, target_users: ''
  })

  // 科室管理相关状态
  const [departments, setDepartments] = useState([])
  const [selectedDepartment, setSelectedDepartment] = useState(null)
  const [departmentDoctors, setDepartmentDoctors] = useState([])
  const [showDeptModal, setShowDeptModal] = useState(false)
  const [editingDept, setEditingDept] = useState(null)
  const [deptForm, setDeptForm] = useState({ name: '', description: '', icon: '', sort_order: 0 })
  const [deptFilter, setDeptFilter] = useState('')

  // 医生科室调整模态框
  const [reassignDoctor, setReassignDoctor] = useState(null) // { username, name, currentDeptId }

  // 排班管理相关状态
  const [schedules, setSchedules] = useState([])
  const [scheduleDoctor, setScheduleDoctor] = useState('') // 筛选的医生
  const [scheduleDateFrom, setScheduleDateFrom] = useState('')
  const [scheduleDateTo, setScheduleDateTo] = useState('')
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [scheduleForm, setScheduleForm] = useState({
    doctor_username: '', date: '', start_time: '08:00', end_time: '12:00',
    max_appointments: 10, fee: 0
  })
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchForm, setBatchForm] = useState({
    doctor_username: '', start_date: '', end_date: '',
    template: {
      "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": []
    }
  })

  // 患者管理
  const [patientItems, setPatientItems] = useState([])
  const [patientTotal, setPatientTotal] = useState(0)
  const [patientPage, setPatientPage] = useState(1)
  const patientPerPage = 20
  const [patientQ, setPatientQ] = useState({ name: '', phone: '', id_card: '', created_from: '', created_to: '' })
  const [showPatientDetail, setShowPatientDetail] = useState(false)
  const [patientDetailUsername, setPatientDetailUsername] = useState('')
  const [patientEdit, setPatientEdit] = useState(null)

  useEffect(()=>{ loadOverview() }, [])

  async function loadOverview() {
    try {
      // if admin, fetch admin doctors list (includes unverified)
      const authStored = getStoredAuth()
      let dresp
      if (authStored?.user_type === 'admin' || authStored?.username === '123456789') {
        dresp = await fetch(`${BASE}/admin/doctors`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
      } else {
        dresp = await fetch(`${BASE}/doctors`)
      }
      if (dresp.ok) {
        setDoctors(await dresp.json())
      } else {
        // fallback to public doctors if admin endpoint rejected (e.g., missing token)
        try {
          const publicResp = await fetch(`${BASE}/doctors`)
          if (publicResp.ok) setDoctors(await publicResp.json())
        } catch (_) {}
      }
    } catch(_) {}
    try {
      const ores = await fetch(`${BASE}/doctor-consultations`, { headers: { 'Authorization': 'Bearer ' + (auth?.token || '') }})
      if (ores.ok) setOrders(await ores.json())
    } catch(_) {}
    try {
      // fetch recent prescriptions from app cases
      const pres = await fetch(`${BASE}/recent-prescriptions`, { headers: { 'Authorization': 'Bearer ' + (auth?.token || '') } })
      if (pres.ok) setPrescriptions(await pres.json())
    } catch(_) {}
    try {
      // fetch all appointments for admin
      const authStored = getStoredAuth()
      const apptResp = await fetch(`${BASE}/admin/appointments`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
      if (apptResp.ok) {
        const apptData = await apptResp.json()
        setAppointments(apptData.appointments || [])
      }
    } catch(_) {}

    // 加载科室列表
    try {
      const authStored = getStoredAuth()
      const deptResp = await fetch(`${BASE}/admin/departments`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
      if (deptResp.ok) {
        setDepartments(await deptResp.json())
      }
    } catch(_) {}
  }

  // 加载通知列表
  async function loadNotifications() {
    try {
      const authStored = getStoredAuth()
      const resp = await fetch(`${BASE}/admin/notifications`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
      if (resp.ok) {
        setNotifications(await resp.json())
      }
    } catch(_) {}
  }

  useEffect(() => {
    if (activeTab === 'notifications') loadNotifications()
  }, [activeTab])

  // 加载排班列表
  async function loadSchedules() {
    try {
      const authStored = getStoredAuth()
      let url = `${BASE}/admin/schedules`
      const params = []
      if (scheduleDoctor) params.push(`doctor=${scheduleDoctor}`)
      if (scheduleDateFrom) params.push(`date_from=${scheduleDateFrom}`)
      if (scheduleDateTo) params.push(`date_to=${scheduleDateTo}`)
      if (params.length > 0) url += '?' + params.join('&')

      const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
      if (resp.ok) {
        setSchedules(await resp.json())
      }
    } catch(_) {}
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

  // ==================== 科室管理函数 ====================
  async function handleSaveDepartment() {
    if (!deptForm.name.trim()) {
      alert('请输入科室名称')
      return
    }
    try {
      const authStored = getStoredAuth()
      const isEdit = !!editingDept
      const url = isEdit ? `${BASE}/admin/departments/${editingDept.id}` : `${BASE}/admin/departments`
      const method = isEdit ? 'PUT' : 'POST'

      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authStored?.token || '') },
        body: JSON.stringify(deptForm)
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        alert(data.message || (isEdit ? '科室已更新' : '科室已创建'))
        setShowDeptModal(false)
        setEditingDept(null)
        loadOverview()
      } else {
        alert(data.error || (isEdit ? '更新失败' : '创建失败'))
      }
    } catch (e) {
      console.error('handleSaveDepartment error', e)
      alert('操作失败，请重试')
    }
  }

  async function handleDeleteDepartment(deptId, deptName) {
    try {
      const authStored = getStoredAuth()
      const resp = await fetch(`${BASE}/admin/departments/${deptId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        alert(data.message || `科室 "${deptName}" 已删除`)
        loadOverview()
      } else {
        alert(data.error || '删除失败')
      }
    } catch (e) {
      console.error('handleDeleteDepartment error', e)
      alert('删除失败，请重试')
    }
  }

  async function handleViewDeptDoctors(dept) {
    try {
      const authStored = getStoredAuth()
      const resp = await fetch(`${BASE}/admin/departments/${dept.id}/doctors`, {
        headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }
      })
      if (resp.ok) {
        const doctors = await resp.json()
        setDepartmentDoctors(doctors)
        setSelectedDepartment(dept)
      } else {
        alert('获取医生列表失败')
      }
    } catch (e) {
      console.error('handleViewDeptDoctors error', e)
      alert('获取医生列表失败')
    }
  }

  async function handleUpdateDoctorDepartment(username, newDeptId) {
    try {
      const authStored = getStoredAuth()
      const resp = await fetch(`${BASE}/admin/doctors/${username}/department`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authStored?.token || '') },
        body: JSON.stringify({ department_id: newDeptId })
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        alert(data.message || '医生科室已更新')
        if (selectedDepartment) {
          handleViewDeptDoctors(selectedDepartment)
        }
        loadOverview()
      } else {
        alert(data.error || '更新失败')
      }
    } catch (e) {
      console.error('handleUpdateDoctorDepartment error', e)
      alert('更新失败，请重试')
    }
  }

  function formatTs(ts) {
    if (!ts) return '-'
    try {
      return new Date(ts * 1000).toLocaleString('zh-CN')
    } catch (_) {
      return '-'
    }
  }

  // ==================== 通知公告管理函数 ====================
  function handleNewNotification() {
    setEditingNotif(null)
    setNotifForm({ title: '', content: '', type: 'system', priority: 0, is_pinned: false, is_active: true, target_users: '' })
    setShowNotifModal(true)
  }

  function handleEditNotification(notif) {
    setEditingNotif(notif)
    setNotifForm({
      title: notif.title || '',
      content: notif.content || '',
      type: notif.type || 'system',
      priority: notif.priority || 0,
      is_pinned: !!notif.is_pinned,
      is_active: notif.is_active !== false,
      target_users: notif.target_users || ''
    })
    setShowNotifModal(true)
  }

  async function handleSaveNotification() {
    if (!notifForm.title.trim() || !notifForm.content.trim()) {
      alert('请填写标题和内容')
      return
    }
    try {
      const authStored = getStoredAuth()
      const isEdit = !!editingNotif
      const url = isEdit ? `${BASE}/admin/notifications/${editingNotif.id}` : `${BASE}/admin/notifications`
      const method = isEdit ? 'PUT' : 'POST'
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authStored?.token || '') },
        body: JSON.stringify(notifForm)
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        alert(data.message || (isEdit ? '通知已更新' : '通知已创建'))
        setShowNotifModal(false)
        loadNotifications()
      } else {
        alert(data.error || '操作失败')
      }
    } catch (e) {
      console.error('handleSaveNotification error', e)
      alert('操作失败，请重试')
    }
  }

  async function handleDeleteNotification(notifId) {
    if (!confirm('确定要删除这条通知吗？')) return
    try {
      const authStored = getStoredAuth()
      const resp = await fetch(`${BASE}/admin/notifications/${notifId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        alert(data.message || '通知已删除')
        loadNotifications()
      } else {
        alert(data.error || '删除失败')
      }
    } catch (e) {
      console.error('handleDeleteNotification error', e)
      alert('删除失败，请重试')
    }
  }

  // 获取处方详情
  async function fetchPrescriptionDetail(prescriptionId) {
    console.log('fetchPrescriptionDetail called with:', prescriptionId)
    try {
      const authStored = getStoredAuth()
      console.log('Auth:', authStored)
      const resp = await fetch(`${BASE}/prescriptions/${prescriptionId}`, {
        headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }
      })
      console.log('Response status:', resp.status)
      if (resp.ok) {
        const data = await resp.json()
        console.log('Prescription data:', data)
        setPrescriptionDetail(data)
        setShowPrescriptionModal(true)
      } else {
        const errData = await resp.json().catch(() => ({}))
        console.error('Error response:', errData)
        alert('无法加载处方详情: ' + (errData.error || '未知错误'))
      }
    } catch (e) {
      console.error('fetchPrescriptionDetail error', e)
      alert('加载处方详情失败: ' + e.message)
    }
  }

  async function loadPatients(page = patientPage, q = patientQ) {
    try {
      const authStored = getStoredAuth()
      const params = new URLSearchParams({ page: String(page), per_page: String(patientPerPage) })
      if (q.name) params.set('q_name', q.name)
      if (q.phone) params.set('q_phone', q.phone)
      if (q.id_card) params.set('q_id_card', q.id_card)
      if (q.created_from) params.set('created_from', q.created_from)
      if (q.created_to) params.set('created_to', q.created_to)
      const resp = await fetch(`${BASE}/admin/patients?${params}`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') } })
      if (!resp.ok) return
      const data = await resp.json()
      setPatientItems(data.items || [])
      setPatientTotal(data.total || 0)
      setPatientPage(data.page || page)
    } catch (_) {}
  }

  async function openPatientDetail(username) {
    try {
      const authStored = getStoredAuth()
      const resp = await fetch(`${BASE}/admin/patients/${encodeURIComponent(username)}`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') } })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        alert(data.error || '加载失败')
        return
      }
      setPatientDetailUsername(username)
      setPatientEdit({
        display_name: data.display_name || '',
        gender: data.gender || '',
        birthday: data.birthday || '',
        id_card: data.id_card || '',
        emergency_name: data.emergency_name || '',
        emergency_phone: data.emergency_phone || '',
        health_info: data.health_info || '',
        allergies: data.allergies || '',
        medical_history: data.medical_history || '',
        height: data.height || '',
        weight: data.weight || '',
        blood_type: data.blood_type || '',
        chronic: data.chronic || '',
        medications: data.medications || '',
        insurance: data.insurance || '',
        created_at: data.created_at,
        last_login_at: data.last_login_at,
        is_banned: data.is_banned,
        is_frozen: data.is_frozen
      })
      setShowPatientDetail(true)
    } catch (e) {
      console.error(e)
      alert('加载失败')
    }
  }

  async function handleSavePatientEdit() {
    if (!patientDetailUsername || !patientEdit) return
    try {
      const authStored = getStoredAuth()
      const body = { ...patientEdit }
      delete body.created_at
      delete body.last_login_at
      delete body.is_banned
      delete body.is_frozen
      const resp = await fetch(`${BASE}/admin/patients/${encodeURIComponent(patientDetailUsername)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authStored?.token || '') },
        body: JSON.stringify(body)
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        alert(data.message || '已保存')
        loadPatients()
        openPatientDetail(patientDetailUsername)
      } else {
        alert(data.error || '保存失败')
      }
    } catch (e) {
      console.error(e)
      alert('保存失败')
    }
  }

  async function handlePatientStatus(action) {
    if (!patientDetailUsername) return
    try {
      const authStored = getStoredAuth()
      const resp = await fetch(`${BASE}/admin/patients/${encodeURIComponent(patientDetailUsername)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authStored?.token || '') },
        body: JSON.stringify({ action })
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        alert(data.message || '操作成功')
        loadPatients()
        openPatientDetail(patientDetailUsername)
      } else {
        alert(data.error || '操作失败')
      }
    } catch (e) {
      console.error(e)
      alert('操作失败')
    }
  }

  async function handleExportPatients() {
    try {
      const authStored = getStoredAuth()
      const params = new URLSearchParams()
      if (patientQ.name) params.set('q_name', patientQ.name)
      if (patientQ.phone) params.set('q_phone', patientQ.phone)
      if (patientQ.id_card) params.set('q_id_card', patientQ.id_card)
      if (patientQ.created_from) params.set('created_from', patientQ.created_from)
      if (patientQ.created_to) params.set('created_to', patientQ.created_to)
      const resp = await fetch(`${BASE}/admin/patients/export?${params}`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') } })
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}))
        alert(d.error || '导出失败')
        return
      }
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'patients_export.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
      alert('导出失败')
    }
  }

  // ==================== 排班管理函数 ====================
  async function handleSaveSchedule() {
    if (!scheduleForm.doctor_username || !scheduleForm.date || !scheduleForm.start_time || !scheduleForm.end_time) {
      alert('请填写完整的排班信息')
      return
    }
    try {
      const authStored = getStoredAuth()
      const isEdit = !!editingSchedule
      const url = isEdit ? `${BASE}/admin/schedules/${editingSchedule.id}` : `${BASE}/admin/schedules`
      const method = isEdit ? 'PUT' : 'POST'

      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authStored?.token || '') },
        body: JSON.stringify(scheduleForm)
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        alert(data.message || (isEdit ? '排班已更新' : '排班已添加'))
        setShowScheduleModal(false)
        setEditingSchedule(null)
        loadSchedules()
      } else {
        alert(data.error || (isEdit ? '更新失败' : '添加失败'))
      }
    } catch (e) {
      console.error('handleSaveSchedule error', e)
      alert('操作失败，请重试')
    }
  }

  async function handleDeleteSchedule(scheduleId) {
    try {
      const authStored = getStoredAuth()
      const resp = await fetch(`${BASE}/admin/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        alert(data.message || '排班已删除')
        loadSchedules()
      } else {
        alert(data.error || '删除失败')
      }
    } catch (e) {
      console.error('handleDeleteSchedule error', e)
      alert('删除失败，请重试')
    }
  }

  async function handleBatchSchedule() {
    if (!batchForm.doctor_username || !batchForm.start_date || !batchForm.end_date) {
      alert('请选择医生和日期范围')
      return
    }
    // 检查是否至少有一个时段
    const hasSlot = Object.values(batchForm.template).some(slots => slots.length > 0)
    if (!hasSlot) {
      alert('请至少设置一个排班时段')
      return
    }
    try {
      const authStored = getStoredAuth()
      const resp = await fetch(`${BASE}/admin/schedules/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authStored?.token || '') },
        body: JSON.stringify({
          doctor_username: batchForm.doctor_username,
          start_date: batchForm.start_date,
          end_date: batchForm.end_date,
          template: batchForm.template
        })
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        alert(data.message + `（新建 ${data.created} 条，跳过 ${data.skipped} 条）`)
        setShowBatchModal(false)
        loadSchedules()
      } else {
        alert(data.error || '批量排班失败')
      }
    } catch (e) {
      console.error('handleBatchSchedule error', e)
      alert('批量排班失败，请重试')
    }
  }

  return (
    <div style={{padding:24}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
        <h2>系统管理员控制台</h2>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <div className="admin-card">
          <h3>医生总数</h3>
          <div style={{fontSize:28,fontWeight:700}}>{doctors.length}</div>
        </div>
        <div className="admin-card">
          <h3>待审接诊</h3>
          <div style={{fontSize:28,fontWeight:700}}>{orders.filter(o=>o.status==='pending').length}</div>
        </div>
        <div className="admin-card">
          <h3>最近处方</h3>
          <div style={{fontSize:28,fontWeight:700}}>{prescriptions.length}</div>
        </div>
        <div className="admin-card">
          <h3>预约总数</h3>
          <div style={{fontSize:28,fontWeight:700}}>{appointments.length}</div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12,marginBottom:18}}>
        <div className="admin-card" style={{cursor:'pointer',transition:'all 0.2s'}} onClick={() => setActiveTab('stats')}>
          <h3>数据统计</h3>
          <div style={{fontSize:28,fontWeight:700,color:'#10b981'}}>📊</div>
          <div style={{fontSize:12,color:'#6b7280',marginTop:4}}>查看平台数据</div>
        </div>
      </div>

      {/* Tab切换 */}
      <div style={{display:'flex',gap:12,marginBottom:18}}>
        <button
          onClick={() => setActiveTab('doctors')}
          style={{
            padding:'10px 20px', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600,
            background: activeTab === 'doctors' ? '#10b981' : '#f3f4f6',
            color: activeTab === 'doctors' ? '#fff' : '#6b7280'
          }}
        >
          医生审核
        </button>
        <button
          onClick={() => setActiveTab('appointments')}
          style={{
            padding:'10px 20px', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600,
            background: activeTab === 'appointments' ? '#10b981' : '#f3f4f6',
            color: activeTab === 'appointments' ? '#fff' : '#6b7280'
          }}
        >
          预约管理
        </button>
        <button
          onClick={() => { setActiveTab('departments'); }}
          style={{
            padding:'10px 20px', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600,
            background: activeTab === 'departments' ? '#10b981' : '#f3f4f6',
            color: activeTab === 'departments' ? '#fff' : '#6b7280'
          }}
        >
          科室管理
        </button>
        <button
          onClick={() => { setActiveTab('schedules'); loadSchedules(); }}
          style={{
            padding:'10px 20px', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600,
            background: activeTab === 'schedules' ? '#10b981' : '#f3f4f6',
            color: activeTab === 'schedules' ? '#fff' : '#6b7280'
          }}
        >
          排班管理
        </button>
        <button
          onClick={() => { setActiveTab('patients'); setPatientPage(1); loadPatients(1, patientQ); }}
          style={{
            padding:'10px 20px', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600,
            background: activeTab === 'patients' ? '#10b981' : '#f3f4f6',
            color: activeTab === 'patients' ? '#fff' : '#6b7280'
          }}
        >
          患者管理
        </button>
        <button
          onClick={() => { setActiveTab('notifications'); loadNotifications(); }}
          style={{
            padding:'10px 20px', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600,
            background: activeTab === 'notifications' ? '#10b981' : '#f3f4f6',
            color: activeTab === 'notifications' ? '#fff' : '#6b7280'
          }}
        >
          通知公告
        </button>
      </div>

      {activeTab === 'doctors' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 420px',gap:18}}>
          <div>
            <h3>医生审核</h3>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {doctors.slice(0,20).map(d=>(
                <div key={d.username} onClick={async ()=>{
                  try{
                    const authStored = getStoredAuth()
                    const resp = await fetch(`${BASE}/admin/doctor/${d.username}`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
                    if (resp.ok) {
                      const full = await resp.json()
                      setSelectedDoctorFull(full)
                      setShowDoctorModal(true)
                    } else {
                      setSelectedDoctorFull(d)
                      setShowDoctorModal(true)
                    }
                  }catch(e){
                    setSelectedDoctor(d)
                  }
                }} style={{background: selectedDoctor?.username===d.username ? '#f0f9f4' : '#fff',padding:12,borderRadius:8,marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',border: selectedDoctor?.username===d.username ? '1px solid #10b981' : '1px solid #f1f5f9'}}>
                <div>
                  <div style={{fontWeight:700}}>{d.display_name || d.username}</div>
                  <div style={{fontSize:12,color:'#6b7280'}}>{d.clinic} · {d.specialties}</div>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  {d.verified ? (
                    <div style={{padding:'6px 10px',background:'#ecfdf5',color:'#065f46',borderRadius:8,fontWeight:600}}>已通过</div>
                  ) : (
                    <button className="btn-primary" onClick={async (e)=>{
                      e.stopPropagation()
                      try{
                        const authStored = getStoredAuth()
                        if (!authStored?.token) { alert('请先以管理员登录'); return }
                        const resp = await fetch(`${BASE}/admin/approve-doctor/${d.username}`, { method:'POST', headers: { 'Authorization': 'Bearer ' + (authStored.token || '') }})
                        const body = await resp.json().catch(()=>({}))
                        if (resp.ok) {
                          alert(body.message || '已通过')
                          loadOverview()
                        } else {
                          console.error('approve failed', resp.status, body)
                          alert(body.error || '通过失败')
                        }
                      }catch(err){
                        console.error('approve error', err)
                        alert('通过时发生错误，请查看控制台')
                      }
                    }}>通过</button>
                  )}
                  <button className="btn-ghost" onClick={(e)=>{ e.stopPropagation(); setSelectedDoctor(d); setShowRejectModal(true); }}>驳回</button>
                </div>
              </div>
            ))}
            </div>
          </div>

          <aside style={{background:'#fff',padding:12,borderRadius:8}}>
            <h3>最近订单</h3>
            <div style={{maxHeight:300,overflow:'auto'}}>
              {orders.slice(0,8).map(o=>(
                <div key={o.id} style={{padding:8,borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <div style={{flex:1, cursor:'pointer'}} onClick={async ()=>{
                    try{
                      const authStored = getStoredAuth()
                      const resp = await fetch(`${BASE}/cases/${o.id}`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
                      if (resp.ok) {
                        const cc = await resp.json()
                        setChatMessages(cc.messages || [])
                        setSelectedCase(cc)
                        try {
                          const authStored = getStoredAuth()
                          const p = await fetch(`${BASE}/patient-info/${cc.owner}`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
                          if (p.ok) {
                            const pd = await p.json()
                            setSelectedPatientInfo(pd)
                          } else {
                            setSelectedPatientInfo({ username: cc.owner })
                          }
                        } catch (e) {
                          setSelectedPatientInfo({ username: cc.owner })
                        }
                        setShowChatModal(true)
                      } else {
                        const resp2 = await fetch(`${BASE}/cases/${o.id}`)
                        if (resp2.ok) {
                          const cc = await resp2.json()
                          setChatMessages(cc.messages || [])
                          setShowChatModal(true)
                        } else {
                          alert('无法加载会话')
                        }
                      }
                    }catch(e){
                      console.error('load case failed', e)
                      alert('加载会话失败')
                    }
                  }}>
                    <div style={{fontWeight:700}}>{o.title}</div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{fontSize:12,color:'#6b7280'}}>{o.patient_name || o.owner} · {o.status}</div>
                      {o.chat_banned ? <div style={{padding:'4px 8px',background:'#fee2e2',color:'#b91c1c',borderRadius:6,fontSize:12,fontWeight:700}}>聊天已封禁</div> : null}
                    </div>
                    {o.prescription_id ? (
                      <div style={{fontSize:12,color:'#10b981',marginTop:4}}>处方已开具</div>
                    ) : null}
                  </div>
                  <div style={{marginLeft:12}}>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <button className="btn-ghost" onClick={async (e)=>{
                        e.stopPropagation()
                        try{
                          const authStored = getStoredAuth()
                          const resp = await fetch(`${BASE}/cases/${o.id}`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
                          if (resp.ok) {
                            const cc = await resp.json()
                            setChatMessages(cc.messages || [])
                            setSelectedCase(cc)
                            try {
                              const authStored = getStoredAuth()
                              const p = await fetch(`${BASE}/patient-info/${cc.owner}`, { headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
                              if (p.ok) {
                                const pd = await p.json()
                                setSelectedPatientInfo(pd)
                              } else {
                                setSelectedPatientInfo({ username: cc.owner })
                              }
                            } catch (e) {
                              setSelectedPatientInfo({ username: cc.owner })
                            }
                            setShowChatModal(true)
                          } else {
                            alert('无法加载对话')
                          }
                        }catch(err){
                          console.error(err)
                          alert('加载对话失败')
                        }
                      }}>查看对话</button>
                      {o.chat_banned ? (
                        <button className="btn-ghost" onClick={async (e)=>{
                          e.stopPropagation()
                          if (!confirm('确定解除该会话的聊天封禁吗？')) return
                          try {
                            const authStored = getStoredAuth()
                            const r = await fetch(`${BASE}/cases/${o.id}/ban`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') } })
                            if (r.ok) {
                              setOrders(prev => prev.map(x => x.id === o.id ? { ...x, chat_banned: 0 } : x))
                              alert('已解除封禁')
                            } else {
                              const d = await r.json().catch(()=>({})); alert(d.error || '解除封禁失败')
                            }
                          } catch (e) { console.error(e); alert('网络错误') }
                        }}>解除封禁</button>
                      ) : (
                        <button className="btn-ghost" onClick={async (e)=>{
                          e.stopPropagation()
                          const reason = prompt('请输入封禁原因（可选）')
                          if (reason === null) return
                          try {
                            const authStored = getStoredAuth()
                            const r = await fetch(`${BASE}/cases/${o.id}/ban`, { method: 'POST', headers: { 'Content-Type':'application/json','Authorization': 'Bearer ' + (authStored?.token || '') }, body: JSON.stringify({ reason }) })
                            if (r.ok) {
                              setOrders(prev => prev.map(x => x.id === o.id ? { ...x, chat_banned: 1 } : x))
                              alert('已封禁聊天')
                            } else {
                              const d = await r.json().catch(()=>({})); alert(d.error || '封禁失败')
                            }
                          } catch (e) { console.error(e); alert('网络错误') }
                        }}>封禁聊天</button>
                      )}
                      {o.prescription_id ? (
                        <button
                          className="btn-ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            console.log('Button clicked, prescription_id:', o.prescription_id)
                            fetchPrescriptionDetail(o.prescription_id)
                          }}
                          style={{color:'#10b981', fontWeight:600, padding:'6px 12px', border:'1px solid #10b981', borderRadius:6, cursor:'pointer', background:'#f0fdf4'}}
                        >
                          查看处方
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      {activeTab === 'appointments' && (
        <div style={{background:'#fff',borderRadius:12,padding:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <h3 style={{margin:0}}>预约管理</h3>
            <div style={{display:'flex',gap:8}}>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e5e7eb',fontSize:14}}
              >
                <option value="">全部状态</option>
                <option value="scheduled">待确认</option>
                <option value="confirmed">已确认</option>
                <option value="completed">已完成</option>
                <option value="cancelled">已取消</option>
              </select>
              <button className="btn-ghost" onClick={loadOverview}>刷新</button>
            </div>
          </div>

          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'#f9fafb', borderBottom:'1px solid #e5e7eb'}}>
                <th style={{padding:'12px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>ID</th>
                <th style={{padding:'12px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>患者</th>
                <th style={{padding:'12px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>医生</th>
                <th style={{padding:'12px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>日期</th>
                <th style={{padding:'12px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>时间</th>
                <th style={{padding:'12px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>状态</th>
                <th style={{padding:'12px', textAlign:'left', fontWeight:600, fontSize:'13px', color:'#6b7280'}}>操作</th>
              </tr>
            </thead>
            <tbody>
              {appointments.filter(a => !statusFilter || a.status === statusFilter).map(apt => (
                <tr key={apt.id} style={{borderBottom:'1px solid #f3f4f6'}}>
                  <td style={{padding:'12px'}}>{apt.id}</td>
                  <td style={{padding:'12px'}}>
                    <button className="btn-ghost" style={{padding:0,fontWeight:600,color:'#10b981'}} onClick={() => apt.patient_username && openPatientDetail(apt.patient_username)}>
                      {apt.patient_name || apt.patient_username || '-'}
                    </button>
                    <div style={{fontSize:12,color:'#6b7280'}}>{apt.patient_phone || '-'}</div>
                  </td>
                  <td style={{padding:'12px'}}>
                    <div style={{fontWeight:600}}>{apt.doctor_name}</div>
                    <div style={{fontSize:12,color:'#6b7280'}}>{apt.doctor_clinic}</div>
                  </td>
                  <td style={{padding:'12px'}}>{apt.date}</td>
                  <td style={{padding:'12px'}}>{apt.start_time} - {apt.end_time}</td>
                  <td style={{padding:'12px'}}>{getStatusBadge(apt.status)}</td>
                  <td style={{padding:'12px'}}>
                    {apt.status !== 'cancelled' && apt.status !== 'completed' && (
                      <button
                        className="btn-ghost"
                        onClick={async () => {
                          if (!confirm('确定要取消该预约吗？')) return
                          try {
                            const authStored = getStoredAuth()
                            const resp = await fetch(`${BASE}/appointments/${apt.id}/cancel`, {
                              method: 'POST',
                              headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }
                            })
                            if (resp.ok) {
                              alert('取消成功')
                              loadOverview()
                            } else {
                              const d = await resp.json().catch(()=>({}))
                              alert(d.error || '取消失败')
                            }
                          } catch (e) {
                            console.error(e)
                            alert('网络错误')
                          }
                        }}
                        style={{background:'#fee2e2',color:'#dc2626',border:'none',padding:'6px 12px',borderRadius:6,cursor:'pointer'}}
                      >
                        取消
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {appointments.length === 0 && (
                <tr><td colSpan={7} style={{padding:'40px', textAlign:'center', color:'#9ca3af'}}>暂无预约记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ==================== 科室管理 Tab ==================== */}
      {activeTab === 'departments' && (
        <div style={{background:'#fff',borderRadius:12,padding:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <h3 style={{margin:0}}>科室管理</h3>
            <div style={{display:'flex',gap:8}}>
              <input
                type="text"
                placeholder="搜索科室..."
                value={deptFilter}
                onChange={e => setDeptFilter(e.target.value)}
                style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e5e7eb',fontSize:14,width:180}}
              />
              <button className="btn-primary" onClick={() => {
                setEditingDept(null)
                setDeptForm({ name: '', description: '', icon: '', sort_order: 0 })
                setShowDeptModal(true)
              }}>+ 新增科室</button>
              <button className="btn-ghost" onClick={loadOverview}>刷新</button>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:16}}>
            {departments.filter(d => !deptFilter || d.name.includes(deptFilter) || (d.description && d.description.includes(deptFilter))).map(dept => (
              <div key={dept.id} style={{
                border:'1px solid #e5e7eb',
                borderRadius:10,
                padding:16,
                cursor:'pointer',
                transition:'all 0.2s',
                background:'#fff'
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#10b981'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#e5e7eb'}
              >
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>{dept.name}</div>
                    <div style={{fontSize:12,color:'#6b7280',marginBottom:8}}>{dept.description || '暂无描述'}</div>
                  </div>
                  <div style={{display:'flex',gap:4}}>
                    <button className="btn-ghost" style={{padding:'4px 8px',fontSize:12}} onClick={(e) => {
                      e.stopPropagation()
                      setEditingDept(dept)
                      setDeptForm({ name: dept.name, description: dept.description || '', icon: dept.icon || '', sort_order: dept.sort_order || 0 })
                      setShowDeptModal(true)
                    }}>编辑</button>
                    <button className="btn-ghost" style={{padding:'4px 8px',fontSize:12,color:'#ef4444'}} onClick={(e) => {
                      e.stopPropagation()
                      if (!confirm(`确定删除科室 "${dept.name}" 吗？`)) return
                      handleDeleteDepartment(dept.id, dept.name)
                    }}>删除</button>
                  </div>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:13}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{background:'#f3f4f6',color:'#6b7280',padding:'4px 8px',borderRadius:6}}>
                      医生: {dept.doctor_count || 0} 名
                    </span>
                    {dept.icon && (
                      <span style={{color:'#9ca3af'}}>{dept.icon}</span>
                    )}
                  </div>
                  <button className="btn-ghost" style={{padding:'4px 8px',fontSize:12,color:'#10b981'}} onClick={(e) => {
                    e.stopPropagation()
                    handleViewDeptDoctors(dept)
                  }}>查看医生</button>
                </div>
              </div>
            ))}
            {departments.filter(d => !deptFilter || d.name.includes(deptFilter) || (d.description && d.description.includes(deptFilter))).length === 0 && (
              <div style={{gridColumn:'1 / -1',padding:'40px',textAlign:'center',color:'#9ca3af'}}>
                {deptFilter ? '未找到匹配的科室' : '暂无科室，请点击右上角添加'}
              </div>
            )}
          </div>

          <div style={{marginTop:20,padding:'12px 16px',background:'#f9fafb',borderRadius:8,fontSize:13,color:'#6b7280'}}>
            <strong>统计信息：</strong> 共有 <strong>{departments.length}</strong> 个科室，
            其中 <strong>{departments.reduce((sum, d) => sum + (d.doctor_count || 0), 0)}</strong> 名医生已分配科室
          </div>
        </div>
      )}

      {/* ==================== 科室详情 Modal ==================== */}
      {showDeptModal && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#fff',padding:24,borderRadius:12,width:520,maxWidth:'95%'}}>
            <h3 style={{marginTop:0,marginBottom:16}}>{editingDept ? '编辑科室' : '新增科室'}</h3>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>科室名称 *</label>
                <input
                  type="text"
                  value={deptForm.name}
                  onChange={e => setDeptForm(prev => ({...prev, name: e.target.value}))}
                  style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}}
                  placeholder="如：内科、外科、心血管科"
                />
              </div>
              <div>
                <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>科室描述</label>
                <textarea
                  value={deptForm.description}
                  onChange={e => setDeptForm(prev => ({...prev, description: e.target.value}))}
                  style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,resize:'vertical',minHeight:80,boxSizing:'border-box'}}
                  placeholder="描述科室的主要诊疗范围..."
                />
              </div>
              <div>
                <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>图标标识</label>
                <input
                  type="text"
                  value={deptForm.icon}
                  onChange={e => setDeptForm(prev => ({...prev, icon: e.target.value}))}
                  style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}}
                  placeholder="如：heart、brain、bone"
                />
              </div>
              <div>
                <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>排序序号</label>
                <input
                  type="number"
                  value={deptForm.sort_order}
                  onChange={e => setDeptForm(prev => ({...prev, sort_order: parseInt(e.target.value) || 0}))}
                  style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}}
                  placeholder="数字越小越靠前"
                />
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:20}}>
              <button className="btn-ghost" onClick={() => { setShowDeptModal(false); setEditingDept(null) }}>取消</button>
              <button className="btn-primary" onClick={handleSaveDepartment}>{editingDept ? '保存修改' : '创建科室'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 科室医生列表 Modal ==================== */}
      {selectedDepartment && !showDeptModal && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#fff',padding:24,borderRadius:12,width:680,maxWidth:'95%',maxHeight:'80vh',overflow:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <h3 style={{margin:0}}>科室医生 - {selectedDepartment.name}</h3>
              <button className="btn-ghost" onClick={() => setSelectedDepartment(null)}>关闭</button>
            </div>
            {departmentDoctors.length > 0 ? (
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{background:'#f9fafb',borderBottom:'1px solid #e5e7eb'}}>
                    <th style={{padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>医生姓名</th>
                    <th style={{padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>所属机构</th>
                    <th style={{padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>专业方向</th>
                    <th style={{padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>状态</th>
                    <th style={{padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {departmentDoctors.map(doc => (
                    <tr key={doc.username} style={{borderBottom:'1px solid #f3f4f6'}}>
                      <td style={{padding:'12px',fontWeight:600}}>{doc.display_name || doc.username}</td>
                      <td style={{padding:'12px',fontSize:13,color:'#6b7280'}}>{doc.clinic || '-'}</td>
                      <td style={{padding:'12px',fontSize:13,color:'#6b7280'}}>{doc.specialties || '-'}</td>
                      <td style={{padding:'12px'}}>
                        {doc.verified ? (
                          <span style={{padding:'4px 8px',background:'#d1fae5',color:'#065f46',borderRadius:6,fontSize:12,fontWeight:600}}>已认证</span>
                        ) : (
                          <span style={{padding:'4px 8px',background:'#fef3c7',color:'#92400e',borderRadius:6,fontSize:12,fontWeight:600}}>待审核</span>
                        )}
                      </td>
                      <td style={{padding:'12px'}}>
                        <button className="btn-ghost" style={{padding:'4px 8px',fontSize:12}} onClick={() => {
                          setReassignDoctor({
                            username: doc.username,
                            name: doc.display_name || doc.username,
                            currentDeptId: selectedDepartment.id
                          })
                        }}>调整科室</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{padding:'40px',textAlign:'center',color:'#9ca3af'}}>
                该科室暂无医生
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 医生科室调整 Modal ==================== */}
      {reassignDoctor && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10000}}>
          <div style={{background:'#fff',padding:24,borderRadius:12,width:420,maxWidth:'95%'}}>
            <h3 style={{marginTop:0,marginBottom:16}}>调整医生科室</h3>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:14,marginBottom:4}}><strong>医生：</strong>{reassignDoctor.name}</div>
              <div style={{fontSize:14,color:'#6b7280'}}>
                <strong>当前科室：</strong>{departments.find(d => d.id === reassignDoctor.currentDeptId)?.name || '未分配'}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{display:'block',marginBottom:8,fontWeight:600,fontSize:14}}>选择新科室</label>
              <select
                id="dept-select"
                style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14}}
                defaultValue=""
              >
                <option value="" disabled>请选择科室...</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
                <option value="__unassigned__">取消分配（设为未分配）</option>
              </select>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn-ghost" onClick={() => setReassignDoctor(null)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const select = document.getElementById('dept-select')
                const val = select.value
                if (!val) {
                  alert('请选择科室')
                  return
                }
                const newDeptId = val === '__unassigned__' ? null : parseInt(val)
                handleUpdateDoctorDepartment(reassignDoctor.username, newDeptId)
                setReassignDoctor(null)
              }}>确认调整</button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 数据统计 Tab ==================== */}
      {activeTab === 'stats' && <AdminStatsPanel />}

      {/* ==================== 排班管理 Tab ==================== */}
      {activeTab === 'schedules' && (
        <div style={{background:'#fff',borderRadius:12,padding:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <h3 style={{margin:0}}>排班管理</h3>
            <div style={{display:'flex',gap:8}}>
              <button className="btn-primary" onClick={() => {
                setEditingSchedule(null)
                setScheduleForm({ doctor_username: '', date: '', start_time: '08:00', end_time: '12:00', max_appointments: 10, fee: 0 })
                setShowScheduleModal(true)
              }}>+ 添加排班</button>
              <button className="btn-primary" onClick={() => {
                setBatchForm({ doctor_username: '', start_date: '', end_date: '', template: { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [] } })
                setShowBatchModal(true)
              }} style={{background:'#3b82f6'}}>+ 批量排班</button>
              <button className="btn-ghost" onClick={loadSchedules}>刷新</button>
            </div>
          </div>

          {/* 筛选条件 */}
          <div style={{display:'flex',gap:12,marginBottom:20,padding:16,background:'#f9fafb',borderRadius:8}}>
            <div>
              <label style={{display:'block',marginBottom:4,fontSize:13,color:'#6b7280'}}>选择医生</label>
              <select value={scheduleDoctor} onChange={e => setScheduleDoctor(e.target.value)} style={{padding:'8px 12px',borderRadius:6,border:'1px solid #e5e7eb',minWidth:160}}>
                <option value="">全部医生</option>
                {doctors.map(d => <option key={d.username} value={d.username}>{d.display_name || d.username}</option>)}
              </select>
            </div>
            <div>
              <label style={{display:'block',marginBottom:4,fontSize:13,color:'#6b7280'}}>开始日期</label>
              <input type="date" value={scheduleDateFrom} onChange={e => setScheduleDateFrom(e.target.value)} style={{padding:'8px 12px',borderRadius:6,border:'1px solid #e5e7eb'}} />
            </div>
            <div>
              <label style={{display:'block',marginBottom:4,fontSize:13,color:'#6b7280'}}>结束日期</label>
              <input type="date" value={scheduleDateTo} onChange={e => setScheduleDateTo(e.target.value)} style={{padding:'8px 12px',borderRadius:6,border:'1px solid #e5e7eb'}} />
            </div>
            <div style={{display:'flex',alignItems:'flex-end'}}>
              <button className="btn-ghost" onClick={() => { setScheduleDoctor(''); setScheduleDateFrom(''); setScheduleDateTo(''); }}>清除筛选</button>
            </div>
          </div>

          {/* 排班列表 */}
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#f9fafb',borderBottom:'1px solid #e5e7eb'}}>
                  <th style={{padding:'12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>日期</th>
                  <th style={{padding:'12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>医生</th>
                  <th style={{padding:'12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>时段</th>
                  <th style={{padding:'12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>最大/已预约</th>
                  <th style={{padding:'12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>费用</th>
                  <th style={{padding:'12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>状态</th>
                  <th style={{padding:'12px',textAlign:'left',fontWeight:600,fontSize:13,color:'#6b7280'}}>操作</th>
                </tr>
              </thead>
              <tbody>
                {schedules.filter(s => {
                  if (scheduleDoctor && s.doctor_username !== scheduleDoctor) return false
                  if (scheduleDateFrom && s.date < scheduleDateFrom) return false
                  if (scheduleDateTo && s.date > scheduleDateTo) return false
                  return true
                }).map(sched => (
                  <tr key={sched.id} style={{borderBottom:'1px solid #f3f4f6'}}>
                    <td style={{padding:'12px',fontWeight:600}}>{sched.date}</td>
                    <td style={{padding:'12px'}}>
                      <div style={{fontWeight:600}}>{sched.doctor_name}</div>
                      <div style={{fontSize:12,color:'#6b7280'}}>{sched.doctor_clinic}</div>
                    </td>
                    <td style={{padding:'12px'}}>{sched.start_time} - {sched.end_time}</td>
                    <td style={{padding:'12px'}}>
                      <span style={{fontWeight:700,color: sched.remaining > 0 ? '#10b981' : '#ef4444'}}>{sched.remaining}</span>
                      <span style={{color:'#9ca3af'}}> / {sched.max_appointments}</span>
                    </td>
                    <td style={{padding:'12px',fontWeight:600,color:'#f59e0b'}}>¥{sched.fee}</td>
                    <td style={{padding:'12px'}}>
                      {sched.is_available ? (
                        <span style={{padding:'4px 8px',background:'#d1fae5',color:'#065f46',borderRadius:6,fontSize:12,fontWeight:600}}>可预约</span>
                      ) : (
                        <span style={{padding:'4px 8px',background:'#fee2e2',color:'#b91c1c',borderRadius:6,fontSize:12,fontWeight:600}}>已停诊</span>
                      )}
                    </td>
                    <td style={{padding:'12px'}}>
                      <button className="btn-ghost" style={{padding:'4px 8px',fontSize:12,marginRight:4}} onClick={() => {
                        setEditingSchedule(sched)
                        setScheduleForm({
                          doctor_username: sched.doctor_username,
                          date: sched.date,
                          start_time: sched.start_time,
                          end_time: sched.end_time,
                          max_appointments: sched.max_appointments,
                          fee: sched.fee
                        })
                        setShowScheduleModal(true)
                      }}>编辑</button>
                      <button className="btn-ghost" style={{padding:'4px 8px',fontSize:12,color:'#ef4444'}} onClick={() => {
                        if (!confirm('确定删除该排班吗？')) return
                        handleDeleteSchedule(sched.id)
                      }}>删除</button>
                    </td>
                  </tr>
                ))}
                {schedules.filter(s => {
                  if (scheduleDoctor && s.doctor_username !== scheduleDoctor) return false
                  if (scheduleDateFrom && s.date < scheduleDateFrom) return false
                  if (scheduleDateTo && s.date > scheduleDateTo) return false
                  return true
                }).length === 0 && (
                  <tr><td colSpan={7} style={{padding:'40px',textAlign:'center',color:'#9ca3af'}}>暂无排班记录</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{marginTop:16,padding:'12px 16px',background:'#f9fafb',borderRadius:8,fontSize:13,color:'#6b7280'}}>
            <strong>提示：</strong> 批量排班可一次性为医生设置一周或一个月的固定排班模板，提高工作效率。
          </div>
        </div>
      )}

      {/* ==================== 添加/编辑排班 Modal ==================== */}
      {showScheduleModal && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10000}}>
          <div style={{background:'#fff',padding:24,borderRadius:12,width:480,maxWidth:'95%'}}>
            <h3 style={{marginTop:0,marginBottom:16}}>{editingSchedule ? '编辑排班' : '添加排班'}</h3>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>选择医生 *</label>
                <select value={scheduleForm.doctor_username} onChange={e => setScheduleForm(p => ({...p, doctor_username: e.target.value}))}
                  style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}}>
                  <option value="">请选择医生...</option>
                  {doctors.map(d => <option key={d.username} value={d.username}>{d.display_name || d.username}</option>)}
                </select>
              </div>
              <div>
                <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>排班日期 *</label>
                <input type="date" value={scheduleForm.date} onChange={e => setScheduleForm(p => ({...p, date: e.target.value}))}
                  style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}} />
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>开始时间 *</label>
                  <input type="time" value={scheduleForm.start_time} onChange={e => setScheduleForm(p => ({...p, start_time: e.target.value}))}
                    style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}} />
                </div>
                <div>
                  <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>结束时间 *</label>
                  <input type="time" value={scheduleForm.end_time} onChange={e => setScheduleForm(p => ({...p, end_time: e.target.value}))}
                    style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}} />
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>最大预约数</label>
                  <input type="number" value={scheduleForm.max_appointments} min={1} max={100}
                    onChange={e => setScheduleForm(p => ({...p, max_appointments: parseInt(e.target.value) || 10}))}
                    style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}} />
                </div>
                <div>
                  <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>挂号费用(元)</label>
                  <input type="number" value={scheduleForm.fee} min={0} step={0.01}
                    onChange={e => setScheduleForm(p => ({...p, fee: parseFloat(e.target.value) || 0}))}
                    style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}} />
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:20}}>
              <button className="btn-ghost" onClick={() => setShowScheduleModal(false)}>取消</button>
              <button className="btn-primary" onClick={handleSaveSchedule}>{editingSchedule ? '保存修改' : '添加排班'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 批量排班 Modal ==================== */}
      {showBatchModal && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10000}}>
          <div style={{background:'#fff',padding:24,borderRadius:12,width:720,maxWidth:'95%',maxHeight:'90vh',overflow:'auto'}}>
            <h3 style={{marginTop:0,marginBottom:16}}>批量排班</h3>
            <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:16}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                <div>
                  <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>选择医生 *</label>
                  <select value={batchForm.doctor_username} onChange={e => setBatchForm(p => ({...p, doctor_username: e.target.value}))}
                    style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}}>
                    <option value="">请选择医生...</option>
                    {doctors.map(d => <option key={d.username} value={d.username}>{d.display_name || d.username}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>开始日期 *</label>
                  <input type="date" value={batchForm.start_date} onChange={e => setBatchForm(p => ({...p, start_date: e.target.value}))}
                    style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}} />
                </div>
                <div>
                  <label style={{display:'block',marginBottom:4,fontWeight:600,fontSize:14}}>结束日期 *</label>
                  <input type="date" value={batchForm.end_date} onChange={e => setBatchForm(p => ({...p, end_date: e.target.value}))}
                    style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box'}} />
                </div>
              </div>
              <div>
                <label style={{display:'block',marginBottom:8,fontWeight:600,fontSize:14}}>排班模板（按星期设置）</label>
                <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:8}}>
                  {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((day, idx) => {
                    const dayKey = String(idx + 1)
                    const daySlots = batchForm.template[dayKey] || []
                    return (
                      <div key={day} style={{border:'1px solid #e5e7eb',borderRadius:8,padding:8,background:'#f9fafb'}}>
                        <div style={{fontWeight:600,fontSize:13,marginBottom:8,textAlign:'center'}}>{day}</div>
                        {daySlots.map((slot, sIdx) => (
                          <div key={sIdx} style={{display:'flex',gap:4,marginBottom:4,alignItems:'center',fontSize:12}}>
                            <input type="time" value={slot.start} onChange={e => {
                              const newTemplate = {...batchForm.template}
                              newTemplate[dayKey] = [...daySlots]
                              newTemplate[dayKey][sIdx] = {...slot, start: e.target.value}
                              setBatchForm(p => ({...p, template: newTemplate}))
                            }} style={{width:70,padding:'4px',borderRadius:4,border:'1px solid #d1d5db',fontSize:11}} />
                            <span>-</span>
                            <input type="time" value={slot.end} onChange={e => {
                              const newTemplate = {...batchForm.template}
                              newTemplate[dayKey] = [...daySlots]
                              newTemplate[dayKey][sIdx] = {...slot, end: e.target.value}
                              setBatchForm(p => ({...p, template: newTemplate}))
                            }} style={{width:70,padding:'4px',borderRadius:4,border:'1px solid #d1d5db',fontSize:11}} />
                            <input type="number" value={slot.max} placeholder="数量" min={1}
                              onChange={e => {
                                const newTemplate = {...batchForm.template}
                                newTemplate[dayKey] = [...daySlots]
                                newTemplate[dayKey][sIdx] = {...slot, max: parseInt(e.target.value) || 10}
                                setBatchForm(p => ({...p, template: newTemplate}))
                              }}
                              style={{width:40,padding:'4px',borderRadius:4,border:'1px solid #d1d5db',fontSize:11}} />
                            <button onClick={() => {
                              const newTemplate = {...batchForm.template}
                              newTemplate[dayKey] = daySlots.filter((_, i) => i !== sIdx)
                              setBatchForm(p => ({...p, template: newTemplate}))
                            }} style={{border:'none',background:'#fee2e2',color:'#b91c1c',borderRadius:4,padding:'2px 4px',cursor:'pointer',fontSize:10}}>×</button>
                          </div>
                        ))}
                        <button onClick={() => {
                          const newTemplate = {...batchForm.template}
                          newTemplate[dayKey] = [...daySlots, { start: '08:00', end: '12:00', max: 10 }]
                          setBatchForm(p => ({...p, template: newTemplate}))
                        }} style={{width:'100%',marginTop:4,padding:'4px',border:'1px dashed #d1d5db',borderRadius:4,background:'transparent',cursor:'pointer',fontSize:11,color:'#6b7280'}}>+ 添加时段</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn-ghost" onClick={() => setShowBatchModal(false)}>取消</button>
              <button className="btn-primary" onClick={handleBatchSchedule} style={{background:'#3b82f6'}}>确认批量创建</button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 患者管理 Tab ==================== */}
      {activeTab === 'patients' && (
        <div style={{background:'#fff',borderRadius:12,padding:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:12}}>
            <h3 style={{margin:0}}>患者管理</h3>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <button className="btn-primary" onClick={handleExportPatients}>导出 Excel (CSV)</button>
              <button className="btn-ghost" onClick={() => loadPatients(patientPage, patientQ)}>刷新</button>
            </div>
          </div>
          <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16,padding:16,background:'#f9fafb',borderRadius:8}}>
            <input placeholder="姓名/用户名" value={patientQ.name} onChange={e => setPatientQ(p => ({...p, name: e.target.value}))}
              style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e5e7eb',minWidth:140}} />
            <input placeholder="手机号" value={patientQ.phone} onChange={e => setPatientQ(p => ({...p, phone: e.target.value}))}
              style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e5e7eb',minWidth:140}} />
            <input placeholder="身份证号" value={patientQ.id_card} onChange={e => setPatientQ(p => ({...p, id_card: e.target.value}))}
              style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e5e7eb',minWidth:160}} />
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:13,color:'#6b7280'}}>注册从</span>
              <input type="date" value={patientQ.created_from} onChange={e => setPatientQ(p => ({...p, created_from: e.target.value}))}
                style={{padding:'8px',borderRadius:8,border:'1px solid #e5e7eb'}} />
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:13,color:'#6b7280'}}>至</span>
              <input type="date" value={patientQ.created_to} onChange={e => setPatientQ(p => ({...p, created_to: e.target.value}))}
                style={{padding:'8px',borderRadius:8,border:'1px solid #e5e7eb'}} />
            </div>
            <button className="btn-primary" onClick={() => { setPatientPage(1); loadPatients(1, patientQ); }}>查询</button>
            <button className="btn-ghost" onClick={() => {
              const empty = { name: '', phone: '', id_card: '', created_from: '', created_to: '' }
              setPatientQ(empty)
              setPatientPage(1)
              loadPatients(1, empty)
            }}>重置</button>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#f9fafb',borderBottom:'1px solid #e5e7eb'}}>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>用户名</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>姓名</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>手机</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>身份证</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>注册时间</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>状态</th>
                </tr>
              </thead>
              <tbody>
                {patientItems.map(p => (
                  <tr key={p.username} style={{borderBottom:'1px solid #f3f4f6'}}>
                    <td style={{padding:'10px'}}>{p.username}</td>
                    <td style={{padding:'10px'}}>
                      <button className="btn-ghost" style={{padding:0,fontWeight:600,color:'#10b981'}} onClick={() => openPatientDetail(p.username)}>
                        {p.display_name || p.username}
                      </button>
                    </td>
                    <td style={{padding:'10px',fontSize:13}}>{p.emergency_phone || '-'}</td>
                    <td style={{padding:'10px',fontSize:13}}>{p.id_card || '-'}</td>
                    <td style={{padding:'10px',fontSize:13}}>{formatTs(p.created_at)}</td>
                    <td style={{padding:'10px'}}>
                      {p.is_banned ? <span style={{padding:'4px 8px',background:'#fee2e2',color:'#b91c1c',borderRadius:6,fontSize:12}}>已禁用</span>
                        : p.is_frozen ? <span style={{padding:'4px 8px',background:'#fef3c7',color:'#92400e',borderRadius:6,fontSize:12}}>已冻结</span>
                        : <span style={{padding:'4px 8px',background:'#d1fae5',color:'#065f46',borderRadius:6,fontSize:12}}>正常</span>}
                    </td>
                  </tr>
                ))}
                {patientItems.length === 0 && (
                  <tr><td colSpan={6} style={{padding:'36px',textAlign:'center',color:'#9ca3af'}}>暂无患者数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:16}}>
            <span style={{fontSize:13,color:'#6b7280'}}>共 {patientTotal} 条，每页 {patientPerPage} 条</span>
            <div style={{display:'flex',gap:8}}>
              <button className="btn-ghost" disabled={patientPage <= 1} onClick={() => { const p = patientPage - 1; setPatientPage(p); loadPatients(p, patientQ); }}>上一页</button>
              <span style={{fontSize:14,lineHeight:'32px'}}>第 {patientPage} 页</span>
              <button className="btn-ghost" disabled={patientPage * patientPerPage >= patientTotal} onClick={() => { const p = patientPage + 1; setPatientPage(p); loadPatients(p, patientQ); }}>下一页</button>
            </div>
          </div>
        </div>
      )}

      {showPatientDetail && patientEdit && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10001,overflow:'auto',padding:16}}>
          <div style={{background:'#fff',padding:24,borderRadius:12,width:640,maxWidth:'100%',maxHeight:'92vh',overflow:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <h3 style={{margin:0}}>患者详情 — {patientDetailUsername}</h3>
              <button className="btn-ghost" onClick={() => { setShowPatientDetail(false); setPatientEdit(null) }}>关闭</button>
            </div>
            <div style={{fontSize:13,color:'#6b7280',marginBottom:12}}>
              注册时间：{formatTs(patientEdit.created_at)} · 最后登录：{formatTs(patientEdit.last_login_at)}
            </div>
            <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
              <button className="btn-primary" onClick={handleSavePatientEdit}>保存编辑</button>
              <button className="btn-ghost" onClick={() => handlePatientStatus('enable')}>启用</button>
              <button className="btn-ghost" style={{color:'#b91c1c'}} onClick={() => { if (confirm('确定禁用该患者？')) handlePatientStatus('disable') }}>禁用</button>
              <button className="btn-ghost" style={{color:'#92400e'}} onClick={() => handlePatientStatus('freeze')}>冻结</button>
              <button className="btn-ghost" onClick={() => handlePatientStatus('unfreeze')}>解冻</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              {[
                ['display_name', '真实姓名/显示名'],
                ['gender', '性别'],
                ['birthday', '出生日期'],
                ['id_card', '身份证号'],
                ['emergency_phone', '联系电话'],
                ['emergency_name', '紧急联系人'],
              ].map(([key, label]) => (
                <div key={key}>
                  <label style={{display:'block',fontSize:13,marginBottom:4,color:'#374151'}}>{label}</label>
                  <input value={patientEdit[key] || ''} onChange={e => setPatientEdit(pe => ({...pe, [key]: e.target.value}))}
                    style={{width:'100%',padding:'8px 10px',border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}} />
                </div>
              ))}
            </div>
            <div style={{marginTop:12}}>
              <label style={{display:'block',fontSize:13,marginBottom:4}}>既往病史 / 慢性病</label>
              <textarea value={patientEdit.medical_history || ''} onChange={e => setPatientEdit(pe => ({...pe, medical_history: e.target.value}))}
                style={{width:'100%',minHeight:56,padding:8,border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}} />
            </div>
            <div style={{marginTop:12}}>
              <label style={{display:'block',fontSize:13,marginBottom:4}}>过敏史</label>
              <textarea value={patientEdit.allergies || ''} onChange={e => setPatientEdit(pe => ({...pe, allergies: e.target.value}))}
                style={{width:'100%',minHeight:48,padding:8,border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}} />
            </div>
            <div style={{marginTop:12}}>
              <label style={{display:'block',fontSize:13,marginBottom:4}}>健康备注</label>
              <textarea value={patientEdit.health_info || ''} onChange={e => setPatientEdit(pe => ({...pe, health_info: e.target.value}))}
                style={{width:'100%',minHeight:48,padding:8,border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}} />
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:12}}>
              {[
                ['height', '身高'],
                ['weight', '体重'],
                ['blood_type', '血型'],
                ['insurance', '医保信息'],
              ].map(([key, label]) => (
                <div key={key}>
                  <label style={{display:'block',fontSize:13,marginBottom:4}}>{label}</label>
                  <input value={patientEdit[key] || ''} onChange={e => setPatientEdit(pe => ({...pe, [key]: e.target.value}))}
                    style={{width:'100%',padding:'8px 10px',border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}} />
                </div>
              ))}
            </div>
            <div style={{marginTop:12}}>
              <label style={{display:'block',fontSize:13,marginBottom:4}}>用药情况</label>
              <textarea value={patientEdit.medications || ''} onChange={e => setPatientEdit(pe => ({...pe, medications: e.target.value}))}
                style={{width:'100%',minHeight:40,padding:8,border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}} />
            </div>
            <div style={{marginTop:12}}>
              <label style={{display:'block',fontSize:13,marginBottom:4}}>慢性病</label>
              <input value={patientEdit.chronic || ''} onChange={e => setPatientEdit(pe => ({...pe, chronic: e.target.value}))}
                style={{width:'100%',padding:'8px 10px',border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}} />
            </div>
            <div style={{marginTop:16,padding:12,background:'#f9fafb',borderRadius:8,fontSize:13}}>
              当前状态：
              {patientEdit.is_banned ? <strong style={{color:'#b91c1c'}}> 已禁用</strong> : null}
              {patientEdit.is_frozen ? <strong style={{color:'#92400e'}}> 已冻结</strong> : null}
              {!patientEdit.is_banned && !patientEdit.is_frozen ? <strong style={{color:'#065f46'}}> 正常</strong> : null}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 通知公告 Tab ==================== */}
      {activeTab === 'notifications' && (
        <div style={{background:'#fff',borderRadius:12,padding:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:12}}>
            <h3 style={{margin:0}}>通知公告管理</h3>
            <button className="btn-primary" onClick={handleNewNotification}>+ 新建通知</button>
          </div>

          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#f9fafb',borderBottom:'1px solid #e5e7eb'}}>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>置顶</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>状态</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>标题</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>类型</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>优先级</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>创建时间</th>
                  <th style={{padding:'10px',textAlign:'left',fontSize:13,color:'#6b7280'}}>操作</th>
                </tr>
              </thead>
              <tbody>
                {notifications.map(notif => (
                  <tr key={notif.id} style={{borderBottom:'1px solid #f3f4f6'}}>
                    <td style={{padding:'10px',textAlign:'center'}}>
                      {notif.is_pinned ? <span style={{color:'#f59e0b',fontSize:16}}>📌</span> : '-'}
                    </td>
                    <td style={{padding:'10px'}}>
                      {notif.is_active ? (
                        <span style={{padding:'4px 8px',background:'#d1fae5',color:'#065f46',borderRadius:6,fontSize:12}}>显示</span>
                      ) : (
                        <span style={{padding:'4px 8px',background:'#f3f4f6',color:'#6b7280',borderRadius:6,fontSize:12}}>隐藏</span>
                      )}
                    </td>
                    <td style={{padding:'10px',fontWeight:600,maxWidth:240}}>
                      <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{notif.title}</div>
                    </td>
                    <td style={{padding:'10px',fontSize:13}}>
                      <span style={{padding:'4px 8px',background:'#eff6ff',color:'#1d4ed8',borderRadius:6,fontSize:12}}>
                        {notif.type === 'system' ? '系统' : notif.type === 'announcement' ? '公告' : '其他'}
                      </span>
                    </td>
                    <td style={{padding:'10px',fontSize:13}}>
                      {notif.priority > 0 ? <span style={{color:'#dc2626'}}>高 {notif.priority}</span> : '-'}
                    </td>
                    <td style={{padding:'10px',fontSize:13}}>{formatTs(notif.created_at)}</td>
                    <td style={{padding:'10px'}}>
                      <button className="btn-ghost" style={{padding:'4px 8px',marginRight:8,fontSize:13}} onClick={() => handleEditNotification(notif)}>编辑</button>
                      <button className="btn-ghost" style={{padding:'4px 8px',color:'#dc2626',fontSize:13}} onClick={() => handleDeleteNotification(notif.id)}>删除</button>
                    </td>
                  </tr>
                ))}
                {notifications.length === 0 && (
                  <tr><td colSpan={7} style={{padding:'36px',textAlign:'center',color:'#9ca3af'}}>暂无通知公告</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 通知编辑模态框 */}
      {showNotifModal && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10001}}>
          <div style={{background:'#fff',padding:24,borderRadius:12,width:600,maxWidth:'96%',maxHeight:'90vh',overflow:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <h3 style={{margin:0}}>{editingNotif ? '编辑通知' : '新建通知'}</h3>
              <button className="btn-ghost" onClick={() => setShowNotifModal(false)}>关闭</button>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
              <div>
                <label style={{display:'block',fontSize:13,marginBottom:6,color:'#374151'}}>标题 *</label>
                <input
                  value={notifForm.title}
                  onChange={e => setNotifForm(f => ({...f, title: e.target.value}))}
                  style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}}
                  placeholder="通知标题"
                />
              </div>
              <div>
                <label style={{display:'block',fontSize:13,marginBottom:6,color:'#374151'}}>类型</label>
                <select
                  value={notifForm.type}
                  onChange={e => setNotifForm(f => ({...f, type: e.target.value}))}
                  style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}}
                >
                  <option value="system">系统通知</option>
                  <option value="announcement">公告</option>
                  <option value="activity">活动</option>
                  <option value="other">其他</option>
                </select>
              </div>
            </div>

            <div style={{marginBottom:16}}>
              <label style={{display:'block',fontSize:13,marginBottom:6,color:'#374151'}}>内容 *</label>
              <textarea
                value={notifForm.content}
                onChange={e => setNotifForm(f => ({...f, content: e.target.value}))}
                style={{width:'100%',minHeight:120,padding:10,border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box',resize:'vertical'}}
                placeholder="通知内容"
              />
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:16}}>
              <div>
                <label style={{display:'block',fontSize:13,marginBottom:6,color:'#374151'}}>优先级</label>
                <select
                  value={notifForm.priority}
                  onChange={e => setNotifForm(f => ({...f, priority: parseInt(e.target.value) || 0}))}
                  style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}}
                >
                  <option value="0">普通</option>
                  <option value="1">中等</option>
                  <option value="2">高</option>
                  <option value="3">紧急</option>
                </select>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:16,paddingTop:28}}>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                  <input
                    type="checkbox"
                    checked={notifForm.is_pinned}
                    onChange={e => setNotifForm(f => ({...f, is_pinned: e.target.checked}))}
                  />
                  <span style={{fontSize:13}}>置顶显示</span>
                </label>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                  <input
                    type="checkbox"
                    checked={notifForm.is_active}
                    onChange={e => setNotifForm(f => ({...f, is_active: e.target.checked}))}
                  />
                  <span style={{fontSize:13}}>启用</span>
                </label>
              </div>
              <div>
                <label style={{display:'block',fontSize:13,marginBottom:6,color:'#374151'}}>目标用户</label>
                <input
                  value={notifForm.target_users}
                  onChange={e => setNotifForm(f => ({...f, target_users: e.target.value}))}
                  style={{width:'100%',padding:'10px 12px',border:'1px solid #d1d5db',borderRadius:8,boxSizing:'border-box'}}
                  placeholder="留空表示全部用户"
                />
              </div>
            </div>

            <div style={{display:'flex',gap:12,justifyContent:'flex-end'}}>
              <button className="btn-ghost" onClick={() => setShowNotifModal(false)}>取消</button>
              <button className="btn-primary" onClick={handleSaveNotification}>
                {editingNotif ? '保存修改' : '发布通知'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {showRejectModal && selectedDoctor && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#fff',padding:20,borderRadius:8,width:520,maxWidth:'90%'}}>
            <h3>驳回理由 — {selectedDoctor.display_name || selectedDoctor.username}</h3>
            <textarea value={rejectReason} onChange={e=>setRejectReason(e.target.value)} style={{width:'100%',minHeight:120,padding:8}} placeholder="请输入驳回原因（必须）" />
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:12}}>
              <button className="btn-ghost" onClick={()=>{ setShowRejectModal(false); setRejectReason('') }}>取消</button>
              <button className="btn-primary" onClick={async ()=>{
                if (!rejectReason.trim()) { alert('请输入驳回原因'); return }
                try{
                  const resp = await fetch(`${BASE}/admin/reject-doctor/${selectedDoctor.username}`, { method:'POST', headers: { 'Content-Type':'application/json','Authorization': 'Bearer ' + (auth?.token || '') }, body: JSON.stringify({ reason: rejectReason })})
                  if (resp.ok) {
                    alert('已驳回')
                    setShowRejectModal(false)
                    setRejectReason('')
                    loadOverview()
                  } else {
                    alert('已驳回（本地模拟）')
                    setShowRejectModal(false)
                    setRejectReason('')
                  }
                }catch(e){
                  alert('已驳回（本地模拟）')
                  setShowRejectModal(false)
                  setRejectReason('')
                }
              }}>提交驳回</button>
            </div>
          </div>
        </div>
      )}

      {/* Chat modal */}
      {showChatModal && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#fff',padding:20,borderRadius:8,width:800,maxWidth:'95%',maxHeight:'90%',overflow:'auto'}}>
            <h3>对话记录</h3>
            {selectedCase && (
              <div style={{padding:8, marginBottom:8, border:'1px solid #eef2f7', borderRadius:6, background:'#fff'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:700}}>{selectedCase.title}</div>
                    <div style={{fontSize:12,color:'#6b7280'}}>{selectedCase.owner} · {selectedCase.status || ''}</div>
                  </div>
                  <div>
                    <div style={{fontSize:12,color:'#6b7280'}}>接单医生：{selectedCase.assigned_doctor || '未分配'}</div>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 300px',gap:12}}>
                  <div style={{maxHeight:'50vh',overflow:'auto',padding:8,border:'1px solid #eef2f7',borderRadius:6,background:'#fbfdff'}}>
                    {chatMessages.length===0 ? <div style={{color:'#6b7280'}}>暂无消息</div> : chatMessages.map((m,idx)=>(
                      <div key={idx} style={{marginBottom:8,display:'flex',justifyContent: m.role==='doctor' ? 'flex-end' : 'flex-start'}}>
                        <div style={{maxWidth:'70%',padding:10,borderRadius:8,background: m.role==='doctor' ? '#10b981' : '#f3f4f6',color: m.role==='doctor' ? '#fff' : '#111827'}}>{m.content}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:12}}>
                    <div style={{background:'#fff',padding:12,borderRadius:6,border:'1px solid #eef2f7'}}>
                      <h4 style={{marginTop:0}}>患者信息</h4>
                      {selectedPatientInfo ? (
                        <div style={{fontSize:14}}>
                          <div><strong>用户名：</strong>{selectedPatientInfo.username}</div>
                          <div><strong>姓名：</strong>{selectedPatientInfo.display_name || '未填写'}</div>
                          <div><strong>联系电话：</strong>{selectedPatientInfo.emergency_phone || selectedPatientInfo.phone || '未填写'}</div>
                          <div><strong>过敏史：</strong>{selectedPatientInfo.allergies || '无'}</div>
                        </div>
                      ) : <div style={{color:'#6b7280'}}>无法读取患者信息</div>}
                    </div>
                    {selectedCase && selectedCase.prescription_id ? (
                      <div style={{background:'#fff',padding:12,borderRadius:6,border:'1px solid #10b981'}}>
                        <h4 style={{marginTop:0,color:'#10b981'}}>处方信息</h4>
                        <div style={{fontSize:14}}>
                          <div><strong>处方ID：</strong>{selectedCase.prescription_id}</div>
                          <button
                            className="btn-ghost"
                            onClick={() => fetchPrescriptionDetail(selectedCase.prescription_id)}
                            style={{marginTop:8,color:'#10b981',fontWeight:600}}
                          >
                            查看处方详情
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{background:'#fff',padding:12,borderRadius:6,border:'1px solid #eef2f7'}}>
                        <h4 style={{marginTop:0}}>处方信息</h4>
                        <div style={{fontSize:14,color:'#6b7280'}}>暂无处方</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div style={{display:'flex',justifyContent:'flex-end',marginTop:12}}>
              <button className="btn-ghost" onClick={()=>setShowChatModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* Doctor detail modal */}
      {showDoctorModal && selectedDoctorFull && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#fff',padding:20,borderRadius:8,width:760,maxWidth:'96%',maxHeight:'90%',overflow:'auto'}}>
            <h3>医生资料 - {selectedDoctorFull.display_name || selectedDoctorFull.username}</h3>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:8}}>
              <div><strong>用户名：</strong>{selectedDoctorFull.username}</div>
              <div><strong>工作机构：</strong>{selectedDoctorFull.clinic || '未填写'}</div>
              <div><strong>联系电话：</strong>{selectedDoctorFull.phone || '请输入联系电话'}</div>
              <div><strong>执业证号：</strong>{selectedDoctorFull.license_number || '未填写'}</div>
              <div><strong>执业证到期：</strong>{selectedDoctorFull.license_expiry || '未填写'}</div>
              <div><strong>专业/科室：</strong>{selectedDoctorFull.specialties || '请输入专业方向，用逗号分隔'}</div>
              <div style={{gridColumn:'1 / -1'}}>
                <strong>个人简介：</strong>
                <div style={{marginTop:6, padding:8, background:'#f9fafb', borderRadius:6}}>{selectedDoctorFull.bio || '无'}</div>
              </div>
              <div style={{gridColumn:'1 / -1'}}>
                <strong>资质文件：</strong>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
                  {(selectedDoctorFull.license_file_urls && selectedDoctorFull.license_file_urls.length>0) ? selectedDoctorFull.license_file_urls.map((u,i)=>(
                    <a key={i} href={u.startsWith('http') ? u : BASE + u} target="_blank" rel="noreferrer" style={{padding:'8px 12px',background:'#f3f4f6',borderRadius:6}}>查看文件{i+1}</a>
                  )) : <div style={{color:'#6b7280'}}>未上传文件</div>}
                </div>
              </div>
            </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:12}}>
              <button className="btn-ghost" onClick={()=>setShowDoctorModal(false)}>关闭</button>
              <button className="btn-primary" onClick={async ()=>{
                try{
                  const authStored = getStoredAuth()
                  const resp = await fetch(`${BASE}/admin/approve-doctor/${selectedDoctorFull.username}`, { method:'POST', headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
                  const body = await resp.json().catch(()=>({}))
                  if (resp.ok) {
                    alert(body.message || '已通过')
                    setShowDoctorModal(false)
                    loadOverview()
                  } else {
                    console.error('approve failed', resp.status, body)
                    alert(body.error || '通过失败')
                  }
                }catch(e){
                  console.error('approve error', e)
                  alert('通过时发生错误，请查看控制台')
                }
              }}>通过</button>
              <button className="btn-ghost" onClick={()=>{ setSelectedDoctor(selectedDoctorFull); setShowRejectModal(true); }}>驳回</button>
              <button className="btn-ghost" onClick={async ()=>{
                if (!confirm('确认封禁该医生账号？')) return
                try{
                  const authStored = getStoredAuth()
                  const resp = await fetch(`${BASE}/admin/ban-user/${selectedDoctorFull.username}`, { method:'POST', headers: { 'Authorization': 'Bearer ' + (authStored?.token || '') }})
                  if (resp.ok) {
                    alert('已封禁')
                    setShowDoctorModal(false)
                    loadOverview()
                  } else {
                    alert('封禁（本地）')
                  }
                }catch(e){ alert('封禁（本地）') }
              }}>封禁</button>
            </div>
          </div>
        </div>
      )}

      {/* 处方详情弹窗 */}
      {showPrescriptionModal && prescriptionDetail && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10000}}>
          <div style={{background:'#fff',padding:24,borderRadius:12,width:600,maxWidth:'95%',maxHeight:'90vh',overflow:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <h3 style={{margin:0}}>处方详情</h3>
              <button className="btn-ghost" onClick={()=>{ setShowPrescriptionModal(false); setPrescriptionDetail(null); }}>关闭</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
              <div><strong>处方ID：</strong>{prescriptionDetail.id}</div>
              <div><strong>医生：</strong>{prescriptionDetail.doctor_name || prescriptionDetail.doctor || '未知'}</div>
              <div><strong>开具时间：</strong>{prescriptionDetail.created_at ? new Date(prescriptionDetail.created_at * 1000).toLocaleString('zh-CN') : '-'}</div>
              <div><strong>状态：</strong>
                <span style={{padding:'4px 8px',background: prescriptionDetail.is_paid ? '#d1fae5' : '#fef3c7',color: prescriptionDetail.is_paid ? '#065f46' : '#92400e',borderRadius:6,fontSize:12}}>
                  {prescriptionDetail.is_paid ? '已支付' : '未支付'}
                </span>
              </div>
            </div>
            {prescriptionDetail.content ? (
              <div style={{marginBottom:16}}>
                <strong>处方内容：</strong>
                <div style={{marginTop:8,padding:12,background:'#f9fafb',borderRadius:8,whiteSpace:'pre-wrap',fontSize:14}}>
                  {prescriptionDetail.content}
                </div>
              </div>
            ) : null}
            {prescriptionDetail.medicines && prescriptionDetail.medicines.length > 0 && (
              <div style={{marginBottom:16}}>
                <strong>药品列表：</strong>
                <table style={{width:'100%',marginTop:8,borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{background:'#f3f4f6'}}>
                      <th style={{padding:'8px',textAlign:'left',borderBottom:'1px solid #e5e7eb'}}>药品名称</th>
                      <th style={{padding:'8px',textAlign:'left',borderBottom:'1px solid #e5e7eb'}}>单价/单位</th>
                      <th style={{padding:'8px',textAlign:'left',borderBottom:'1px solid #e5e7eb'}}>数量</th>
                      <th style={{padding:'8px',textAlign:'left',borderBottom:'1px solid #e5e7eb'}}>用法用量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prescriptionDetail.medicines.map((med, idx) => (
                      <tr key={idx}>
                        <td style={{padding:'8px',borderBottom:'1px solid #f3f4f6'}}>{med.name}</td>
                        <td style={{padding:'8px',borderBottom:'1px solid #f3f4f6'}}>{med.price || 0}元/{med.unit || '份'}</td>
                        <td style={{padding:'8px',borderBottom:'1px solid #f3f4f6'}}>{med.qty || 1}</td>
                        <td style={{padding:'8px',borderBottom:'1px solid #f3f4f6'}}>
                          {med.unitsPerDose && med.timesPerDay && med.days
                            ? `每次${med.unitsPerDose}单位，每天${med.timesPerDay}次，共${med.days}天`
                            : (med.usage || '-')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {prescriptionDetail.image_url ? (
              <div>
                <strong>处方图片：</strong>
                <div style={{marginTop:8}}>
                  <img src={prescriptionDetail.image_url} alt="处方图片" style={{maxWidth:'100%',maxHeight:400,borderRadius:8,border:'1px solid #e5e7eb'}} />
                </div>
              </div>
            ) : null}
            <div style={{display:'flex',justifyContent:'flex-end',marginTop:16}}>
              <button className="btn-ghost" onClick={()=>{ setShowPrescriptionModal(false); setPrescriptionDetail(null); }}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== 数据统计面板组件 ====================
function AdminStatsPanel() {
  const [stats, setStats] = useState({
    patients: 0, doctors: 0, verifiedDoctors: 0,
    appointments: 0, completedAppointments: 0, cases: 0, departments: 0,
    totalRevenue: 0, monthlyRevenue: 0, prescriptionCount: 0
  })
  const [departmentStats, setDepartmentStats] = useState([])
  const [appointmentStatus, setAppointmentStatus] = useState([])
  const [recentAppointments, setRecentAppointments] = useState([])
  const [revenueTrend, setRevenueTrend] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadStats() }, [])

  async function loadStats() {
    try {
      const authStored = getStoredAuth()
      const headers = { 'Authorization': 'Bearer ' + (authStored?.token || '') }
      const [statsRes, deptRes, apptRes, revenueRes] = await Promise.all([
        fetch(`${BASE}/admin/stats`, { headers }),
        fetch(`${BASE}/admin/department-stats`, { headers }),
        fetch(`${BASE}/admin/appointments`, { headers }),
        fetch(`${BASE}/admin/revenue`, { headers }).catch(() => ({ ok: false }))
      ])
      if (statsRes.ok) setStats(await statsRes.json())
      if (deptRes.ok) setDepartmentStats(await deptRes.json())
      if (apptRes.ok) {
        const data = await apptRes.json()
        const appts = data.appointments || []
        const statusCount = {}
        appts.forEach(a => { statusCount[a.status] = (statusCount[a.status] || 0) + 1 })
        setAppointmentStatus(Object.entries(statusCount).map(([s, c]) => ({ status: s, count: c })))
        setRecentAppointments(appts.slice(0, 10))
      }
      if (revenueRes.ok) {
        const revenueData = await revenueRes.json()
        setRevenueTrend(revenueData.trend || [])
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  function getStatusColor(s) { return { scheduled: '#f59e0b', confirmed: '#3b82f6', completed: '#10b981', cancelled: '#ef4444' }[s] || '#6b7280' }
  function getStatusName(s) { return { scheduled: '待确认', confirmed: '已确认', completed: '已完成', cancelled: '已取消' }[s] || s }
  function pct(c, t) { return t === 0 ? 0 : Math.round((c / t) * 100) }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>加载中...</div>

  const totalAppt = appointmentStatus.reduce((s, i) => s + i.count, 0)
  const maxDoctors = Math.max(...departmentStats.map(d => d.doctor_count || 0), 1)
  const maxRevenue = Math.max(...revenueTrend.map(r => r.amount || 0), 1)

  return (
    <div>
      {/* 核心指标卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 24 }}>
        {[
          { title: '患者总数', value: stats.patients, icon: '👥', bg: '#ecfdf5', color: '#10b981', trend: '+12%' },
          { title: '医生总数', value: stats.doctors, icon: '👨‍⚕️', bg: '#eff6ff', color: '#3b82f6', trend: '+5%' },
          { title: '认证医生', value: stats.verifiedDoctors, icon: '✅', bg: '#f5f3ff', color: '#8b5cf6' },
          { title: '预约总数', value: stats.appointments, icon: '📅', bg: '#fffbeb', color: '#f59e0b' },
          { title: '已完成预约', value: stats.completedAppointments, icon: '✓', bg: '#ecfdf5', color: '#10b981' },
          { title: '咨询病例', value: stats.cases, icon: '💬', bg: '#fdf2f8', color: '#ec4899' },
          { title: '总收入', value: `¥${(stats.totalRevenue || 0).toLocaleString()}`, icon: '💰', bg: '#fef3c7', color: '#d97706' },
          { title: '本月收入', value: `¥${(stats.monthlyRevenue || 0).toLocaleString()}`, icon: '📈', bg: '#fce7f3', color: '#db2777' },
        ].map((s, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: 16, transition: 'all 0.2s', cursor: 'pointer' }}
               onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'}
               onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)'}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 图表区域 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24, marginBottom: 24 }}>
        {/* 预约状态分布 */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#111827' }}>预约状态分布</h3>
          {totalAppt === 0 ? <div style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>暂无数据</div> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <svg width="200" height="200" viewBox="0 0 200 200">
                {(() => {
                  let angle = 0
                  return appointmentStatus.map((item, idx) => {
                    const a = (item.count / totalAppt) * 360
                    const startA = angle - 90
                    angle += a
                    const r = 80, cx = 100, cy = 100
                    const x1 = cx + r * Math.cos(startA * Math.PI / 180)
                    const y1 = cy + r * Math.sin(startA * Math.PI / 180)
                    const x2 = cx + r * Math.cos((startA + a) * Math.PI / 180)
                    const y2 = cy + r * Math.sin((startA + a) * Math.PI / 180)
                    const path = a === 360 ? `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2 - 0.01} ${y2} Z` : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${a > 180 ? 1 : 0} 1 ${x2} ${y2} Z`
                    return <path key={item.status} d={path} fill={getStatusColor(item.status)} />
                  })
                })()}
                <circle cx="100" cy="100" r="40" fill="white" />
                <text x="100" y="105" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#374151">{totalAppt}</text>
              </svg>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {appointmentStatus.map(item => (
                  <div key={item.status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: getStatusColor(item.status) }} />
                    <span style={{ fontSize: 13, color: '#374151' }}>{getStatusName(item.status)}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{item.count}</span>
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>({pct(item.count, totalAppt)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 各科室医生分布 */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#111827' }}>各科室医生分布</h3>
          {departmentStats.length === 0 ? <div style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>暂无数据</div> : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, padding: '10px 0' }}>
              {departmentStats.map((dept, idx) => (
                <div key={dept.id || idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, maxWidth: 60 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{dept.doctor_count || 0}</div>
                  <div style={{ width: '100%', height: Math.max(((dept.doctor_count || 0) / maxDoctors) * 130, 4), background: '#3b82f6', borderRadius: '4px 4px 0 0', transition: 'all 0.3s' }} />
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4, textAlign: 'center', wordBreak: 'break-word' }}>{dept.name?.slice(0, 3)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 收入趋势图 */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#111827' }}>近7天收入趋势</h3>
          {revenueTrend.length === 0 ? <div style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>暂无数据</div> : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 160, padding: '10px 0' }}>
              {revenueTrend.map((day, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>
                    ¥{(day.amount || 0).toLocaleString()}
                  </div>
                  <div style={{ width: '100%', height: Math.max(((day.amount || 0) / maxRevenue) * 100, 4), background: idx === revenueTrend.length - 1 ? '#10b981' : '#3b82f6', borderRadius: '4px 4px 0 0', transition: 'all 0.3s' }} />
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>{day.date?.slice(-5) || ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 近期预约表格 */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#111827' }}>近期预约</h3>
        {recentAppointments.length === 0 ? <div style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>暂无预约数据</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                {['ID', '患者', '医生', '日期', '时间', '状态'].map(h => (
                  <th key={h} style={{ padding: '12px', textAlign: 'left', fontSize: 13, color: '#6b7280', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentAppointments.map(apt => (
                <tr key={apt.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: 12, fontSize: 13 }}>{apt.id}</td>
                  <td style={{ padding: 12, fontSize: 13 }}>{apt.patient_name || apt.patient_username || '-'}</td>
                  <td style={{ padding: 12, fontSize: 13 }}>{apt.doctor_name || apt.doctor_username || '-'}</td>
                  <td style={{ padding: 12, fontSize: 13 }}>{apt.date || apt.start_date || '-'}</td>
                  <td style={{ padding: 12, fontSize: 13 }}>{apt.start_time ? `${apt.start_time} - ${apt.end_time || ''}` : apt.start_hour || '-'}</td>
                  <td style={{ padding: 12 }}>
                    <span style={{ padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: getStatusColor(apt.status) + '20', color: getStatusColor(apt.status) }}>
                      {getStatusName(apt.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
