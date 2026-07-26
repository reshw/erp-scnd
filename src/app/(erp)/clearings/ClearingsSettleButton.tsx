'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function ClearingsSettleButton({
  accountId,
  cpId,
  cpName,
  balance,
}: {
  accountId: string
  cpId: string | null
  cpName: string
  balance: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(balance))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setSaving(true); setError('')
    const res = await fetch('/api/clearings/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: accountId,
        counterparty_id: cpId,
        counterparty_name: cpName,
        amount: Number(amount),
        date,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? '반제 처리 실패'); setSaving(false); return }
    setOpen(false)
    setSaving(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-green-600 hover:underline">
        반제
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1 justify-end whitespace-nowrap">
      <input
        type="number"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        className="border rounded px-1.5 py-0.5 text-xs w-24 text-right tabular-nums"
      />
      <input
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className="border rounded px-1.5 py-0.5 text-xs"
      />
      <Button size="sm" className="text-xs px-2 h-6" disabled={saving} onClick={handleConfirm}>
        {saving ? '...' : '확인'}
      </Button>
      <button onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:underline">취소</button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
