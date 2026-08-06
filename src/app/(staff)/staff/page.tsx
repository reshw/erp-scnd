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

  // 부가세 포함 매출 — 순매출(revenue)에 대응하는 부가세예수금만 골라야 하므로
  // subtype 문자열(예수/지급)로는 못 거른다: 지급은 매출취소 시의 예수금 차감과
  // 실제 세무서 납부가 같은 라벨을 씀. 대신 "같은 전표에 매출 계정 라인이 있는지"로
  // 부가세예수금 라인을 매출 관련만 골라낸다(납부 전표는 매출 계정 라인이 없음).
  const monthStart = `${monthKey}-01`
  const monthLastDate = monthEnd(monthKey)
  const { data: revenueAccounts } = await (supabase as any)
    .from('accounts')
    .select('id')
    .eq('activity_type', '영업')
    .eq('increase_type', '매출')
  const revenueAccountIds = (revenueAccounts ?? []).map((a: any) => a.id)

  let vat = 0
  if (revenueAccountIds.length > 0) {
    const { data: revenueLines } = await (supabase as any)
      .from('journal_lines')
      .select('journal_id, journals!inner(is_cancelled, project_id)')
      .in('account_id', revenueAccountIds)
      .eq('journals.is_cancelled', false)
      .eq('journals.project_id', projectId)
      .gte('date', monthStart)
      .lte('date', monthLastDate)
    const salesJournalIds = [...new Set((revenueLines ?? []).map((l: any) => l.journal_id))]

    if (salesJournalIds.length > 0) {
      const { data: vatLines } = await (supabase as any)
        .from('journal_lines')
        .select('debit, credit, accounts!inner(name)')
        .eq('accounts.name', '부가세예수금')
        .in('journal_id', salesJournalIds)
      for (const l of (vatLines ?? []) as any[]) vat += l.credit - l.debit
    }
  }
  const revenueGross = revenue + vat

  // 미결잔액 (미수금/미지급금 계열) — 이 프로젝트 전표만, 기준일까지
  const { data: balanceAccounts } = await (supabase as any)
    .from('accounts')
    .select('id, name, normal_side')
    .in('name', ['미수금(신용카드)', '미수금(무통장입금)', '미수금(PG)', '미지급금(매입)', '미지급금(원리금)'])

  const { data: validJournals } = await (supabase as any)
    .from('journals')
    .select('id')
    .eq('is_cancelled', false)
    .eq('project_id', projectId)
    .lte('date', asOfDate)
  const validIds = (validJournals ?? []).map((j: any) => j.id)

  const balanceRows: { name: string; balance: number }[] = []
  if (validIds.length > 0) {
    for (const acc of (balanceAccounts ?? []) as any[]) {
      const { data: lines } = await (supabase as any)
        .from('journal_lines')
        .select('debit, credit')
        .eq('account_id', acc.id)
        .in('journal_id', validIds)
      let bal = 0
      for (const l of (lines ?? []) as any[]) {
        bal += acc.normal_side === 'credit' ? l.credit - l.debit : l.debit - l.credit
      }
      if (bal !== 0) balanceRows.push({ name: acc.name, balance: bal })
    }
  }

  // 통장 잔고 (보통예금, 거래처별)
  const { data: bankAcc } = await (supabase as any).from('accounts').select('id').eq('name', '보통예금').single()
  const bankBalance: Record<string, number> = {}
  if (bankAcc && validIds.length > 0) {
    const { data: lines } = await (supabase as any)
      .from('journal_lines')
      .select('debit, credit, counterparty_name')
      .eq('account_id', bankAcc.id)
      .in('journal_id', validIds)
    for (const l of (lines ?? []) as any[]) {
      const cp = l.counterparty_name
      if (!cp) continue
      bankBalance[cp] = (bankBalance[cp] ?? 0) + l.debit - l.credit
    }
  }

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
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-xs text-gray-500 mb-1">{monthKey} 매출 (부가세 포함)</div>
          <div className="text-xl font-bold tabular-nums">{fmt(revenueGross)}</div>
          <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
            (순매출 {fmt(revenue)} / 부가세 {fmt(vat)})
          </div>
        </div>
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-xs text-gray-500 mb-1">{monthKey} 비용</div>
          <div className="text-xl font-bold tabular-nums">{fmt(opex)}</div>
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
