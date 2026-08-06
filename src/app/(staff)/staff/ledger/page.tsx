import { createAdminClient } from '@/lib/supabase/admin'
import { getScope } from '@/lib/auth/scope'
import Link from 'next/link'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

// /staff의 매출/비용 집계와 동일한 제외 기준 (src/app/(staff)/staff/page.tsx 참조)
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

export default async function StaffLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; month?: string }>
}) {
  const scope = await getScope()
  if (scope.role !== 'employee') return null
  const projectId = scope.allowedProjectId
  const supabase = createAdminClient()

  const { type: rawType, month: requestedMonth } = await searchParams
  const type = rawType === 'expense' ? 'expense' : 'revenue'
  const vatAccountName = type === 'revenue' ? '부가세예수금' : '부가세대급금'
  // 부가세예수금(부채, 대변증가) / 부가세대급금(자산, 차변증가) — 둘 다 "증가액"이
  // 양수가 되도록 부호를 계정 정상측에 맞춘다 (src/app/(staff)/staff/page.tsx와 동일 로직).
  const vatSide: 'debit' | 'credit' = type === 'revenue' ? 'credit' : 'debit'

  const currentMonthKey = new Date().toISOString().slice(0, 7)
  const monthKey = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) && requestedMonth <= currentMonthKey
    ? requestedMonth
    : currentMonthKey
  const isCurrentMonth = monthKey === currentMonthKey
  const prevMonth = shiftMonth(monthKey, -1)
  const nextMonth = shiftMonth(monthKey, 1)
  const monthStart = `${monthKey}-01`
  const monthLastDate = monthEnd(monthKey)

  const { data: linesData } = await (supabase as any)
    .from('journal_lines')
    .select(`
      id, journal_id, date, activity_subtype, debit, credit, counterparty_name, note,
      accounts ( name ),
      journals!inner ( journal_no, description, is_cancelled, project_id )
    `)
    .eq('activity_type', '영업')
    .eq('journals.project_id', projectId)
    .eq('journals.is_cancelled', false)
    .gte('date', monthStart)
    .lte('date', monthLastDate)
    .order('date', { ascending: false })

  // 전표(journal) 단위로 묶는다 — 부가세는 같은 전표의 별도 라인(부가세예수금/부가세대급금)이라
  // 라인 하나가 아니라 전표 하나가 "거래 한 건"의 단위다.
  type Row = { journalId: string; date: string; journalNo: number; account: string; label: string; net: number }
  const rowsByJournal = new Map<string, Row>()
  for (const l of (linesData ?? []) as any[]) {
    if (PL_EXCLUDE_SUBTYPES.has(l.activity_subtype)) continue
    const isCancel = l.activity_subtype === '매출취소'
    let amount: number | null = null
    if (type === 'revenue') {
      if (isCancel) amount = -Number(l.debit)
      else if (Number(l.credit) > 0) amount = Number(l.credit)
    } else {
      if (!isCancel && Number(l.debit) > 0) amount = Number(l.debit)
    }
    if (amount === null) continue

    const label = l.counterparty_name || l.note || l.journals?.description || '-'
    const account = l.accounts?.name ?? '-'
    const existing = rowsByJournal.get(l.journal_id)
    if (existing) {
      existing.net += amount
      if (!existing.account.includes(account)) existing.account += `, ${account}`
    } else {
      rowsByJournal.set(l.journal_id, { journalId: l.journal_id, date: l.date, journalNo: l.journals.journal_no, account, label, net: amount })
    }
  }

  const journalIds = [...rowsByJournal.keys()]
  const vatByJournal = new Map<string, number>()
  if (journalIds.length > 0) {
    const { data: vatLines } = await (supabase as any)
      .from('journal_lines')
      .select('journal_id, debit, credit, accounts!inner(name)')
      .eq('accounts.name', vatAccountName)
      .in('journal_id', journalIds)
    for (const l of (vatLines ?? []) as any[]) {
      const amt = vatSide === 'credit' ? l.credit - l.debit : l.debit - l.credit
      vatByJournal.set(l.journal_id, (vatByJournal.get(l.journal_id) ?? 0) + amt)
    }
  }

  // timetable 결제매칭 워시(wash) 쌍 제외 — timetable은 결제 승인 시 상품이 아직 안
  // 정해졌으면 일단 무상품("결제")으로 먼저 올렸다가, 나중에 수강권이 매칭되면 올바른
  // 상품명으로 새 결제를 다시 올리고 원래 무상품 결제는 취소로 반대행을 낸다(sync/route.ts
  // 주석 참고, 원장이 append-only라 수정 대신 반대행 방식). 그래서 실제로는 거래 1건인데
  // 전표가 "결제/[취소] 결제/정기 OO" 3장으로 쪼개져 보인다. `timetable_payment_postings`의
  // payload.reverses_external_id가 취소 건이 정확히 어떤 원 결제를 취소하는지 알려주므로,
  // 그 짝(원 결제+취소)만 리스트에서 숨긴다 — 순액엔 이미 0으로 반영돼 있어 합계는 안 바뀌고,
  // 매칭된 진짜 매출("정기 OO")과 원인 없는 단독 취소(진짜 환불)는 그대로 보인다.
  const washJournalIds = new Set<string>()
  if (journalIds.length > 0) {
    const { data: postings } = await (supabase as any)
      .from('timetable_payment_postings')
      .select('external_id, journal_id, payload')
      .in('journal_id', journalIds)
    const journalIdByExternalId = new Map<string, string>((postings ?? []).map((p: any) => [p.external_id, p.journal_id]))
    for (const p of (postings ?? []) as any[]) {
      const reversesId = p.payload?.reverses_external_id
      if (!reversesId) continue
      const originalJournalId = journalIdByExternalId.get(reversesId)
      if (originalJournalId && rowsByJournal.has(originalJournalId)) {
        washJournalIds.add(p.journal_id)
        washJournalIds.add(originalJournalId)
      }
    }
  }

  const rows = [...rowsByJournal.values()]
    .filter(r => !washJournalIds.has(r.journalId))
    .map(r => {
      const vat = vatByJournal.get(r.journalId) ?? 0
      return { ...r, vat, gross: r.net + vat }
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const totalNet = rows.reduce((sum, r) => sum + r.net, 0)
  const totalVat = rows.reduce((sum, r) => sum + r.vat, 0)
  const totalGross = totalNet + totalVat
  const title = type === 'revenue' ? '매출' : '비용'

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/staff?month=${monthKey}`} className="text-sm text-gray-500 hover:text-black">← 잔액/손익으로</Link>
        <h2 className="text-xl font-bold mt-1">{monthKey} {title} 내역</h2>
        <div className="flex items-center gap-1.5 mt-1">
          <Link
            href={`/staff/ledger?type=${type}&month=${prevMonth}`}
            className="px-2 py-0.5 rounded border text-sm text-gray-600 hover:bg-gray-50"
          >◀</Link>
          <span className="text-sm text-gray-700 font-medium tabular-nums w-16 text-center">{monthKey}</span>
          {isCurrentMonth ? (
            <span className="px-2 py-0.5 text-sm text-gray-300">▶</span>
          ) : (
            <Link
              href={`/staff/ledger?type=${type}&month=${nextMonth}`}
              className="px-2 py-0.5 rounded border text-sm text-gray-600 hover:bg-gray-50"
            >▶</Link>
          )}
        </div>
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <div className="text-xs text-gray-500 mb-1">{monthKey} {title} 합계 (부가세 포함)</div>
        <div className="text-xl font-bold tabular-nums">{fmt(totalGross)}</div>
        <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
          (공급가액 {fmt(totalNet)} / 부가세 {fmt(totalVat)})
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">날짜</th>
              <th className="text-left px-3 py-2">계정</th>
              <th className="text-left px-3 py-2">내역</th>
              <th className="text-right px-3 py-2">공급가액</th>
              <th className="text-right px-3 py-2">부가세</th>
              <th className="text-right px-3 py-2">합계</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(r => (
              <tr key={r.journalId}>
                <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.date}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.account}</td>
                <td className="px-3 py-2">{r.label}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.net < 0 ? 'text-red-600' : ''}`}>{fmt(r.net)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.vat)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.gross < 0 ? 'text-red-600' : ''}`}>{fmt(r.gross)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">내역 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
