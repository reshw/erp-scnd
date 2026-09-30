// timetable(나디아요가) payout-forecast API — 이번 달 대관료·강사료 지급예정액.
// 월 중엔 대관료(익월 초 전표)와 강사료(익월 10일경 지급 시 전표)가 아직 장부에 없어서 가용잔액이
// 실제보다 높게 나오는 문제를 메우려는 추정치다. 호출 시점 기준으로 timetable이 매번 즉시 재계산해
// 주는 pull API라 ERP는 저장하지 않고 화면 렌더 때 조회한다(짧은 서버 캐시만).
// 협의 기록: _shared/inbox/_archive/erp/from-timetable__260930-payout-forecast-reply.md

const API_URL = process.env.TIMETABLE_PAYOUT_FORECAST_API_URL ?? 'https://nadia.mdl.kr/api/erp/payout-forecast'
const CACHE_SECONDS = 600
const TIMEOUT_MS = 5000

export interface PayoutForecast {
  month: string
  venue_fee: {
    rent_supply_amount: number
    rent_vat_amount: number
    rent_total_amount: number
    pending_refund_from_prior_month: number
  }
  instructor_fees: {
    name: string
    rate_set: boolean
    gross_fee: number | null
  }[]
}

/** 실패(토큰 없음·네트워크·비정상 응답)는 null — 호출부는 예상 항목만 숨기고 공식 수치는 그대로 보여준다. */
export async function fetchPayoutForecast(month: string): Promise<PayoutForecast | null> {
  const token = process.env.ERP_PAYMENTS_PULL_TOKEN
  if (!token) return null
  try {
    const res = await fetch(`${API_URL}?month=${encodeURIComponent(month)}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = await res.json()
    if (!json?.venue_fee || !Array.isArray(json.instructor_fees)) return null
    return json as PayoutForecast
  } catch {
    return null
  }
}
