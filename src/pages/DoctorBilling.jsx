import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getStoredAuth } from '../utils/auth'

const BASE = 'http://127.0.0.1:8080'

export default function DoctorBilling() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const auth = getStoredAuth()
  const [consultation, setConsultation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [billing, setBilling] = useState({
    consultation_fee: 0,
    medication_fee: 0,
    other_fees: 0,
    total_amount: 0,
    payment_method: 'cash',
    notes: ''
  })
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    if (!auth || auth.user_type !== 'doctor') {
      navigate('/auth')
      return
    }
    loadConsultation()
  }, [caseId, auth, navigate])

  useEffect(() => {
    // Auto-calculate total when fees change
    const total = billing.consultation_fee + billing.medication_fee + billing.other_fees
    setBilling(prev => ({ ...prev, total_amount: total }))
  }, [billing.consultation_fee, billing.medication_fee, billing.other_fees])

  async function loadConsultation() {
    try {
      const resp = await fetch(`${BASE}/cases/${caseId}`, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      })

      if (resp.ok) {
        const data = await resp.json()
        setConsultation(data)
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

  function updateFee(field, value) {
    const numValue = parseFloat(value) || 0
    setBilling(prev => ({ ...prev, [field]: numValue }))
  }

  async function processPayment() {
    if (billing.total_amount <= 0) {
      alert('总金额必须大于0')
      return
    }

    setProcessing(true)
    try {
      const resp = await fetch(`${BASE}/billing/${caseId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.token
        },
        body: JSON.stringify({
          consultation_fee: billing.consultation_fee,
          medication_fee: billing.medication_fee,
          other_fees: billing.other_fees,
          total_amount: billing.total_amount,
          payment_method: billing.payment_method,
          notes: billing.notes
        })
      })

      if (resp.ok) {
        alert('收费结算成功')
        navigate(`/doctor-patient-chat/${caseId}`)
      } else {
        alert('结算失败，请重试')
      }
    } catch (error) {
      console.error('结算失败:', error)
      alert('网络错误')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className="billing-page">
        <div className="page-header">
          <h1>收费结算</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px' }}>加载中...</div>
      </div>
    )
  }

  if (!consultation) {
    return (
      <div className="billing-page">
        <div className="page-header">
          <h1>收费结算</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px' }}>病例不存在</div>
      </div>
    )
  }

  return (
    <div className="billing-page">
      <div className="page-header">
        <div className="header-left">
          <button className="btn-ghost" onClick={() => navigate(`/doctor-patient-chat/${caseId}`)}>
            返回沟通页面
          </button>
          <h1>收费结算</h1>
        </div>
      </div>

      <div className="billing-content">
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
            <div className="info-item">
              <span className="label">诊断：</span>
              <span>{consultation.diagnosis || '暂无'}</span>
            </div>
          </div>
        </div>

        <div className="billing-form">
          <h3>费用明细</h3>

          <div className="fee-grid">
            <div className="fee-item">
              <label>诊疗费 (元)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={billing.consultation_fee}
                onChange={(e) => updateFee('consultation_fee', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="fee-item">
              <label>药费 (元)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={billing.medication_fee}
                onChange={(e) => updateFee('medication_fee', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="fee-item">
              <label>其他费用 (元)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={billing.other_fees}
                onChange={(e) => updateFee('other_fees', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="fee-item total">
              <label>总计 (元)</label>
              <div className="total-amount">
                ¥{billing.total_amount.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="payment-section">
            <h4>支付方式</h4>
            <div className="payment-methods">
              <label className="payment-method">
                <input
                  type="radio"
                  name="payment_method"
                  value="cash"
                  checked={billing.payment_method === 'cash'}
                  onChange={(e) => setBilling(prev => ({ ...prev, payment_method: e.target.value }))}
                />
                <span>现金</span>
              </label>
              <label className="payment-method">
                <input
                  type="radio"
                  name="payment_method"
                  value="card"
                  checked={billing.payment_method === 'card'}
                  onChange={(e) => setBilling(prev => ({ ...prev, payment_method: e.target.value }))}
                />
                <span>银行卡</span>
              </label>
              <label className="payment-method">
                <input
                  type="radio"
                  name="payment_method"
                  value="wechat"
                  checked={billing.payment_method === 'wechat'}
                  onChange={(e) => setBilling(prev => ({ ...prev, payment_method: e.target.value }))}
                />
                <span>微信支付</span>
              </label>
              <label className="payment-method">
                <input
                  type="radio"
                  name="payment_method"
                  value="alipay"
                  checked={billing.payment_method === 'alipay'}
                  onChange={(e) => setBilling(prev => ({ ...prev, payment_method: e.target.value }))}
                />
                <span>支付宝</span>
              </label>
            </div>
          </div>

          <div className="notes-section">
            <h4>备注</h4>
            <textarea
              value={billing.notes}
              onChange={(e) => setBilling(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="收费备注信息..."
              rows={3}
            />
          </div>

          <div className="billing-actions">
            <button
              className="btn-secondary"
              onClick={() => navigate(`/doctor-patient-chat/${caseId}`)}
              disabled={processing}
            >
              取消
            </button>
            <button
              className="btn-success"
              onClick={processPayment}
              disabled={processing || billing.total_amount <= 0}
            >
              {processing ? '处理中...' : '确认收费'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
