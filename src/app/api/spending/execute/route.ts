import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/spending/execute
 * body: { ids: string[] }  ← spending_executions.id 목록
 */
export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const { ids } = await req.json() as { ids: string[] }

  if (!ids?.length) return NextResponse.json({ error: '처리할 항목이 없습니다' }, { status: 400 })

  // 필요한 계정 조회 (classification 계산용 필드 포함)
  const { data: accounts } = await (supabase as any)
    .from('accounts')
    .select('id, name, activity_type, normal_side, increase_label, decrease_label')
    .in('name', ['이자비용', '보통예금', '장기차입금']) as any

  const accById = Object.fromEntries((accounts ?? []).map((a: any) => [a.id, a]))
  const accByName = Object.fromEntries((accounts ?? []).map((a: any) => [a.name, a]))
  const accId = (name: string) => accByName[name]?.id

  // debit/credit 방향에 따라 classification 결정
  function classification(accountId: string, side: 'debit' | 'credit'): string {
    const acc = accById[accountId]
    if (!acc) return ''
    const normalDebit = acc.normal_side === 'debit'
    if (side === 'debit')  return normalDebit ? acc.increase_label : acc.decrease_label
    return normalDebit ? acc.decrease_label : acc.increase_label
  }

  // journal_no 시작값
  const { data: lastJ } = await (supabase as any)
    .from('journals').select('journal_no').order('journal_no', { ascending: false }).limit(1).single() as any
  let nextNo: number = (lastJ?.journal_no ?? 0) + 1

  // 대상 executions 조회
  const { data: execs, error: ee } = await (supabase as any)
    .from('spending_executions')
    .select('*')
    .in('id', ids)
    .eq('status', 'pending') as any
  if (ee) return NextResponse.json({ error: ee.message }, { status: 500 })

  for (const ex of execs ?? []) {
    let lines: any[] = []
    let planProjectId: string | null = null
    let counterpartyId: string | null = null
    let counterpartyName: string | null = null
    let bankAccountName: string | null = null

    if (ex.source_type === 'loan') {
      const { data: loan } = await (supabase as any)
        .from('loans')
        .select('project_id, counterparties(id, name), bank_accounts(name)')
        .eq('id', ex.source_id).single() as any
      planProjectId = loan?.project_id ?? null
      counterpartyId = loan?.counterparties?.id ?? null
      counterpartyName = loan?.counterparties?.name ?? null
      bankAccountName = loan?.bank_accounts?.name ?? null

      if (ex.interest > 0) {
        const interestAccId = accId('이자비용')
        const bankAccId = accId('보통예금')
        lines.push(
          {
            account_id: interestAccId,
            debit: ex.interest, credit: 0,
            activity_type: accByName['이자비용']?.activity_type ?? '영업',
            activity_subtype: '금융비용',
            classification: classification(interestAccId, 'debit'),
            counterparty_id: counterpartyId,
            counterparty_name: counterpartyName,
            note: ex.description,
            date: ex.planned_date,
          },
          {
            account_id: bankAccId,
            debit: 0, credit: ex.interest,
            activity_type: accByName['보통예금']?.activity_type ?? '현금',
            activity_subtype: '출금',
            classification: classification(bankAccId, 'credit'),
            counterparty_id: null,
            counterparty_name: bankAccountName,
            note: ex.description,
            date: ex.planned_date,
          },
        )
      }
      if (ex.repayment > 0) {
        const debtAccId = accId('장기차입금')
        const bankAccId = accId('보통예금')
        lines.push(
          {
            account_id: debtAccId,
            debit: ex.repayment, credit: 0,
            activity_type: accByName['장기차입금']?.activity_type ?? '재무',
            activity_subtype: '상환',
            classification: classification(debtAccId, 'debit'),
            counterparty_id: counterpartyId,
            counterparty_name: counterpartyName,
            note: ex.description,
            date: ex.planned_date,
          },
          {
            account_id: bankAccId,
            debit: 0, credit: ex.repayment,
            activity_type: accByName['보통예금']?.activity_type ?? '현금',
            activity_subtype: '출금',
            classification: classification(bankAccId, 'credit'),
            counterparty_id: null,
            counterparty_name: bankAccountName,
            note: ex.description,
            date: ex.planned_date,
          },
        )
      }
    } else {
      const { data: plan } = await (supabase as any)
        .from('spending_plans')
        .select('account_id, project_id, accounts(id, name, activity_type, normal_side, increase_label, decrease_label), counterparties(id, name), bank_accounts(name)')
        .eq('id', ex.source_id).single() as any

      if (plan?.account_id) {
        planProjectId = plan.project_id ?? null
        counterpartyId = plan.counterparties?.id ?? null
        counterpartyName = plan.counterparties?.name ?? null
        bankAccountName = plan.bank_accounts?.name ?? null

        const planAcc = plan.accounts
        const bankAccId = accId('보통예금')

        // plan 계정의 classification 계산 (debit 기준)
        const planClassification = planAcc
          ? (planAcc.normal_side === 'debit' ? planAcc.increase_label : planAcc.decrease_label)
          : ''

        // accById에 plan 계정 추가 (classification 함수용)
        if (planAcc) accById[planAcc.id] = planAcc

        lines = [
          {
            account_id: plan.account_id,
            debit: ex.amount, credit: 0,
            activity_type: planAcc?.activity_type ?? '영업',
            activity_subtype: planClassification.split(' - ')[1] ?? '',
            classification: planClassification,
            counterparty_id: counterpartyId,
            counterparty_name: counterpartyName,
            note: ex.description,
            date: ex.planned_date,
          },
          {
            account_id: bankAccId,
            debit: 0, credit: ex.amount,
            activity_type: accByName['보통예금']?.activity_type ?? '현금',
            activity_subtype: '출금',
            classification: classification(bankAccId, 'credit'),
            counterparty_id: null,
            counterparty_name: bankAccountName,
            note: ex.description,
            date: ex.planned_date,
          },
        ]
      }
    }

    if (!lines.length) continue

    const { data: journal, error: je } = await (supabase as any)
      .from('journals')
      .insert({ journal_no: nextNo++, date: ex.planned_date, project_id: planProjectId, description: ex.description })
      .select('id').single() as any
    if (je) continue

    const { error: le } = await (supabase as any)
      .from('journal_lines')
      .insert(lines.map((l: any) => ({ ...l, journal_id: journal.id })))
    if (le) {
      await supabase.from('journals').delete().eq('id', journal.id)
      continue
    }

    await (supabase as any).from('spending_executions')
      .update({ status: 'executed', journal_id: journal.id, executed_at: new Date().toISOString() })
      .eq('id', ex.id)

    if (ex.source_type === 'plan') {
      await (supabase as any)
        .from('spending_plans')
        .update({ status: 'completed' })
        .eq('id', ex.source_id)
        .eq('type', 'one_time')
    }
  }

  return NextResponse.json({ ok: true })
}
