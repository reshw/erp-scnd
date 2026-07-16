import { createAdminClient } from '@/lib/supabase/admin'
import EntitiesClient from './EntitiesClient'

type Entity = {
  id: string
  name: string
  type: 'corporate' | 'personal'
  business_no: string | null
  opened_at: string | null
  biz_type: string | null
  biz_item: string | null
}

export default async function EntitiesPage() {
  const supabase = createAdminClient()
  const { data } = await (supabase as any)
    .from('entities')
    .select('id, name, type, business_no, opened_at, biz_type, biz_item')
    .order('name') as { data: Entity[] | null }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">사업자 관리</h2>
      <EntitiesClient entities={data ?? []} />
    </div>
  )
}
