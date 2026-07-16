-- 대출 금리 변동 이력 (마이너스통장 일별 이자 계산에 반영)

CREATE TABLE IF NOT EXISTS loan_rate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  annual_rate numeric NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, effective_date)
);

COMMENT ON TABLE loan_rate_history IS '금리 변동 이력. effective_date 당일부터 annual_rate 적용. 첫 변동일 이전 기간은 loans.interest_rate 사용';
COMMENT ON COLUMN loan_rate_history.annual_rate IS '연이율 소수 표기 (5.55% = 0.0555)';
