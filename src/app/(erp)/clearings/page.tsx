import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import ClearingsFilter from './ClearingsFilter'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default async function ClearingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    account_id?: string
    from?: string
    to?: string
    open_only?: string
  }>
}) {
  const params = await searchParams
  const supabase = createAdminClient()

  const { data: accounts } = await (supabase as any)
    .from('accounts')
    .select('id,name,normal_side')
    .eq('is_active', true)
    .order('name') as any

  const selectedAccount = (accounts ?? []).find((a: any) => a.id === params.account_id)

  interface CpRow {
    cp_key: string
    cp_name: string
    cp_id: string | null
    src_count: number
    src_amount: number
    settle_count: number
    settle_amount: number
    balance: number
  }

  let rows: CpRow[] = []

  if (params.account_id) {
    let jq = (supabase as any).from('journals').select('id').eq('is_cancelled', false)
    if (params.from) jq = jq.gte('date', params.from)
    if (params.to)   jq = jq.lte('date', params.to)
    const { data: validJournals } = await jq as any
    const validIds = (validJournals ?? []).map((j: any) => j.id)

    if (validIds.length > 0) {
      const { data: lines } = await (supabase as any)
        .from('journal_lines')
        .select('debit, credit, counterparty_id, counterparty_name')
        .eq('account_id', params.account_id)
        .in('journal_id', validIds) as any

      const normalSide = selectedAccount?.normal_side ?? 'debit'
      const grouped = new Map<string, CpRow>()

      for (const l of lines ?? []) {
        const cpKey = l.counterparty_id ?? `name:${l.counterparty_name ?? ''}`
        const cpName = l.counterparty_name ?? '(거래처 없음)'

        if (!grouped.has(cpKey)) {
          grouped.set(cpKey, {
            cp_key: cpKey,
            cp_name: cpName,
            cp_id: l.counterparty_id ?? null,
            src_count: 0,
            src_amount: 0,
            settle_count: 0,
            settle_amount: 0,
            balance: 0,
          })
        }

        const row = grouped.get(cpKey)!
        const debit  = Number(l.debit)
        const credit = Number(l.credit)

        if (normalSide === 'credit') {
          // 부채/자본: credit=발생, debit=반제
          if (credit > 0) { row.src_count++;    row.src_amount    += credit }
          if (debit  > 0) { row.settle_count++;  row.settle_amount += debit  }
          row.balance += credit - debit
        } else {
          // 자산/비용: debit=발생, credit=반제
          if (debit  > 0) { row.src_count++;    row.src_amount    += debit  }
          if (credit > 0) { row.settle_count++;  row.settle_amount += credit }
          row.balance += debit - credit
        }
      }

      rows = [...grouped.values()].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    }
  }

  const openOnly     = params.open_only === '1'
  const displayRows  = openOnly ? rows.filter(r => Math.abs(r.balance) > 0) : rows
  const openCount    = rows.filter(r => Math.abs(r.balance) > 0).length
  const totalBalance = rows.reduce((s, r) => s + r.balance, 0)

  function ledgerUrl(r: CpRow) {
    const p = new URLSearchParams({ account_id: params.account_id! })
    if (r.cp_id) p.set('cp_id', r.cp_id)
    if (params.from) p.set('from', params.from)
    if (params.to)   p.set('to',   params.to)
    return `/ledger?${p.toString()}`
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">미결잔액</h2>
        {selectedAccount && (
          <p className="text-sm text-gray-500 mt-0.5">
            {selectedAccount.name} · 거래처별 잔액
          </p>
        )}
      </div>

      <ClearingsFilter accounts={accounts ?? []} />

      {!params.account_id && (
        <div className="text-sm text-gray-400 py-12 text-center border rounded-lg">
          계정과목을 선택하고 조회 버튼을 누르세요.
        </div>
      )}

      {params.account_id && rows.length === 0 && (
        <div className="text-sm text-gray-400 py-12 text-center border rounded-lg">
          조건에 맞는 전표가 없습니다.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="text-sm text-gray-500">
            전체 {rows.length}건 중 미결{' '}
            <strong className={openCount > 0 ? 'text-red-600' : 'text-gray-600'}>{openCount}건</strong>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="text-left px-3 py-3">거래처</th>
                  <th className="text-right px-3 py-3 w-20">발생건</th>
                  <th className="text-right px-3 py-3 w-32">발생액</th>
                  <th className="text-right px-3 py-3 w-20">반제건</th>
                  <th className="text-right px-3 py-3 w-32">반제액</th>
                  <th className="text-right px-3 py-3 w-36 font-semibold">미결잔액</th>
                  <th className="px-3 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {displayRows.map(r => {
                  const isOpen = Math.abs(r.balance) > 0
                  return (
                    <tr key={r.cp_key} className={`hover:bg-gray-50 ${!isOpen ? 'opacity-40' : ''}`}>
                      <td className="px-3 py-2.5 font-medium">{r.cp_name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{r.src_count}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.src_amount)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{r.settle_count}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.settle_amount)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${isOpen ? 'text-red-600' : 'text-gray-400'}`}>
                        {isOpen ? fmt(Math.abs(r.balance)) : '완결'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Link href={ledgerUrl(r)} className="text-xs text-blue-500 hover:underline">원장</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold text-sm">
                  <td className="px-3 py-2 text-gray-500">
                    합계 ({displayRows.length}건)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {displayRows.reduce((s, r) => s + r.src_count, 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(displayRows.reduce((s, r) => s + r.src_amount, 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {displayRows.reduce((s, r) => s + r.settle_count, 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(displayRows.reduce((s, r) => s + r.settle_amount, 0))}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${totalBalance < 0 ? 'text-red-600' : ''}`}>
                    {fmt(Math.abs(totalBalance))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
