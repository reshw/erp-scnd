'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

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
}

interface CalcResult {
  dailyBalances: DailyBalance[]
  totalInterest: number
}

interface Props {
  loanId: string
  overdraftLimit: number | null
  annualRate: number
  includeDrawDay: boolean
  lines: DrawLine[]
}

export default function OverdraftDetail({ loanId, overdraftLimit, annualRate, includeDrawDay, lines }: Props) {
  const router = useRouter()

  const currentBalance = lines.reduce((sum, l) => sum + l.credit - l.debit, 0)

  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [calcMonth, setCalcMonth] = useState(defaultMonth)
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [calculating, setCalculating] = useState(false)

  async function handleCalc() {
    setCalculating(true)
    setCalcResult(null)
    const [y, m] = calcMonth.split('-').map(Number)
    const from = `${calcMonth}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const to = `${calcMonth}-${String(lastDay).padStart(2, '0')}`
    const res = await fetch(`/api/loans/${loanId}/overdraft-interest?from=${from}&to=${to}`)
    if (res.ok) setCalcResult(await res.json())
    setCalculating(false)
  }

  function handleGoToJournal() {
    if (!calcResult) return
    const [y, m] = calcMonth.split('-').map(Number)
    const to = `${calcMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
    router.push(`/journals/new?overdraftInterest=${calcResult.totalInterest}&date=${to}&loanMonth=${calcMonth}`)
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

      {/* 월말 이자 계산 */}
      <div className="border rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">월말 이자 계산</h3>
        <div className="text-xs text-gray-400">
          연이율 {(annualRate * 100).toFixed(2)}% · 일별잔액 × 연이율 ÷ 365
          {includeDrawDay ? ' · 당일 인출 포함' : ' · 당일 인출 미포함 (익일 기산)'}
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
                    <th className="text-right px-3 py-2">일이자</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {calcResult.dailyBalances.map(d => (
                    <tr key={d.date} className={d.balance === 0 ? 'opacity-40' : ''}>
                      <td className="px-3 py-1.5 tabular-nums">{d.date}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.balance)}</td>
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
                전표 작성 →
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
