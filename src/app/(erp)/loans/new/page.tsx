import { createAdminClient } from '@/lib/supabase/admin'
import LoanForm from '../LoanForm'

export default async function NewLoanPage({
  searchParams,
}: {
  searchParams: Promise<{ copy?: string }>
}) {
  const { copy } = await searchParams
  const supabase = createAdminClient()

  const [{ data: counterparties }, { data: projects }, { data: accounts }, { data: bankAccounts }] = await Promise.all([
    (supabase as any).from('counterparties').select('id,name').order('name') as any,
    (supabase as any).from('projects').select('id,code').eq('is_active', true).order('code') as any,
    (supabase as any).from('accounts').select('id,name').eq('is_active', true).order('name') as any,
    (supabase as any).from('bank_accounts').select('id,name').eq('is_active', true).order('name') as any,
  ])

  // 복사 대상 대출 조회
  let copyValues: any = undefined
  if (copy) {
    const { data: src } = await (supabase as any)
      .from('loans')
      .select('*')
      .eq('id', copy)
      .single() as any

    if (src) {
      const accList = (accounts ?? []) as any[]
      copyValues = {
        // id 없음 → 신규 등록
        name:                src.name + ' (복사)',
        principal:           Number(src.principal),
        interest_rate:       Number(src.interest_rate),
        start_date:          src.start_date,
        end_date:            src.end_date,
        loan_type:           src.loan_type ?? '원리금균등',
        interest_calc:       src.interest_calc ?? 'monthly',
        first_month_partial: src.first_month_partial ?? true,
        payment_day:         src.payment_day ?? null,
        pmt_floor:           src.pmt_floor ?? false,
        interest_round:      src.interest_round ?? 'round',
        counterparty_id:     src.counterparty_id ?? null,
        project_id:          src.project_id ?? null,
        overdraft_limit:     src.overdraft_limit ? Number(src.overdraft_limit) : null,
        include_draw_day:    src.include_draw_day ?? true,
        account_id:          src.account_id ?? null,
        account_name:        accList.find((a: any) => a.id === src.account_id)?.name ?? null,
        bank_account_id:     src.bank_account_id ?? null,
        bank_account_name:   ((bankAccounts ?? []) as any[]).find((b: any) => b.id === src.bank_account_id)?.name ?? null,
      }
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-xl font-bold">{copy ? '대출 복사 (신규 등록)' : '대출 등록'}</h2>
      <LoanForm
        counterparties={(counterparties ?? []) as any}
        projects={(projects ?? []) as any}
        accounts={(accounts ?? []) as any}
        bankAccounts={(bankAccounts ?? []) as any}
        initialValues={copyValues}
      />
    </div>
  )
}
