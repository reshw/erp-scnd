export interface SettlementConfig {
  settlementType: 'date' | 'weekday'
  settlementDay: number | null
  settlementWeekday: number | null       // ISO: 1=월 ... 7=일
  settlementWeekOfMonth: number | null   // 1~5
}

function isoWeekday(d: Date): number {
  const day = d.getDay() // 0=일 ... 6=토
  return day === 0 ? 7 : day
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 매월 N번째 특정 요일 (달력상 단순 카운트: 1일이 해당 요일이면 그날이 1번째) */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month - 1, 1)
  const offset = (weekday - isoWeekday(first) + 7) % 7
  return new Date(year, month - 1, 1 + offset + (n - 1) * 7)
}

/** 토/일이면 다음 월요일로 이월 (공휴일 미반영) */
function rollForwardToBusinessDay(d: Date): Date {
  const r = new Date(d)
  while (isoWeekday(r) >= 6) r.setDate(r.getDate() + 1)
  return r
}

function settlementDateOf(year: number, month: number, config: SettlementConfig): Date {
  if (config.settlementType === 'weekday' && config.settlementWeekday && config.settlementWeekOfMonth) {
    return nthWeekdayOfMonth(year, month, config.settlementWeekday, config.settlementWeekOfMonth)
  }
  if (config.settlementType === 'date' && config.settlementDay) {
    const lastDay = new Date(year, month, 0).getDate()
    return new Date(year, month - 1, Math.min(config.settlementDay, lastDay))
  }
  // 미설정: 매월 말일 (기존 방식)
  return new Date(year, month, 0)
}

function isLegacyConfig(config: SettlementConfig): boolean {
  return config.settlementType === 'date' && !config.settlementDay
}

/**
 * calcMonth('YYYY-MM')이 속한 정산기간을 계산.
 * - from~to: 이자 계산 기간 (전월 기산일 다음날 ~ 이번달 기산일, 기산일 당일 포함)
 * - chargeDate: 이자 부과일(전표 날짜). 기산일이 주말이면 익영업일로 이월
 * 기산일이 설정되지 않은 경우 기존 동작(해당 월 1일~말일, 말일 부과)을 그대로 유지한다.
 */
export function computeSettlementPeriod(
  year: number, month: number, config: SettlementConfig,
): { from: string; to: string; chargeDate: string } {
  const to = settlementDateOf(year, month, config)

  if (isLegacyConfig(config)) {
    return {
      from: toDateStr(new Date(year, month - 1, 1)),
      to: toDateStr(to),
      chargeDate: toDateStr(to),
    }
  }

  const prevMonthDate = new Date(year, month - 2, 1)
  const prevTo = settlementDateOf(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, config)
  const from = new Date(prevTo)
  from.setDate(from.getDate() + 1)

  return {
    from: toDateStr(from),
    to: toDateStr(to),
    chargeDate: toDateStr(rollForwardToBusinessDay(to)),
  }
}

export const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']
export const WEEK_OF_MONTH_LABELS = ['첫번째', '두번째', '세번째', '네번째', '다섯번째']
