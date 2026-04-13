"""
현금출납 엑셀 → Supabase 임포트 스크립트
실행: python scripts/import_excel.py
"""

import openpyxl
import requests
import re
import sys
from datetime import datetime, date

# ── 설정 ─────────────────────────────────────────────
SUPABASE_URL = "https://akdltdkcdkbutxtgxirp.supabase.co"
EXCEL_PATH   = "erp_dadada.xlsx"
def load_env():
    env = {}
    for fname in (".env", ".env.local"):
        try:
            with open(fname, encoding="utf-8") as f:
                for line in f:
                    m = re.match(r"([^=]+)=(.+)", line.strip())
                    if m:
                        env[m.group(1).strip()] = m.group(2).strip()
        except FileNotFoundError:
            pass
    key = env.get("SUPABASE_SECRET_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        sys.exit("❌ SUPABASE_SECRET_KEY를 .env.local에 추가해주세요.")
    return key

KEY = load_env()
HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

def get(table, params=""):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}?{params}", headers=HEADERS)
    r.raise_for_status()
    return r.json()

def post(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", json=data, headers=HEADERS)
    r.raise_for_status()
    return r.json()

def upsert(table, data, on_conflict):
    h = {**HEADERS, "Prefer": "resolution=ignore-duplicates,return=representation"}
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}",
        json=data, headers=h
    )
    r.raise_for_status()
    return r.json()

# ── 마스터 데이터 로드 ────────────────────────────────
print("📥 마스터 데이터 로드 중...")
accounts_list   = get("accounts", "select=id,name")
projects_list   = get("projects", "select=id,code")

account_map = {a["name"]: a["id"] for a in accounts_list}
project_map = {p["code"]: p["id"] for p in projects_list}

print(f"   계정과목 {len(account_map)}개, 프로젝트 {len(project_map)}개")

# ── 엑셀 읽기 ─────────────────────────────────────────
print("📂 엑셀 읽는 중...")
wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb["현금출납"]

rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    journal_no, dt, classification, entity, project, account_name, debit, credit, counterparty_name, note = \
        row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]

    # 헤더나 빈 행 스킵
    if journal_no is None or classification is None:
        continue
    if not isinstance(journal_no, (int, float)):
        continue

    # 날짜 변환
    if isinstance(dt, datetime):
        row_date = dt.date().isoformat()
    elif isinstance(dt, date):
        row_date = dt.isoformat()
    else:
        continue

    rows.append({
        "journal_no":       int(journal_no),
        "date":             row_date,
        "classification":   str(classification).strip(),
        "entity":           str(entity).strip() if entity else None,
        "project_code":     str(project).strip() if project else None,
        "account_name":     str(account_name).strip() if account_name else None,
        "debit":            int(debit)  if debit  else 0,
        "credit":           int(credit) if credit else 0,
        "counterparty_name": str(counterparty_name).strip() if counterparty_name else None,
        "note":             str(note).strip() if note else None,
    })

print(f"   총 {len(rows)}행 읽음")

# ── 거래처 등록 (기존 조회 후 신규만 insert) ──────────
print("거래처 등록 중...")
existing_cp   = get("counterparties", "select=id,name")
existing_names = {c["name"] for c in existing_cp}
cp_map         = {c["name"]: c["id"] for c in existing_cp}

new_cp_names = sorted({r["counterparty_name"] for r in rows if r["counterparty_name"]} - existing_names)
if new_cp_names:
    inserted = post("counterparties", [{"name": n} for n in new_cp_names])
    for c in inserted:
        cp_map[c["name"]] = c["id"]

print(f"   거래처 총 {len(cp_map)}개 (신규 {len(new_cp_names)}개)")

# ── 전표 그룹핑 ───────────────────────────────────────
from collections import defaultdict
journal_groups = defaultdict(list)
for r in rows:
    journal_groups[(r["journal_no"], r["date"])].append(r)

print(f"📋 전표 {len(journal_groups)}건 처리 중...")

ok_count  = 0
err_count = 0
missing_accounts = set()

for (journal_no, date_str), lines in sorted(journal_groups.items()):
    # 프로젝트 ID
    project_code = next((l["project_code"] for l in lines if l["project_code"]), None)
    project_id   = project_map.get(project_code) if project_code else None

    # 대표 적요
    description = next((l["note"] for l in lines if l["note"]), None)

    # 전표 헤더 insert
    try:
        journal_res = post("journals", {
            "journal_no":  journal_no,
            "date":        date_str,
            "description": description,
            "project_id":  project_id,
        })
        journal_id = journal_res[0]["id"]
    except Exception as e:
        print(f"   ⚠️  전표 {journal_no} ({date_str}) 스킵: {e}")
        err_count += 1
        continue

    # 전표 명세 insert
    line_data = []
    for l in lines:
        account_id = account_map.get(l["account_name"])
        if not account_id:
            missing_accounts.add(l["account_name"])
            continue

        # classification 파싱: "현금 - 입금" → activity_type=현금, activity_subtype=입금
        parts = l["classification"].split(" - ", 1)
        activity_type    = parts[0].strip() if len(parts) > 0 else ""
        activity_subtype = parts[1].strip() if len(parts) > 1 else ""

        line_data.append({
            "journal_id":       journal_id,
            "date":             l["date"],
            "classification":   l["classification"],
            "activity_type":    activity_type,
            "activity_subtype": activity_subtype,
            "account_id":       account_id,
            "debit":            l["debit"],
            "credit":           l["credit"],
            "counterparty_id":  cp_map.get(l["counterparty_name"]) if l["counterparty_name"] else None,
            "counterparty_name": l["counterparty_name"],
            "note":             l["note"],
        })

    if line_data:
        try:
            post("journal_lines", line_data)
            ok_count += 1
        except Exception as e:
            print(f"   ❌ 전표 {journal_no} 명세 오류: {e}")
            err_count += 1

# ── 결과 ─────────────────────────────────────────────
print(f"\n✅ 완료: {ok_count}건 성공 / {err_count}건 실패")
if missing_accounts:
    print(f"⚠️  계정과목 미매핑 ({len(missing_accounts)}개):")
    for a in sorted(missing_accounts):
        print(f"   - {a}")
