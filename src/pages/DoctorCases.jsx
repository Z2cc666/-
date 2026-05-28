import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function DoctorCases() {
  const navigate = useNavigate()
  const auth = getStoredAuth()
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false)
  const [datePreset, setDatePreset] = useState('all') // all | today | week | month | custom
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [tagsAvailable, setTagsAvailable] = useState([])
  const [selectedTag, setSelectedTag] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    load()
  }, [statusFilter, debouncedSearch, page, perPage])

  // debounce search input
  useEffect(()=>{
    const t = setTimeout(()=> setDebouncedSearch(searchTerm.trim()), 450)
    setPage(1)
    return ()=>clearTimeout(t)
  }, [searchTerm])

  useEffect(()=>{ fetchTagsList() }, [])

  async function fetchTagsList() {
    try {
      const r = await fetch(`${BASE}/tags`)
      if (!r.ok) return
      const data = await r.json()
      setTagsAvailable((data || []).map(x=>x.tag))
    } catch (e) { console.error('fetch tags failed', e) }
  }

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter)
      if (debouncedSearch) params.set('q', debouncedSearch)
      params.set('page', String(page))
      params.set('per_page', String(perPage))
      const url = `${BASE}/doctor-consultations?${params.toString()}`
      const resp = await fetch(url, { headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {} })
      if (!resp.ok) { setCases([]); setLoading(false); return }
      const data = await resp.json()
      // backend returns { items: [], total }
      if (Array.isArray(data)) {
        setCases(data)
        setTotal(0)
      } else {
        setCases(data.items || [])
        setTotal(data.total || 0)
      }
    } catch (e) {
      console.error('加载接诊列表失败', e)
      setCases([])
    } finally {
      setLoading(false)
    }
  }

  function groupByDate(list) {
    const today = new Date()
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()/1000
    const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay()).getTime()/1000
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime()/1000
    const groups = { '今日': [], '本周': [], '本月': [], '更早': [] }
    list.forEach(c => {
      let t = c.created_at || (c.createdAt) || 0
      // ensure seconds
      if (String(t).length > 10) t = Math.floor(t/1000)
      if (t >= startOfToday) groups['今日'].push(c)
      else if (t >= startOfWeek) groups['本周'].push(c)
      else if (t >= startOfMonth) groups['本月'].push(c)
      else groups['更早'].push(c)
    })
    return groups
  }

  function applyDateFilter(list) {
    if (!list || list.length === 0) return list
    if (datePreset === 'all') return list
    const now = new Date()
    let start = 0, end = Infinity
    if (datePreset === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()/1000
      end = Infinity
    } else if (datePreset === 'week') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime()/1000
      end = Infinity
    } else if (datePreset === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()/1000
      end = Infinity
    } else if (datePreset === 'custom' && customStart) {
      start = Math.floor(new Date(customStart).getTime()/1000)
      end = customEnd ? Math.floor(new Date(customEnd).getTime()/1000) + 86400 : Infinity
    }
    return list.filter(c => {
      let t = c.created_at || c.createdAt || 0
      if (String(t).length > 10) t = Math.floor(t/1000)
      return t >= start && t <= end
    })
  }

  return (
    <div style={{padding:24}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
        <button className="btn-ghost" onClick={() => navigate('/doctor/profile')}>
          ← 返回
        </button>
        <h2>病例管理</h2>
      </div>
      <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:12}}>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{padding:'6px 10px',borderRadius:6,border:'1px solid #d1d5db'}}>
            <option value="all">全部</option>
            <option value="pending">待接</option>
            <option value="active">进行中</option>
            <option value="completed">已完成</option>
          </select>

          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button onClick={()=>setShowOnlyFavorites(v=>!v)} style={{
              padding:'6px 12px',
              borderRadius:20,
              border:'1px solid #d1d5db',
              background: showOnlyFavorites ? '#fef3c7' : '#fff',
              cursor:'pointer'
            }}>{showOnlyFavorites ? '★ 我的收藏' : '☆ 我的收藏'}</button>
          </div>

          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <select value={datePreset} onChange={e=>setDatePreset(e.target.value)} style={{padding:'6px 10px',borderRadius:6,border:'1px solid #d1d5db'}}>
              <option value="all">全部日期</option>
              <option value="today">今日</option>
              <option value="week">本周</option>
              <option value="month">本月</option>
              <option value="custom">自定义</option>
            </select>
            {datePreset === 'custom' && (
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)} />
                <span>—</span>
                <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} />
              </div>
            )}
            <div style={{display:'flex',alignItems:'center',gap:8,marginLeft:8}}>
              <select value={selectedTag} onChange={e=>setSelectedTag(e.target.value)} style={{padding:'6px 10px',borderRadius:6,border:'1px solid #d1d5db'}}>
                <option value="">全部标签</option>
                {tagsAvailable.map(t=> <option key={t} value={t}>{t}</option>)}
              </select>
              {selectedTag && <button onClick={()=>setSelectedTag('')} style={{padding:'6px 8px',borderRadius:6}}>清除</button>}
            </div>
          </div>
      </div>

      <div style={{background:'#fff',padding:12,borderRadius:8}}>
        {loading ? <div style={{padding:24}}>加载中...</div> : (
          (() => {
            let baseList = showOnlyFavorites ? cases.filter(c => c.favorite) : cases
            if (selectedTag) {
              baseList = baseList.filter(c => (c.tags || []).includes(selectedTag))
            }
            const list = applyDateFilter(baseList)
            if (!list || list.length === 0) return <div style={{color:'#6b7280'}}>暂无病例</div>
            const groups = groupByDate(list)
            return (
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <input placeholder="按患者/标题/ID 搜索" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} style={{padding:6,borderRadius:6,border:'1px solid #e5e7eb',minWidth:220}} />
                    <select value={perPage} onChange={e=>{ setPerPage(Number(e.target.value)); setPage(1) }} style={{padding:6,borderRadius:6}}>
                      <option value={5}>5 / 页</option>
                      <option value={10}>10 / 页</option>
                      <option value={20}>20 / 页</option>
                    </select>
                  </div>
                  <div style={{fontSize:12,color:'#6b7280'}}>共 {total || list.length} 条</div>
                </div>
                {Object.keys(groups).map(key => (
                  groups[key].length > 0 ? (
                    <div key={key}>
                      <div style={{fontWeight:700,marginBottom:8}}>{key}</div>
                      <div style={{display:'grid',gap:12}}>
                        {groups[key].map(c => (
                          <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:12,background:'#f9fafb',borderRadius:8}}>
                            <div>
                              <div style={{fontWeight:700}}>{c.title || c.id}</div>
                              <div style={{fontSize:12,color:'#6b7280'}}>{c.owner} · {c.patient_name || ''} · <span style={{fontWeight:700}}>{c.status}</span></div>
                              {c.symptoms && <div style={{marginTop:6,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:500}}>{c.symptoms}</div>}
                              {c.tags && c.tags.length > 0 && (
                                <div style={{marginTop:6,display:'flex',gap:6,flexWrap:'wrap'}}>
                                  {c.tags.map((t,ti)=>(<div key={ti} style={{background:'#eef2ff',padding:'4px 8px',borderRadius:12,fontSize:12}}>{t}</div>))}
                                </div>
                              )}
                            </div>
                            <div style={{display:'flex',gap:8,alignItems:'center'}}>
                              <button className="fav-btn" onClick={async ()=>{
                                try {
                                  const method = c.favorite ? 'DELETE' : 'POST'
                                  const url = `${BASE}/cases/${c.id}/favorite`
                                  const r = await fetch(url, { method, headers: { 'Authorization': 'Bearer ' + (auth?.token || '') } })
                                  if (r.ok) {
                                    setCases(prev => prev.map(x => x.id === c.id ? { ...x, favorite: !c.favorite } : x))
                                  } else {
                                    const d = await r.json().catch(()=>({}))
                                    alert(d.error || '操作失败')
                                  }
                                } catch (e) { console.error(e); alert('网络错误') }
                              }} title={c.favorite ? '取消收藏' : '收藏'} style={{fontSize:18,border:'none',background:'transparent',cursor:'pointer'}}>
                                <span style={{color: c.favorite ? '#f59e0b' : '#9ca3af', transition:'transform .15s', transform: c.favorite ? 'scale(1.15)' : 'scale(1)'}}>{c.favorite ? '★' : '☆'}</span>
                              </button>
                              <button className="btn-primary" onClick={()=>navigate('/doctor-patient-chat/'+c.id)}>查看聊天</button>
                              <button className="btn-ghost" onClick={()=>navigate('/doctor-case/'+c.id)}>查看详情</button>
                              {c.status === 'pending' && <button className="btn-success" onClick={async ()=>{
                                const resp = await fetch(`${BASE}/accept-consultation/${c.id}`, { method:'POST', headers: { 'Authorization': 'Bearer ' + (auth?.token || '') } })
                                if (resp.ok) { alert('接单成功'); load() } else { const d = await resp.json().catch(()=>({})); alert(d.error || '接单失败') }
                              }}>接单</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null
                ))}
              </div>
            )
          })()
        )}
      </div>
      {/* pagination */}
      <div style={{display:'flex',justifyContent:'center',marginTop:12,gap:8}}>
        <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="btn-ghost">上一页</button>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span>第</span>
          <strong>{page}</strong>
          <span>页</span>
        </div>
        <button disabled={total>0 && page >= Math.ceil(total/perPage)} onClick={()=>setPage(p=>p+1)} className="btn-ghost">下一页</button>
      </div>
    </div>
  )
}


