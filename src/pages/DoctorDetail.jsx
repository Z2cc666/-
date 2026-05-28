import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function DoctorDetail() {
  const { username } = useParams()
  const navigate = useNavigate()
  const [doctor, setDoctor] = useState(null)
  const [loading, setLoading] = useState(true)
  const auth = getStoredAuth()

  useEffect(() => {
    async function loadDoctor() {
      try {
        // 首先尝试从/doctors API获取医生信息
        const resp = await fetch(`${BASE}/doctors`)
        if (resp.ok) {
          const data = await resp.json()
          // API返回 {"doctors": [...]} 格式
          const doctors = Array.isArray(data) ? data : (data.doctors || [])
          const found = doctors.find(d => d.username === username)
          if (found) {
            setDoctor(found)
            setLoading(false)
            return
          }
        }

        // 如果没找到，尝试从/doctor-info API获取
        const doctorResp = await fetch(`${BASE}/doctor-info/${username}`)
        if (doctorResp.ok) {
          const doctorData = await doctorResp.json()
          setDoctor(doctorData)
        }
      } catch (e) {
        console.error('加载医生信息失败', e)
      } finally {
        setLoading(false)
      }
    }
    loadDoctor()
  }, [username])

  const handleRequestConsultation = () => {
    if (!auth) {
      navigate('/auth')
      return
    }
    // 跳转到求助页面，预选该医生
    navigate(`/request-consultation?doctor=${username}`)
  }

  if (loading) {
    return (
      <div style={{padding: 40, textAlign: 'center'}}>
        <div>加载中...</div>
      </div>
    )
  }

  if (!doctor) {
    return (
      <div style={{padding: 40, textAlign: 'center'}}>
        <div>医生信息不存在</div>
        <button className="btn-secondary" onClick={() => navigate('/consultation-square')} style={{marginTop: 20}}>
          返回问诊广场
        </button>
      </div>
    )
  }

  return (
    <div style={{padding: '24px', maxWidth: '800px', margin: '0 auto'}}>
      <button onClick={() => navigate('/profile')} style={{background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, marginBottom: 20}}>
        ← 返回
      </button>

      <div style={{background: '#fff', borderRadius: '16px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.1)'}}>
        {/* 医生基本信息 */}
        <div style={{display: 'flex', gap: '24px', marginBottom: '32px'}}>
          <img
            src={doctor.avatar_url || '/placeholder.png'}
            alt={doctor.display_name}
            style={{
              width: '120px',
              height: '120px',
              borderRadius: '12px',
              objectFit: 'cover',
              border: '3px solid #f0f0f0'
            }}
          />
          <div style={{flex: 1}}>
            <h1 style={{margin: '0 0 8px 0', fontSize: '28px', fontWeight: 'bold', color: '#1f2937'}}>
              {doctor.display_name}
            </h1>
            <div style={{display: 'flex', gap: '16px', marginBottom: '12px'}}>
              <span style={{
                background: '#dbeafe',
                color: '#1e40af',
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '14px',
                fontWeight: '500'
              }}>
                {doctor.specialties}
              </span>
            </div>
            <div style={{fontSize: '16px', color: '#6b7280', marginBottom: '8px'}}>
              🏥 {doctor.clinic}
            </div>
            {doctor.phone && (
              <div style={{fontSize: '16px', color: '#6b7280'}}>
                📞 {doctor.phone}
              </div>
            )}
          </div>
        </div>

        {/* 医生简介 */}
        {doctor.bio && (
          <div style={{marginBottom: '32px'}}>
            <h2 style={{margin: '0 0 16px 0', fontSize: '20px', fontWeight: 'bold', color: '#1f2937'}}>
              医生简介
            </h2>
            <div style={{
              background: '#f9fafb',
              padding: '20px',
              borderRadius: '12px',
              lineHeight: '1.6',
              color: '#4b5563',
              border: '1px solid #e5e7eb'
            }}>
              {doctor.bio}
            </div>
          </div>
        )}

        {/* 资质信息 */}
        {(doctor.license_number) && (
          <div style={{marginBottom: '32px'}}>
            <h2 style={{margin: '0 0 16px 0', fontSize: '20px', fontWeight: 'bold', color: '#1f2937'}}>
              资质信息
            </h2>
            <div style={{
              background: '#f9fafb',
              padding: '20px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb'
            }}>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px'}}>
                {doctor.license_number && (
                  <div>
                    <div style={{fontSize: '14px', color: '#6b7280', marginBottom: '4px'}}>执业证书号</div>
                    <div style={{fontSize: '16px', fontWeight: '500', color: '#1f2937'}}>{doctor.license_number}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div style={{display: 'flex', gap: '16px', justifyContent: 'center', paddingTop: '24px', borderTop: '1px solid #e5e7eb'}}>
          <button
            className="btn-primary"
            onClick={handleRequestConsultation}
            style={{padding: '12px 32px', fontSize: '16px'}}
          >
            立即求助咨询
          </button>
          <button
            className="btn-secondary"
            onClick={() => navigate('/consultation-square')}
            style={{padding: '12px 32px', fontSize: '16px'}}
          >
            返回广场
          </button>
        </div>
      </div>
    </div>
  )
}



