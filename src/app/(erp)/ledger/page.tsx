import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import LedgerFilter from './LedgerFilter'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    account_id?: string
    project_id?: string
    cp_id?: string
    from?: string
    to?: string
    carry?: string
  }>
}) {
  const params = await searchParams
  const supabase = createAdminClient()

  const [{ data: accounts }, { data: projects }, { data: counterparties }] = await Promise.all([
    (supabase as any).from('accounts').select('id,name,normal_side').eq('is_active', true).order('name') as any,
    (supabase as any).from('projects').select('id,code').eq('is_active', true).order('code') as any,
    (supabase as any).from('counterparties').select('id,name').order('name') as any,
  ])

  const selectedAccount = (accounts ?? []).find((a: any) => a.id === params.account_id)

  // ── 원장 데이터 조회 ──────────────────────────────────────────────────────
  interface LedgerLine {
    id: string
    date: string
    journal_no: number
    journal_id: string
    description: string | null
    note: string | null
    counterparty_name: string | null
    debit: number
    credit: number
    balance: number
  }

  let lines: LedgerLine[] = []
  let totalDebit = 0, totalCredit = 0
  let openingBalance = 0
  const applyCarry = params.carry === '1' && !!params.from

  if (params.account_id) {
    const normalSide = selectedAccount?.normal_side ?? 'debit'

    // 이월잔액: 선택 구간(from) 이전 전체를 화면에 그릴 필요 없이, debit/credit 두 컬럼만
    // 가볍게 뽑아 합산한다(PostgREST 쪽 sum() 집계 함수는 이 프로젝트에서 막혀 있어(PGRST123)
    // 못 씀 — 대시보드 통장별 집계와 같은 방식). limit을 크게 잡아 기본 페이지 크기(1000)에
    // 안 걸리게 한다.
    if (applyCarry) {
      let oq = (supabase as any)
        .from('journal_lines')
        .select('debit, credit, journals!inner(is_cancelled, project_id)')
        .eq('account_id', params.account_id)
        .eq('journals.is_cancelled', false)
        .lt('date', params.from)
        .limit(100000)
      if (params.cp_id)      oq = oq.eq('counterparty_id', params.cp_id)
      if (params.project_id) oq = oq.eq('journals.project_id', params.project_id)

      const { data: openingRows } = await oq as any
      let openingDebit = 0, openingCredit = 0
      for (const r of openingRows ?? []) {
        openingDebit  += Number(r.debit)
        openingCredit += Number(r.credit)
      }
      openingBalance = normalSide === 'credit'
        ? openingCredit - openingDebit
        : openingDebit - openingCredit
    }

    // 취소 제외 + 프로젝트/기간 필터를 journals!inner 조인으로 한 번에 밀어넣는다.
    // (예전엔 전체 journals를 먼저 긁어 id 목록을 만들고 그 수천 개를 .in()에
    // 넣어 재조회했는데, 이게 느리고 요청도 비대해지는 원인이었다.)
    let lq = (supabase as any)
      .from('journal_lines')
      .select('id, date, debit, credit, note, counterparty_name, journal_id, journals!inner(journal_no, description, is_cancelled, project_id)')
      .eq('account_id', params.account_id)
      .eq('journals.is_cancelled', false)
      .order('date').order('journal_id')
    if (params.cp_id)      lq = lq.eq('counterparty_id', params.cp_id)
    if (params.project_id) lq = lq.eq('journals.project_id', params.project_id)
    if (params.from)       lq = lq.gte('date', params.from)
    if (params.to)         lq = lq.lte('date', params.to)

    const { data: rawLines } = await lq as any

    // 누적잔액 계산 (이월잔액 적용 시 여기서부터 시작)
    let running = openingBalance
    for (const l of rawLines ?? []) {
      const j = l.journals
      if (!j) continue
      const debit  = Number(l.debit)
      const credit = Number(l.credit)
      // 정상 차변 계정(자산/비용): 차변+, 대변-
      // 정상 대변 계정(부채/자본/수익): 대변+, 차변-
      running += normalSide === 'credit'
        ? credit - debit
        : debit - credit
      totalDebit  += debit
      totalCredit += credit
      lines.push({
        id:               l.id,
        date:             l.date,
        journal_no:       j.journal_no,
        journal_id:       l.journal_id,
        description:      j.description,
        note:             l.note,
        counterparty_name: l.counterparty_name,
        debit,
        credit,
        balance:          running,
      })
    }
  }

  const finalBalance = lines.length > 0 ? lines[lines.length - 1].balance : openingBalance
  const displayLines = [...lines].reverse()

  const selectedAccountName = selectedAccount?.name ?? ''
  const selectedProjectCode = (projects ?? []).find((p: any) => p.id === params.project_id)?.code ?? ''
  const selectedCpName      = (counterparties ?? []).find((c: any) => c.id === params.cp_id)?.name ?? ''

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">계정원장</h2>
          {selectedAccountName && (
            <p className="text-sm text-gray-500 mt-0.5">
              {selectedAccountName}
              {selectedProjectCode && ` · ${selectedProjectCode}`}
              {selectedCpName && ` · ${selectedCpName}`}
              {params.from && ` · ${params.from}`}
              {params.to && ` ~ ${params.to}`}
            </p>
          )}
        </div>
      </div>

      <LedgerFilter
        accounts={accounts ?? []}
        projects={projects ?? []}
        counterparties={counterparties ?? []}
      />

      {!params.account_id && (
        <div className="text-sm text-gray-400 py-12 text-center border rounded-lg">
          계정과목을 선택하고 조회 버튼을 누르세요.
        </div>
      )}

      {params.account_id && lines.length === 0 && !applyCarry && (
        <div className="text-sm text-gray-400 py-12 text-center border rounded-lg">
          조건에 맞는 전표가 없습니다.
        </div>
      )}

      {(lines.length > 0 || applyCarry) && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="text-left px-3 py-3 w-28">날짜</th>
                <th className="text-left px-3 py-3 w-16">전표</th>
                <th className="text-left px-3 py-3">적요</th>
                <th className="text-left px-3 py-3 w-32">거래처</th>
                <th className="text-right px-3 py-3 w-32">차변</th>
                <th className="text-right px-3 py-3 w-32">대변</th>
                <th className="text-right px-3 py-3 w-36 font-semibold">잔액</th>
              </tr>
              <tr className="bg-gray-50 border-t border-b-2 border-gray-300 font-semibold text-sm">
                <td colSpan={4} className="px-3 py-2 text-gray-500">합계 ({lines.length}건)</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(totalDebit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(totalCredit)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${finalBalance < 0 ? 'text-red-600' : ''}`}>
                  {fmt(Math.abs(finalBalance))}
                  {finalBalance < 0 ? ' (대)' : finalBalance > 0 ? ' (차)' : ''}
                </td>
              </tr>
            </thead>
            <tbody className="divide-y">
              {displayLines.map(l => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 tabular-nums text-gray-600">{l.date}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/journals/${l.journal_id}`}
                      className="text-blue-600 hover:underline tabular-nums">
                      #{l.journal_no}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 max-w-[220px]">
                    <div className="truncate">{l.description ?? ''}</div>
                    {l.note && l.note !== l.description && (
                      <div className="text-xs text-gray-400 truncate">{l.note}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs">{l.counterparty_name ?? ''}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {l.debit > 0 ? fmt(l.debit) : ''}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {l.credit > 0 ? fmt(l.credit) : ''}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${l.balance < 0 ? 'text-red-600' : ''}`}>
                    {fmt(Math.abs(l.balance))}{l.balance < 0 ? ' (대)' : l.balance > 0 ? ' (차)' : ''}
                  </td>
                </tr>
              ))}
              {applyCarry && (
                <tr className="bg-gray-50 text-gray-500 italic">
                  <td className="px-3 py-2.5" colSpan={4}>이월잔액 ({params.from} 이전 누계)</td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5"></td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${openingBalance < 0 ? 'text-red-600' : ''}`}>
                    {fmt(Math.abs(openingBalance))}{openingBalance < 0 ? ' (대)' : openingBalance > 0 ? ' (차)' : ''}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
