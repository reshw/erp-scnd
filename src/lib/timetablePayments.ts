/**
 * 채널 → 차변 계정. 카드·PG는 카드사 정산 전까지 미수금으로 잡고, 현금은 정산 지연이
 * 없어 바로 현금 자산으로 잡는다. sync 라우트와 정산대사 화면(/receivables)이 공유한다.
 * 값이 null이면 자동전표 대상이 아니라는 뜻.
 */
export function receivableAccountName(source: string, method: string | null): string | null {
  switch (source) {
    case 'toss':
      // POS 현장결제. EXTERNAL(외부단말)은 어느 채널로 정산될지 알 수 없어 수동처리한다.
      if (method === 'EXTERNAL') return null
      return method === 'CASH' ? '현금' : '미수금(신용카드)'
    case 'card':
      return '미수금(신용카드)'
    case 'portone':
    case 'kakaopay':
      return '미수금(PG)'
    case 'bank':
      return '미수금(무통장입금)'
    case 'cash':
      return '현금'
    default:
      return null
  }
}

export const RECEIVABLE_ACCOUNT_NAMES = ['미수금(신용카드)', '미수금(무통장입금)', '미수금(PG)', '현금']
