import { createAdminClient } from '@/lib/supabase/admin'
import ProjectsClient from './ProjectsClient'

type Project = {
  id: string
  code: string
  name: string
  description: string | null
  entity_id: string | null
  is_active: boolean
}

export default async function ProjectsPage() {
  const supabase = createAdminClient()
  const [{ data }, { data: entities }] = await Promise.all([
    (supabase as any)
      .from('projects')
      .select('id, code, name, description, entity_id, is_active')
      .order('code') as { data: Project[] | null },
    (supabase as any)
      .from('entities')
      .select('id, name')
      .order('name') as { data: { id: string; name: string }[] | null },
  ])

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">프로젝트 관리</h2>
      <ProjectsClient projects={data ?? []} entities={entities ?? []} />
    </div>
  )
}
