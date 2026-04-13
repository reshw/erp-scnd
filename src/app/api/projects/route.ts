import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('projects')
    .select('id, code, name, description, is_active')
    .order('code') as any
  if (error) return NextResponse.json({ message: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()
  const { data, error } = await (supabase as any)
    .from('projects')
    .insert({
      code:        body.code,
      name:        body.name,
      description: body.description || null,
      is_active:   true,
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
    .from('projects')
    .update({
      code:        body.code,
      name:        body.name,
      description: body.description || null,
    })
    .eq('id', body.id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const supabase = createAdminClient()
  const { id, is_active } = await req.json()
  const { error } = await (supabase as any).from('projects').update({ is_active }).eq('id', id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const { id } = await req.json()
  const { error } = await (supabase as any).from('projects').delete().eq('id', id)
  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
