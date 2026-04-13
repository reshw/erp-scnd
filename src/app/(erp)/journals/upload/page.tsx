import UploadForm from './UploadForm'

export default function UploadPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-xl font-bold">전표 일괄 업로드</h2>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm space-y-1">
        <p className="font-medium text-blue-800">지원 형식: .xlsx / .csv</p>
        <p className="text-blue-700">첫 번째 시트의 아래 헤더를 인식합니다:</p>
        <code className="block bg-white border border-blue-200 rounded px-3 py-2 text-xs mt-2">
          전표번호 | 날짜 | 프로젝트 | 계정과목 | 차변 | 대변 | 거래처 | 적요
        </code>
        <ul className="text-blue-600 text-xs mt-2 space-y-0.5 list-disc list-inside">
          <li>분류는 계정과목 + 차변/대변 방향으로 자동 계산됩니다</li>
          <li>같은 전표번호끼리 하나의 전표로 묶입니다</li>
          <li>거래처는 없으면 자동 등록됩니다</li>
          <li>중복 전표번호는 오류 처리됩니다</li>
        </ul>
      </div>

      <UploadForm />
    </div>
  )
}
