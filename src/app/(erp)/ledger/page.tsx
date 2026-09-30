import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import LedgerFilter from './LedgerFilter'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

// running은 이미 normalSide 부호를 반영해서 계산되므로(정상 대변 계정은 대변-차변),
// 양수=정상측(대변 계정이면 대변) 잔액이다. 라벨은 이 부호를 실제 차/대 방향으로 되돌려 표시한다.
function balanceLabel(balance: number, normalSide: 'debit' | 'credit') {
  if (balance === 0) return ''
  const isDebitSide = normalSide === 'credit' ? balance < 0 : balance > 0
  return isDebitSide ? ' (차)' : ' (대)'
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    account_id?: string
    entity_id?: string
    project_ids?: string
    cp_id?: string
    from?: string
    to?: string
    carry?: string
  }>
}) {
  const params = await searchParams
  const supabase = createAdminClient()

  const [{ data: accounts }, { data: projects }, { data: counterparties }, { data: entities }] = await Promise.all([
    (supabase as any).from('accounts').select('id,name,normal_side').eq('is_active', true).order('name') as any,
    (supabase as any).from('projects').select('id,code,entity_id').eq('is_active', true).order('code') as any,
    (supabase as any).from('counterparties').select('id,name').order('name') as any,
    (supabase as any).from('entities').select('id,name').order('name') as any,
  ])

  const selectedAccount = (accounts ?? []).find((a: any) => a.id === params.account_id)

  // 프로젝트 체크박스로 직접 고른 게 있으면 그걸 쓰고, 없이 사업자만 골랐으면
  // 그 사업자 소속 프로젝트 전체로 넓혀서 필터한다.
  const explicitProjectIds = (params.project_ids ?? '').split(',').filter(Boolean)
  const projectIds = explicitProjectIds.length > 0
    ? explicitProjectIds
    : params.entity_id
      ? (projects ?? []).filter((p: any) => p.entity_id === params.entity_id).map((p: any) => p.id)
      : []
  // 사업자를 골랐는데 그 사업자 소속 프로젝트가 하나도 없으면(신규 사업자 등)
  // 필터를 안 거는 게 아니라 "일치하는 데이터 없음"으로 처리해야 한다.
  const noMatchingProjects = !!params.entity_id && explicitProjectIds.length === 0 && projectIds.length === 0

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
  const normalSide: 'debit' | 'credit' = selectedAccount?.normal_side ?? 'debit'

  if (params.account_id && !noMatchingProjects) {

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
      if (params.cp_id) oq = oq.eq('counterparty_id', params.cp_id)
      if (projectIds.length === 1) oq = oq.eq('journals.project_id', projectIds[0])
      else if (projectIds.length > 1) oq = oq.in('journals.project_id', projectIds)

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
    if (params.cp_id) lq = lq.eq('counterparty_id', params.cp_id)
    if (projectIds.length === 1) lq = lq.eq('journals.project_id', projectIds[0])
    else if (projectIds.length > 1) lq = lq.in('journals.project_id', projectIds)
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
  const selectedEntityName = (entities ?? []).find((e: any) => e.id === params.entity_id)?.name ?? ''
  const selectedProjectLabel = explicitProjectIds.length === 0 ? ''
    : explicitProjectIds.length === 1
      ? ((projects ?? []).find((p: any) => p.id === explicitProjectIds[0])?.code ?? '')
      : `프로젝트 ${explicitProjectIds.length}개`
  const selectedCpName      = (counterparties ?? []).find((c: any) => c.id === params.cp_id)?.name ?? ''

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">계정원장</h2>
          {selectedAccountName && (
            <p className="text-sm text-gray-500 mt-0.5">
              {selectedAccountName}
              {selectedEntityName && ` · ${selectedEntityName}`}
              {selectedProjectLabel && ` · ${selectedProjectLabel}`}
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
        entities={entities ?? []}
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
                  {balanceLabel(finalBalance, normalSide)}
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
                    {fmt(Math.abs(l.balance))}{balanceLabel(l.balance, normalSide)}
                  </td>
                </tr>
              ))}
              {applyCarry && (
                <tr className="bg-gray-50 text-gray-500 italic">
                  <td className="px-3 py-2.5" colSpan={4}>이월잔액 ({params.from} 이전 누계)</td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5"></td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${openingBalance < 0 ? 'text-red-600' : ''}`}>
                    {fmt(Math.abs(openingBalance))}{balanceLabel(openingBalance, normalSide)}
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
