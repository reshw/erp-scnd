-- =============================================
-- 보험료 계정과목 추가
-- '임대원가(보험료)'는 부동산 임대사업(JH계열) 소유자 배상책임 등 전용이라
-- 나디아요가처럼 임차인 입장에서 내는 보증보험 등 일반 영업 보험료와는 별개로 둔다.
-- =============================================

INSERT INTO accounts (name, activity_type, normal_side, increase_type, increase_label, decrease_type, decrease_label, note)
VALUES ('보험료', '영업', 'debit', '매입', '영업 - 매입', '매입취소', '영업 - 매입취소', '이행보증보험 등 일반 영업 보험료 (임대사업자용 임대원가(보험료)와 별개)')
ON CONFLICT (name) DO NOTHING;
