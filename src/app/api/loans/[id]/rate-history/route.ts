import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('loan_rate_history')
    .select('id, effective_date, annual_rate, note')
    .eq('loan_id', id)
    .order('effective_date') as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await req.json()
  if (!body.effective_date || body.annual_rate == null) {
    return NextResponse.json({ error: 'effective_date, annual_rate 필수' }, { status: 400 })
  }
  const { data, error } = await (supabase as any)
    .from('loan_rate_history')
    .insert({
      loan_id:        id,
      effective_date: body.effective_date,
      annual_rate:    body.annual_rate,
      note:           body.note || null,
    })
    .select()
    .single() as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { rateId } = await req.json()
  const { error } = await (supabase as any)
    .from('loan_rate_history')
    .delete()
    .eq('id', rateId)
    .eq('loan_id', id) as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
