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
  )

  // 기존 pending 삭제
  await supabase
    .from('spending_executions')
    .delete()
    .eq('source_type', 'loan')
    .eq('source_id', loanId)
    .eq('status', 'pending')

  // 확정 내역 전체 조회
  const { data: settled } = await supabase
    .from('loan_settlements').select('*').eq('loan_id', loanId)
  const settledMonths = new Set((settled ?? []).map((s: any) => s.month))
  // 확정됐지만 아직 미집행(journal_id 없음)인 항목
  const unexecuted = (settled ?? []).filter((s: any) => !s.journal_id)

  // 미확정 스케줄 행
  const rows: any[] = schedule
    .filter(r => !r.prepayment && !settledMonths.has(r.month))
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
