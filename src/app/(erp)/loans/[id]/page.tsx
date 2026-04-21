import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

/** 원리금균등상환 스케줄 계산
 *  interest_calc:
 *    monthly      전월잔고 × 연이율/12           (은행 표준, trunc)
 *    daily_30     전월잔고 × 연이율/365 × 30      (30일 고정, trunc)
 *    daily_actual 전월잔고 × 연이율/365 × 실일수  (trunc)
 */
function calcSchedule(
  principal: number,
  annualRate: number,
  startDate: string,
  endDate: string,
  interestCalc: string = 'monthly',
) {
  const r = annualRate / 12
  const start = new Date(startDate)
  const end   = new Date(endDate)
  const n = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())

  if (n <= 0) return []

  // PMT: 연이율/12 기준으로 고정 (정수로 올림)
  const pmt = Math.round(
    r === 0 ? principal / n : principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
  )

  const rows = []
  let balance = principal

  for (let i = 0; i < n; i++) {
    const d = new Date(start)
    d.setMonth(d.getMonth() + i + 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    // 이자: 소수점 버림 (trunc)
    let interest: number
    if (interestCalc === 'daily_30') {
      interest = Math.trunc(balance * annualRate / 365 * 30)
    } else if (interestCalc === 'daily_actual') {
      const daysInMonth = new Date(d.getFullYear(), d.getMonth(), 0).getDate()
      interest = Math.trunc(balance * annualRate / 365 * daysInMonth)
    } else {
      // monthly (기본): 연이율/12
      interest = Math.trunc(balance * annualRate / 12)
    }

    const repayment = pmt - interest
    balance -= repayment

    rows.push({
      month,
      payment: pmt,
      interest,
      repayment,
      balance: Math.max(0, balance),
    })
  }

  return rows
}

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: loan } = await (supabase as any)
    .from('loans')
    .select('*, counterparties(name), projects(code)')
    .eq('id', id)
    .single() as any

  if (!loan) notFound()

  const schedule = calcSchedule(
    Number(loan.principal),
    Number(loan.interest_rate),
    loan.start_date,
    loan.end_date,
    loan.interest_calc ?? 'monthly',
  )

  const today = new Date().toISOString().slice(0, 7) // YYYY-MM

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{loan.name}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {loan.counterparties?.name ?? '-'} · {loan.projects?.code ?? '-'} ·{' '}
            원금 {fmt(loan.principal)}원 · 연 {(Number(loan.interest_rate) * 100).toFixed(2)}% · {loan.loan_type}
          </p>
        </div>
        <Link href="/loans">
          <Button size="sm" variant="outline">목록</Button>
        </Link>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="text-left px-4 py-3">회차</th>
              <th className="text-left px-4 py-3">납부월</th>
              <th className="text-right px-4 py-3">월납부액</th>
              <th className="text-right px-4 py-3">원금</th>
              <th className="text-right px-4 py-3">이자</th>
              <th className="text-right px-4 py-3">잔액</th>
              <th className="w-28 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {schedule.map((row, i) => {
              const isPast = row.month < today
              const isCurrent = row.month === today
              return (
                <tr key={row.month} className={`${isCurrent ? 'bg-blue-50' : isPast ? 'opacity-50' : ''} hover:bg-gray-50`}>
                  <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium">
                    {row.month}
                    {isCurrent && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">이번달</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.payment)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.repayment)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-orange-600">{fmt(row.interest)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{fmt(row.balance)}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/journals/new?loanId=${id}&loanMonth=${row.month}&repayment=${row.repayment}&interest=${row.interest}`}>
                      <Button size="sm" variant={isCurrent ? 'default' : 'outline'} className="w-full text-xs">
                        전표 발행
                      </Button>
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 text-sm font-bold">
            <tr>
              <td colSpan={2} className="px-4 py-3 text-gray-600">합계</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmt(schedule.reduce((s, r) => s + r.payment, 0))}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmt(schedule.reduce((s, r) => s + r.repayment, 0))}</td>
              <td className="px-4 py-3 text-right tabular-nums text-orange-600">{fmt(schedule.reduce((s, r) => s + r.interest, 0))}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
