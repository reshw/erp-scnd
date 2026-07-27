-- =============================================
-- 현금(시재) 계정과목 — toss/CASH·cash/cash 채널 자동전표용
-- 카드사 정산을 거치는 게 아니라 매장에서 즉시 현금으로 받는 결제라 미수금이 아니라
-- 현금 자산으로 바로 잡는다. 은행 입금(보통예금 이체)은 별도 수기 전표로 처리한다.
-- =============================================
INSERT INTO accounts (name, activity_type, normal_side, increase_type, increase_label, decrease_type, decrease_label, note)
VALUES ('현금', '현금', 'debit', '입금', '현금 - 입금', '출금', '현금 - 출금', '매장 시재 현금, 통장 입금 전까지')
ON CONFLICT (name) DO NOTHING;
