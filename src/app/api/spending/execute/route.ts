import { createAdminClient } from '@/lib/supabase/admin'
import { executeSpendingExecutions } from '@/lib/spending/executeExecutions'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/spending/execute
 * body: { ids: string[] }  ← spending_executions.id 목록
 */
export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const { ids } = await req.json() as { ids: string[] }

  if (!ids?.length) return NextResponse.json({ error: '처리할 항목이 없습니다' }, { status: 400 })

  const result = await executeSpendingExecutions(supabase, ids)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
