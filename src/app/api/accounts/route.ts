import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('accounts')
    .select('id, name, activity_type, normal_side, increase_label, decrease_label, is_active')
    .order('activity_type')
    .order('name') as any
  if (error) return NextResponse.json({ message: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const supabase = createAdminClient()
  const { id, is_active } = await req.json()
  const { error } = await (supabase as any).from('accounts').update({ is_active }).eq('id', id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
