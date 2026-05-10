import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const { project } = await searchParams
  const supabase = createAdminClient()

  const { data: projects } = await (supabase as any)
    .from('projects').select('id, code').eq('is_active', true).order('code') as any

  let query = (supabase as any)
    .from('loans')
    .select('*, counterparties(name), projects(code)')
    .order('created_at', { ascending: false })

  if (project) {
    const proj = (projects ?? []).find((p: any) => p.code === project)
    if (proj) query = query.eq('project_id', proj.id)
  }

  const { data: loans } = await query as any
  const loanList: any[] = loans ?? []

  // ── 일반 대출 잔액: loan_settlements 합산 ──────────────────────────
  const regularIds = loanList.filter(l => l.loan_type !== '마이너스통장').map(l => l.id)
  let settlementsMap = new Map<string, number>() // loan_id → sum(actual_repayment)

  if (regularIds.length > 0) {
    const { data: settlements } = await (supabase as any)
      .from('loan_settlements')
      .select('loan_id, actual_repayment')
      .in('loan_id', regularIds) as any

    for (const s of settlements ?? []) {
      if (s.actual_repayment == null) continue
      settlementsMap.set(s.loan_id, (settlementsMap.get(s.loan_id) ?? 0) + Number(s.actual_repayment))
    }
  }

  // ── 마통 잔액: journal_lines 역산 (대변-차변 합산) ─────────────────
  const overdraftLoans = loanList.filter(l => l.loan_type === '마이너스통장' && l.account_id && l.counterparty_id)
  const overdraftBalanceMap = new Map<string, number>() // loan_id → balance

  await Promise.all(overdraftLoans.map(async (loan: any) => {
    // 1단계: 유효 journal_id 목록
    let jq = (supabase as any)
      .from('journals')
      .select('id')
      .eq('is_cancelled', false)
    if (loan.project_id) jq = jq.eq('project_id', loan.project_id)
    const { data: validJs } = await jq as any
    const validIds: string[] = (validJs ?? []).map((j: any) => j.id)
    if (validIds.length === 0) { overdraftBalanceMap.set(loan.id, 0); return }

    // 2단계: 명세 조회
    const { data: lines } = await (supabase as any)
      .from('journal_lines')
      .select('credit, debit')
      .eq('account_id', loan.account_id)
      .eq('counterparty_id', loan.counterparty_id)
      .in('journal_id', validIds) as any
    const balance = (lines ?? []).reduce((sum: number, l: any) => sum + Number(l.credit) - Number(l.debit), 0)
    overdraftBalanceMap.set(loan.id, balance)
  }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">대출 관리</h2>
        <Link href="/loans/new">
          <Button size="sm">+ 대출 등록</Button>
        </Link>
      </div>

      {/* 프로젝트 필터 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/loans">
          <span className={`px-3 py-1.5 rounded-full text-xs border cursor-pointer ${!project ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            전체
          </span>
        </Link>
        {(projects ?? []).map((p: any) => (
          <Link key={p.id} href={`/loans?project=${p.code}`}>
            <span className={`px-3 py-1.5 rounded-full text-xs border cursor-pointer ${project === p.code ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
              {p.code}
            </span>
          </Link>
        ))}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="text-left px-4 py-3">대출명</th>
              <th className="text-left px-4 py-3">거래처</th>
              <th className="text-left px-4 py-3">프로젝트</th>
              <th className="text-right px-4 py-3">잔액</th>
              <th className="text-right px-4 py-3">금리(%)</th>
              <th className="text-left px-4 py-3">시작일</th>
              <th className="text-left px-4 py-3">종료일</th>
              <th className="text-left px-4 py-3">유형</th>
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loanList.map((loan: any) => {
              const isOverdraft = loan.loan_type === '마이너스통장'
              let balance: number | null = null
              if (isOverdraft) {
                balance = overdraftBalanceMap.get(loan.id) ?? null
              } else {
                const paid = settlementsMap.get(loan.id) ?? 0
                balance = Number(loan.principal) - paid
              }

              return (
                <tr key={loan.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/loans/${loan.id}`} className="text-blue-600 hover:underline">
                      {loan.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{loan.counterparties?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{loan.projects?.code ?? '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="tabular-nums font-medium">
                      {balance != null ? fmt(balance) : '-'}
                    </span>
                    {isOverdraft && loan.overdraft_limit && (
                      <div className="text-xs text-gray-400 tabular-nums">
                        한도 {fmt(loan.overdraft_limit)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{(Number(loan.interest_rate) * 100).toFixed(2)}</td>
                  <td className="px-4 py-3">{loan.start_date}</td>
                  <td className="px-4 py-3">{loan.end_date}</td>
                  <td className="px-4 py-3">
                    {isOverdraft
                      ? <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">마통</span>
                      : loan.loan_type}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/loans/${loan.id}`}>
                      <Button size="sm" variant="outline">상세</Button>
                    </Link>
                  </td>
                </tr>
              )
            })}
            {loanList.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                  {project ? `${project} 프로젝트 대출 없음` : '등록된 대출이 없습니다'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
