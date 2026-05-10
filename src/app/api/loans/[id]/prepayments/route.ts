import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('loan_prepayments')
    .select('*')
    .eq('loan_id', id)
    .order('date') as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await req.json()
  const { data, error } = await (supabase as any)
    .from('loan_prepayments')
    .insert({ loan_id: id, date: body.date, amount: body.amount, note: body.note ?? null })
    .select()
    .single() as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { prepaymentId } = await req.json()
  const { error } = await (supabase as any)
    .from('loan_prepayments')
    .delete()
    .eq('id', prepaymentId)
    .eq('loan_id', id) as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
