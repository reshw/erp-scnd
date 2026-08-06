/**
 * spending_executions(지출예정/대출 자동집행) pending 항목들을 실제 전표로 발행한다.
 * `/api/spending/execute`(수동 "집행" 클릭)와 `/api/loans/auto-execute`(대출 크론)
 * 양쪽에서 공유하는 핵심 로직.
 */
export async function executeSpendingExecutions(supabase: any, ids: string[]) {
  if (!ids?.length) return { ok: true, executed: 0 }

  // 필요한 계정 조회 (classification 계산용 필드 포함)
  const { data: accounts } = await (supabase as any)
    .from('accounts')
    .select('id, name, activity_type, normal_side, increase_label, decrease_label')
    .in('name', ['이자비용', '보통예금', '장기차입금', '미지급금(매입)', '미지급금(원리금)']) as any

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
  if (ee) return { ok: false, error: ee.message }

  let executed = 0

  for (const ex of execs ?? []) {
    let lines: any[] = []
    let planProjectId: string | null = null
    let counterpartyId: string | null = null
    let counterpartyName: string | null = null
    let bankAccountName: string | null = null

    if (ex.source_type === 'loan') {
      const { data: loan } = await (supabase as any)
        .from('loans')
        .select('project_id, loan_type, counterparties(id, name), bank_accounts(name)')
        .eq('id', ex.source_id).single() as any
      planProjectId = loan?.project_id ?? null
      counterpartyId = loan?.counterparties?.id ?? null
      counterpartyName = loan?.counterparties?.name ?? null
      bankAccountName = loan?.bank_accounts?.name ?? null

      // 마통(마이너스통장) 제외 전 대출은 정산일에 실제 이체 확인 없이 미지급금(원리금)으로 선발행한다.
      // 실제 상환 전표는 이 미지급금 반제(/clearings)로 처리한다 — docs/manual-posting-conventions.md 참조.
      // 마통은 spending_executions을 아예 안 거치는 별도 체계라 실질적으로 이 분기를 안 타지만,
      // 의도를 명시하기 위해 조건을 남긴다.
      const preBookAsPayable = loan?.loan_type !== '마이너스통장'
      const creditAccName = preBookAsPayable ? '미지급금(원리금)' : '보통예금'
      const creditAccId = accId(creditAccName)
      const creditCounterpartyId = preBookAsPayable ? counterpartyId : null
      const creditCounterpartyName = preBookAsPayable ? counterpartyName : bankAccountName
      const creditSubtype = preBookAsPayable ? (classification(creditAccId, 'credit').split(' - ')[1] ?? '') : '출금'

      if (ex.interest > 0) {
        const interestAccId = accId('이자비용')
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
            account_id: creditAccId,
            debit: 0, credit: ex.interest,
            activity_type: accByName[creditAccName]?.activity_type ?? '현금',
            activity_subtype: creditSubtype,
            classification: classification(creditAccId, 'credit'),
            counterparty_id: creditCounterpartyId,
            counterparty_name: creditCounterpartyName,
            note: ex.description,
            date: ex.planned_date,
          },
        )
      }
      if (ex.repayment > 0) {
        const debtAccId = accId('장기차입금')
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
            account_id: creditAccId,
            debit: 0, credit: ex.repayment,
            activity_type: accByName[creditAccName]?.activity_type ?? '현금',
            activity_subtype: creditSubtype,
            classification: classification(creditAccId, 'credit'),
            counterparty_id: creditCounterpartyId,
            counterparty_name: creditCounterpartyName,
            note: ex.description,
            date: ex.planned_date,
          },
        )
      }
    } else {
      const { data: plan } = await (supabase as any)
        .from('spending_plans')
        .select('account_id, project_id, accounts(id, name, activity_type, normal_side, increase_label, decrease_label), counterparties(id, name)')
        .eq('id', ex.source_id).single() as any

      if (plan?.account_id) {
        planProjectId = plan.project_id ?? null
        counterpartyId = plan.counterparties?.id ?? null
        counterpartyName = plan.counterparties?.name ?? null

        const planAcc = plan.accounts
        const apAccId = accId('미지급금(매입)')

        // plan 계정의 classification 계산 (debit 기준)
        const planClassification = planAcc
          ? (planAcc.normal_side === 'debit' ? planAcc.increase_label : planAcc.decrease_label)
          : ''

        // accById에 plan 계정 추가 (classification 함수용)
        if (planAcc) accById[planAcc.id] = planAcc

        // 집행 시 바로 확정비용/보통예금으로 잡지 않고 미지급금(매입)으로 먼저 발행한다.
        // 실제 이체 확인은 /clearings 반제 처리에서 별도로 한다.
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
            account_id: apAccId,
            debit: 0, credit: ex.amount,
            activity_type: accByName['미지급금(매입)']?.activity_type ?? '영업',
            activity_subtype: classification(apAccId, 'credit').split(' - ')[1] ?? '',
            classification: classification(apAccId, 'credit'),
            counterparty_id: counterpartyId,
            counterparty_name: counterpartyName,
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

    executed++
  }

  return { ok: true, executed }
}
