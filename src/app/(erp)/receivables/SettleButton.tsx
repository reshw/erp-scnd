'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function SettleButton({ externalId, amount }: { externalId: string; amount: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [deposit, setDeposit] = useState(String(amount))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setSaving(true); setError('')
    const res = await fetch('/api/timetable/payments/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ external_id: externalId, deposit_amount: Number(deposit), date }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? '정산 처리 실패'); setSaving(false); return }
    setOpen(false)
    setSaving(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-green-600 hover:underline">
        정산 등록
      </button>
    )
  }

  const fee = amount - Number(deposit || 0)

  return (
    <div className="flex items-center gap-1 justify-end whitespace-nowrap">
      <input
        type="number"
        value={deposit}
        onChange={e => setDeposit(e.target.value)}
        placeholder="입금액"
        className="border rounded px-1.5 py-0.5 text-xs w-24 text-right tabular-nums"
      />
      <input
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className="border rounded px-1.5 py-0.5 text-xs"
      />
      {fee > 0 && <span className="text-xs text-gray-400">수수료 {fee.toLocaleString()}</span>}
      <Button size="sm" className="text-xs px-2 h-6" disabled={saving} onClick={handleConfirm}>
        {saving ? '...' : '확인'}
      </Button>
      <button onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:underline">취소</button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
