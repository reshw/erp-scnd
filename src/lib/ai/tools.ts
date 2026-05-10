import { FunctionDeclaration, SchemaType } from '@google/generative-ai'

const lineItemSchema = {
  type: SchemaType.OBJECT,
  properties: {
    account_id: {
      type: SchemaType.STRING,
      description: '계정과목 UUID — 목록에서 정확히 복사할 것, 절대 만들지 말 것',
    },
    account_name: {
      type: SchemaType.STRING,
      description: '계정과목 명',
    },
    debit: {
      type: SchemaType.NUMBER,
      description: '차변 금액. 대변 라인이면 0',
    },
    credit: {
      type: SchemaType.NUMBER,
      description: '대변 금액. 차변 라인이면 0',
    },
    classification: {
      type: SchemaType.STRING,
      description: 'increase_label 또는 decrease_label — 규칙에 따라 결정',
    },
    counterparty_name: {
      type: SchemaType.STRING,
      description: '거래처명 — 필수, 반드시 채울 것',
    },
    note: {
      type: SchemaType.STRING,
      description: '라인 적요 (선택)',
    },
  },
  required: ['account_id', 'account_name', 'debit', 'credit', 'classification', 'counterparty_name'],
}

const journalParamsSchema = {
  type: SchemaType.OBJECT,
  properties: {
    date: {
      type: SchemaType.STRING,
      description: '전표 날짜 YYYY-MM-DD',
    },
    description: {
      type: SchemaType.STRING,
      description: '전표 대표적요 — 필수, 반드시 채울 것',
    },
    project_id: {
      type: SchemaType.STRING,
      description: '프로젝트 UUID — 필수, 목록에서만 선택',
    },
    lines: {
      type: SchemaType.ARRAY,
      items: lineItemSchema as any,
      description: '전표 라인 목록',
    },
  },
  required: ['date', 'description', 'project_id', 'lines'],
}

export const journalTools: FunctionDeclaration[] = [
  {
    name: 'preview_journal',
    description:
      '전표 미리보기 카드를 생성합니다. 사용자에게 발행 전 내용을 확인받기 위해 호출합니다. DB에는 저장되지 않습니다.',
    parameters: journalParamsSchema as any,
  },
  {
    name: 'create_journal',
    description:
      '사용자가 확인한 전표를 DB에 저장합니다. 반드시 preview_journal 후 사용자 확인을 받은 경우에만 호출합니다.',
    parameters: journalParamsSchema as any,
  },
]
