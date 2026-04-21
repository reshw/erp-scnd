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

  const [{ data: counterparties }, { data: projects }] = await Promise.all([
    supabase.from('counterparties').select('id, name').order('name'),
    supabase.from('projects').select('id, code').eq('is_active', true).order('code'),
  ])

  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-xl font-bold">대출 수정</h2>
      <LoanForm
        counterparties={(counterparties ?? []) as any}
        projects={(projects ?? []) as any}
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
          counterparty_id: loan.counterparty_id ?? null,
          project_id: loan.project_id ?? null,
        }}
      />
    </div>
  )
}
