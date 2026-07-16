import { createAdminClient } from '@/lib/supabase/admin'
import VatForm from './VatForm'

export default async function VatPage() {
  const supabase = createAdminClient()
  const { data: entities } = await (supabase as any)
    .from('entities')
    .select('id, name')
    .order('name') as { data: { id: string; name: string }[] | null }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">부가세 신고 자료</h2>
        <p className="text-sm text-gray-500 mt-1">
          갑지(요약) + 매입매출 명세 2개 시트가 포함된 엑셀 파일을 내려받습니다.
        </p>
      </div>

      <VatForm entities={entities ?? []} />

      <p className="text-xs text-gray-400">
        ※ 취소전표는 제외됩니다. 부가세 계정(부가세예수금/부가세대급금)이 없는 면세·해외결제
        지출은 매입세액 공제 대상에서 자동으로 빠집니다. 사업자를 선택하면 해당 사업자에
        매칭된 프로젝트의 전표만 집계됩니다 (미매칭 프로젝트 전표는 "전체 사업자 통합"에서만 잡힙니다).
      </p>
    </div>
  )
}
