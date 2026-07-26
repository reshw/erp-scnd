import { createAdminClient } from '@/lib/supabase/admin'
import { ACCOUNT_META_COLUMNS, insertJournalWithLines, type AccountMeta } from '@/lib/journal'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/clearings/settle
 *
 * /clearings에서 특정 거래처의 미결잔액을 상계 처리한다(실제 지급/입금 확인).
 * body: { account_id, counterparty_id?, counterparty_name?, amount, date, note? }
 */
export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const db = supabase as any
  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: '잘못된 요청 본문입니다' }, { status: 400 })

  const { account_id, counterparty_id, counterparty_name, amount, date, note } = body

  if (!account_id) return NextResponse.json({ error: 'account_id가 필요합니다' }, { status: 400 })
  if (!Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount는 0보다 큰 정수여야 합니다' }, { status: 400 })
  }
  if (!date) return NextResponse.json({ error: 'date가 필요합니다' }, { status: 400 })
  if (!counterparty_id && !counterparty_name?.trim()) {
    return NextResponse.json({ error: '거래처(counterparty_id 또는 counterparty_name)가 필요합니다' }, { status: 400 })
  }

  const [{ data: account }, { data: bankAcc }] = await Promise.all([
    db.from('accounts').select(ACCOUNT_META_COLUMNS).eq('id', account_id).single(),
    db.from('accounts').select(ACCOUNT_META_COLUMNS).eq('name', '보통예금').single(),
  ])
  if (!account) return NextResponse.json({ error: '계정과목을 찾을 수 없습니다' }, { status: 404 })
  if (!bankAcc) return NextResponse.json({ error: '보통예금 계정을 찾을 수 없습니다' }, { status: 500 })

  // 현재 미결잔액 재계산 — /clearings와 동일한 규칙(정상측=발생, 반대측=반제)으로
  // 과잉 반제를 막는다.
  let lq = db.from('journals').select('id').eq('is_cancelled', false)
  const { data: journals } = await lq
  const journalIds = (journals ?? []).map((j: any) => j.id)

  let lineQuery = db.from('journal_lines').select('debit, credit').eq('account_id', account_id).in('journal_id', journalIds)
  lineQuery = counterparty_id ? lineQuery.eq('counterparty_id', counterparty_id) : lineQuery.is('counterparty_id', null).eq('counterparty_name', counterparty_name)
  const { data: lines } = await lineQuery

  const normalDebit = (account as AccountMeta).normal_side === 'debit'
  let balance = 0
  for (const l of lines ?? []) {
    const debit = Number(l.debit)
    const credit = Number(l.credit)
    balance += normalDebit ? debit - credit : credit - debit
  }

  if (amount > Math.abs(balance)) {
    return NextResponse.json(
      { error: `반제 금액(${amount.toLocaleString()})이 미결잔액(${Math.abs(balance).toLocaleString()})을 초과합니다` },
      { status: 400 }
    )
  }

  // 정상측=발생, 반대측=반제. 상대편(보통예금)은 그 반대.
  const settleSide: 'debit' | 'credit' = normalDebit ? 'credit' : 'debit'
  const cashSide: 'debit' | 'credit' = settleSide === 'debit' ? 'credit' : 'debit'

  const description = note?.trim() || `${counterparty_name ?? ''} 반제`.trim()

  try {
    const journal = await insertJournalWithLines(supabase, {
      date,
      description,
      lines: [
        {
          account: account as AccountMeta,
          side: settleSide,
          amount,
          counterparty_id: counterparty_id ?? null,
          counterparty_name: counterparty_name ?? null,
          note: description,
        },
        {
          account: bankAcc as AccountMeta,
          side: cashSide,
          amount,
          note: description,
        },
      ],
    })
    return NextResponse.json({ ok: true, journal_id: journal.id, journal_no: journal.journal_no })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
