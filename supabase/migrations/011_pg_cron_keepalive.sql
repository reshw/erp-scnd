-- pg_cron: Supabase 무료 티어 비활성 일시정지 방지
-- 매일 오전 9시(KST) = 00:00 UTC 에 DB 쿼리를 실행해 활성 상태 유지

create extension if not exists pg_cron;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'keepalive-ping',   -- job name (unique)
  '0 0 * * *',        -- 매일 00:00 UTC (= KST 09:00)
  $$ select count(*) from accounts limit 1 $$
);
