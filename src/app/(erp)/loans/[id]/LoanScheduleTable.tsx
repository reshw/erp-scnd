'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

interface PrepaymentInfo {
  id: string
  date: string
  amount: number
  note: string | null
  journal_id: string | null
}

interface ScheduleRow {
  month: string
  payment: number
  interest: number
  repayment: number
  balance: number
  partial?: boolean
  days?: number
  prepayment?: PrepaymentInfo
}

interface Settlement {
  month: string
  actual_interest: number
  actual_repayment: number | null
  note: string | null
}

interface Props {
  loanId: string
  projectId: string | null
  schedule: ScheduleRow[]
  settlements: Settlement[]
  annualRate: number
  interestCalc: string
  interestRound: string
  loanType: string
  principal: number
  pmt: number
}

export default function LoanScheduleTable({ loanId, projectId, schedule, settlements, annualRate, interestCalc, interestRound, loanType, principal, pmt }: Props) {
  const router = useRouter()
  const today = new Date().toISOString().slice(0, 7)
  const todayDate = new Date().toISOString().slice(0, 10)

  // ── 확정 상태 ────────────────────────────────────────────────────────
  const [settleMap, setSettleMap] = useState<Map<string, Settlement>>(() => {
    const m = new Map<string, Settlement>()
    settlements.forEach(s => m.set(s.month, s))
    return m
  })
  const [settleModal, setSettleModal] = useState<{ month: string; row: ScheduleRow } | null>(null)
  const [actualInterest, setActualInterest] = useState('')
  const [actualRepayment, setActualRepayment] = useState('')
  const [settleNote, setSettleNote] = useState('')

  // ── 중도상환 모달 ─────────────────────────────────────────────────────
  const [prepayModal, setPrepayModal] = useState(false)
  const [prepayDate, setPrepayDate] = useState(todayDate)
  const [prepayAmount, setPrepayAmount] = useState('')
  const [prepayNote, setPrepayNote] = useState('')

  // ── 일괄집행 모달 ──────────────────────────────────────────────────────
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkChecked, setBulkChecked] = useState<Set<string>>(new Set())

  const [saving, setSaving] = useState(false)

  // ── 확정 핸들러 ──────────────────────────────────────────────────────
  function openSettleModal(row: ScheduleRow) {
    const existing = settleMap.get(row.month)
    setSettleModal({ month: row.month, row })
    setActualInterest(String(existing?.actual_interest ?? row.interest))
    setActualRepayment(existing?.actual_repayment != null ? String(existing.actual_repayment) : '')
    setSettleNote(existing?.note ?? '')
  }

  async function handleSettle() {
    if (!settleModal) return
    setSaving(true)
    const res = await fetch(`/api/loans/${loanId}/settlements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month: settleModal.month,
        actual_interest:  parseFloat(actualInterest) || 0,
        actual_repayment: actualRepayment !== '' ? parseFloat(actualRepayment) : null,
        note: settleNote || null,
      }),
    })
    if (res.ok) {
      const saved = await res.json()
      setSettleMap(prev => { const m = new Map(prev); m.set(saved.month, saved); return m })
      setSettleModal(null)
    }
    setSaving(false)
  }

  async function handleUnsettle(month: string) {
    if (!confirm(`${month} 확정을 취소하시겠습니까?`)) return
    const res = await fetch(`/api/loans/${loanId}/settlements`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month }),
    })
    if (res.ok) {
      setSettleMap(prev => { const m = new Map(prev); m.delete(month); return m })
    }
  }

  // ── 중도상환 핸들러 ──────────────────────────────────────────────────
  async function handlePrepay() {
    if (!prepayAmount || !prepayDate) return
    setSaving(true)
    const res = await fetch(`/api/loans/${loanId}/prepayments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date:   prepayDate,
        amount: parseFloat(prepayAmount),
        note:   prepayNote || null,
      }),
    })
    if (res.ok) {
      setPrepayModal(false)
      setPrepayAmount('')
      setPrepayNote('')
      router.refresh()  // 서버 스케줄 재계산
    }
    setSaving(false)
  }

  // ── 일괄집행 핸들러 ──────────────────────────────────────────────────
  function openBulkModal(displayRows: (ScheduleRow & { settled?: boolean })[]) {
    // 이번달 이하, 미확정, 비중도상환, 비일할 행만
    const eligible = displayRows.filter(r =>
      !r.prepayment && !r.partial && !r.settled && r.month <= today
    )
    const all = new Set(eligible.map(r => r.month))
    setBulkChecked(all)
    setBulkModal(true)
  }

  async function handleBulkExecute(displayRows: (ScheduleRow & { settled?: boolean })[]) {
    if (bulkChecked.size === 0) return
    setSaving(true)
    const rowMap = new Map(displayRows.map(r => [r.month, r]))
    const months = [...bulkChecked].sort().map(month => {
      const r = rowMap.get(month)!
      return { month, interest: r.interest, repayment: r.repayment }
    })
    const res = await fetch(`/api/loans/${loanId}/bulk-execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ months }),
    })
    if (res.ok) {
      setBulkModal(false)
      router.refresh()
    }
    setSaving(false)
  }

  async function handleDeletePrepayment(prepaymentId: string) {
    if (!confirm('중도상환 내역을 삭제하시겠습니까?')) return
    const res = await fetch(`/api/loans/${loanId}/prepayments`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prepaymentId }),
    })
    if (res.ok) router.refresh()
  }

  // ── 캐스케이드 재계산 ─────────────────────────────────────────────────
  function buildDisplayRows() {
    const rows: (ScheduleRow & { settled?: boolean })[] = []
    let carryBalance: number | null = null

    function applyRound(x: number): number {
      if (interestRound === 'ceil')  return Math.ceil(x)
      if (interestRound === 'floor') return Math.floor(x)
      return Math.round(x)
    }
    function recomputeInterest(bal: number, days: number | undefined): number {
      if (interestCalc === 'daily_actual' && days != null)
        return applyRound(bal * annualRate / 365 * days)
      if (interestCalc === 'daily_30')
        return applyRound(bal * annualRate / 365 * 30)
      return applyRound(bal * annualRate / 12)
    }

    const regularRows = schedule.filter(r => !r.partial && !r.prepayment)

    for (let i = 0; i < schedule.length; i++) {
      const row = { ...schedule[i] }

      // 중도상환 행: 캐스케이드 잔액 반영 (서버에서 이미 계산됐지만 확정 drift 반영)
      if (row.prepayment) {
        const adjustedBalance: number = carryBalance !== null
          ? Math.max(0, carryBalance - row.prepayment.amount)
          : row.balance
        if (carryBalance !== null) carryBalance = adjustedBalance
        rows.push({ ...row, balance: adjustedBalance })
        continue
      }

      const s = settleMap.get(row.month)

      if (row.partial) {
        if (s) {
          rows.push({ ...row, interest: s.actual_interest, payment: s.actual_interest, settled: true })
        } else {
          rows.push({ ...row, settled: false })
        }
        continue
      }
      const balanceBefore = carryBalance !== null
        ? carryBalance
        : row.balance + row.repayment

      if (s) {
        const actualRep = s.actual_repayment ?? (pmt > 0 ? pmt - s.actual_interest : row.repayment)
        const newBalance = Math.max(0, balanceBefore - actualRep)
        carryBalance = newBalance
        rows.push({ ...row, interest: s.actual_interest, repayment: actualRep, payment: s.actual_interest + actualRep, balance: newBalance, settled: true })
      } else if (carryBalance !== null) {
        const interest = recomputeInterest(balanceBefore, row.days)
        const isLast = i === schedule.length - 1 || regularRows.indexOf(row) === regularRows.length - 1
        let repayment: number, payment: number
        if (loanType === '만기일시') {
          repayment = isLast ? balanceBefore : 0
          payment   = interest + repayment
        } else if (loanType === '원금균등') {
          repayment = Math.min(row.repayment, balanceBefore)
          payment   = interest + repayment
        } else {
          repayment = Math.min(pmt - interest, balanceBefore)
          payment   = interest + repayment
        }
        const newBalance = Math.max(0, balanceBefore - repayment)
        carryBalance = newBalance
        rows.push({ ...row, interest, repayment, payment, balance: newBalance, settled: false })
      } else {
        rows.push({ ...row, settled: false })
      }
    }
    return rows
  }

  const displayRows = buildDisplayRows()
  const regularDisplayRows = displayRows.filter(r => !r.prepayment)

  // 일괄집행 대상: 이번달 이하 미확정 행
  const bulkEligible = displayRows.filter(r =>
    !r.prepayment && !r.partial && !r.settled && r.month <= today
  )

  return (
    <>
      {/* 헤더 액션 */}
      <div className="flex justify-end gap-2">
        {loanType === '만기일시' && bulkEligible.length > 0 && (
          <Button size="sm" variant="outline" className="text-blue-600 border-blue-200"
            onClick={() => openBulkModal(displayRows)}>
            일괄 집행 ({bulkEligible.length}건)
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => { setPrepayModal(true); setPrepayDate(todayDate) }}>
          + 중도상환 등록
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="text-left px-4 py-3">회차</th>
              <th className="text-left px-4 py-3">날짜</th>
              <th className="text-right px-4 py-3">납부액</th>
              <th className="text-right px-4 py-3">원금</th>
              <th className="text-right px-4 py-3">이자</th>
              <th className="text-right px-4 py-3">잔액</th>
              <th className="w-36 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {displayRows.map((row, i) => {
              const isPrepayment = !!row.prepayment
              const isPartial = row.partial === true
              const isSettled = row.settled === true
              const isPast = row.month < today
              const isCurrent = row.month === today

              // 회차 번호: partial·중도상환 제외한 순번
              const regularIdx = !isPrepayment && !isPartial
                ? regularDisplayRows.filter(r => !r.prepayment && !r.partial).indexOf(row)
                : -1

              let rowClass = ''
              if (isPrepayment) rowClass = 'bg-purple-50'
              else if (isSettled) rowClass = 'bg-green-50'
              else if (isCurrent) rowClass = 'bg-blue-50'
              else if (isPast) rowClass = 'opacity-50'
              else if (isPartial) rowClass = 'bg-amber-50/60'

              return (
                <tr key={`${row.month}-${isPrepayment ? row.prepayment!.id : i}`} className={`${rowClass} hover:bg-gray-50`}>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">
                    {isPrepayment
                      ? <span className="text-purple-600 font-medium">중도상환</span>
                      : isPartial
                        ? <span className="text-amber-600">일할</span>
                        : regularIdx + 1}
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    {isPrepayment ? row.prepayment!.date : row.month}
                    {isCurrent && !isSettled && !isPrepayment && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">이번달</span>}
                    {isPartial && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">시작월 일할</span>}
                    {isSettled && <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">확정</span>}
                    {isPrepayment && row.prepayment!.note && <span className="ml-2 text-xs text-purple-500">{row.prepayment!.note}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.payment)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {isPrepayment
                      ? <span className="text-purple-700 font-medium">{fmt(row.repayment)}</span>
                      : row.repayment > 0 ? fmt(row.repayment) : '-'}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${isSettled ? 'text-green-700 font-medium' : isPrepayment ? 'text-gray-400' : 'text-orange-600'}`}>
                    {isPrepayment ? '-' : fmt(row.interest)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{fmt(row.balance)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      {isPrepayment ? (
                        <>
                          {row.prepayment!.journal_id ? (
                            <Link href={`/journals/${row.prepayment!.journal_id}`}>
                              <Button size="sm" variant="outline" className="text-xs px-2">전표</Button>
                            </Link>
                          ) : (
                            <Link href={`/journals/new?loanId=${loanId}&prepaymentId=${row.prepayment!.id}&repayment=${row.prepayment!.amount}&interest=0&loanMonth=${row.month}`}>
                              <Button size="sm" variant="outline" className="text-xs px-2">전표</Button>
                            </Link>
                          )}
                          <Button size="sm" variant="outline" className="text-xs px-2 text-red-400"
                            onClick={() => handleDeletePrepayment(row.prepayment!.id)}>
                            삭제
                          </Button>
                        </>
                      ) : isSettled ? (
                        <>
                          <Link href={`/journals/new?loanId=${loanId}&loanMonth=${row.month}&repayment=${row.repayment}&interest=${row.interest}`}>
                            <Button size="sm" variant="outline" className="text-xs px-2">전표</Button>
                          </Link>
                          <Button size="sm" variant="outline" className="text-xs px-2 text-gray-400"
                            onClick={() => handleUnsettle(row.month)}>
                            취소
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant={isCurrent ? 'default' : 'outline'}
                            className="text-xs px-2"
                            onClick={() => openSettleModal(row)}>
                            확정
                          </Button>
                          <Link href={`/journals/new?loanId=${loanId}&loanMonth=${row.month}&repayment=${row.repayment}&interest=${row.interest}`}>
                            <Button size="sm" variant="outline" className="text-xs px-2">전표</Button>
                          </Link>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 text-sm font-bold">
            <tr>
              <td colSpan={2} className="px-4 py-3 text-gray-600">합계</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmt(displayRows.reduce((s, r) => s + r.payment, 0))}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmt(displayRows.reduce((s, r) => s + r.repayment, 0))}</td>
              <td className="px-4 py-3 text-right tabular-nums text-orange-600">{fmt(displayRows.filter(r => !r.prepayment).reduce((s, r) => s + r.interest, 0))}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 중도상환 등록 모달 */}
      {prepayModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <h3 className="font-bold text-base">중도상환 등록</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-gray-500 block mb-1">상환일 *</label>
                <input type="date" value={prepayDate} onChange={e => setPrepayDate(e.target.value)}
                  className="border rounded px-3 py-2 text-sm w-full" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">상환 원금 *</label>
                <input type="number" value={prepayAmount} onChange={e => setPrepayAmount(e.target.value)}
                  placeholder="10000000" className="border rounded px-3 py-2 text-sm w-full" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">메모</label>
                <input type="text" value={prepayNote} onChange={e => setPrepayNote(e.target.value)}
                  placeholder="일부상환, 전액상환 등" className="border rounded px-3 py-2 text-sm w-full" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setPrepayModal(false)}>취소</Button>
              <Button size="sm" disabled={saving || !prepayAmount} onClick={handlePrepay}>
                {saving ? '저장 중...' : '등록'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 일괄집행 모달 */}
      {bulkModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">일괄 집행</h3>
              <span className="text-xs text-gray-400">확정 + 전표 자동발행</span>
            </div>
            <p className="text-xs text-gray-500">처리할 월을 선택하세요. 선택하지 않은 월은 나중에 별도 처리할 수 있습니다.</p>

            {/* 전체 선택/해제 */}
            <div className="flex items-center gap-2 pb-1 border-b">
              <input type="checkbox"
                checked={bulkChecked.size === bulkEligible.length}
                onChange={e => setBulkChecked(e.target.checked ? new Set(bulkEligible.map(r => r.month)) : new Set())}
                className="accent-blue-600" />
              <span className="text-xs text-gray-600 font-medium">전체 ({bulkEligible.length}건)</span>
            </div>

            {/* 월별 체크리스트 */}
            <div className="max-h-64 overflow-y-auto space-y-1">
              {bulkEligible.map(row => (
                <label key={row.month} className="flex items-center justify-between gap-2 px-1 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox"
                      checked={bulkChecked.has(row.month)}
                      onChange={e => {
                        setBulkChecked(prev => {
                          const next = new Set(prev)
                          e.target.checked ? next.add(row.month) : next.delete(row.month)
                          return next
                        })
                      }}
                      className="accent-blue-600" />
                    <span className="text-sm font-medium">{row.month}</span>
                  </div>
                  <span className="text-sm tabular-nums text-orange-600">{fmt(row.interest)}원</span>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between pt-1 border-t">
              <span className="text-xs text-gray-500">
                선택 {bulkChecked.size}건 · 이자 합계 {fmt(bulkEligible.filter(r => bulkChecked.has(r.month)).reduce((s, r) => s + r.interest, 0))}원
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setBulkModal(false)}>취소</Button>
                <Button size="sm" disabled={saving || bulkChecked.size === 0}
                  onClick={() => handleBulkExecute(displayRows)}>
                  {saving ? '처리 중...' : `${bulkChecked.size}건 집행`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 확정 모달 */}
      {settleModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <h3 className="font-bold text-base">{settleModal.month} 납부 확정</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  실제 이자 (스케줄: {fmt(settleModal.row.interest)}원)
                </label>
                <input type="number" value={actualInterest} onChange={e => setActualInterest(e.target.value)}
                  className="border rounded px-3 py-2 text-sm w-full" />
              </div>
              {!settleModal.row.partial && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  실제 원금상환 (비워두면 스케줄대로: {fmt(settleModal.row.repayment)}원)
                </label>
                <input type="number" value={actualRepayment} onChange={e => setActualRepayment(e.target.value)}
                  placeholder={String(settleModal.row.repayment)}
                  className="border rounded px-3 py-2 text-sm w-full" />
              </div>
              )}
              <div>
                <label className="text-xs text-gray-500 block mb-1">메모</label>
                <input type="text" value={settleNote} onChange={e => setSettleNote(e.target.value)}
                  placeholder="금리변동, 특이사항 등" className="border rounded px-3 py-2 text-sm w-full" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setSettleModal(null)}>취소</Button>
              <Button size="sm" disabled={saving} onClick={handleSettle}>
                {saving ? '저장 중...' : '확정'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
