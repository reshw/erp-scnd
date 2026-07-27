import { createAdminClient } from '@/lib/supabase/admin'
import { syncLoanExecutions } from '@/lib/loans/syncExecutions'
import { executeSpendingExecutions } from '@/lib/spending/executeExecutions'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/loans/auto-execute
 *
 * 마이너스통장(마통) 제외 전 대출의 "오늘" 정산일 도래분만 매일 기계적으로 선발행한다
 * (매칭·판단 없음 — docs/decisions.md "대출 자동선발행" 결정 참조).
 * 일 1회 GitHub Actions에서 호출한다(Vercel 크론은 신뢰할 수 없어 쓰지 않는다).
 * 인증: Authorization: Bearer <CRON_SECRET> (proxy.ts에서 이 경로 제외됨)
 *
 * planned_date가 정확히 오늘인 것만 본다 — 과거 미집행 백로그(대출마다 쌓여있는 오래된
 * pending)는 절대 소급 처리하지 않는다. 하루 실행을 놓쳐도 다음날 그 하루치만 처리하고
 * 지나간 날짜는 건드리지 않는다(과거분이 필요하면 사람이 검토해서 수동 처리).
 */

/** 현재 KST 달력일(YYYY-MM-DD) */
function todayKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const db = supabase as any

  const { data: loans, error: le } = await db
    .from('loans')
    .select('id')
    .neq('loan_type', '마이너스통장')
  if (le) return NextResponse.json({ error: le.message }, { status: 500 })

  const loanIds: string[] = (loans ?? []).map((l: any) => l.id)
  if (!loanIds.length) return NextResponse.json({ ok: true, synced: 0, executed: 0 })

  // 1. 스케줄/확정 내역 재동기화 (pending 최신화)
  for (const id of loanIds) {
    await syncLoanExecutions(supabase, id)
  }

  // 2. 정산일이 정확히 오늘인 pending만 골라 기계적으로 집행 (과거 백로그 소급 금지)
  const today = todayKST()
  const { data: due, error: de } = await db
    .from('spending_executions')
    .select('id')
    .eq('source_type', 'loan')
    .eq('status', 'pending')
    .in('source_id', loanIds)
    .eq('planned_date', today)
  if (de) return NextResponse.json({ error: de.message }, { status: 500 })

  const dueIds: string[] = (due ?? []).map((d: any) => d.id)
  const result = await executeSpendingExecutions(supabase, dueIds)

  return NextResponse.json({ ok: result.ok, synced: loanIds.length, due: dueIds.length, executed: result.executed })
}
