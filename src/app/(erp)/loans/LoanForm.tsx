'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import Combobox from '@/components/ui/Combobox'

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
  payment_day: number | null
  pmt_floor: boolean
  interest_round: string
  counterparty_id: string | null
  project_id: string | null
  overdraft_limit: number | null
  include_draw_day: boolean
  account_id: string | null
  account_name: string | null
  bank_account_id: string | null
  bank_account_name: string | null
}

export default function LoanForm({
  counterparties,
  projects,
  accounts,
  bankAccounts,
  initialValues,
}: {
  counterparties: { id: string; name: string }[]
  projects: { id: string; code: string }[]
  accounts: { id: string; name: string }[]
  bankAccounts: { id: string; name: string }[]
  initialValues?: LoanInitialValues
}) {
  const router = useRouter()
  const isEdit = !!initialValues?.id
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [principalRaw, setPrincipalRaw] = useState(
    initialValues?.principal ? String(initialValues.principal) : ''
  )
  const [loanType, setLoanType] = useState(initialValues?.loan_type ?? '원리금균등')
  const isOverdraft = loanType === '마이너스통장'
  const [includeDrawDay, setIncludeDrawDay] = useState(initialValues?.include_draw_day ?? true)

  const [overdraftRaw, setOverdraftRaw] = useState(
    initialValues?.overdraft_limit ? String(initialValues.overdraft_limit) : ''
  )
  const overdraftFormatted = overdraftRaw
    ? new Intl.NumberFormat('ko-KR').format(Number(overdraftRaw))
    : ''

  const principalFormatted = principalRaw
    ? new Intl.NumberFormat('ko-KR').format(Number(principalRaw))
    : ''

  function handlePrincipalChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    setPrincipalRaw(raw)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true); setError('')
    const fd = new FormData(e.currentTarget)

    const rateInput = parseFloat(fd.get('interest_rate') as string)
    const paymentDayRaw = fd.get('payment_day') as string
    const pmtFloor = fd.get('pmt_round_unit_enabled') === 'on'
    const body = {
      ...(isEdit ? { id: initialValues!.id } : {}),
      name:                fd.get('name'),
      principal:           isOverdraft ? null : (principalRaw ? parseInt(principalRaw) : 0),
      interest_rate:       rateInput / 100,
      start_date:          fd.get('start_date'),
      end_date:            fd.get('end_date'),
      loan_type:           loanType,
      interest_calc:       isOverdraft ? 'daily_actual' : fd.get('interest_calc'),
      first_month_partial: isOverdraft ? false : fd.get('first_month_partial') === 'on',
      payment_day:         isOverdraft ? null : (paymentDayRaw ? parseInt(paymentDayRaw) : null),
      pmt_floor:           isOverdraft ? false : pmtFloor,
      interest_round:      fd.get('interest_round') ?? 'round',
      counterparty_id:     fd.get('counterparty_id') || null,
      project_id:          fd.get('project_id') || null,
      overdraft_limit:     isOverdraft ? (overdraftRaw ? parseInt(overdraftRaw) : null) : null,
      include_draw_day:    isOverdraft ? includeDrawDay : true,
      account_id:          isOverdraft ? (fd.get('account_id') || null) : null,
      bank_account_id:     fd.get('bank_account_id') || null,
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
            className="border rounded px-3 py-2 text-sm w-full"
            placeholder={isOverdraft ? '예: 마통-경남은행' : '예: IM뱅크 장기대출'} />
        </div>

        {/* 상환 유형 (항상 표시, 마이너스통장 옵션 포함) */}
        <div>
          <label className="text-xs text-gray-500 block mb-1">대출 유형</label>
          <select name="loan_type" value={loanType} onChange={e => setLoanType(e.target.value)}
            className="border rounded px-3 py-2 text-sm w-full">
            <option value="원리금균등">원리금균등상환</option>
            <option value="원금균등">원금균등상환</option>
            <option value="만기일시">만기일시상환</option>
            <option value="마이너스통장">마이너스통장 (한도대출)</option>
          </select>
        </div>

        {isOverdraft ? (
          /* ── 마이너스통장 전용 필드 ── */
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">한도 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={overdraftFormatted}
                  onChange={e => setOverdraftRaw(e.target.value.replace(/[^0-9]/g, ''))}
                  className="border rounded px-3 py-2 text-sm w-full text-right tabular-nums"
                  placeholder="50,000,000"
                />
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
                <label className="text-xs text-gray-500 block mb-1">개설일 *</label>
                <input name="start_date" type="date" required defaultValue={v?.start_date}
                  className="border rounded px-3 py-2 text-sm w-full" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">만기일 *</label>
                <input name="end_date" type="date" required defaultValue={v?.end_date}
                  className="border rounded px-3 py-2 text-sm w-full" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">잔액 추적 계정과목 *</label>
              <Combobox
                name="account_id"
                placeholder="계정과목 검색 (예: 장기차입금)"
                options={accounts.map(a => ({ id: a.id, label: a.name }))}
                defaultId={v?.account_id ?? ''}
                defaultLabel={v?.account_name ?? accounts.find(a => a.id === v?.account_id)?.name ?? ''}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">이자 끝수 처리</label>
              <select name="interest_round" defaultValue={v?.interest_round ?? 'round'}
                className="border rounded px-3 py-2 text-sm w-full">
                <option value="round">반올림 (기본)</option>
                <option value="floor">버림 (내림)</option>
                <option value="ceil">올림</option>
              </select>
            </div>
            <div className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                id="include_draw_day"
                checked={includeDrawDay}
                onChange={e => setIncludeDrawDay(e.target.checked)}
                className="accent-blue-600"
              />
              <label htmlFor="include_draw_day" className="text-sm text-gray-700 cursor-pointer">
                당일 인출분 당일 이자 포함
                <span className="ml-1.5 text-xs text-gray-400">(OFF 시 익일 기산)</span>
              </label>
            </div>
          </>
        ) : (
          /* ── 일반 대출 필드 ── */
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">원금 (원) *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={principalFormatted}
                  onChange={handlePrincipalChange}
                  className="border rounded px-3 py-2 text-sm w-full text-right tabular-nums"
                  placeholder="100,000,000"
                />
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
            <div>
              <label className="text-xs text-gray-500 block mb-1">이자 계산 방식</label>
              <select name="interest_calc" defaultValue={v?.interest_calc ?? 'monthly'}
                className="border rounded px-3 py-2 text-sm w-full">
                <option value="monthly">월할 (연이율÷12) — 은행 표준</option>
                <option value="daily_30">일할 30일 고정 (연이율÷365×30)</option>
                <option value="daily_actual">일할 실일수 (연이율÷365×실일수)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">이자 끝수 처리</label>
              <select name="interest_round" defaultValue={v?.interest_round ?? 'round'}
                className="border rounded px-3 py-2 text-sm w-full">
                <option value="round">반올림 (기본)</option>
                <option value="floor">버림 (내림)</option>
                <option value="ceil">올림</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">
                납부일
                <span className="ml-1 text-gray-400">(비워두면 대출 시작일과 동일, 예: 18)</span>
              </label>
              <input
                name="payment_day"
                type="number"
                min="1" max="31"
                defaultValue={v?.payment_day ?? undefined}
                placeholder="대출 시작일과 동일"
                className="border rounded px-3 py-2 text-sm w-full"
              />
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
                <span className="ml-1.5 text-xs text-gray-400">(시작일 ≠ 납부일인 경우 첫 납부일까지 일할이자 선납)</span>
              </label>
            </div>
            {loanType === '원리금균등' && (
              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  name="pmt_round_unit_enabled"
                  id="pmt_round_unit_enabled"
                  defaultChecked={v?.pmt_floor ?? false}
                  className="accent-blue-600"
                />
                <label htmlFor="pmt_round_unit_enabled" className="text-sm text-gray-700 cursor-pointer">
                  월불입금 10원 단위 절사
                  <span className="ml-1.5 text-xs text-gray-400">(월 납부액 끝자리 0으로, floor(PMT÷10)×10)</span>
                </label>
              </div>
            )}
          </>
        )}

        <div>
          <label className="text-xs text-gray-500 block mb-1">거래처 (금융기관)</label>
          <Combobox
            name="counterparty_id"
            placeholder="거래처 검색"
            options={counterparties.map(c => ({ id: c.id, label: c.name }))}
            defaultId={v?.counterparty_id ?? ''}
            defaultLabel={counterparties.find(c => c.id === v?.counterparty_id)?.name ?? ''}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">출금 통장</label>
          <Combobox
            name="bank_account_id"
            placeholder="통장 선택"
            options={bankAccounts.map(b => ({ id: b.id, label: b.name }))}
            defaultId={v?.bank_account_id ?? ''}
            defaultLabel={bankAccounts.find(b => b.id === v?.bank_account_id)?.name ?? ''}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">프로젝트</label>
          <Combobox
            name="project_id"
            placeholder="프로젝트 검색"
            options={projects.map(p => ({ id: p.id, label: p.code }))}
            defaultId={v?.project_id ?? ''}
            defaultLabel={projects.find(p => p.id === v?.project_id)?.code ?? ''}
          />
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
