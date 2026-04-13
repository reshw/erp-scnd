'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'

type Account = {
  id: string
  name: string
  activity_type: string
  normal_side: string
  increase_label: string
  decrease_label: string
  is_active: boolean
}

const ACTIVITY_COLOR: Record<string, string> = {
  현금: 'bg-blue-100 text-blue-700',
  영업: 'bg-green-100 text-green-700',
  재무: 'bg-purple-100 text-purple-700',
  투자: 'bg-orange-100 text-orange-700',
  개인: 'bg-gray-100 text-gray-700',
  세무: 'bg-red-100 text-red-700',
}

export default function AccountsClient({ accounts: initial }: { accounts: Account[] }) {
  const router = useRouter()
  const [accounts, setAccounts] = useState(initial)
  const [loading, setLoading] = useState<string | null>(null)

  async function toggleActive(id: string, current: boolean) {
    setLoading(id)
    const res = await fetch('/api/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !current }),
    })
    if (res.ok) {
      setAccounts(prev => prev.map(a => a.id === id ? { ...a, is_active: !current } : a))
      router.refresh()
    }
    setLoading(null)
  }

  const grouped = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    if (!acc[a.activity_type]) acc[a.activity_type] = []
    acc[a.activity_type].push(a)
    return acc
  }, {})

  const activeCount = accounts.filter(a => a.is_active).length

  return (
    <>
      <div className="text-sm text-gray-500">{activeCount}개 활성 / 전체 {accounts.length}개</div>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="w-24">활동구분</TableHead>
              <TableHead>계정과목</TableHead>
              <TableHead className="w-20">방향</TableHead>
              <TableHead className="w-24">증가 유형</TableHead>
              <TableHead className="w-24">감소 유형</TableHead>
              <TableHead className="w-24 text-center">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(grouped).map(([type, items]) =>
              items.map((a, i) => (
                <TableRow key={a.id} className={`${!a.is_active ? 'opacity-40' : ''} hover:bg-gray-50`}>
                  {i === 0 && (
                    <TableCell
                      rowSpan={items.length}
                      className="border-r align-middle"
                    >
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${ACTIVITY_COLOR[type] ?? 'bg-gray-100'}`}>
                        {type}
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="font-medium text-sm">{a.name}</TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {a.normal_side === 'debit' ? '차변' : '대변'}
                  </TableCell>
                  <TableCell className="text-sm">{a.increase_label}</TableCell>
                  <TableCell className="text-sm">{a.decrease_label}</TableCell>
                  <TableCell className="text-center">
                    <Button
                      size="sm"
                      variant={a.is_active ? 'outline' : 'ghost'}
                      className={`text-xs h-7 ${a.is_active ? '' : 'text-gray-400'}`}
                      disabled={loading === a.id}
                      onClick={() => toggleActive(a.id, a.is_active)}
                    >
                      {loading === a.id ? '...' : a.is_active ? '활성' : '비활성'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
