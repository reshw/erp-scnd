'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface LoanInitialValues {
  id: string
  name: string
  principal: number
  interest_rate: number       // 소수 (0.045)
  start_date: string
  end_date: string
  loan_type: string
  interest_calc: string
  first_month_partial: boolean
  counterparty_id: string | null
  project_id: string | null
}

export default function LoanForm({
  counterparties,
  projects,
  initialValues,
}: {
  counterparties: { id: string; name: string }[]
  projects: { id: string; code: string }[]
  initialValues?: LoanInitialValues
}) {
  const router = useRouter()
  const isEdit = !!initialValues
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true); setError('')
    const fd = new FormData(e.currentTarget)

    const rateInput = parseFloat(fd.get('interest_rate') as string)
    const body = {
      ...(isEdit ? { id: initialValues!.id } : {}),
      name:                fd.get('name'),
      principal:           parseFloat(fd.get('principal') as string),
      interest_rate:       rateInput / 100,
      start_date:          fd.get('start_date'),
      end_date:            fd.get('end_date'),
      loan_type:           fd.get('loan_type'),
      interest_calc:       fd.get('interest_calc'),
      first_month_partial: fd.get('first_month_partial') === 'on',
      counterparty_id:     fd.get('counterparty_id') || null,
      project_id:          fd.get('project_id') || null,
    }

    const res = await fetch('/api/loans', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json()
      setError(err.error ?? '저장 실패')
      setSaving(false)
      return
    }

    const loan = await res.json()
    router.push(`/loans/${isEdit ? initialValues!.id : loan.id}`)
  }

  const v = initialValues

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white border rounded-lg p-6">
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">대출명 *</label>
          <input name="name" required defaultValue={v?.name}
            className="border rounded px-3 py-2 text-sm w-full" placeholder="예: IM뱅크 장기대출" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">원금 (원) *</label>
            <input name="principal" type="number" required min="1" defaultValue={v?.principal}
              className="border rounded px-3 py-2 text-sm w-full" placeholder="100000000" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">연이율 (%) *</label>
            <input name="interest_rate" type="number" required step="0.01" min="0"
              defaultValue={v ? (v.interest_rate * 100).toFixed(2) : undefined}
              className="border rounded px-3 py-2 text-sm w-full" placeholder="4.50" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">시작일 *</label>
            <input name="start_date" type="date" required defaultValue={v?.start_date}
              className="border rounded px-3 py-2 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">종료일 *</label>
            <input name="end_date" type="date" required defaultValue={v?.end_date}
              className="border rounded px-3 py-2 text-sm w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">상환 유형</label>
            <select name="loan_type" defaultValue={v?.loan_type ?? '원리금균등'}
              className="border rounded px-3 py-2 text-sm w-full">
              <option value="원리금균등">원리금균등상환</option>
              <option value="원금균등">원금균등상환</option>
              <option value="만기일시">만기일시상환</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">이자 계산 방식</label>
            <select name="interest_calc" defaultValue={v?.interest_calc ?? 'monthly'}
              className="border rounded px-3 py-2 text-sm w-full">
              <option value="monthly">월할 (연이율÷12) — 은행 표준</option>
              <option value="daily_30">일할 30일 고정 (연이율÷365×30)</option>
              <option value="daily_actual">일할 실일수 (연이율÷365×실일수)</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2 py-1">
          <input
            type="checkbox"
            name="first_month_partial"
            id="first_month_partial"
            defaultChecked={v ? v.first_month_partial : true}
            className="accent-blue-600"
          />
          <label htmlFor="first_month_partial" className="text-sm text-gray-700 cursor-pointer">
            시작월 일할이자 납부
            <span className="ml-1.5 text-xs text-gray-400">(시작일이 1일 아닐 때 잔여일수 이자만 1회 추가)</span>
          </label>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">거래처 (금융기관)</label>
          <select name="counterparty_id" defaultValue={v?.counterparty_id ?? ''}
            className="border rounded px-3 py-2 text-sm w-full">
            <option value="">-</option>
            {counterparties.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">프로젝트</label>
          <select name="project_id" defaultValue={v?.project_id ?? ''}
            className="border rounded px-3 py-2 text-sm w-full">
            <option value="">-</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>취소</Button>
        <Button type="submit" disabled={saving}>
          {saving ? '저장 중...' : isEdit ? '수정 저장' : '등록'}
        </Button>
      </div>
    </form>
  )
}
