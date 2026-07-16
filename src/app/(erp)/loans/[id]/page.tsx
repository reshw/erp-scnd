import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import LoanScheduleTable from './LoanScheduleTable'
import OverdraftDetail from './OverdraftDetail'
import SyncButton from './SyncButton'
import { calcSchedule } from '@/lib/loans/calcSchedule'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: loan } = await (supabase as any)
    .from('loans')
    .select('*, counterparties(name), projects(code)')
    .eq('id', id)
    .single() as any

  if (!loan) notFound()

  const isOverdraft = loan.loan_type === '마이너스통장'

  // ── 마이너스통장: 금리 변동 이력 ─────────────────────────────────────
  let rateHistory: any[] = []
  if (isOverdraft) {
    const { data } = await (supabase as any)
      .from('loan_rate_history')
      .select('id, effective_date, annual_rate, note')
      .eq('loan_id', id)
      .order('effective_date') as any
    rateHistory = data ?? []
  }

  // ── 마이너스통장: 전표 기반 인출/상환 내역 조회 ──────────────────────
  let overdraftLines: any[] = []
  if (isOverdraft && loan.account_id && loan.counterparty_id) {
    // 1단계: 유효 journal_id 목록 확보 (취소 제외 + 프로젝트 필터)
    let journalQuery = (supabase as any)
      .from('journals')
      .select('id')
      .eq('is_cancelled', false)
    if (loan.project_id) {
      journalQuery = journalQuery.eq('project_id', loan.project_id)
    }
    const { data: validJournals } = await journalQuery as any
    const validIds: string[] = (validJournals ?? []).map((j: any) => j.id)

    // 2단계: 해당 계정+거래처의 명세만 조회
    if (validIds.length > 0) {
      const { data } = await (supabase as any)
        .from('journal_lines')
        .select('id, date, debit, credit, note, journal_id')
        .eq('account_id', loan.account_id)
        .eq('counterparty_id', loan.counterparty_id)
        .in('journal_id', validIds)
        .order('date') as any
      overdraftLines = data ?? []
    }
  }

  // ── 일반 대출: 상환 스케줄 계산 ─────────────────────────────────────
  let schedule: any[] = []
  let settlements: any[] = []
  let prepayments: any[] = []

  if (!isOverdraft) {
    const [{ data: s }, { data: p }] = await Promise.all([
      (supabase as any).from('loan_settlements').select('*').eq('loan_id', id).order('month') as any,
      (supabase as any).from('loan_prepayments').select('*').eq('loan_id', id).order('date') as any,
    ])
    settlements = s ?? []
    prepayments = p ?? []
    schedule = calcSchedule(
      Number(loan.principal),
      Number(loan.interest_rate),
      loan.start_date,
      loan.end_date,
      loan.loan_type ?? '원리금균등',
      loan.interest_calc ?? 'monthly',
      loan.first_month_partial ?? true,
      loan.payment_day ?? null,
      prepayments,
      loan.pmt_floor ?? false,
      loan.interest_round ?? 'round',
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{loan.name}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {loan.counterparties?.name ?? '-'} · {loan.projects?.code ?? '-'} ·{' '}
            {isOverdraft
              ? `한도 ${loan.overdraft_limit ? fmt(loan.overdraft_limit) : '-'}원 · 연 ${(Number(loan.interest_rate) * 100).toFixed(2)}% · 마이너스통장`
              : `원금 ${fmt(loan.principal)}원 · 연 ${(Number(loan.interest_rate) * 100).toFixed(2)}% · ${loan.loan_type}${loan.payment_day ? ` · 매월 ${loan.payment_day}일 납부` : ''}`
            }
          </p>
        </div>
        <div className="flex gap-2">
          {!isOverdraft && <SyncButton loanId={id} />}
          <Link href={`/loans/new?copy=${id}`}>
            <Button size="sm" variant="outline">복사 (신규)</Button>
          </Link>
          <Link href={`/loans/${id}/edit`}>
            <Button size="sm" variant="outline">수정</Button>
          </Link>
          <Link href="/loans">
            <Button size="sm" variant="outline">목록</Button>
          </Link>
        </div>
      </div>

      {isOverdraft ? (
        <OverdraftDetail
          loanId={id}
          overdraftLimit={loan.overdraft_limit ? Number(loan.overdraft_limit) : null}
          annualRate={Number(loan.interest_rate)}
          includeDrawDay={loan.include_draw_day ?? true}
          lines={overdraftLines}
          settlementType={loan.settlement_type ?? 'date'}
          settlementDay={loan.settlement_day ?? null}
          settlementWeekday={loan.settlement_weekday ?? null}
          settlementWeekOfMonth={loan.settlement_week_of_month ?? null}
          rateHistory={rateHistory.map((r: any) => ({
            id: r.id,
            effective_date: r.effective_date,
            annual_rate: Number(r.annual_rate),
            note: r.note ?? null,
          }))}
        />
      ) : (
        <LoanScheduleTable
          loanId={id}
          projectId={loan.project_id ?? null}
          schedule={schedule}
          settlements={settlements}
          annualRate={Number(loan.interest_rate)}
          interestCalc={loan.interest_calc ?? 'monthly'}
          interestRound={loan.interest_round ?? 'round'}
          loanType={loan.loan_type ?? '원리금균등'}
          principal={Number(loan.principal)}
          pmt={schedule.find((r: any) => !r.partial && !r.prepayment)?.payment ?? 0}
        />
      )}
    </div>
  )
}
