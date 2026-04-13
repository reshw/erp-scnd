import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('counterparties')
    .select('id, name, representative, business_no, bank_name, bank_account_no, note')
    .order('name') as any
  if (error) return NextResponse.json({ message: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()
  const { data, error } = await (supabase as any)
    .from('counterparties')
    .insert({
      name:           body.name,
      representative: body.representative || null,
      business_no:    body.business_no || null,
      bank_name:      body.bank_name || null,
      bank_account_no: body.bank_account_no || null,
      note:           body.note || null,
    })
    .select('id')
    .single() as any
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()
  const { error } = await (supabase as any)
    .from('counterparties')
    .update({
      name:           body.name,
      representative: body.representative || null,
      business_no:    body.business_no || null,
      bank_name:      body.bank_name || null,
      bank_account_no: body.bank_account_no || null,
      note:           body.note || null,
    })
    .eq('id', body.id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const { id } = await req.json()
  const { error } = await (supabase as any).from('counterparties').delete().eq('id', id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
