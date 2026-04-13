import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(n)
}

export default async function LoansPage() {
  const supabase = createAdminClient()
  const { data: loans } = await (supabase as any)
    .from('loans')
    .select('*, counterparties(name), projects(code)')
    .order('created_at', { ascending: false }) as any

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">대출 관리</h2>
        <Link href="/loans/new">
          <Button size="sm">+ 대출 등록</Button>
        </Link>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="text-left px-4 py-3">대출명</th>
              <th className="text-left px-4 py-3">거래처</th>
              <th className="text-left px-4 py-3">프로젝트</th>
              <th className="text-right px-4 py-3">원금</th>
              <th className="text-right px-4 py-3">금리(%)</th>
              <th className="text-left px-4 py-3">시작일</th>
              <th className="text-left px-4 py-3">종료일</th>
              <th className="text-left px-4 py-3">유형</th>
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(loans ?? []).map((loan: any) => (
              <tr key={loan.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/loans/${loan.id}`} className="text-blue-600 hover:underline">
                    {loan.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600">{loan.counterparties?.name ?? '-'}</td>
                <td className="px-4 py-3 text-gray-600">{loan.projects?.code ?? '-'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(loan.principal)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{(Number(loan.interest_rate) * 100).toFixed(2)}</td>
                <td className="px-4 py-3">{loan.start_date}</td>
                <td className="px-4 py-3">{loan.end_date}</td>
                <td className="px-4 py-3">{loan.loan_type}</td>
                <td className="px-4 py-3">
                  <Link href={`/loans/${loan.id}`}>
                    <Button size="sm" variant="outline">스케줄</Button>
                  </Link>
                </td>
              </tr>
            ))}
            {(loans ?? []).length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">등록된 대출이 없습니다</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
