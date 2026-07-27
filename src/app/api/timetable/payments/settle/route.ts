import { createAdminClient } from '@/lib/supabase/admin'
import { ACCOUNT_META_COLUMNS, insertJournalWithLines, type AccountMeta } from '@/lib/journal'
import { RECEIVABLE_ACCOUNT_NAMES } from '@/lib/timetablePayments'
import { NextRequest, NextResponse } from 'next/server'

// nadia/timetable 카드·현금 정산금이 실제로 들어오는 계좌. 계좌가 늘면 파라미터화한다.
const SETTLEMENT_BANK_ACCOUNT_NAME = '통장-기업-레저'

/**
 * POST /api/timetable/payments/settle
 *
 * /receivables 화면에서 미수금·현금 항목 하나를 실제 입금액과 매칭해 정산 전표를 낸다.
 * body: { external_id, deposit_amount, date }
 *
 * 전표: 차변 보통예금(입금액, 거래처=SETTLEMENT_BANK_ACCOUNT_NAME)
 *       + 차변 판관비(지급수수료)(총액-입금액, 0이면 생략)
 *       / 대변 [원 posting이 잡았던 계정](총액)
 */
export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const db = supabase as any
  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: '잘못된 요청 본문입니다' }, { status: 400 })

  const { external_id, deposit_amount, date } = body
  if (!external_id) return NextResponse.json({ error: 'external_id가 필요합니다' }, { status: 400 })
  if (!Number.isInteger(deposit_amount) || deposit_amount <= 0) {
    return NextResponse.json({ error: 'deposit_amount는 0보다 큰 정수여야 합니다' }, { status: 400 })
  }
  if (!date) return NextResponse.json({ error: 'date가 필요합니다' }, { status: 400 })

  const { data: posting } = await db
    .from('timetable_payment_postings')
    .select('external_id, journal_id, settlement_journal_id, payload, journals!timetable_payment_postings_journal_id_fkey(journal_no)')
    .eq('external_id', external_id)
    .single()

  if (!posting) return NextResponse.json({ error: 'posting을 찾을 수 없습니다' }, { status: 404 })
  if (!posting.journal_id) return NextResponse.json({ error: '아직 전표가 발행되지 않은 항목입니다' }, { status: 400 })
  if (posting.settlement_journal_id) return NextResponse.json({ error: '이미 정산 처리된 항목입니다' }, { status: 400 })

  // 원 전표에서 어느 계정(미수금 계열 또는 현금)으로 잡혔는지 조회
  const { data: origLines } = await db
    .from('journal_lines')
    .select('debit, accounts(id, name, activity_type, normal_side, increase_type, increase_label, decrease_type, decrease_label)')
    .eq('journal_id', posting.journal_id)
    .gt('debit', 0)

  const receivableLine = (origLines ?? []).find((l: any) => RECEIVABLE_ACCOUNT_NAMES.includes(l.accounts?.name))
  if (!receivableLine) return NextResponse.json({ error: '원 전표에서 미수금/현금 라인을 찾지 못했습니다' }, { status: 500 })

  const receivableAcc = receivableLine.accounts as AccountMeta
  const gross = Number(receivableLine.debit)
  const fee = gross - deposit_amount
  if (fee < 0) {
    return NextResponse.json(
      { error: `입금액(${deposit_amount.toLocaleString()})이 총액(${gross.toLocaleString()})보다 큽니다` },
      { status: 400 }
    )
  }

  const { data: bankAcc } = await db.from('accounts').select(ACCOUNT_META_COLUMNS).eq('name', '보통예금').single()
  const { data: feeAcc } = await db.from('accounts').select(ACCOUNT_META_COLUMNS).eq('name', '판관비(지급수수료)').single()
  if (!bankAcc) return NextResponse.json({ error: '보통예금 계정을 찾을 수 없습니다' }, { status: 500 })
  if (fee > 0 && !feeAcc) return NextResponse.json({ error: '판관비(지급수수료) 계정을 찾을 수 없습니다' }, { status: 500 })

  const label = posting.payload?.product_name?.trim() || receivableAcc.name
  const origNo = posting.journals?.journal_no
  const description = `${label} 정산 입금 (${receivableAcc.name}${origNo ? `, 전표 #${origNo}` : ''})`

  const lines = [
    { account: bankAcc as AccountMeta, side: 'debit' as const, amount: deposit_amount, counterparty_name: SETTLEMENT_BANK_ACCOUNT_NAME },
    ...(fee > 0 ? [{ account: feeAcc as AccountMeta, side: 'debit' as const, amount: fee, note: '카드 가맹점수수료 (면세)' }] : []),
    { account: receivableAcc, side: 'credit' as const, amount: gross },
  ]

  try {
    const journal = await insertJournalWithLines(supabase, { date, description, lines })

    const { error: ue } = await db
      .from('timetable_payment_postings')
      .update({ settlement_journal_id: journal.id })
      .eq('external_id', external_id)
    if (ue) throw new Error(ue.message)

    return NextResponse.json({ ok: true, journal_id: journal.id, journal_no: journal.journal_no, fee })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
