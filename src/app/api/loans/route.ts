import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { syncLoanExecutions } from '@/lib/loans/syncExecutions'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('loans')
    .select('*, counterparties(name), projects(code)')
    .order('created_at', { ascending: false }) as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()
  const { data, error } = await (supabase as any)
    .from('loans')
    .insert({
      name:             body.name,
      principal:        body.principal ?? null,
      interest_rate:    body.interest_rate,
      start_date:       body.start_date,
      end_date:         body.end_date,
      loan_type:        body.loan_type ?? '원리금균등',
      interest_calc:    body.interest_calc ?? 'monthly',
      payment_day:      body.payment_day ?? null,
      pmt_floor:        body.pmt_floor ?? false,
      interest_round:   body.interest_round ?? 'round',
      counterparty_id:  body.counterparty_id || null,
      project_id:       body.project_id || null,
      overdraft_limit:  body.overdraft_limit ?? null,
      include_draw_day: body.include_draw_day ?? true,
      account_id:       body.account_id || null,
      bank_account_id:  body.bank_account_id || null,
      settlement_type:          body.settlement_type ?? 'date',
      settlement_day:           body.settlement_day ?? null,
      settlement_weekday:       body.settlement_weekday ?? null,
      settlement_week_of_month: body.settlement_week_of_month ?? null,
    })
    .select()
    .single() as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await syncLoanExecutions(supabase, data.id)
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()
  const { error } = await (supabase as any)
    .from('loans')
    .update({
      name:                body.name,
      principal:           body.principal ?? null,
      interest_rate:       body.interest_rate,
      start_date:          body.start_date,
      end_date:            body.end_date,
      loan_type:           body.loan_type ?? '원리금균등',
      interest_calc:       body.interest_calc ?? 'monthly',
      first_month_partial: body.first_month_partial ?? true,
      payment_day:         body.payment_day ?? null,
      pmt_floor:           body.pmt_floor ?? false,
      interest_round:      body.interest_round ?? 'round',
      counterparty_id:     body.counterparty_id || null,
      project_id:          body.project_id || null,
      overdraft_limit:     body.overdraft_limit ?? null,
      include_draw_day:    body.include_draw_day ?? true,
      account_id:          body.account_id || null,
      bank_account_id:     body.bank_account_id || null,
      settlement_type:          body.settlement_type ?? 'date',
      settlement_day:           body.settlement_day ?? null,
      settlement_weekday:       body.settlement_weekday ?? null,
      settlement_week_of_month: body.settlement_week_of_month ?? null,
    })
    .eq('id', body.id) as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await syncLoanExecutions(supabase, body.id)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const { id } = await req.json()
  const { error } = await (supabase as any).from('loans').delete().eq('id', id) as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
