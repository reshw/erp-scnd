import { calcSchedule } from './calcSchedule'

/**
 * 대출 스케줄 → spending_executions 동기화 (공유 로직)
 * API route와 직접 호출 양쪽에서 사용
 */
export async function syncLoanExecutions(supabase: any, loanId: string) {
  const { data: loan } = await supabase
    .from('loans')
    .select('*')
    .eq('id', loanId)
    .single()

  if (!loan) return { count: 0 }

  const { data: prepayments } = await supabase
    .from('loan_prepayments').select('*').eq('loan_id', loanId).order('date')

  const { data: rateHistory } = await supabase
    .from('loan_rate_history').select('effective_date, annual_rate').eq('loan_id', loanId).order('effective_date')

  const schedule = calcSchedule(
    Number(loan.principal),
    Number(loan.interest_rate),
    loan.start_date,
    loan.end_date,
    loan.loan_type ?? '원리금균등',
    loan.interest_calc ?? 'monthly',
    loan.first_month_partial ?? true,
    loan.payment_day ?? null,
    prepayments ?? [],
    loan.pmt_floor ?? false,
    loan.interest_round ?? 'round',
    (rateHistory ?? []).map((r: any) => ({ effective_date: r.effective_date, annual_rate: Number(r.annual_rate) })),
  )

  // 기존 pending 삭제
  await supabase
    .from('spending_executions')
    .delete()
    .eq('source_type', 'loan')
    .eq('source_id', loanId)
    .eq('status', 'pending')

  // 이미 집행(전표 발행)된 달 — loan_settlements와는 별개 트랙이라 여기서 직접 확인해야 한다.
  // loan_settlements.journal_id는 실제 집행 로직(executeSpendingExecutions)이 채우지 않으므로
  // "확정됐지만 journal_id 없음" 판정만으로는 이미 집행된 달도 계속 미집행으로 오판해
  // 동기화할 때마다 중복 pending이 되살아나는 버그가 있었다(2026-08-10 발견).
  const { data: executed } = await supabase
    .from('spending_executions')
    .select('planned_date')
    .eq('source_type', 'loan')
    .eq('source_id', loanId)
    .eq('status', 'executed')
  const executedMonths = new Set((executed ?? []).map((e: any) => String(e.planned_date).slice(0, 7)))

  // 확정 내역 전체 조회
  const { data: settled } = await supabase
    .from('loan_settlements').select('*').eq('loan_id', loanId)
  const settledMonths = new Set((settled ?? []).map((s: any) => s.month))
  // 확정됐지만 아직 미집행(journal_id 없음 + 실제로도 집행된 적 없음)인 항목
  const unexecuted = (settled ?? []).filter((s: any) => !s.journal_id && !executedMonths.has(s.month))

  // 미확정 스케줄 행 (이미 집행된 달은 제외)
  const rows: any[] = schedule
    .filter(r => !r.prepayment && !settledMonths.has(r.month) && !executedMonths.has(r.month))
    .map(r => ({
      source_type:  'loan',
      source_id:    loanId,
      planned_date: r.payDate,
      amount:       r.payment,
      interest:     r.interest,
      repayment:    r.repayment,
      description:  `${loan.name} ${r.month}${r.partial ? ' (일할)' : ''}`,
      status:       'pending',
    }))

  // 확정됐지만 미집행인 항목 → 실제 확정 금액으로 pending 행 추가
  for (const s of unexecuted) {
    const schedRow = schedule.find(r => r.month === s.month && !r.prepayment)
    if (!schedRow) continue
    rows.push({
      source_type:  'loan',
      source_id:    loanId,
      planned_date: schedRow.payDate,
      amount:       (s.actual_interest ?? 0) + (s.actual_repayment ?? 0),
      interest:     s.actual_interest ?? 0,
      repayment:    s.actual_repayment ?? 0,
      description:  `${loan.name} ${s.month}${schedRow.partial ? ' (일할)' : ''} [확정]`,
      status:       'pending',
    })
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from('spending_executions').insert(rows)
    if (insertError) return { count: 0, error: insertError.message }
  }

  return { count: rows.length }
}
