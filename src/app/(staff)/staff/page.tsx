import { createAdminClient } from '@/lib/supabase/admin'
import { getScope } from '@/lib/auth/scope'
import Link from 'next/link'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

// 잔액성(자산/부채) 계정의 activity_subtype — 손익 집계에서 제외해야 매출/비용이 안 부풀려짐
// (src/app/(erp)/monthly/page.tsx의 PL_EXCLUDE_SUBTYPES와 동일한 목적)
const PL_EXCLUDE_SUBTYPES = new Set([
  '미수', '회수', '선급', '선급환입', '입금', '환수', '예수', '정산',
  '비용발생', '비용집행', '', '반제처리',
])

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthEnd(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return `${monthKey}-${String(lastDay).padStart(2, '0')}`
}

export default async function StaffDashboard({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const scope = await getScope()
  if (scope.role !== 'employee') return null
  const projectId = scope.allowedProjectId
  const supabase = createAdminClient()

  const { data: project } = await (supabase as any).from('projects').select('code').eq('id', projectId).single()

  const currentMonthKey = new Date().toISOString().slice(0, 7)
  const { month: requestedMonth } = await searchParams
  const monthKey = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) && requestedMonth <= currentMonthKey
    ? requestedMonth
    : currentMonthKey
  const isCurrentMonth = monthKey === currentMonthKey
  const prevMonth = shiftMonth(monthKey, -1)
  const nextMonth = shiftMonth(monthKey, 1)
  // 미결잔액/통장잔고는 "기간" 활동이 아니라 "기준일" 스냅샷 개념(docs/decisions.md의
  // /clearings 재설계와 동일한 이유) — 선택한 달의 말일까지 누적으로 계산한다.
  // 이번 달을 보고 있을 땐 아직 그 달이 끝나지 않았으니 오늘까지로 계산.
  const asOfDate = isCurrentMonth ? new Date().toISOString().slice(0, 10) : monthEnd(monthKey)

  // 매출/비용 (monthly_cashflow 뷰, 영업 activity만)
  const { data: cashflowRows } = await (supabase as any)
    .from('monthly_cashflow')
    .select('month, activity_type, activity_subtype, total_debit, total_credit')
    .eq('project_id', projectId)
    .eq('month', `${monthKey}-01`)

  let revenue = 0
  let opex = 0
  for (const r of (cashflowRows ?? []) as any[]) {
    if (r.activity_type !== '영업') continue
    if (PL_EXCLUDE_SUBTYPES.has(r.activity_subtype)) continue
    if (r.activity_subtype === '매출취소') {
      // 매출 계정(판매수입 등)의 감소 라벨 — 별도 비용이 아니라 매출에서 순액 차감
      // (src/app/(erp)/monthly/page.tsx의 손익 집계와 동일한 이유)
      revenue -= Number(r.total_debit)
    } else {
      revenue += Number(r.total_credit)
      opex += Number(r.total_debit)
    }
  }
  // 매출/비용을 같은 기준(발생주의, 부가세 제외)으로 맞춰야 차액이 실질 손익이 된다 —
  // 부가세 포함 총액은 여기 표시하지 않는다(2026-08-06, 사장님 요청으로 되돌림).

  // 미결잔액 (미수금/미지급금 계열) — 이 프로젝트 전표만, 기준일까지
  const { data: balanceAccounts } = await (supabase as any)
    .from('accounts')
    .select('id, name, normal_side')
    .in('name', [
      '미수금(신용카드)', '미수금(무통장입금)', '미수금(PG)', '미지급금(매입)', '미지급금(원리금)',
      '현금', '보통예금', '부가세예수금', '부가세대급금', '출자금', '인출금',
    ])
  const accByName = Object.fromEntries((balanceAccounts ?? []).map((a: any) => [a.name, a]))

  const { data: validJournals } = await (supabase as any)
    .from('journals')
    .select('id')
    .eq('is_cancelled', false)
    .eq('project_id', projectId)
    .lte('date', asOfDate)
  const validIds = (validJournals ?? []).map((j: any) => j.id)

  // acc 잔액(기준일까지 누적). counterpartyName을 주면 그 거래처 라인만 걸러서 합산.
  async function accountBalance(acc: any, counterpartyName?: string): Promise<number> {
    if (!acc || validIds.length === 0) return 0
    let q = (supabase as any).from('journal_lines').select('debit, credit').eq('account_id', acc.id).in('journal_id', validIds)
    if (counterpartyName) q = q.eq('counterparty_name', counterpartyName)
    const { data: lines } = await q
    let bal = 0
    for (const l of (lines ?? []) as any[]) {
      bal += acc.normal_side === 'credit' ? l.credit - l.debit : l.debit - l.credit
    }
    return bal
  }

  const balanceRows: { name: string; balance: number }[] = []
  for (const name of ['미수금(신용카드)', '미수금(무통장입금)', '미수금(PG)', '미지급금(매입)', '미지급금(원리금)']) {
    const bal = await accountBalance(accByName[name])
    if (bal !== 0) balanceRows.push({ name, balance: bal })
  }

  // 통장 잔고 (보통예금, 거래처별)
  const bankBalance: Record<string, number> = {}
  if (accByName['보통예금'] && validIds.length > 0) {
    const { data: lines } = await (supabase as any)
      .from('journal_lines')
      .select('debit, credit, counterparty_name')
      .eq('account_id', accByName['보통예금'].id)
      .in('journal_id', validIds)
    for (const l of (lines ?? []) as any[]) {
      const cp = l.counterparty_name
      if (!cp) continue
      bankBalance[cp] = (bankBalance[cp] ?? 0) + l.debit - l.credit
    }
  }

  // 가용잔액(운영 가능 자금) = 보통예금 + 현금
  //   − 부가세 순채무(부가세예수금 − 부가세대급금, 세무서에 낼 돈이라 회사가 쓸 돈 아님)
  //   − 대표자 정산대기금(출자금(양석환) − 인출금(양석환), 대표이사가 회사를 위해 대신 낸 돈)
  //   − 미지급금(매입)(대관료 등 확정된 채무)
  // 전부 asOfDate 기준 누적 잔액. 2026-08-06, 사장님 요청으로 신설 — "통장 잔액만으론
  // 지금 얼마를 써도 되는지 알 수 없다"는 문제(그래서 개인자금을 투입하는 일이 생김)를
  // 대시보드에서 바로 확인하게 하려는 목적.
  const bankTotal = Object.values(bankBalance).reduce((s, v) => s + v, 0)
  const cashTotal = await accountBalance(accByName['현금'])
  const vatPayable = await accountBalance(accByName['부가세예수금']) - await accountBalance(accByName['부가세대급금'])
  const founderSettlement = await accountBalance(accByName['출자금'], '양석환') - await accountBalance(accByName['인출금'], '양석환')
  const apPayable = await accountBalance(accByName['미지급금(매입)'])
  const availableBalance = bankTotal + cashTotal - vatPayable - founderSettlement - apPayable

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{project?.code ?? ''} 잔액/손익</h2>
        <div className="flex items-center gap-1.5 mt-1">
          <Link
            href={`/staff?month=${prevMonth}`}
            className="px-2 py-0.5 rounded border text-sm text-gray-600 hover:bg-gray-50"
          >◀</Link>
          <span className="text-sm text-gray-700 font-medium tabular-nums w-16 text-center">{monthKey}</span>
          {isCurrentMonth ? (
            <span className="px-2 py-0.5 text-sm text-gray-300">▶</span>
          ) : (
            <Link
              href={`/staff?month=${nextMonth}`}
              className="px-2 py-0.5 rounded border text-sm text-gray-600 hover:bg-gray-50"
            >▶</Link>
          )}
          <span className="text-xs text-gray-400 ml-1">잔액은 {asOfDate} 기준</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Link
          href={`/staff/ledger?type=revenue&month=${monthKey}`}
          className="border rounded-lg p-4 bg-white hover:bg-gray-50 hover:border-gray-300 transition-colors"
        >
          <div className="text-xs text-gray-500 mb-1">{monthKey} 순매출</div>
          <div className="text-xl font-bold tabular-nums">{fmt(revenue)}</div>
        </Link>
        <Link
          href={`/staff/ledger?type=expense&month=${monthKey}`}
          className="border rounded-lg p-4 bg-white hover:bg-gray-50 hover:border-gray-300 transition-colors"
        >
          <div className="text-xs text-gray-500 mb-1">{monthKey} 비용</div>
          <div className="text-xl font-bold tabular-nums">{fmt(opex)}</div>
        </Link>
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <div className="text-xs text-gray-500 mb-1">가용잔액 (운영 가능 자금, {asOfDate} 기준)</div>
        <div className={`text-2xl font-bold tabular-nums ${availableBalance < 0 ? 'text-red-600' : ''}`}>{fmt(availableBalance)}</div>
        <div className="text-xs text-gray-400 mt-1 tabular-nums">
          보통예금+현금 {fmt(bankTotal + cashTotal)} − 부가세 {fmt(vatPayable)} − 대표자 정산대기금 {fmt(founderSettlement)} − 미지급금(매입) {fmt(apPayable)}
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr><th className="text-left px-3 py-2">통장</th><th className="text-right px-3 py-2">잔고</th></tr>
          </thead>
          <tbody className="divide-y">
            {Object.entries(bankBalance).map(([name, bal]) => (
              <tr key={name}>
                <td className="px-3 py-2">{name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(bal)}</td>
              </tr>
            ))}
            {Object.keys(bankBalance).length === 0 && (
              <tr><td colSpan={2} className="px-3 py-6 text-center text-gray-400">데이터 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr><th className="text-left px-3 py-2">미결잔액 계정</th><th className="text-right px-3 py-2">잔액</th></tr>
          </thead>
          <tbody className="divide-y">
            {balanceRows.map(r => (
              <tr key={r.name}>
                <td className="px-3 py-2">{r.name}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.balance < 0 ? 'text-red-600' : ''}`}>{fmt(r.balance)}</td>
              </tr>
            ))}
            {balanceRows.length === 0 && (
              <tr><td colSpan={2} className="px-3 py-6 text-center text-gray-400">미결 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
