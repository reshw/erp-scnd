import { createAdminClient } from '@/lib/supabase/admin'
import LoanForm from '../LoanForm'

export default async function NewLoanPage() {
  const supabase = createAdminClient()
  const [{ data: counterparties }, { data: projects }] = await Promise.all([
    (supabase as any).from('counterparties').select('id,name').order('name') as any,
    (supabase as any).from('projects').select('id,code').eq('is_active', true).order('code') as any,
  ])

  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-xl font-bold">대출 등록</h2>
      <LoanForm counterparties={counterparties ?? []} projects={projects ?? []} />
    </div>
  )
}
