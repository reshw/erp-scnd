import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/journals/batch
 * 행 하나 = 프로젝트 하나 = 전표 하나
 * body: {
 *   date: string
 *   description: string
 *   rows: {
 *     project_id: string
 *     debit_account_id: string
 *     debit_amount: string
 *     debit_counterparty_id?: string
 *     credit_account_id: string
 *     credit_amount: string
 *     credit_counterparty_id?: string
 *     note?: string
 *   }[]
 * }
 */
export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const { date, description, rows } = await req.json()

  if (!rows?.length) return NextResponse.json({ error: '행이 없습니다' }, { status: 400 })

  // 계정과목 분류 조회 (classification 구성용)
  const accountIds = [
    ...new Set([
      ...rows.map((r: any) => r.debit_account_id),
      ...rows.map((r: any) => r.credit_account_id),
    ].filter(Boolean))
  ]

  const { data: accountRows } = await (supabase as any)
    .from('accounts')
    .select('id, name, activity_type, increase_label, decrease_label')
    .in('id', accountIds) as any

  const accountMap = new Map((accountRows ?? []).map((a: any) => [a.id, a]))

  // 프로젝트 코드 조회 (결과 표시용)
  const projectIds = [...new Set(rows.map((r: any) => r.project_id).filter(Boolean))]
  const { data: projectRows } = await (supabase as any)
    .from('projects')
    .select('id, code')
    .in('id', projectIds) as any
  const projectMap = new Map((projectRows ?? []).map((p: any) => [p.id, p.code]))

  // 현재 최대 journal_no
  const { data: lastJ } = await (supabase as any)
    .from('journals')
    .select('journal_no')
    .order('journal_no', { ascending: false })
    .limit(1)
    .single() as any
  let nextNo: number = (lastJ?.journal_no ?? 0) + 1

  const results: { journalNo: number; project: string }[] = []

  for (const row of rows) {
    const debitAcc  = accountMap.get(row.debit_account_id) as any
    const creditAcc = accountMap.get(row.credit_account_id) as any
    if (!debitAcc || !creditAcc) continue

    const debitAmt  = Math.round(Number(row.debit_amount))
    const creditAmt = Math.round(Number(row.credit_amount))
    if (debitAmt <= 0 || creditAmt <= 0) continue

    // 전표 생성
    const { data: journal, error: je } = await (supabase as any)
      .from('journals')
      .insert({
        journal_no:  nextNo,
        date,
        project_id:  row.project_id || null,
        description: description || null,
      })
      .select('id')
      .single() as any

    if (je) return NextResponse.json({ error: `전표 생성 오류: ${je.message}` }, { status: 500 })

    const { error: le } = await (supabase as any)
      .from('journal_lines')
      .insert([
        {
          journal_id:       journal.id,
          date,
          account_id:       debitAcc.id,
          classification:   debitAcc.increase_label,
          activity_type:    debitAcc.activity_type,
          activity_subtype: debitAcc.increase_label.split(' - ')[1] ?? '',
          debit:            debitAmt,
          credit:           0,
          counterparty_id:  row.debit_counterparty_id || null,
          note:             row.note || null,
        },
        {
          journal_id:       journal.id,
          date,
          account_id:       creditAcc.id,
          classification:   creditAcc.increase_label,
          activity_type:    creditAcc.activity_type,
          activity_subtype: creditAcc.increase_label.split(' - ')[1] ?? '',
          debit:            0,
          credit:           creditAmt,
          counterparty_id:  row.credit_counterparty_id || null,
          note:             row.note || null,
        },
      ]) as any

    if (le) return NextResponse.json({ error: `명세 생성 오류: ${le.message}` }, { status: 500 })

    results.push({ journalNo: nextNo, project: projectMap.get(row.project_id) ?? row.project_id })
    nextNo++
  }

  return NextResponse.json({ ok: true, results })
}
