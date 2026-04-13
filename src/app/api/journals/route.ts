import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const { journal_no, date, project_id, description, lines } = await req.json()

  const { data: journal, error: je } = await (supabase as any)
    .from('journals')
    .insert({ journal_no, date, project_id, description })
    .select('id')
    .single()

  if (je) return NextResponse.json({ message: je.message }, { status: 400 })

  const linesPayload = lines.map((l: any) => ({ ...l, journal_id: journal.id }))
  const { error: le } = await supabase.from('journal_lines').insert(linesPayload)

  if (le) {
    await supabase.from('journals').delete().eq('id', journal.id)
    return NextResponse.json({ message: le.message }, { status: 400 })
  }

  return NextResponse.json({ id: journal.id })
}

export async function PUT(req: NextRequest) {
  const supabase = createAdminClient()
  const { journalId, date, project_id, description, lines } = await req.json()

  const { error: je } = await (supabase as any)
    .from('journals')
    .update({ date, project_id, description, updated_at: new Date().toISOString() })
    .eq('id', journalId)

  if (je) return NextResponse.json({ message: je.message }, { status: 400 })

  // 기존 명세 삭제 후 재삽입
  await supabase.from('journal_lines').delete().eq('journal_id', journalId)
  const linesPayload = lines.map((l: any) => ({ ...l, journal_id: journalId }))
  const { error: le } = await supabase.from('journal_lines').insert(linesPayload)

  if (le) return NextResponse.json({ message: le.message }, { status: 400 })

  return NextResponse.json({ id: journalId })
}

export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const { id } = await req.json()

  await supabase.from('journal_lines').delete().eq('journal_id', id)
  const { error } = await supabase.from('journals').delete().eq('id', id)

  if (error) return NextResponse.json({ message: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
