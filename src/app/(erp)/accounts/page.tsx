import { createAdminClient } from '@/lib/supabase/admin'
import AccountsClient from './AccountsClient'

type Account = {
  id: string
  name: string
  activity_type: string
  normal_side: string
  increase_label: string
  decrease_label: string
  is_active: boolean
}

const ACTIVITY_ORDER = ['현금', '영업', '재무', '투자', '개인', '세무']

export default async function AccountsPage() {
  const supabase = createAdminClient()
  const { data } = await (supabase as any)
    .from('accounts')
    .select('id, name, activity_type, normal_side, increase_label, decrease_label, is_active')
    .order('activity_type')
    .order('name') as { data: Account[] | null }

  const accounts = (data ?? []).sort((a, b) => {
    const ai = ACTIVITY_ORDER.indexOf(a.activity_type)
    const bi = ACTIVITY_ORDER.indexOf(b.activity_type)
    if (ai !== bi) return ai - bi
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">계정과목 관리</h2>
      <AccountsClient accounts={accounts} />
    </div>
  )
}
