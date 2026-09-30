/**
 * 리포트 툴 — 잔액/손익 계산은 여기서 새로 짜지 않고 웹 화면과 같은 코드
 * (src/lib/reports/projectDashboard.ts)를 그대로 호출한다. 화면과 AI가 다른 숫자를
 * 말하는 순간 둘 다 못 믿게 되므로, 계산 로직은 한 곳에만 있어야 한다.
 */
import { z } from 'zod'
import { supabase, resolveProject, won, pad } from '../db.ts'
import {
  getProjectDashboardData,
  getProjectLedgerData,
  PL_EXCLUDE_SUBTYPES,
  monthEnd,
} from '../../lib/reports/projectDashboard.ts'

const signed = (n: number) => `${n < 0 ? '−' : ''}${won(Math.abs(n))}`

export const cashflowTool = {
  name: 'erp_available_cashflow',
  config: {
    description:
      '프로젝트의 실질 운영 가능 자금. 보통예금+현금에서 부가세 순채무·대표자 관련 순채무·미지급금(매입)을 뺀 "가용잔액"과, 미수금이 전부 들어왔을 때의 "예정잔고"를 낸다. ERP 웹의 잔액/손익 화면과 같은 계산이라 숫자가 일치한다. "지금 얼마 쓸 수 있어?" 류 질문에 쓴다.',
    inputSchema: {
      project: z.string().describe('프로젝트 코드 (예: NADIA)'),
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .describe('YYYY-MM. 생략하면 이번 달. 기준일은 이번 달이면 오늘, 지난 달이면 그 달 말일로 자동 결정된다.'),
    },
  },
  async handler({ project, month }: { project: string; month?: string }) {
    const p = await resolveProject(project)
    const d = await getProjectDashboardData(supabase, p.id, month)

    const bank = Object.entries(d.bankBalance)
      .filter(([, v]) => v !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([k, v]) => `    ${pad(k, 22)} ${pad(signed(v), 14, 'right')}`)

    return [
      `[${p.code}] ${d.monthKey} 기준 (기준일 ${d.asOfDate}${d.isCurrentMonth ? ', 진행 중인 달' : ''})`,
      '',
      `  보통예금 합계        ${pad(signed(d.bankTotal), 14, 'right')}`,
      ...bank,
      `  현금                 ${pad(signed(d.cashTotal), 14, 'right')}`,
      `  − 부가세 순채무      ${pad(signed(d.vatPayable), 14, 'right')}  (부가세예수금 − 부가세대급금)`,
      `  − 대표자 순채무      ${pad(signed(d.founderPayable), 14, 'right')}  (가수금(대표이사) − 인출금, 양석환)`,
      `  − 미지급금(매입)     ${pad(signed(d.apPayable), 14, 'right')}`,
      `  ─────────────────────────────────`,
      `  가용잔액             ${pad(signed(d.availableBalance), 14, 'right')}  ← 지금 실제로 쓸 수 있는 돈`,
      `  + 미수금             ${pad(signed(d.receivablesTotal), 14, 'right')}  (신용카드/무통장입금/PG)`,
      `  예정잔고             ${pad(signed(d.projectedBalance), 14, 'right')}  ← 미수금이 다 들어왔을 때`,
      ...(d.payoutForecast
        ? [
            '',
            `  − 대관료 예정        ${pad(signed(d.payoutForecast.venueTotal), 14, 'right')}  (전표 전, 부가세 포함 — timetable 산정)`,
            `  + 대관료 부가세      ${pad(signed(d.payoutForecast.venueVat), 14, 'right')}  (대급금으로 잡혀 부가세 납부액이 줄어드는 몫)`,
            `  − 강사료 예정        ${pad(signed(d.payoutForecast.instructorTotal), 14, 'right')}  (지급 전, 세전)`,
            `  예상 가용잔액        ${pad(signed(d.payoutForecast.expectedAvailable), 14, 'right')}  ← 지급예정 반영한 추정치`,
          ]
        : []),
      '',
      d.balanceRows.length
        ? '미결잔액\n' + d.balanceRows.map((r) => `  ${pad(r.name, 22)} ${pad(signed(r.balance), 14, 'right')}`).join('\n')
        : '미결잔액 없음',
    ].join('\n')
  },
}

