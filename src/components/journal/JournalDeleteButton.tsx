'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function JournalDeleteButton({ journalId }: { journalId: string }) {
  const router = useRouter()

  async function handleDelete() {
    if (!confirm('이 전표를 삭제하시겠습니까?')) return

    const res = await fetch('/api/journals', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: journalId }),
    })

    if (res.ok) {
      router.push('/journals')
      router.refresh()
    }
  }

  return (
    <Button variant="destructive" size="sm" onClick={handleDelete}>
      삭제
    </Button>
  )
}
