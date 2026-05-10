import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('spending_plans')
    .select('*, accounts(name), counterparties(name), projects(code)')
    .eq('status', 'active')
    .order('created_at', { ascending: false }) as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()

  const { data: plan, error } = await (supabase as any)
    .from('spending_plans')
    .insert({
      name:            body.name,
      type:            body.type,
      amount:          body.amount,
      recurrence_day:  body.recurrence_day ?? null,
      planned_date:    body.planned_date ?? null,
      account_id:       body.account_id || null,
      counterparty_id:  body.counterparty_id || null,
      project_id:       body.project_id || null,
      note:             body.note || null,
      bank_account_id:  body.bank_account_id || null,
      status:           'active',
    })
    .select()
    .single() as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // spending_executions 자동 생성
  const executions: any[] = []
  const desc = plan.name

  if (plan.type === 'one_time' && plan.planned_date) {
    executions.push({
      source_type:  'plan',
      source_id:    plan.id,
      planned_date: plan.planned_date,
      amount:       plan.amount,
      description:  desc,
      status:       'pending',
    })
  } else if (plan.type === 'recurring' && plan.recurrence_day) {
    // 이번달 포함 12개월치 생성
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const y = now.getFullYear()
      const m = now.getMonth() + i
      const date = new Date(y, m, 1)
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      const day = Math.min(plan.recurrence_day, lastDay)
      const planned_date = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const month = planned_date.slice(0, 7)
      executions.push({
        source_type:  'plan',
        source_id:    plan.id,
        planned_date,
        amount:       plan.amount,
        description:  `${desc} ${month}`,
        status:       'pending',
      })
    }
  }

  if (executions.length > 0) {
    await (supabase as any).from('spending_executions').insert(executions)
  }

  return NextResponse.json(plan)
}

export async function PUT(req: NextRequest) {
  const supabase = createAdminClient()
  const body = await req.json()

  const { data: plan, error } = await (supabase as any)
    .from('spending_plans')
    .update({
      name:            body.name,
      amount:          body.amount,
      recurrence_day:  body.recurrence_day ?? null,
      planned_date:    body.planned_date ?? null,
      account_id:       body.account_id || null,
      counterparty_id:  body.counterparty_id || null,
      project_id:       body.project_id || null,
      note:             body.note || null,
      bank_account_id:  body.bank_account_id || null,
    })
    .eq('id', body.id)
    .select()
    .single() as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // pending executions 재생성
  await (supabase as any)
    .from('spending_executions')
    .delete()
    .eq('source_type', 'plan')
    .eq('source_id', plan.id)
    .eq('status', 'pending')

  const executions: any[] = []
  if (plan.type === 'one_time' && plan.planned_date) {
    executions.push({
      source_type: 'plan', source_id: plan.id,
      planned_date: plan.planned_date, amount: plan.amount,
      description: plan.name, status: 'pending',
    })
  } else if (plan.type === 'recurring' && plan.recurrence_day) {
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      const day = Math.min(plan.recurrence_day, lastDay)
      const planned_date = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      executions.push({
        source_type: 'plan', source_id: plan.id,
        planned_date, amount: plan.amount,
        description: `${plan.name} ${planned_date.slice(0, 7)}`, status: 'pending',
      })
    }
  }
  if (executions.length > 0) {
    await (supabase as any).from('spending_executions').insert(executions)
  }

  return NextResponse.json(plan)
}

export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const { id } = await req.json()

  // pending executions 삭제
  await (supabase as any)
    .from('spending_executions')
    .delete()
    .eq('source_type', 'plan')
    .eq('source_id', id)
    .eq('status', 'pending')

  // 계획 cancelled 처리
  const { error } = await (supabase as any)
    .from('spending_plans')
    .update({ status: 'cancelled' })
    .eq('id', id) as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
