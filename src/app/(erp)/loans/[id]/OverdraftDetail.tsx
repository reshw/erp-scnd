'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { computeSettlementPeriod, WEEKDAY_LABELS, WEEK_OF_MONTH_LABELS } from '@/lib/loans/overdraftSettlement'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

interface DrawLine {
  id: string
  date: string
  debit: number
  credit: number
  note: string | null
  journal_id: string
}

interface DailyBalance {
  date: string
  balance: number
  interest: number
  rate: number
}

interface ProjectInterest {
  project_id: string | null
  project_code: string
  interest: number
}

interface CalcResult {
  dailyBalances: DailyBalance[]
  totalInterest: number
  projectBreakdown: ProjectInterest[]
}

interface RateEntry {
  id: string
  effective_date: string
  annual_rate: number   // 소수 (0.0555)
  note: string | null
}

interface Props {
  loanId: string
  overdraftLimit: number | null
  annualRate: number
  includeDrawDay: boolean
  lines: DrawLine[]
  settlementType: string
  settlementDay: number | null
  settlementWeekday: number | null
  settlementWeekOfMonth: number | null
  rateHistory: RateEntry[]
}

export default function OverdraftDetail({
  loanId, overdraftLimit, annualRate, includeDrawDay, lines,
  settlementType, settlementDay, settlementWeekday, settlementWeekOfMonth,
  rateHistory,
}: Props) {
  const router = useRouter()

  const settlementConfig = {
    settlementType: (settlementType === 'weekday' ? 'weekday' : 'date') as 'date' | 'weekday',
    settlementDay, settlementWeekday, settlementWeekOfMonth,
  }
  const settlementLabel = settlementConfig.settlementType === 'weekday' && settlementWeekday && settlementWeekOfMonth
    ? `매월 ${WEEK_OF_MONTH_LABELS[settlementWeekOfMonth - 1]} ${WEEKDAY_LABELS[settlementWeekday - 1]}요일 (주말이면 익영업일 부과)`
    : settlementDay
      ? `매월 ${settlementDay}일 (주말이면 익영업일 부과)`
      : '매월 1일~말일 전체'

  const currentBalance = lines.reduce((sum, l) => sum + l.credit - l.debit, 0)

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const currentRate = rateHistory.reduce(
    (r, rc) => (rc.effective_date <= todayStr ? rc.annual_rate : r),
    annualRate
  )

  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [calcMonth, setCalcMonth] = useState(defaultMonth)
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [calculating, setCalculating] = useState(false)

  // 금리 변동 입력
  const [rateDate, setRateDate] = useState('')
  const [ratePercent, setRatePercent] = useState('')
  const [rateNote, setRateNote] = useState('')
  const [rateSaving, setRateSaving] = useState(false)
  const [rateError, setRateError] = useState('')

  async function handleAddRate() {
    if (!rateDate || !ratePercent) return
    setRateSaving(true); setRateError('')
    const res = await fetch(`/api/loans/${loanId}/rate-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        effective_date: rateDate,
        annual_rate: parseFloat(ratePercent) / 100,
        note: rateNote || null,
      }),
    })
    setRateSaving(false)
    if (!res.ok) {
      const err = await res.json()
      setRateError(err.error ?? '저장 실패')
      return
    }
    setRateDate(''); setRatePercent(''); setRateNote('')
    setCalcResult(null)
    router.refresh()
  }

  async function handleDeleteRate(rateId: string) {
    const res = await fetch(`/api/loans/${loanId}/rate-history`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rateId }),
    })
    if (res.ok) {
      setCalcResult(null)
      router.refresh()
    }
  }

  function goToProjectJournal(interest: number, projectId: string | null, label: string) {
    const { from, to, chargeDate } = periodOf(calcMonth)
    const params = new URLSearchParams({
      overdraftInterest: String(interest),
      loanId,
      date: chargeDate,
      loanMonth: calcMonth,
      from,
      to,
      label,
    })
    if (projectId) params.set('projectId', projectId)
    router.push(`/journals/new?${params.toString()}`)
  }

  function periodOf(month: string) {
    const [y, m] = month.split('-').map(Number)
    return computeSettlementPeriod(y, m, settlementConfig)
  }

  async function handleCalc() {
    setCalculating(true)
    setCalcResult(null)
    const { from, to } = periodOf(calcMonth)
    const res = await fetch(`/api/loans/${loanId}/overdraft-interest?from=${from}&to=${to}`)
    if (res.ok) setCalcResult(await res.json())
    setCalculating(false)
  }

  function handleGoToJournal() {
    if (!calcResult) return
    const { from, to, chargeDate } = periodOf(calcMonth)
    const params = new URLSearchParams({
      overdraftInterest: String(calcResult.totalInterest),
      loanId,
      date: chargeDate,
      loanMonth: calcMonth,
      from,
      to,
    })
    router.push(`/journals/new?${params.toString()}`)
  }

  // 누적 잔액 계산 (테이블 표시용)
  function buildRunningRows() {
    let running = 0
    return lines.map(l => {
      running += l.credit - l.debit
      return { ...l, running }
    })
  }
  const runningRows = buildRunningRows()

  return (
    <div className="space-y-6">
      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">한도</p>
          <p className="text-lg font-bold tabular-nums">
            {overdraftLimit ? `${fmt(overdraftLimit)}원` : '미설정'}
          </p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">현재 잔액 (인출 누계)</p>
          <p className="text-lg font-bold text-red-600 tabular-nums">{fmt(currentBalance)}원</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">여유 한도</p>
          <p className="text-lg font-bold text-green-700 tabular-nums">
            {overdraftLimit != null ? `${fmt(overdraftLimit - currentBalance)}원` : '-'}
          </p>
        </div>
      </div>

      {/* 인출/상환 내역 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">인출 / 상환 내역</h3>
          <button
            onClick={() => router.refresh()}
            className="text-xs text-gray-400 hover:text-gray-600 border rounded px-2 py-1"
          >
            ↺ 재계산
          </button>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="text-left px-4 py-3">날짜</th>
                <th className="text-right px-4 py-3">인출</th>
                <th className="text-right px-4 py-3">상환</th>
                <th className="text-right px-4 py-3">잔액</th>
                <th className="px-4 py-3 text-left">적요</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {runningRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-xs">
                    인출/상환 전표 없음 — 해당 거래처·계정과목으로 전표를 입력하면 자동 집계됩니다
                  </td>
                </tr>
              )}
              {runningRows.map(l => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 tabular-nums">{l.date}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-600">
                    {l.credit > 0 ? fmt(l.credit) : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-green-700">
                    {l.debit > 0 ? fmt(l.debit) : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                    {fmt(l.running)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{l.note ?? ''}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/journals/${l.journal_id}`}>
                      <Button size="sm" variant="outline" className="text-xs px-2">전표</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 금리 변동 이력 */}
      <div className="border rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">금리 변동 이력</h3>
          <span className="text-xs text-gray-400">
            현재 적용 연 {(currentRate * 100).toFixed(2)}%
          </span>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y">
            <tr className="text-gray-500">
              <td className="py-1.5 tabular-nums">{'개설 ~'}</td>
              <td className="py-1.5 text-right tabular-nums">연 {(annualRate * 100).toFixed(2)}%</td>
              <td className="py-1.5 pl-4 text-xs text-gray-400">계약 금리 (대출설정의 연이율)</td>
              <td></td>
            </tr>
            {rateHistory.map(r => (
              <tr key={r.id}>
                <td className="py-1.5 tabular-nums">{r.effective_date} ~</td>
                <td className="py-1.5 text-right tabular-nums font-medium">연 {(r.annual_rate * 100).toFixed(2)}%</td>
                <td className="py-1.5 pl-4 text-xs text-gray-400">{r.note ?? ''}</td>
                <td className="py-1.5 text-right">
                  <button
                    onClick={() => handleDeleteRate(r.id)}
                    className="text-xs text-gray-400 hover:text-red-600"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-2 pt-1">
          <input
            type="date"
            value={rateDate}
            onChange={e => setRateDate(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            step="0.01"
            min="0"
            value={ratePercent}
            onChange={e => setRatePercent(e.target.value)}
            placeholder="5.55"
            className="border rounded px-2 py-1.5 text-sm w-24 text-right"
          />
          <span className="text-sm text-gray-500">%</span>
          <input
            type="text"
            value={rateNote}
            onChange={e => setRateNote(e.target.value)}
            placeholder="메모 (선택)"
            className="border rounded px-2 py-1.5 text-sm flex-1"
          />
          <Button size="sm" variant="outline" disabled={rateSaving || !rateDate || !ratePercent} onClick={handleAddRate}>
            {rateSaving ? '저장 중...' : '추가'}
          </Button>
        </div>
        {rateError && <p className="text-red-500 text-xs">{rateError}</p>}
      </div>

      {/* 월말 이자 계산 */}
      <div className="border rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">정산 이자 계산</h3>
        <div className="text-xs text-gray-400">
          연이율 {(currentRate * 100).toFixed(2)}%{rateHistory.length > 0 ? ' (변동이력 반영)' : ''} · 일별잔액 × 연이율 ÷ 365
          {includeDrawDay ? ' · 당일 인출 포함' : ' · 당일 인출 미포함 (익일 기산)'}
          {' · 정산일: '}{settlementLabel}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={calcMonth}
            onChange={e => { setCalcMonth(e.target.value); setCalcResult(null) }}
            className="border rounded px-3 py-2 text-sm"
          />
          <Button size="sm" variant="outline" disabled={calculating} onClick={handleCalc}>
            {calculating ? '계산 중...' : '계산'}
          </Button>
          <span className="text-xs text-gray-400">
            {periodOf(calcMonth).from} ~ {periodOf(calcMonth).to}
            {periodOf(calcMonth).chargeDate !== periodOf(calcMonth).to && (
              <> · 부과일 {periodOf(calcMonth).chargeDate}</>
            )}
          </span>
        </div>

        {calcResult && (
          <div className="space-y-3">
            {/* 일별잔액 미리보기 */}
            <div className="max-h-52 overflow-y-auto border rounded text-xs">
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">날짜</th>
                    <th className="text-right px-3 py-2">잔액</th>
                    <th className="text-right px-3 py-2">연이율</th>
                    <th className="text-right px-3 py-2">일이자</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {calcResult.dailyBalances.map(d => (
                    <tr key={d.date} className={d.balance === 0 ? 'opacity-40' : ''}>
                      <td className="px-3 py-1.5 tabular-nums">{d.date}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.balance)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-400">
                        {d.rate != null ? `${(d.rate * 100).toFixed(2)}%` : '-'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-orange-600">
                        {fmt(d.interest)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div>
                <span className="text-xs text-gray-500">{calcMonth} 이자 합계</span>
                <span className="ml-3 text-xl font-bold text-orange-600">
                  {fmt(calcResult.totalInterest)}원
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={calcResult.totalInterest === 0}
                onClick={handleGoToJournal}
              >
                전표 작성 (전체) →
              </Button>
            </div>

            {/* 프로젝트별 이자 분해 (전표의 프로젝트 귀속 기반 자동 계산) */}
            {calcResult.projectBreakdown.length > 1 && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left px-3 py-2">프로젝트</th>
                      <th className="text-right px-3 py-2">이자</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {calcResult.projectBreakdown.map(p => (
                      <tr key={p.project_id ?? 'none'}>
                        <td className="px-3 py-2">{p.project_code}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-orange-600">{fmt(p.interest)}</td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs px-2"
                            disabled={p.interest === 0}
                            onClick={() => goToProjectJournal(p.interest, p.project_id, p.project_code)}
                          >
                            전표
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
