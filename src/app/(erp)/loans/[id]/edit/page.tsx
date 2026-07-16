import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import LoanForm from '../../LoanForm'

export default async function LoanEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: loan } = await (supabase as any)
    .from('loans')
    .select('*')
    .eq('id', id)
    .single() as any

  if (!loan) notFound()

  const [{ data: counterparties }, { data: projects }, { data: accounts }, { data: bankAccounts }] = await Promise.all([
    supabase.from('counterparties').select('id, name').order('name'),
    supabase.from('projects').select('id, code').eq('is_active', true).order('code'),
    supabase.from('accounts').select('id, name').eq('is_active', true).order('name'),
    (supabase as any).from('bank_accounts').select('id, name').eq('is_active', true).order('name') as any,
  ])

  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-xl font-bold">대출 수정</h2>
      <LoanForm
        counterparties={(counterparties ?? []) as any}
        projects={(projects ?? []) as any}
        accounts={(accounts ?? []) as any}
        bankAccounts={(bankAccounts ?? []) as any}
        initialValues={{
          id: loan.id,
          name: loan.name,
          principal: Number(loan.principal),
          interest_rate: Number(loan.interest_rate),
          start_date: loan.start_date,
          end_date: loan.end_date,
          loan_type: loan.loan_type ?? '원리금균등',
          interest_calc: loan.interest_calc ?? 'monthly',
          first_month_partial: loan.first_month_partial ?? true,
          payment_day: loan.payment_day ?? null,
          pmt_floor: loan.pmt_floor ?? false,
          interest_round: loan.interest_round ?? 'round',
          counterparty_id: loan.counterparty_id ?? null,
          project_id: loan.project_id ?? null,
          overdraft_limit: loan.overdraft_limit ? Number(loan.overdraft_limit) : null,
          include_draw_day: loan.include_draw_day ?? true,
          account_id: loan.account_id ?? null,
          account_name: ((accounts ?? []) as any[]).find((a: any) => a.id === loan.account_id)?.name ?? null,
          bank_account_id: loan.bank_account_id ?? null,
          bank_account_name: ((bankAccounts ?? []) as any[]).find((b: any) => b.id === loan.bank_account_id)?.name ?? null,
          settlement_type: loan.settlement_type ?? 'date',
          settlement_day: loan.settlement_day ?? null,
          settlement_weekday: loan.settlement_weekday ?? null,
          settlement_week_of_month: loan.settlement_week_of_month ?? null,
        }}
      />
    </div>
  )
}
