import { createAdminClient } from '@/lib/supabase/admin'
import { getScope } from '@/lib/auth/scope'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

// 잔액성(자산/부채) 계정의 activity_subtype — 손익 집계에서 제외해야 매출/비용이 안 부풀려짐
// (src/app/(erp)/monthly/page.tsx의 PL_EXCLUDE_SUBTYPES와 동일한 목적)
const PL_EXCLUDE_SUBTYPES = new Set([
  '미수', '회수', '선급', '선급환입', '입금', '환수', '예수', '정산',
  '비용발생', '비용집행', '', '반제처리',
])

export default async function StaffDashboard() {
  const scope = await getScope()
  if (scope.role !== 'employee') return null
  const projectId = scope.allowedProjectId
  const supabase = createAdminClient()

  const { data: project } = await (supabase as any).from('projects').select('code').eq('id', projectId).single()

  // 이번 달 매출/비용 (monthly_cashflow 뷰, 영업 activity만)
  const monthKey = new Date().toISOString().slice(0, 7)
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
    revenue += Number(r.total_credit)
    opex += Number(r.total_debit)
  }

  // 미결잔액 (미수금/미지급금 계열) — 이 프로젝트 전표만
  const { data: balanceAccounts } = await (supabase as any)
    .from('accounts')
    .select('id, name, normal_side')
    .in('name', ['미수금(신용카드)', '미수금(무통장입금)', '미수금(PG)', '미지급금(매입)', '미지급금(원리금)'])

  const { data: validJournals } = await (supabase as any)
    .from('journals')
    .select('id')
    .eq('is_cancelled', false)
    .eq('project_id', projectId)
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
        <p className="text-sm text-gray-500 mt-0.5">{monthKey} 기준</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-xs text-gray-500 mb-1">이번 달 매출</div>
          <div className="text-xl font-bold tabular-nums">{fmt(revenue)}</div>
        </div>
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-xs text-gray-500 mb-1">이번 달 비용</div>
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
