import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/bank-display-order/move
 * body: { name: string, direction: 'up' | 'down' }
 *
 * 대시보드 "통장별 잔고" 표시 순서를 바로 옆 항목과 sort_order를 맞바꿔 이동한다.
 */
export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const db = supabase as any
  const { name, direction } = await req.json() as { name: string; direction: 'up' | 'down' }

  if (!name || (direction !== 'up' && direction !== 'down')) {
    return NextResponse.json({ error: 'name과 direction(up/down)이 필요합니다' }, { status: 400 })
  }

  const { data: current, error: ce } = await db
    .from('bank_display_order').select('name, sort_order').eq('name', name).single()
  if (ce || !current) return NextResponse.json({ error: '등록되지 않은 통장입니다' }, { status: 404 })

  const { data: neighbor, error: ne } = direction === 'up'
    ? await db.from('bank_display_order').select('name, sort_order')
        .lt('sort_order', current.sort_order).order('sort_order', { ascending: false }).limit(1).maybeSingle()
    : await db.from('bank_display_order').select('name, sort_order')
        .gt('sort_order', current.sort_order).order('sort_order', { ascending: true }).limit(1).maybeSingle()

  if (ne) return NextResponse.json({ error: ne.message }, { status: 500 })
  if (!neighbor) return NextResponse.json({ ok: true })

  const { error: e1 } = await db.from('bank_display_order').update({ sort_order: neighbor.sort_order }).eq('name', current.name)
  const { error: e2 } = await db.from('bank_display_order').update({ sort_order: current.sort_order }).eq('name', neighbor.name)
  if (e1 || e2) return NextResponse.json({ error: (e1 ?? e2)!.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
