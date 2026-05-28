import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function DoctorStats() {
  const navigate = useNavigate()
  const auth = getStoredAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [rangePreset, setRangePreset] = useState('month') // today | week | month | custom | all
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  useEffect(()=>{ load() }, [])
  useEffect(()=>{ load() }, [rangePreset, customStart, customEnd])

  function buildRangeParams() {
    const params = {}
    if (rangePreset && rangePreset !== 'all' && rangePreset !== 'custom') {
      params.preset = rangePreset
    } else if (rangePreset === 'custom' && customStart) {
      // convert dates to unix seconds (start at 00:00 for start, end at 23:59 for end)
      try {
        const s = new Date(customStart + 'T00:00:00')
        params.start = Math.floor(s.getTime()/1000)
        if (customEnd) {
          const e = new Date(customEnd + 'T23:59:59')
          params.end = Math.floor(e.getTime()/1000)
        }
      } catch (e) {}
    }
    return params
  }

  async function load() {
    setLoading(true)
    try {
      const params = buildRangeParams()
      const qs = new URLSearchParams(params).toString()
      const url = `${BASE}/doctor-stats` + (qs ? `?${qs}` : '')
      const resp = await fetch(url, { headers: auth?.token ? { Authorization: 'Bearer ' + auth.token } : {} })
      if (!resp.ok) { setStats(null); setLoading(false); return }
      const data = await resp.json()
      setStats(data)
    } catch (e) {
      console.error('load stats failed', e)
      setStats(null)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div style={{padding:24}}>加载中...</div>
  if (!stats) return <div style={{padding:24}}>无法获取统计数据</div>

  function LineChart({ data, width = 720, height = 200 }) {
    const containerRef = useRef(null)
    const [view, setView] = useState({ start: 0, end: Math.max(0, (data?.length || 1) - 1) })
    const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, date: '', count: 0 })
    const [dragging, setDragging] = useState(false)
    const dragState = useRef({ startX: 0, startView: null })

    useEffect(() => {
      setView({ start: 0, end: Math.max(0, (data?.length || 1) - 1) })
    }, [data])

    if (!data || data.length === 0) return <div style={{color:'#6b7280'}}>无数据</div>
    const padding = 24
    const w = width - padding * 2
    const h = height - padding * 2
    const n = data.length

    const visible = data.slice(view.start, view.end + 1)
    const values = visible.map(d => d.count)
    const maxV = Math.max(...values, 1)
    const points = visible.map((d, i) => {
      const x = padding + (n === 1 ? w/2 : (w * (i + view.start) / (n - 1)))
      const y = padding + h - (d.count / maxV) * h
      return { x, y, label: d.date, v: d.count, idx: i + view.start }
    })
    const path = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ')

    function clientToIndex(clientX) {
      const rect = containerRef.current.getBoundingClientRect()
      const x = clientX - rect.left
      // map x to nearest point index (global index)
      const rel = (x - padding) / w
      const idx = Math.round(rel * (n - 1))
      return Math.max(0, Math.min(n - 1, idx))
    }

    function handleMouseMove(e) {
      const idx = clientToIndex(e.clientX)
      const d = data[idx]
      if (!d) return
      const rect = containerRef.current.getBoundingClientRect()
      // compute point position
      const x = padding + (w * idx / (n - 1))
      const y = padding + h - (d.count / maxV) * h
      setTooltip({ visible: true, x: rect.left + x, y: rect.top + y, date: d.date, count: d.count })
      if (dragging && dragState.current.startView) {
        const dx = e.clientX - dragState.current.startX
        const deltaIdx = Math.round(-dx / Math.max(1, w) * (view.end - view.start + 1))
        let ns = dragState.current.startView.start + deltaIdx
        let ne = dragState.current.startView.end + deltaIdx
        if (ns < 0) { ne += -ns; ns = 0 }
        if (ne > n - 1) { ns -= (ne - (n - 1)); ne = n - 1 }
        ns = Math.max(0, ns); ne = Math.min(n - 1, ne)
        setView({ start: ns, end: ne })
      }
    }

    function handleMouseLeave() {
      setTooltip(t => ({ ...t, visible: false }))
    }

    function handleWheel(e) {
      e.preventDefault()
      const delta = e.deltaY
      const zoomFactor = delta > 0 ? 1.2 : 0.8
      const centerIdx = clientToIndex(e.clientX)
      const len = view.end - view.start + 1
      let newLen = Math.max(1, Math.round(len * zoomFactor))
      if (newLen > n) newLen = n
      let ns = centerIdx - Math.floor((centerIdx - view.start) * (newLen / len))
      let ne = ns + newLen - 1
      if (ns < 0) { ne += -ns; ns = 0 }
      if (ne > n - 1) { ns -= (ne - (n - 1)); ne = n - 1 }
      ns = Math.max(0, ns); ne = Math.min(n - 1, ne)
      setView({ start: ns, end: ne })
    }

    function handleMouseDown(e) {
      setDragging(true)
      dragState.current.startX = e.clientX
      dragState.current.startView = { ...view }
    }

    function handleMouseUp() {
      setDragging(false)
      dragState.current.startView = null
    }

    return (
      <div style={{background:'#fff',padding:12,borderRadius:8}} ref={containerRef}>
        <h4>就诊单数趋势</h4>
        <div style={{position:'relative'}}>
          <svg width={width} height={height} style={{display:'block',margin:'0 auto'}} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp}>
            {/* grid lines */}
            {[0,0.25,0.5,0.75,1].map((t,idx)=>(
              <line key={idx} x1={padding} x2={width-padding} y1={padding + t * h} y2={padding + t * h} stroke="#eef2f6" />
            ))}
            {/* path */}
            <path d={path} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {/* area fill */}
            <path d={`${path} L ${padding + w} ${padding + h} L ${padding} ${padding + h} Z`} fill="rgba(59,130,246,0.08)" />
            {/* points */}
            {points.map((p,idx)=>(
              <g key={idx}>
                <circle cx={p.x} cy={p.y} r={3.5} fill="#fff" stroke="#3b82f6" strokeWidth="2" />
              </g>
            ))}
            {/* x labels every ~7 ticks if too many */}
            {points.map((p,idx)=> {
              const show = n <= 14 ? true : (idx % Math.ceil(n/14) === 0)
              return show ? <text key={idx} x={p.x} y={height - 4} fontSize={10} textAnchor="middle" fill="#6b7280">{p.label.replace(/^\d{4}-/,'')}</text> : null
            })}
          </svg>
          {tooltip.visible && (
            <div style={{position:'fixed',left:tooltip.x + 12,top:tooltip.y - 24,background:'#111827',color:'#fff',padding:'6px 8px',borderRadius:6,fontSize:12,boxShadow:'0 6px 18px rgba(0,0,0,0.12)'}}>
              <div style={{fontSize:12}}>{tooltip.date}</div>
              <div style={{fontWeight:700}}>{tooltip.count} 单</div>
            </div>
          )}
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:8,gap:8}}>
          <button className="btn-ghost" onClick={()=>setView({ start: 0, end: Math.max(0, n-1) })}>重置视图</button>
        </div>
      </div>
    )
  }

  function BarChart({ items = [], width = 320, barHeight = 22 }) {
    if (!items || items.length === 0) return <div style={{color:'#6b7280'}}>暂无数据</div>
    const maxV = Math.max(...items.map(i=>i.count), 1)
    const w = width - 80
    return (
      <div style={{marginTop:12}}>
        <svg width={width} height={items.length * (barHeight + 8)} style={{display:'block'}}>
          {items.map((it, idx) => {
            const y = idx * (barHeight + 8)
            const bw = Math.round((it.count / maxV) * w)
            return (
              <g key={it.diagnosis}>
                <text x={8} y={y + (barHeight/2)+5} fontSize={12} fill="#374151">{it.diagnosis}</text>
                <rect x={100} y={y+4} width={bw} height={barHeight} rx={4} fill="#10b981" />
                <text x={100 + bw + 8} y={y + (barHeight/2)+5} fontSize={12} fill="#374151">{it.count}</text>
              </g>
            )
          })}
        </svg>
      </div>
    )
  }

  return (
    <div style={{padding:24}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
        <button className="btn-ghost" onClick={() => navigate('/doctor/profile')}>
          ← 返回
        </button>
        <h2>我的统计</h2>
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center',marginTop:8}}>
        <select value={rangePreset} onChange={e=>setRangePreset(e.target.value)} style={{padding:6,borderRadius:6}}>
          <option value="today">今日</option>
          <option value="week">本周</option>
          <option value="month">本月</option>
          <option value="all">全部</option>
          <option value="custom">自定义</option>
        </select>
        {rangePreset === 'custom' && (
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)} />
            <span>—</span>
            <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} />
          </div>
        )}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginTop:12}}>
        <div style={{background:'#fff',padding:12,borderRadius:8}}>
          <div style={{fontSize:12,color:'#6b7280'}}>总接诊量</div>
          <div style={{fontSize:20,fontWeight:700}}>{stats.total_cases}</div>
        </div>
        <div style={{background:'#fff',padding:12,borderRadius:8}}>
          <div style={{fontSize:12,color:'#6b7280'}}>进行中</div>
          <div style={{fontSize:20,fontWeight:700}}>{stats.active}</div>
        </div>
        <div style={{background:'#fff',padding:12,borderRadius:8}}>
          <div style={{fontSize:12,color:'#6b7280'}}>待接/待分配</div>
          <div style={{fontSize:20,fontWeight:700}}>{stats.pending}</div>
        </div>
        <div style={{background:'#fff',padding:12,borderRadius:8}}>
          <div style={{fontSize:12,color:'#6b7280'}}>已完成</div>
          <div style={{fontSize:20,fontWeight:700}}>{stats.completed}</div>
        </div>
        <div style={{background:'#fff',padding:12,borderRadius:8}}>
          <div style={{fontSize:12,color:'#6b7280'}}>总收入（已支付）</div>
          <div style={{fontSize:20,fontWeight:700}}>{stats.total_income.toFixed(2)} 元</div>
        </div>
        <div style={{background:'#fff',padding:12,borderRadius:8}}>
          <div style={{fontSize:12,color:'#6b7280'}}>未付金额</div>
          <div style={{fontSize:20,fontWeight:700}}>{stats.total_outstanding.toFixed(2)} 元</div>
        </div>
      </div>

      <div style={{display:'flex',gap:12,marginTop:16}}>
        <div style={{flex:1,background:'#fff',padding:12,borderRadius:8}}>
          <h4>处方数量</h4>
          <div style={{fontSize:18,fontWeight:700}}>{stats.prescriptions_count}</div>
          <h4 style={{marginTop:12}}>平均完成天数</h4>
          <div style={{fontSize:18,fontWeight:700}}>{stats.avg_completion_days ?? '—'}</div>
        </div>
        <div style={{width:360,background:'#fff',padding:12,borderRadius:8}}>
          <h4>热门标签</h4>
          {stats.top_tags && stats.top_tags.length > 0 ? (
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {stats.top_tags.map(t => <div key={t.tag} style={{display:'flex',justifyContent:'space-between'}}><span>#{t.tag}</span><span>{t.count}</span></div>)}
            </div>
          ) : <div style={{color:'#6b7280'}}>暂无标签</div>}
          <h4 style={{marginTop:12}}>热门诊断</h4>
          {stats.top_diagnoses && stats.top_diagnoses.length > 0 ? (
            <BarChart items={stats.top_diagnoses} width={320} />
          ) : <div style={{color:'#6b7280'}}>暂无诊断统计</div>}
        </div>
      </div>
      <div style={{marginTop:16}}>
        <LineChart data={stats.timeseries || []} width={860} height={240} />
      </div>
    </div>
  )
}


