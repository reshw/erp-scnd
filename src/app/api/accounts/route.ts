import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('accounts')
    .select('id, name, activity_type, normal_side, increase_type, increase_label, decrease_type, decrease_label, note, is_active')
    .order('activity_type')
    .order('name') as any
  if (error) return NextResponse.json({ message: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()
  const { data, error } = await (supabase as any)
    .from('accounts')
    .insert({
      name:           body.name,
      activity_type:  body.activity_type,
      normal_side:    body.normal_side,
      increase_type:  body.increase_type,
      increase_label: body.increase_label,
      decrease_type:  body.decrease_type,
      decrease_label: body.decrease_label,
      note:           body.note || null,
      is_active:      true,
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
    .from('accounts')
    .update({
      name:           body.name,
      activity_type:  body.activity_type,
      normal_side:    body.normal_side,
      increase_type:  body.increase_type,
      increase_label: body.increase_label,
      decrease_type:  body.decrease_type,
      decrease_label: body.decrease_label,
      note:           body.note || null,
    })
    .eq('id', body.id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const supabase = createAdminClient()
  const { id, is_active } = await req.json()
  const { error } = await (supabase as any).from('accounts').update({ is_active }).eq('id', id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const { id } = await req.json()
  const { error } = await (supabase as any).from('accounts').delete().eq('id', id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
