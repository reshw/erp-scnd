import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/timetable/venue-fee
 *
 * timetable(나디아요가)이 매월 초 대관료(60%) 산정 결과를 보내면 미지급금 전표를 자동 발행한다.
 * 인증: Authorization: Bearer <TIMETABLE_ERP_WEBHOOK_SECRET> (Supabase 세션 아님 — proxy.ts에서 경로 제외됨)
 *
 * body:
 * {
 *   period: "2026-07",            // 필수, 대관료 산정 대상 매출월(YYYY-MM)
 *   journal_date?: "2026-07-31",  // 생략 시 period 말일
 *   gross_supply_amount?: number, // 참고용 원본 매출 공급가액 (전표에는 안 들어감)
 *   rent_supply_amount: number,   // 필수, 대관료 공급가액
 *   rent_vat_amount: number,      // 필수, 대관료 부가세
 *   rent_total_amount: number,    // 필수, supply+vat와 일치해야 함
 *   counterparty_name: string,    // 필수, 거래처명(자유텍스트)
 *   note?: string,
 * }
 *
 * period가 이미 접수된 경우 재전송해도 새 전표를 만들지 않고 기존 전표 정보를 그대로 반환한다(멱등).
 */
export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.TIMETABLE_ERP_WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: '잘못된 요청 본문입니다' }, { status: 400 })

  const {
    period,
    journal_date,
    rent_supply_amount,
    rent_vat_amount,
    rent_total_amount,
    counterparty_name,
    note,
  } = body

  if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
    return NextResponse.json({ error: 'period는 YYYY-MM 형식이어야 합니다' }, { status: 400 })
  }
  if (![rent_supply_amount, rent_vat_amount, rent_total_amount].every((n) => Number.isInteger(n) && n >= 0)) {
    return NextResponse.json({ error: 'rent_supply_amount / rent_vat_amount / rent_total_amount는 0 이상의 정수여야 합니다' }, { status: 400 })
  }
  if (rent_supply_amount + rent_vat_amount !== rent_total_amount) {
    return NextResponse.json({ error: `rent_total_amount(${rent_total_amount})가 supply+vat(${rent_supply_amount + rent_vat_amount})와 일치하지 않습니다` }, { status: 400 })
  }
  if (!counterparty_name?.trim()) {
    return NextResponse.json({ error: 'counterparty_name이 필요합니다' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // 이미 접수된 period면 기존 전표 정보 그대로 반환 (멱등)
  const { data: existing } = await (supabase as any)
    .from('venue_fee_postings')
    .select('journal_id, journals(journal_no)')
    .eq('period', period)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ ok: true, period, journal_id: existing.journal_id, journal_no: existing.journals?.journal_no, duplicate: true })
  }

  const [y, m] = period.split('-').map(Number)
  const date = journal_date || new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

  const [{ data: accounts }, { data: project }] = await Promise.all([
    (supabase as any)
      .from('accounts')
      .select('id, name')
      .in('name', ['지급임차료', '부가세대급금', '미지급금(영업)']),
    (supabase as any)
      .from('projects')
      .select('id')
      .eq('code', 'NADIA')
      .single(),
  ])

  const accId = (name: string) => (accounts ?? []).find((a: any) => a.name === name)?.id
  const rentAccId = accId('지급임차료')
  const vatAccId = accId('부가세대급금')
  const apAccId = accId('미지급금(영업)')
  if (!rentAccId || !vatAccId || !apAccId) {
    return NextResponse.json({ error: '필요한 계정과목(지급임차료/부가세대급금/미지급금(영업))을 찾을 수 없습니다' }, { status: 500 })
  }

  const description = note?.trim() || `${period} 대관료`
  const lines = [
    { account_id: rentAccId, debit: rent_supply_amount, credit: 0, activity_type: '영업', activity_subtype: '매입', classification: '영업 - 매입', counterparty_name, note: description, date },
    { account_id: vatAccId, debit: rent_vat_amount, credit: 0, activity_type: '세무', activity_subtype: '대급', classification: '세무 - 대급', counterparty_name, note: description, date },
    { account_id: apAccId, debit: 0, credit: rent_total_amount, activity_type: '영업', activity_subtype: '매입', classification: '영업 - 매입', counterparty_name, note: description, date },
  ]

  let journal: { id: string; journal_no: number } | null = null
  for (let attempt = 0; attempt < 5 && !journal; attempt++) {
    const { data: lastJ } = await (supabase as any)
      .from('journals').select('journal_no').order('journal_no', { ascending: false }).limit(1).single()
    const nextNo = (lastJ?.journal_no ?? 0) + 1

    const { data: created, error: je } = await (supabase as any)
      .from('journals')
      .insert({ journal_no: nextNo, date, project_id: project?.id ?? null, description })
      .select('id, journal_no')
      .single()

    if (!je) { journal = created; break }
    if (je.code !== '23505') return NextResponse.json({ error: je.message }, { status: 500 })
  }
  if (!journal) return NextResponse.json({ error: '전표번호 채번에 반복 실패했습니다' }, { status: 500 })

  const { error: le } = await (supabase as any)
    .from('journal_lines')
    .insert(lines.map((l) => ({ ...l, journal_id: journal!.id })))
  if (le) {
    await supabase.from('journals').delete().eq('id', journal.id)
    return NextResponse.json({ error: le.message }, { status: 500 })
  }

  const { error: pe } = await (supabase as any)
    .from('venue_fee_postings')
    .insert({ period, journal_id: journal.id, payload: body })
  if (pe) {
    // 동시요청 경합으로 이미 다른 요청이 같은 period를 접수한 경우 — 방금 만든 전표는 버리고 기존 걸 반환
    await supabase.from('journals').delete().eq('id', journal.id)
    const { data: winner } = await (supabase as any)
      .from('venue_fee_postings')
      .select('journal_id, journals(journal_no)')
      .eq('period', period)
      .maybeSingle()
    return NextResponse.json({ ok: true, period, journal_id: winner?.journal_id, journal_no: winner?.journals?.journal_no, duplicate: true })
  }

  return NextResponse.json({ ok: true, period, journal_id: journal.id, journal_no: journal.journal_no })
}
