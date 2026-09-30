'use client'

import { useRouter } from 'next/navigation'

export default function ProjectPicker({
  projects,
  value,
}: {
  projects: { id: string; code: string }[]
  value: string
}) {
  const router = useRouter()
  return (
    <select
      value={value}
      onChange={e => router.push(`/project-dashboard?project_id=${e.target.value}`)}
      className="border rounded px-3 py-1.5 text-sm bg-white"
    >
      {projects.map(p => (
        <option key={p.id} value={p.id}>{p.code}</option>
      ))}
    </select>
  )
}
