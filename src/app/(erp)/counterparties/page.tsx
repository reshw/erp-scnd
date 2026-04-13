import { createAdminClient } from '@/lib/supabase/admin'
import CounterpartiesClient from './CounterpartiesClient'

type Counterparty = {
  id: string
  name: string
  representative: string | null
  business_no: string | null
  bank_name: string | null
  bank_account_no: string | null
  note: string | null
}

export default async function CounterpartiesPage() {
  const supabase = createAdminClient()
  const { data } = await (supabase as any)
    .from('counterparties')
    .select('id, name, representative, business_no, bank_name, bank_account_no, note')
    .order('name') as { data: Counterparty[] | null }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">거래처 관리</h2>
      <CounterpartiesClient counterparties={data ?? []} />
    </div>
  )
}