export const pnlTool = {
  name: 'erp_monthly_pnl',
  config: {
    description:
      '프로젝트의 월 손익(매출/비용, 부가세 포함·제외 양쪽). monthly_cashflow 뷰를 쓰되 미수/회수/선급/예수/정산 같은 잔액성 subtype을 반드시 제외해 계산한다 — 이걸 빼먹어 매출·비용이 부풀려진 버그가 실제로 있었다(수정 a246a0d). detail을 주면 전표 단위 명세까지 같이 낸다.',
    inputSchema: {
      project: z.string().describe('프로젝트 코드 (예: NADIA)'),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('YYYY-MM. 생략하면 이번 달'),
      detail: z.enum(['none', 'revenue', 'expense']).optional().describe('전표 단위 명세를 볼 항목. 기본 none'),
    },
  },
  async handler({ project, month, detail = 'none' }: { project: string; month?: string; detail?: string }) {
    const p = await resolveProject(project)
    const d = await getProjectDashboardData(supabase, p.id, month)

    // 헤드라인은 대시보드와 같은 값. 여기에 활동유형별 내역을 붙여 어디서 나온 숫자인지 보이게 한다.
    const { data: rows } = await supabase
      .from('monthly_cashflow')
      .select('activity_type, activity_subtype, total_debit, total_credit')
      .eq('project_id', p.id)
      .eq('month', `${d.monthKey}-01`)

    const included: string[] = []
    const excluded: string[] = []
    for (const r of (rows ?? []) as any[]) {
      const line = `  ${pad(r.activity_type, 6)} ${pad(r.activity_subtype || '(빈값)', 12)} 차 ${pad(won(r.total_debit), 13, 'right')}  대 ${pad(won(r.total_credit), 13, 'right')}`
      if (r.activity_type !== '영업' || PL_EXCLUDE_SUBTYPES.has(r.activity_subtype)) excluded.push(line)
      else included.push(line)
    }

    const out = [
      `[${p.code}] ${d.monthKey} 손익 (${d.monthKey}-01 ~ ${monthEnd(d.monthKey)}${d.isCurrentMonth ? ', 진행 중' : ''})`,
      '',
      `  매출(순액)   ${pad(won(d.revenue), 14, 'right')}   + 부가세예수금 ${pad(won(d.vat), 12, 'right')}  = 총액 ${won(d.revenueGross)}`,
      `  비용(순액)   ${pad(won(d.opex), 14, 'right')}   + 부가세대급금 ${pad(won(d.vatInput), 12, 'right')}  = 총액 ${won(d.opexGross)}`,
      `  ─────────────────────────────────`,
      `  영업이익(순액 기준) ${pad(signed(d.revenue - d.opex), 14, 'right')}`,
      '',
      '손익에 집계된 활동 (영업, 잔액성 subtype 제외)',
      included.length ? included.join('\n') : '  (없음)',
    ]
    if (excluded.length) {
      out.push('', '손익에서 제외된 활동 (잔액성 계정 — 미수/회수/선급/예수/정산 등)', excluded.join('\n'))
    }

    if (detail !== 'none') {
      const l = await getProjectLedgerData(supabase, p.id, detail as 'revenue' | 'expense', d.monthKey)
      out.push(
        '',
        `── ${detail === 'revenue' ? '매출' : '비용'} 전표 명세 (${l.rows.length}건) ──`,
        `${pad('일자', 12)} ${pad('#', 6)} ${pad('계정', 18)} ${pad('순액', 12, 'right')} ${pad('부가세', 10, 'right')} ${pad('총액', 12, 'right')}  적요`,
        ...l.rows.map(
          (r) =>
            `${pad(r.date, 12)} ${pad(`#${r.journalNo}`, 6)} ${pad(r.account, 18)} ${pad(won(r.net), 12, 'right')} ${pad(won(r.vat), 10, 'right')} ${pad(won(r.gross), 12, 'right')}  ${r.label}`,
        ),
        `${pad('합계', 38)} ${pad(won(l.totalNet), 12, 'right')} ${pad(won(l.totalVat), 10, 'right')} ${pad(won(l.totalGross), 12, 'right')}`,
      )
    }
    return out.join('\n')
  },
}

export const reportTools = [cashflowTool, pnlTool]
