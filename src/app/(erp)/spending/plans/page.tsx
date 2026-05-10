import { createAdminClient } from '@/lib/supabase/admin'
import PlansClient from './PlansClient'

export default async function SpendingPlansPage() {
  const supabase = createAdminClient()

  const [
    { data: plans },
    { data: accounts },
    { data: counterparties },
    { data: projects },
    { data: bankAccounts },
  ] = await Promise.all([
    (supabase as any)
      .from('spending_plans')
      .select('*, accounts(name), counterparties(name), projects(code), bank_accounts(name)')
      .eq('status', 'active')
      .order('created_at', { ascending: false }) as any,
    (supabase as any)
      .from('accounts')
      .select('id, name')
      .order('name') as any,
    (supabase as any)
      .from('counterparties')
      .select('id, name')
      .order('name') as any,
    (supabase as any)
      .from('projects')
      .select('id, code')
      .order('code') as any,
    (supabase as any)
      .from('bank_accounts')
      .select('id, name')
      .eq('is_active', true)
      .order('name') as any,
  ])

  return (
    <PlansClient
      plans={plans ?? []}
      accounts={accounts ?? []}
      counterparties={counterparties ?? []}
      projects={projects ?? []}
      bankAccounts={bankAccounts ?? []}
    />
  )
}
