'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export default function SyncButton({ loanId }: { loanId: string }) {
  const [syncing, setSyncing] = useState(false)
  const [done, setDone] = useState(false)

  const [result, setResult] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setResult(null)
    try {
      const res = await fetch(`/api/loans/${loanId}/sync-executions`, { method: 'POST' })
      const json = await res.json()
      if (res.ok) {
        setDone(true)
        setResult(`완료 (${json.count}건)`)
      } else {
        setResult(`오류: ${json.error ?? res.status}`)
      }
    } catch (e: any) {
      setResult(`오류: ${e.message}`)
    }
    setSyncing(false)
    setTimeout(() => { setDone(false); setResult(null) }, 5000)
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}
        className={done ? 'text-green-600 border-green-300' : ''}>
        {syncing ? '동기화 중...' : done ? '동기화 완료' : '지출예정 동기화'}
      </Button>
      {result && <span className="text-xs text-gray-500">{result}</span>}
    </div>
  )
}
