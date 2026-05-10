type Line = {
  account_name: string
  debit: number
  credit: number
  classification: string
  counterparty_name?: string
  note?: string
}

export type PreviewData = {
  date: string
  description?: string | null
  project_id?: string | null
  project_code?: string | null
  lines: Line[]
}

export default function JournalPreviewCard({
  preview,
  journalNo,
}: {
  preview: PreviewData
  journalNo?: number | null
}) {
  const debitTotal = preview.lines.reduce((s, l) => s + (l.debit || 0), 0)
  const creditTotal = preview.lines.reduce((s, l) => s + (l.credit || 0), 0)
  const balanced = debitTotal === creditTotal
  const fmt = (n: number) => (n > 0 ? n.toLocaleString() : '')

  return (
    <div className="border rounded-lg overflow-hidden text-sm mt-2">
      <div
        className={`px-3 py-2 flex items-center justify-between border-b ${journalNo ? 'bg-green-50' : 'bg-gray-50'}`}
      >
        <span className={`font-medium ${journalNo ? 'text-green-700' : 'text-gray-700'}`}>
          {journalNo ? `전표 #${journalNo} 발행 완료 ✓` : '전표 미리보기'}
        </span>
        <span className="text-gray-500 text-xs flex items-center gap-2">
          {preview.project_code && (
            <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-xs font-medium">
              {preview.project_code}
            </span>
          )}
          {preview.date}
        </span>
      </div>
      {preview.description && (
        <div className="px-3 py-1 text-gray-600 border-b bg-white text-xs">{preview.description}</div>
      )}
      <table className="w-full bg-white">
        <thead>
          <tr className="bg-gray-50 text-gray-500 text-xs border-b">
            <th className="text-left px-3 py-1 font-normal">계정과목</th>
            <th className="text-left px-3 py-1 font-normal">거래처</th>
            <th className="text-right px-3 py-1 font-normal w-24">차변</th>
            <th className="text-right px-3 py-1 font-normal w-24">대변</th>
            <th className="text-left px-3 py-1 font-normal hidden sm:table-cell">분류</th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((l, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-1">{l.account_name}</td>
              <td className="px-3 py-1 text-gray-500 text-xs">{l.counterparty_name ?? ''}</td>
              <td className="px-3 py-1 text-right tabular-nums text-blue-700">{fmt(l.debit)}</td>
              <td className="px-3 py-1 text-right tabular-nums text-red-700">{fmt(l.credit)}</td>
              <td className="px-3 py-1 text-gray-400 text-xs hidden sm:table-cell">{l.classification}</td>
            </tr>
          ))}
          <tr className={`border-t font-medium text-xs ${balanced ? 'bg-gray-50' : 'bg-red-50'}`}>
            <td className="px-3 py-1 text-gray-500" colSpan={2}>합계</td>
            <td className="px-3 py-1 text-right tabular-nums">{debitTotal.toLocaleString()}</td>
            <td className={`px-3 py-1 text-right tabular-nums ${!balanced ? 'text-red-600 font-bold' : ''}`}>
              {creditTotal.toLocaleString()}
            </td>
            <td className="hidden sm:table-cell" />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
