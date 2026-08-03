'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default function BankBalanceTable({
  entries, total,
}: {
  entries: { name: string; balance: number }[]
  total: number
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()

  function move(name: string, direction: 'up' | 'down') {
    startTransition(async () => {
      await fetch('/api/bank-display-order/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, direction }),
      })
      router.refresh()
    })
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="text-left px-4 py-2">
              <div className="flex items-center gap-2">
                <span>통장</span>
                <button
                  type="button"
                  onClick={() => setEditing(v => !v)}
                  className={`text-xs px-1.5 py-0.5 rounded border ${editing ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-gray-300 text-gray-400 hover:text-gray-600'}`}
                >
                  {editing ? '완료' : '순서 편집'}
                </button>
              </div>
            </th>
            <th className="text-right px-4 py-2">잔고</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {entries.map(({ name, balance }, i) => (
            <tr key={name}>
              <td className="px-4 py-2 text-gray-700">
                <div className="flex items-center gap-2">
                  {editing && (
                    <span className="flex flex-col -my-1">
                      <button
                        type="button"
                        disabled={i === 0 || isPending}
                        onClick={() => move(name, 'up')}
                        className="leading-none text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:hover:text-gray-400"
                      >▲</button>
                      <button
                        type="button"
                        disabled={i === entries.length - 1 || isPending}
                        onClick={() => move(name, 'down')}
                        className="leading-none text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:hover:text-gray-400"
                      >▼</button>
                    </span>
                  )}
                  <span>{name}</span>
                </div>
              </td>
              <td className={`px-4 py-2 text-right tabular-nums font-medium ${balance < 0 ? 'text-red-600' : ''}`}>{fmt(balance)}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-400">데이터 없음</td></tr>
          )}
        </tbody>
        <tfoot className="bg-gray-50 font-bold text-sm">
          <tr>
            <td className="px-4 py-2 text-gray-600">합계</td>
            <td className={`px-4 py-2 text-right tabular-nums ${total < 0 ? 'text-red-600' : ''}`}>{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
