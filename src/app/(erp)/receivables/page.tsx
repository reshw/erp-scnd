import { createAdminClient } from '@/lib/supabase/admin'
import { receivableAccountName, RECEIVABLE_ACCOUNT_NAMES } from '@/lib/timetablePayments'
import Link from 'next/link'
import SettleButton from './SettleButton'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

type Posting = {
  external_id: string
  journal_id: string | null
  settlement_journal_id: string | null
  payload: {
    source: string
    method: string | null
    amount: number
    status: string
    product_name: string | null
    paid_at: string | null
    reverses_external_id: string | null
  }
  journals: { journal_no: number } | null // journal_id 쪽 FK로 조인
}

export default async function ReceivablesPage() {
  const supabase = createAdminClient()
  const db = supabase as any

  const { data: postings } = await db
    .from('timetable_payment_postings')
    .select('external_id, journal_id, settlement_journal_id, payload, journals!timetable_payment_postings_journal_id_fkey(journal_no)')
    .not('journal_id', 'is', null)
    .order('created_at') as { data: Posting[] | null }

  const all = postings ?? []

  // 취소(반대행)된 원거래는 화면에서 아예 제외한다 — "취소전표가 안 보이게" 요청.
  const reversedIds = new Set(
    all.filter(p => p.payload.reverses_external_id).map(p => p.payload.reverses_external_id!)
  )

  const candidates = all.filter(p =>
    p.payload.amount > 0 &&
    !p.payload.reverses_external_id &&
    !reversedIds.has(p.external_id)
  )

  const open    = candidates.filter(p => !p.settlement_journal_id)
  const settled = candidates.filter(p => p.settlement_journal_id)

  function accountOf(p: Posting) {
    return receivableAccountName(p.payload.source, p.payload.method) ?? '기타'
  }

  const openByAccount = new Map<string, Posting[]>()
  for (const name of RECEIVABLE_ACCOUNT_NAMES) openByAccount.set(name, [])
  for (const p of open) {
    const acc = accountOf(p)
    if (!openByAccount.has(acc)) openByAccount.set(acc, [])
    openByAccount.get(acc)!.push(p)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">정산 대사</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          미수금·현금으로 찍힌 것과 실제 입금을 건별로 매칭합니다 (취소된 거래는 표시하지 않음)
        </p>
      </div>

      {[...openByAccount.entries()].map(([accName, rows]) => (
        <div key={accName} className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">{accName}</span>
            <span className="text-xs text-gray-400">
              미정산 {rows.length}건 · {fmt(rows.reduce((s, r) => s + r.payload.amount, 0))}원
            </span>
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">미정산 항목 없음</div>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {rows.map(p => (
                  <tr key={p.external_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap w-24">
                      {p.payload.paid_at?.slice(0, 10) ?? '-'}
                    </td>
                    <td className="px-4 py-2.5">
                      {p.payload.product_name ?? '-'}
                      <span className="text-xs text-gray-400 ml-1">
                        ({p.payload.source}{p.payload.method ? `/${p.payload.method}` : ''})
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums w-28">
                      {fmt(p.payload.amount)}
                    </td>
                    <td className="px-4 py-2.5 w-12 text-right">
                      {p.journals && (
                        <Link href={`/journals/${p.journal_id}`} className="text-xs text-blue-500 hover:underline">
                          #{p.journals.journal_no}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2.5 w-64">
                      <SettleButton externalId={p.external_id} amount={p.payload.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {settled.length > 0 && (
        <details className="border rounded-lg">
          <summary className="bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-500 cursor-pointer">
            정산완료 ({settled.length}건)
          </summary>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {settled.map(p => (
                <tr key={p.external_id} className="opacity-60">
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap w-24">
                    {p.payload.paid_at?.slice(0, 10) ?? '-'}
                  </td>
                  <td className="px-4 py-2">
                    {p.payload.product_name ?? '-'}
                    <span className="text-xs text-gray-400 ml-1">({accountOf(p)})</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums w-28">{fmt(p.payload.amount)}</td>
                  <td className="px-4 py-2 w-12"></td>
                  <td className="px-4 py-2 w-64 text-xs text-green-600 text-right">정산완료</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
