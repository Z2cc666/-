import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function DoctorPrescription() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const auth = getStoredAuth()
  const [consultation, setConsultation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [prescription, setPrescription] = useState({
    diagnosis: '',
    medications: [{ name: '', dosage: '', frequency: '', duration: '', instructions: '' }],
    notes: ''
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!auth || auth.user_type !== 'doctor') {
      navigate('/auth')
      return
    }
    loadConsultation()
  }, [caseId, auth, navigate])

  async function loadConsultation() {
    try {
      const resp = await fetch(`${BASE}/cases/${caseId}`, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      })

      if (resp.ok) {
        const data = await resp.json()
        setConsultation(data)
        // Pre-fill diagnosis if available
        if (data.diagnosis) {
          setPrescription(prev => ({ ...prev, diagnosis: data.diagnosis }))
        }
      } else {
        alert('加载病例信息失败')
        navigate('/doctor-consultations')
      }
    } catch (error) {
      console.error('加载病例失败:', error)
      alert('网络错误')
    } finally {
      setLoading(false)
    }
  }

  function addMedication() {
    setPrescription(prev => ({
      ...prev,
      medications: [...prev.medications, { name: '', dosage: '', frequency: '', duration: '', instructions: '' }]
    }))
  }

  function updateMedication(index, field, value) {
    setPrescription(prev => ({
      ...prev,
      medications: prev.medications.map((med, i) =>
        i === index ? { ...med, [field]: value } : med
      )
    }))
  }

  function removeMedication(index) {
    setPrescription(prev => ({
      ...prev,
      medications: prev.medications.filter((_, i) => i !== index)
    }))
  }

  async function savePrescription() {
    if (!prescription.diagnosis.trim()) {
      alert('请填写诊断结果')
      return
    }

    if (prescription.medications.some(med => !med.name.trim())) {
      alert('请填写完整的药品信息')
      return
    }

    setSaving(true)
    try {
      const resp = await fetch(`${BASE}/prescription/${caseId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.token
        },
        body: JSON.stringify({
          diagnosis: prescription.diagnosis,
          medications: prescription.medications,
          notes: prescription.notes,
          doctor_signature: auth.username
        })
      })

      if (resp.ok) {
        alert('处方保存成功')
        navigate(`/doctor-patient-chat/${caseId}`)
      } else {
        alert('保存处方失败')
      }
    } catch (error) {
      console.error('保存处方失败:', error)
      alert('网络错误')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="prescription-page">
        <div className="page-header">
          <h1>开具处方</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px' }}>加载中...</div>
      </div>
    )
  }

  if (!consultation) {
    return (
      <div className="prescription-page">
        <div className="page-header">
          <h1>开具处方</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px' }}>病例不存在</div>
      </div>
    )
  }

  return (
    <div className="prescription-page">
      <div className="page-header">
        <div className="header-left">
          <button className="btn-ghost" onClick={() => navigate(`/doctor-patient-chat/${caseId}`)}>
            返回沟通页面
          </button>
          <h1>开具处方</h1>
        </div>
      </div>

      <div className="prescription-content">
        <div className="patient-info">
          <h3>患者信息</h3>
          <div className="info-grid">
            <div className="info-item">
              <span className="label">患者：</span>
              <span>{consultation.patient_name || '匿名患者'}</span>
            </div>
            <div className="info-item">
              <span className="label">病例ID：</span>
              <span>{caseId}</span>
            </div>
          </div>
        </div>

        <div className="prescription-form">
          <div className="form-section">
            <h3>诊断结果</h3>
            <textarea
              value={prescription.diagnosis}
              onChange={(e) => setPrescription(prev => ({ ...prev, diagnosis: e.target.value }))}
              placeholder="请输入诊断结果..."
              rows={3}
              required
            />
          </div>

          <div className="form-section">
            <div className="section-header">
              <h3>药品处方</h3>
              <button type="button" className="btn-secondary" onClick={addMedication}>
                添加药品
              </button>
            </div>

            {prescription.medications.map((med, index) => (
              <div key={index} className="medication-item">
                <div className="medication-header">
                  <h4>药品 {index + 1}</h4>
                  {prescription.medications.length > 1 && (
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => removeMedication(index)}
                    >
                      删除
                    </button>
                  )}
                </div>

                <div className="medication-grid">
                  <div className="form-field">
                    <label>药品名称 *</label>
                    <input
                      type="text"
                      value={med.name}
                      onChange={(e) => updateMedication(index, 'name', e.target.value)}
                      placeholder="请输入药品名称"
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label>剂量</label>
                    <input
                      type="text"
                      value={med.dosage}
                      onChange={(e) => updateMedication(index, 'dosage', e.target.value)}
                      placeholder="例如：500mg"
                    />
                  </div>

                  <div className="form-field">
                    <label>频率</label>
                    <input
                      type="text"
                      value={med.frequency}
                      onChange={(e) => updateMedication(index, 'frequency', e.target.value)}
                      placeholder="例如：每日3次"
                    />
                  </div>

                  <div className="form-field">
                    <label>疗程</label>
                    <input
                      type="text"
                      value={med.duration}
                      onChange={(e) => updateMedication(index, 'duration', e.target.value)}
                      placeholder="例如：7天"
                    />
                  </div>

                  <div className="form-field full-width">
                    <label>服用说明</label>
                    <textarea
                      value={med.instructions}
                      onChange={(e) => updateMedication(index, 'instructions', e.target.value)}
                      placeholder="服用说明和注意事项"
                      rows={2}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="form-section">
            <h3>医嘱备注</h3>
            <textarea
              value={prescription.notes}
              onChange={(e) => setPrescription(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="其他医嘱或备注信息..."
              rows={3}
            />
          </div>

          <div className="form-actions">
            <button
              className="btn-secondary"
              onClick={() => navigate(`/doctor-patient-chat/${caseId}`)}
              disabled={saving}
            >
              取消
            </button>
            <button
              className="btn-primary"
              onClick={savePrescription}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存处方'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
