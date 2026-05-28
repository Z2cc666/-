import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const BASE = 'http://127.0.0.1:8080'

const AvatarPlaceholder = ({ name, size = 64 }) => {
  const initials = (name || 'U').slice(0, 1).toUpperCase()
  const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899']
  const colorIndex = name ? name.charCodeAt(0) % colors.length : 0
  const bgColor = colors[colorIndex]

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '12px',
      background: `linear-gradient(135deg, ${bgColor}, ${bgColor}dd)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontSize: size * 0.4,
      fontWeight: 'bold',
      border: '2px solid #e5e7eb'
    }}>
      {initials}
    </div>
  )
}

export default function ConsultationSquare() {
  const [doctors, setDoctors] = useState([])
  const navigate = useNavigate()

  useEffect(()=>{
    async function load(){
      try{
        const resp = await fetch(`${BASE}/doctors`)
        if(!resp.ok) {
          console.error('Failed to fetch doctors:', resp.status)
          return
        }
        const data = await resp.json()
        // API returns {"doctors": [...]} so we need to extract the array
        const doctorsArray = Array.isArray(data) ? data : (Array.isArray(data.doctors) ? data.doctors : [])
        setDoctors(doctorsArray)
      }catch(e){
        console.error('Error loading doctors:', e)
        setDoctors([])
      }
    }
    load()
  },[])

  return (
    <div style={{padding: '24px', background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)', minHeight: '100vh'}}>
      <div style={{maxWidth: '1200px', margin: '0 auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center', marginBottom: '32px'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <button onClick={() => navigate('/profile')} style={{background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 14}}>
              ← 返回
            </button>
            <div>
              <h1 style={{margin: '0 0 8px 0', fontSize: '32px', fontWeight: 'bold', color: '#1f2937'}}>
                🏥 问诊广场
              </h1>
              <p style={{margin: 0, color: '#6b7280', fontSize: '16px'}}>
                选择专业医生，开启您的健康之旅
              </p>
            </div>
          </div>
          <div style={{display:'flex',gap:12}}>
            <button
              className="btn-ghost"
              onClick={()=>navigate('/profile')}
              style={{padding: '10px 20px', borderRadius: '8px'}}
            >
              我的资料
            </button>
            <button
              className="btn-primary"
              onClick={()=>navigate('/request-consultation')}
              style={{padding: '10px 20px', borderRadius: '8px'}}
            >
              发起求助
            </button>
          </div>
        </div>

        <div style={{
          display:'grid',
          gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px'
        }}>
          {doctors.length===0 ? (
            <div style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '80px 40px',
              background: 'rgba(255,255,255,0.9)',
              borderRadius: '16px',
              color: '#6b7280',
              fontSize: '18px'
            }}>
              暂无医生展示
            </div>
          ) : doctors.map(d=>(
            <div
              key={d.username}
              style={{
                background: '#fff',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
                border: '1px solid #e5e7eb',
                transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = '0 20px 60px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 10px 40px rgba(0,0,0,0.1)';
              }}
            >
              <div style={{display:'flex', gap: '16px', alignItems:'center', marginBottom: '16px'}}>
                {d.avatar_url ? (
                  <img
                    src={d.avatar_url}
                    alt={d.display_name}
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '12px',
                      objectFit: 'cover',
                      border: '2px solid #e5e7eb'
                    }}
                  />
                ) : (
                  <AvatarPlaceholder name={d.display_name || d.username} size={64} />
                )}
                <div style={{flex: 1}}>
                  <div style={{fontSize: '18px', fontWeight: 'bold', color: '#1f2937', marginBottom: '4px'}}>
                    {d.display_name || d.username}
                  </div>
                  <div style={{
                    fontSize: '14px',
                    color: '#059669',
                    background: '#dcfce7',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    display: 'inline-block',
                    marginBottom: '4px'
                  }}>
                    {d.specialties || '全科'}
                  </div>
                  <div style={{fontSize: '14px', color: '#6b7280'}}>
                    🏥 {d.clinic || '知名医院'}
                  </div>
                </div>
              </div>

              {d.bio && (
                <div style={{
                  fontSize: '14px',
                  color: '#4b5563',
                  lineHeight: '1.5',
                  marginBottom: '20px',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}>
                  {d.bio.length > 100 ? d.bio.substring(0, 100) + '...' : d.bio}
                </div>
              )}

              <div style={{display:'flex', gap: '12px'}}>
                <button
                  className="btn-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/request-consultation?doctor=${d.username}`);
                  }}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  立即求助
                </button>
                <button
                  className="btn-ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/doctor-detail/${d.username}`);
                  }}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  查看详情
                </button>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}


