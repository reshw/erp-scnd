import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('entities')
    .select('id, name, type, business_no, opened_at, biz_type, biz_item')
    .order('name') as any
  if (error) return NextResponse.json({ message: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()
  const { data, error } = await (supabase as any)
    .from('entities')
    .insert({
      name:        body.name,
      type:        body.type || 'corporate',
      business_no: body.business_no || null,
      opened_at:   body.opened_at || null,
      biz_type:    body.biz_type || null,
      biz_item:    body.biz_item || null,
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
    .from('entities')
    .update({
      name:        body.name,
      type:        body.type || 'corporate',
      business_no: body.business_no || null,
      opened_at:   body.opened_at || null,
      biz_type:    body.biz_type || null,
      biz_item:    body.biz_item || null,
    })
    .eq('id', body.id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const { id } = await req.json()
  const { error } = await (supabase as any).from('entities').delete().eq('id', id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
