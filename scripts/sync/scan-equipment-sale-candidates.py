#!/usr/bin/env python3
"""
PM Scheduler — Nightly Equipment-Sale Lead Candidate Scan (V2)

Two jobs, run in this order:

  1. Expiration sweep: flip any equipment_sale lead whose 90-day window has
     elapsed to status='expired' (if still pending/approved/match_pending).

  2. Candidate scan: for each open equipment_sale lead (approved or
     match_pending, expires_at > now()), pull Synergy invoiced orders to the
     flagged customer since the lead's submitted_at. If any line on that order
     has a bonus-eligible ComdtyCode (equipment/scrubbers/pressure washers,
     explicitly excluding V175 vacuums), upsert an
     equipment_sale_lead_candidates row. Flip the lead to match_pending so the
     office picks it up in the Match Candidates tab.

Bonus commodity codes come straight from `rolnew.ComdtyCode`:
  E400  EQUIPMENT
  E401  EQUIPMENTSHOP
  F200  FLOORBURNISHERS   (bonus tier: cord_electric)
  F275  FLOORSCRUBBERS    (bonus tier: ride_on_scrubber OR walk_behind_scrubber)
  S450  SWEEPERS          (bonus tier: cord_electric — unusual, manager judges)
  C200  CARPTEXTRACTORS   (bonus tier: cord_electric, if >=10 gal — manager judges)
  P250  PRESSUREWASHER    (bonus tier: hot_water_pw OR cold_water_pw)

V175 (VACUUMPRODUCTS) is deliberately excluded per the bonus rate card.

The manager picks the tier at match confirmation, so the scan casts a wide
net and leaves the classification judgment to a human.

Runs nightly at 5:30 AM via Windows Task Scheduler (after 5 AM sync).
"""

import os
import sys
import json
import logging
import pyodbc
import requests
from datetime import datetime, timezone
from pathlib import Path

# ============================================================
# Configuration
# ============================================================

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Bonus-eligible commodity codes — V175 (vacuums) deliberately excluded.
BONUS_ELIGIBLE_COMDTY_CODES = (
    "E400",  # EQUIPMENT
    "E401",  # EQUIPMENTSHOP
    "F200",  # FLOORBURNISHERS
    "F275",  # FLOORSCRUBBERS
    "S450",  # SWEEPERS
    "C200",  # CARPTEXTRACTORS
    "P250",  # PRESSUREWASHER
)

# ============================================================
# Logging setup
# ============================================================

def setup_logging() -> logging.Logger:
    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent
    logs_dir = project_root / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    log_filename = logs_dir / f"scan-equipment-sale-{datetime.now().strftime('%Y-%m-%d')}.log"
    log_format = "%(asctime)s [%(levelname)s] %(message)s"

    logger = logging.getLogger("scan_equipment_sale")
    logger.setLevel(logging.DEBUG)

    fh = logging.FileHandler(log_filename, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(log_format))
    logger.addHandler(fh)

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter(log_format))
    logger.addHandler(ch)

    return logger


log = setup_logging()

# ============================================================
# Supabase helpers
# ============================================================

def supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def supabase_get(table: str, params: dict) -> list[dict]:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = supabase_headers()
    response = requests.get(url, params=params, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def supabase_patch(table: str, match: dict, data: dict) -> None:
    params = {k: f"eq.{v}" for k, v in match.items()}
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = supabase_headers()
    headers["Prefer"] = "return=minimal"
    response = requests.patch(url, params=params, json=data, headers=headers, timeout=15)
    response.raise_for_status()


def supabase_upsert(table: str, rows: list[dict], on_conflict: str) -> None:
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = supabase_headers()
    headers["Prefer"] = "resolution=ignore-duplicates,return=minimal"
    params = {"on_conflict": on_conflict}
    response = requests.post(url, params=params, json=rows, headers=headers, timeout=30)
    response.raise_for_status()


# ============================================================
# Step 1 — Expiration sweep
# ============================================================

def expire_stale_leads() -> int:
    """Flip equipment_sale leads past expires_at to 'expired'. Returns count."""
    now_iso = datetime.now(timezone.utc).isoformat()
    # PostgREST patch with filter — atomic, one round-trip.
    url = f"{SUPABASE_URL}/rest/v1/tech_leads"
    headers = supabase_headers()
    headers["Prefer"] = "return=representation"
    params = {
        "lead_type": "eq.equipment_sale",
        "status": "in.(pending,approved,match_pending)",
        "expires_at": f"lt.{now_iso}",
    }
    response = requests.patch(
        url,
        params=params,
        headers=headers,
        json={"status": "expired"},
        timeout=30,
    )
    response.raise_for_status()
    rows = response.json()
    log.info(f"Expiration sweep: {len(rows)} lead(s) expired.")
    return len(rows)


# ============================================================
# Step 2 — Candidate scan
# ============================================================

def fetch_open_leads() -> list[dict]:
    """Open equipment_sale leads with a linked Synergy customer."""
    return supabase_get("tech_leads", {
        "select": "id,submitted_at,customer_id,customers(synergy_id)",
        "lead_type": "eq.equipment_sale",
        "status": "in.(approved,match_pending)",
        "customer_id": "not.is.null",
    })


def build_candidate_rows(conn, leads: list[dict]) -> tuple[list[dict], set[str]]:
    """Query Synergy for each lead. Return (candidate_rows, lead_ids_with_candidates)."""
    cursor = conn.cursor()
    candidate_rows: list[dict] = []
    leads_with_candidates: set[str] = set()

    comdty_placeholders = ",".join("?" for _ in BONUS_ELIGIBLE_COMDTY_CODES)

    for lead in leads:
        lead_id = lead["id"]
        cust_info = lead.get("customers") or {}
        synergy_id = cust_info.get("synergy_id")
        if not synergy_id:
            continue
        try:
            cust_num = int(synergy_id)
        except (TypeError, ValueError):
            log.warning(f"  Lead {lead_id}: non-numeric synergy_id '{synergy_id}' — skipping.")
            continue

        submitted_at = lead["submitted_at"]
        # Synergy OrdDate is a date — compare to the date portion of submitted_at.
        since_date = submitted_at[:10]

        # 1. Invoiced orders to this customer since submit date.
        cursor.execute(
            """
            SELECT OrdNum, OrdDate, TotDol4Prof
            FROM roh
            WHERE CustNum = ?
              AND OrdDate >= ?
              AND InvDate IS NOT NULL
            """,
            (cust_num, since_date),
        )
        orders = cursor.fetchall()
        if not orders:
            continue

        for ord_num, ord_date, tot_dollars in orders:
            # 2. Equipment-eligible lines on this order.
            cursor.execute(
                f"""
                SELECT ProdCode, Desc1, Desc2, QtyOrd, UnitPrice, ComdtyCode
                FROM rolnew
                WHERE OrdNum = ?
                  AND ComdtyCode IN ({comdty_placeholders})
                """,
                (int(ord_num), *BONUS_ELIGIBLE_COMDTY_CODES),
            )
            lines = cursor.fetchall()
            if not lines:
                continue

            order_lines = []
            for prod_code, desc1, desc2, qty, unit_price, comdty_code in lines:
                description = (desc1 or "").strip()
                if desc2 and desc2.strip():
                    description = f"{description} {desc2.strip()}".strip()
                order_lines.append({
                    "prod_code": (prod_code or "").strip(),
                    "description": description or None,
                    "qty": int(qty) if qty is not None else None,
                    "unit_price": float(unit_price) if unit_price is not None else None,
                    "comdty_code": (comdty_code or "").strip() or None,
                })

            candidate_rows.append({
                "tech_lead_id": lead_id,
                "synergy_order_number": int(ord_num),
                "synergy_order_date": ord_date.isoformat() if hasattr(ord_date, "isoformat") else str(ord_date),
                "synergy_order_total": float(tot_dollars) if tot_dollars is not None else None,
                "order_lines": order_lines,
                "status": "pending",
            })
            leads_with_candidates.add(lead_id)

    return candidate_rows, leads_with_candidates


def flip_leads_to_match_pending(lead_ids: set[str]) -> None:
    """For leads still in 'approved', flip to 'match_pending'. match_pending ones stay."""
    if not lead_ids:
        return
    id_filter = ",".join(lead_ids)
    url = f"{SUPABASE_URL}/rest/v1/tech_leads"
    headers = supabase_headers()
    headers["Prefer"] = "return=minimal"
    params = {
        "id": f"in.({id_filter})",
        "status": "eq.approved",
    }
    response = requests.patch(
        url,
        params=params,
        json={"status": "match_pending"},
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()


# ============================================================
# Main
# ============================================================

def main() -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        log.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)

    log.info("=" * 60)
    log.info("Equipment-Sale Lead Candidate Scan — starting")
    log.info("=" * 60)

    # Step 1: expiration sweep
    try:
        expired_count = expire_stale_leads()
    except Exception as e:
        log.error(f"Expiration sweep failed: {e}")
        sys.exit(1)

    # Step 2: open leads
    try:
        open_leads = fetch_open_leads()
    except Exception as e:
        log.error(f"Failed to fetch open leads: {e}")
        sys.exit(1)
    log.info(f"Open equipment-sale leads to scan: {len(open_leads)}")

    if not open_leads:
        log.info("Nothing to scan.")
        return

    # Step 3: Synergy scan
    log.info("Connecting to Synergy ERP (DSN=ERPlinked)...")
    try:
        conn = pyodbc.connect("DSN=ERPlinked", autocommit=True, timeout=30)
    except Exception as e:
        log.error(f"Failed to connect to Synergy: {e}")
        sys.exit(1)

    try:
        candidate_rows, leads_with_candidates = build_candidate_rows(conn, open_leads)
    finally:
        conn.close()

    log.info(f"Candidate rows to upsert: {len(candidate_rows)}")
    log.info(f"Leads with at least one candidate: {len(leads_with_candidates)}")

    # Step 4: upsert candidates (idempotent via unique index)
    if candidate_rows:
        try:
            # Batch in 200s to keep request bodies small with JSONB payloads.
            for i in range(0, len(candidate_rows), 200):
                batch = candidate_rows[i:i + 200]
                supabase_upsert(
                    "equipment_sale_lead_candidates",
                    batch,
                    on_conflict="tech_lead_id,synergy_order_number",
                )
        except Exception as e:
            log.error(f"Candidate upsert failed: {e}")
            sys.exit(1)

    # Step 5: flip leads approved -> match_pending
    try:
        flip_leads_to_match_pending(leads_with_candidates)
    except Exception as e:
        log.error(f"Flipping leads to match_pending failed: {e}")
        sys.exit(1)

    log.info("-" * 40)
    log.info("Scan complete:")
    log.info(f"  Expired leads:           {expired_count}")
    log.info(f"  Leads scanned:           {len(open_leads)}")
    log.info(f"  Leads w/ new candidates: {len(leads_with_candidates)}")
    log.info(f"  Candidates upserted:     {len(candidate_rows)}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
