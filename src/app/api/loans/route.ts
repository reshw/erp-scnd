import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

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
      name:          body.name,
      principal:     body.principal,
      interest_rate: body.interest_rate,
      start_date:    body.start_date,
      end_date:      body.end_date,
      loan_type:     body.loan_type ?? '원리금균등',
      interest_calc: body.interest_calc ?? 'monthly',
      counterparty_id: body.counterparty_id || null,
      project_id:    body.project_id || null,
    })
    .select()
    .single() as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const { id } = await req.json()
  const { error } = await (supabase as any).from('loans').delete().eq('id', id) as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
