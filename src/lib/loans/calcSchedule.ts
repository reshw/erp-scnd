export type Prepayment = {
  id: string
  date: string
  amount: number
  note: string | null
  journal_id: string | null
}

export type ScheduleRow = {
  month: string
  payDate: string   // 실제 납부일 YYYY-MM-DD (spending_executions.planned_date 용)
  payment: number
  interest: number
  repayment: number
  balance: number
  partial?: boolean
  days?: number
  prepayment?: Prepayment
}

type RoundMode = 'round' | 'floor' | 'ceil'

function applyRound(x: number, mode: RoundMode): number {
  if (mode === 'ceil')  return Math.ceil(x)
  if (mode === 'floor') return Math.floor(x)
  return Math.round(x)
}

/**
 * 대출 상환 스케줄 계산 (중도상환 포함)
 * loanType: 원리금균등 | 원금균등 | 만기일시
 * interestCalc: monthly | daily_30 | daily_actual
 * interestRound: round(반올림) | floor(버림) | ceil(올림)  — 이자 계산 끝수 처리
 */
export function calcSchedule(
  principal: number,
  annualRate: number,
  startDate: string,
  endDate: string,
  loanType: string = '원리금균등',
  interestCalc: string = 'monthly',
  firstMonthPartial: boolean = true,
  paymentDay: number | null = null,
  prepayments: Prepayment[] = [],
  pmtFloor: boolean = false,
  interestRound: RoundMode = 'round',
): ScheduleRow[] {
  const start = new Date(startDate)
  const end   = new Date(endDate)
  const pDay  = paymentDay ?? start.getDate()

  const rows: ScheduleRow[] = []
  let balance = principal
  const startDay = start.getDate()
  const hasPartial = firstMonthPartial && startDay !== pDay

  // 첫 정상 납부일 결정
  let firstPayDate: Date
  if (startDay !== pDay) {
    firstPayDate = pDay > startDay
      ? new Date(start.getFullYear(), start.getMonth(), pDay)
      : new Date(start.getFullYear(), start.getMonth() + 1, pDay)
  } else {
    firstPayDate = new Date(start.getFullYear(), start.getMonth() + 1, pDay)
  }

  // n = 납부 횟수
  const n = (end.getFullYear() - firstPayDate.getFullYear()) * 12
           + (end.getMonth()   - firstPayDate.getMonth())
           + (hasPartial ? 0 : 1)
  if (n <= 0) return []

  const r = annualRate / 12
  const pmtRaw = r === 0 ? principal / n : principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
  const pmt = loanType === '원리금균등'
    ? (pmtFloor ? Math.floor(pmtRaw / 10) * 10 : Math.trunc(pmtRaw))
    : 0
  const fixedRepayment = loanType === '원금균등' ? Math.round(principal / n) : 0

  const prepQueue = [...prepayments].sort((a, b) => a.date.localeCompare(b.date))
  let prevDate = new Date(start)

  function toYMD(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // 일할이자 선납 행
  if (hasPartial) {
    const stubDays = Math.round((firstPayDate.getTime() - start.getTime()) / 86400000)
    const stubInterest = applyRound(principal * annualRate / 365 * stubDays, interestRound)
    const stubMonth = `${firstPayDate.getFullYear()}-${String(firstPayDate.getMonth() + 1).padStart(2, '0')}`
    rows.push({ month: stubMonth, payDate: toYMD(firstPayDate), payment: stubInterest, interest: stubInterest, repayment: 0, balance: principal, partial: true })
    prevDate = firstPayDate
  }

  function payDateFromFirst(offset: number): Date {
    const y = firstPayDate.getFullYear()
    const m = firstPayDate.getMonth() + offset
    const lastDay = new Date(y, m + 1, 0).getDate()
    return new Date(y, m, Math.min(pDay, lastDay))
  }

  const loopOffset = hasPartial ? 1 : 0

  for (let i = 0; i < n; i++) {
    const d = payDateFromFirst(i + loopOffset)

    while (prepQueue.length > 0 && prepQueue[0].date < d.toISOString().slice(0, 10)) {
      const pp = prepQueue.shift()!
      balance = Math.max(0, balance - pp.amount)
      rows.push({ month: pp.date.slice(0, 7), payDate: pp.date, payment: pp.amount, interest: 0, repayment: pp.amount, balance, prepayment: pp })
    }

    if (balance <= 0) break

    const isLast = i === n - 1
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    let interest: number, days: number | undefined
    if (interestCalc === 'daily_30') {
      days = 30
      interest = applyRound(balance * annualRate / 365 * 30, interestRound)
    } else if (interestCalc === 'daily_actual') {
      days = Math.round((d.getTime() - prevDate.getTime()) / 86400000)
      interest = applyRound(balance * annualRate / 365 * days, interestRound)
    } else {
      interest = applyRound(balance * annualRate / 12, interestRound)
    }

    let repayment: number, payment: number
    if (loanType === '만기일시') {
      repayment = isLast ? balance : 0
      payment   = interest + repayment
    } else if (loanType === '원금균등') {
      repayment = isLast ? balance : Math.min(fixedRepayment, balance)
      payment   = interest + repayment
    } else {
      repayment = Math.min(pmt - interest, balance)
      payment   = interest + repayment
    }

    balance = Math.max(0, balance - repayment)
    rows.push({ month, payDate: toYMD(d), payment, interest, repayment, balance, days })
    prevDate = d
    if (balance === 0) break
  }

  return rows
}
