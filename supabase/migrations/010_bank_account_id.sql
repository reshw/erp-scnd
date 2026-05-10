-- loans, spending_plans에 출금 통장 컬럼 추가
ALTER TABLE loans          ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES bank_accounts(id);
ALTER TABLE spending_plans ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES bank_accounts(id);
