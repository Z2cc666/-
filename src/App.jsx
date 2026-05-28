import React, { useEffect, useState, useRef } from 'react'
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import Auth from './pages/Auth'
import ClinicianAuth from './pages/ClinicianAuth'
import Profile from './pages/Profile'
import DoctorProfile from './pages/DoctorProfile'
import DoctorConsultations from './pages/DoctorConsultations'
import DoctorChat from './pages/DoctorChat'
import DoctorPatientChat from './pages/DoctorPatientChat'
import PatientDoctorChat from './pages/PatientDoctorChat'
import DoctorPrescription from './pages/DoctorPrescription'
import DoctorDetail from './pages/DoctorDetail'
import DoctorCaseDetail from './pages/DoctorCaseDetail'
import DoctorCases from './pages/DoctorCases'
import DoctorStats from './pages/DoctorStats'
import DoctorCalendar from './pages/DoctorCalendar'
import DoctorSettings from './pages/DoctorSettings'
import RequestConsultation from './pages/RequestConsultation'
import AdminAuth from './pages/AdminAuth'
import AdminDashboard from './pages/AdminDashboard'
import AdminStats from './pages/AdminStats'
import ConsultationSquare from './pages/ConsultationSquare'
import MyOrders from './pages/MyOrders'
import MyAppointments from './pages/MyAppointments'
import QuickRegister from './pages/QuickRegister'
import CaseDetail from './pages/CaseDetail'
import { getStoredAuth, clearAuth } from './utils/auth'

export default function App() {
  const [auth, setAuth] = useState(getStoredAuth())
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // 调试信息
  console.log('App auth state:', auth)

  useEffect(() => {
    const stored = getStoredAuth()
    setAuth(stored)
  }, [])

  function handleLogout() {
    clearAuth()
    setAuth(null)
    navigate('/auth')
  }
  useEffect(() => {
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const location = useLocation()

  return (
    <div className="app-root">
      <header className={`app-header ${(location.pathname === '/auth' || location.pathname === '/clinician-auth' || location.pathname === '/doctor/profile') ? 'header--overlay' : ''}`}>
        <div className="brand">
          <Link to="/">
            <svg className="brand-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#bgrad)"></rect>
              <defs>
                <linearGradient id="bgrad" x1="0" x2="1">
                  <stop offset="0%" stopColor="#10b981"/>
                  <stop offset="50%" stopColor="#f97316"/>
                  <stop offset="100%" stopColor="#0ea5e9"/>
                </linearGradient>
              </defs>
              <path d="M12 7v10M7 12h10" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="brand-text">医疗问诊机器人</span>
          </Link>
        </div>
        <div className="nav">
          <div className="header-tools" style={{display:'flex',gap:8,alignItems:'center',marginRight:12}}>
            <Link to="/consultation-square" className="btn-ghost">问诊广场</Link>
          </div>
          {auth ? (
            <div className="avatar-menu" ref={menuRef}>
              <img className="top-avatar" src={auth.avatar || '/placeholder.png'} alt="avatar" onClick={() => setMenuOpen(v => !v)} />
              {menuOpen && (
                <div className="menu-pop">
                  <div className="menu-item" onClick={() => { navigate(auth?.user_type === 'doctor' ? '/doctor/profile' : '/profile'); setMenuOpen(false) }}>个人中心</div>
                  <div className="menu-item" onClick={() => { handleLogout(); setMenuOpen(false) }}>登出</div>
                </div>
              )}
            </div>
          ) : (
            <Link to="/auth" className="btn-primary"><span className="btn-text-gradient">登录 / 注册</span></Link>
          )}
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home auth={auth} />} />
          <Route path="/auth" element={<Auth onAuth={(a)=>{ setAuth(a); navigate('/profile') }} />} />
          <Route path="/clinician-auth" element={<ClinicianAuth onAuth={(a)=>{ setAuth(a); navigate('/profile') }} />} />
          <Route path="/admin-auth" element={<AdminAuth />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/stats" element={<AdminStats />} />
          <Route path="/profile" element={<Profile auth={auth} onUpdate={setAuth} />} />
          <Route path="/doctor/profile" element={<DoctorProfile auth={auth} onUpdate={setAuth} />} />
          <Route path="/doctor-consultations" element={<DoctorConsultations />} />
          <Route path="/doctor-patient-chat/:caseId" element={<DoctorPatientChat />} />
          <Route path="/doctor-chat" element={<DoctorChat />} />
          <Route path="/doctor-prescription/:caseId" element={<DoctorPrescription />} />
          <Route path="/doctor-case/:caseId" element={<DoctorCaseDetail />} />
          <Route path="/doctor-cases" element={<DoctorCases />} />
          <Route path="/doctor-stats" element={<DoctorStats />} />
          <Route path="/doctor-calendar" element={<DoctorCalendar />} />
          <Route path="/doctor-settings" element={<DoctorSettings />} />
          <Route path="/case-detail/:caseId" element={<CaseDetail />} />
          <Route path="/doctor-detail/:username" element={<DoctorDetail />} />
          <Route path="/request-consultation" element={<RequestConsultation />} />
          <Route path="/consultation-square" element={<ConsultationSquare />} />
          <Route path="/my-orders" element={<MyOrders />} />
          <Route path="/my-appointments" element={<MyAppointments />} />
          <Route path="/quick-register" element={<QuickRegister />} />
        </Routes>
      </main>
    </div>
  )
}


