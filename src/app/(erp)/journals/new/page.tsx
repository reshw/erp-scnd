import { createAdminClient } from '@/lib/supabase/admin'
import JournalForm from '@/components/journal/JournalForm'

export default async function NewJournalPage({
  searchParams,
}: {
  searchParams: Promise<{
    copy?: string; loanId?: string; loanMonth?: string; repayment?: string; interest?: string
    overdraftInterest?: string; date?: string; from?: string; to?: string
    projectId?: string; label?: string
  }>
}) {
  const { copy, loanId, loanMonth, repayment, interest, overdraftInterest, date, from, to, projectId, label } = await searchParams
  const supabase = createAdminClient()

  const [{ data: accounts }, { data: projects }, { data: counterparties }] = await Promise.all([
    supabase.from('accounts').select('id,name,activity_type,normal_side,increase_label,decrease_label').eq('is_active', true).order('name'),
    supabase.from('projects').select('id,code').eq('is_active', true).order('code'),
    supabase.from('counterparties').select('id,name').order('name'),
  ])

  const { data: lastJournal } = await (supabase as any)
    .from('journals')
    .select('journal_no')
    .order('journal_no', { ascending: false })
    .limit(1)
    .single() as { data: { journal_no: number } | null }

  const nextNo = (lastJournal?.journal_no ?? 0) + 1
  const accountList = (accounts ?? []) as any[]

  // ── 전표 복사 ──────────────────────────────────────────
  let copyValues: any = undefined
  if (copy) {
    const { data: src } = await (supabase as any)
      .from('journals')
      .select(`id, date, project_id, description,
        journal_lines(account_id, classification, debit, credit, counterparty_id, counterparty_name, note, accounts(name))`)
      .eq('id', copy)
      .single() as any

    if (src) {
      copyValues = {
        date: new Date().toISOString().slice(0, 10),
        project_id: src.project_id ?? '',
        description: src.description ?? '',
        lines: (src.journal_lines ?? []).map((l: any) => ({
          account_id:        l.account_id,
          account_name:      l.accounts?.name ?? '',
          classification:    l.classification ?? '',
          debit:             l.debit > 0 ? String(l.debit) : '',
          credit:            l.credit > 0 ? String(l.credit) : '',
          counterparty_id:   l.counterparty_id ?? '',
          counterparty_name: l.counterparty_name ?? '',
          note:              l.note ?? '',
        })),
      }
    }
  }

  // ── 대출 전표 자동완성 ────────────────────────────────
  let loanValues: any = undefined
  if (loanId && loanMonth && repayment && interest) {
    const repayAmt = Math.round(Number(repayment))
    const interestAmt = Math.round(Number(interest))
    const totalAmt = repayAmt + interestAmt

    // 필요한 계정과목 찾기
    const accLongDebt   = accountList.find(a => a.name === '장기차입금')
    const accInterest   = accountList.find(a => a.name === '이자비용')
    const accBank       = accountList.find(a => a.name === '보통예금')

    // 대출 정보 (거래처, 프로젝트)
    const { data: loan } = await (supabase as any)
      .from('loans')
      .select('name, project_id, counterparties(id, name)')
      .eq('id', loanId)
      .single() as any

    // 날짜: 해당 월 말일
    const [y, m] = loanMonth.split('-').map(Number)
    const payDate = new Date(y, m, 0).toISOString().slice(0, 10)

    const lines = []

    if (accLongDebt) {
      lines.push({
        account_id:        accLongDebt.id,
        account_name:      accLongDebt.name,
        classification:    accLongDebt.decrease_label,
        debit:             String(repayAmt),
        credit:            '',
        counterparty_id:   loan?.counterparties?.id ?? '',
        counterparty_name: loan?.counterparties?.name ?? '',
        note:              `${loanMonth} 원금상환`,
      })
    }

    if (accInterest) {
      lines.push({
        account_id:        accInterest.id,
        account_name:      accInterest.name,
        classification:    accInterest.increase_label,
        debit:             String(interestAmt),
        credit:            '',
        counterparty_id:   loan?.counterparties?.id ?? '',
        counterparty_name: loan?.counterparties?.name ?? '',
        note:              `${loanMonth} 이자`,
      })
    }

    if (accBank) {
      lines.push({
        account_id:        accBank.id,
        account_name:      accBank.name,
        classification:    accBank.decrease_label,
        debit:             '',
        credit:            String(totalAmt),
        counterparty_id:   loan?.counterparties?.id ?? '',
        counterparty_name: loan?.counterparties?.name ?? '',
        note:              `${loanMonth} 대출상환`,
      })
    }

    if (lines.length > 0) {
      loanValues = {
        date: payDate,
        project_id: loan?.project_id ?? '',
        description: `${loan?.name ?? ''} ${loanMonth} 상환`,
        lines,
      }
    }
  }

  // ── 마통 이자 전표 자동완성 ──────────────────────────
  let overdraftValues: any = undefined
  if (loanId && loanMonth && overdraftInterest && date) {
    const interestAmt = Math.round(Number(overdraftInterest))

    const { data: loan } = await (supabase as any)
      .from('loans')
      .select('name, project_id, account_id, counterparties(id, name)')
      .eq('id', loanId)
      .single() as any

    const accInterest = accountList.find(a => a.name === '이자비용')
    // 이자는 마통 잔액에 가산되므로 대변은 잔액 추적 계정 (예: 장기차입금)
    const accTracking = accountList.find(a => a.id === loan?.account_id)

    const note = `마통 이자 ${loanMonth}${label ? ` ${label}` : ''}${from && to ? ` (${from}~${to})` : ''}`
    const lines = []

    if (accInterest) {
      lines.push({
        account_id:        accInterest.id,
        account_name:      accInterest.name,
        classification:    accInterest.increase_label,
        debit:             String(interestAmt),
        credit:            '',
        counterparty_id:   loan?.counterparties?.id ?? '',
        counterparty_name: loan?.counterparties?.name ?? '',
        note,
      })
    }

    if (accTracking) {
      lines.push({
        account_id:        accTracking.id,
        account_name:      accTracking.name,
        classification:    accTracking.increase_label,
        debit:             '',
        credit:            String(interestAmt),
        counterparty_id:   loan?.counterparties?.id ?? '',
        counterparty_name: loan?.counterparties?.name ?? '',
        note:              `${note} — 대출잔액 증가`,
      })
    }

    if (lines.length > 0) {
      overdraftValues = {
        date,
        project_id: projectId ?? loan?.project_id ?? '',
        description: `${loan?.name ?? '마통'} 이자 ${loanMonth}${label ? ` — ${label}` : ''}`,
        lines,
      }
    }
  }

  const preValues = overdraftValues ?? loanValues ?? copyValues

  return (
    <div className="max-w-4xl space-y-4">
      <h2 className="text-xl font-bold">
        {overdraftValues ? `전표 발행 — 마통 이자 ${loanMonth}`
          : loanValues ? `전표 발행 — 대출상환 ${loanMonth}`
          : copy && copyValues ? '전표 입력 (복사)' : '전표 입력'}
      </h2>
      {(loanValues || overdraftValues) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-800">
          내용을 확인하고 수정한 뒤 저장하세요. 계정과목이나 금액이 다르면 직접 수정 가능합니다.
        </div>
      )}
      <JournalForm
        nextNo={nextNo}
        accounts={accountList as any}
        projects={(projects ?? []) as any}
        counterparties={(counterparties ?? []) as any}
        copyValues={preValues}
      />
    </div>
  )
}
