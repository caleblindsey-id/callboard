#!/usr/bin/env python3
"""
PM Scheduler — Nightly Equipment-Sale Lead Candidate Scan (V2)

Two jobs, run in this order:

  1. Expiration sweep: flip any equipment_sale lead whose 90-day window has
     elapsed to status='expired' (if still pending/approved/match_pending).

  2. Candidate scan: for each open equipment_sale lead (approved or
     match_pending, expires_at > now()), pull Synergy invoiced SALES orders to
     the flagged customer since the lead's submitted_at, from BOTH the open-order
     file (roh) and invoice history (invh) — sales order types only (no
     repair/rental) and actually invoiced. If any line on that order is a real
     sale (qty and UnitPrice > 0) with a bonus-eligible ComdtyCode, and it is not
     a battery or a vacuum, upsert an equipment_sale_lead_candidates row. Flip
     the lead to match_pending so the office picks it up in the Match Candidates
     tab.

     Leads with no linked Synergy customer cannot be scanned. They are reported
     as warnings rather than silently dropped.

Bonus commodity codes come straight from `rolnew.ComdtyCode`:
  E400  EQUIPMENT
  E401  EQUIPMENTSHOP
  F200  FLOORBURNISHERS   (bonus tier: cord_electric)
  F275  FLOORSCRUBBERS    (bonus tier: ride_on_scrubber OR walk_behind_scrubber)
  S450  SWEEPERS          (bonus tier: cord_electric — unusual, manager judges)
  C200  CARPTEXTRACTORS   (bonus tier: cord_electric, if >=10 gal — manager judges)
  P250  PRESSUREWASHER    (bonus tier: hot_water_pw OR cold_water_pw)

V175 (VACUUMPRODUCTS) is on none of these, but that exclusion does not do the
job on its own: vacuums are coded E400 in practice, as are dry-cell batteries.
Both are dropped by line_exclusion_reason() below.

The manager still picks the tier at match confirmation, so the scan stays wide on
everything that is a genuine judgment call (extractor size, manual sweepers) and
only drops what the rate card excludes outright.

Runs nightly at 5:35 AM via Windows Task Scheduler (after the 5:30 AM validate),
matching the trigger registered by run-equipment-sale-scan.ps1.
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

# Synergy roh.OrdType values that represent an equipment SALE. The lead bonus
# pays on sales only, so we exclude OrdType 22 (repair/PM service — references the
# customer's existing machine as a zero-qty line) and OrdType 23 (equipment
# rental). Both 1 (standard sales) and 2 (contract/bulk sales) carry real
# equipment sales, so both are eligible.
SALES_ORDER_TYPES = (1, 2)

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
    """Upsert with ignore-duplicates semantics — confirmed/dismissed candidates
    are never clobbered when re-scanning. KNOWN LIMITATION: pending candidates
    do not refresh their order_total / order_lines if Synergy mutates the
    invoice (credit memo, line correction). Refreshing pending rows would
    require either a Postgres function (atomic conditional merge on
    status='pending') or a two-pass approach. Tracked in the QC review
    (TL-19) for a future improvement."""
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
    """Every open equipment_sale lead, linked or not.

    Deliberately does NOT filter on customer_id. A lead with no linked customer
    cannot be scanned, but dropping it here made it invisible: it sat in
    "Awaiting Match" looking healthy until it expired and nobody was ever told.
    main() now splits linked from unlinked and warns about the latter.
    """
    return supabase_get("tech_leads", {
        "select": "id,submitted_at,customer_id,customer_name_text,customers(synergy_id,name)",
        "lead_type": "eq.equipment_sale",
        "status": "in.(approved,match_pending)",
    })


def split_linked_leads(leads: list[dict]) -> tuple[list[dict], list[dict]]:
    """(scannable, unlinked). Unlinked = no customer_id, or a customer whose
    synergy_id is missing / non-numeric. Either way the scan cannot match it."""
    scannable: list[dict] = []
    unlinked: list[dict] = []
    for lead in leads:
        synergy_id = (lead.get("customers") or {}).get("synergy_id")
        if not synergy_id:
            unlinked.append(lead)
            continue
        try:
            int(synergy_id)
        except (TypeError, ValueError):
            unlinked.append(lead)
            continue
        scannable.append(lead)
    return scannable, unlinked


# ============================================================
# Line eligibility
# ============================================================
#
# BONUS_ELIGIBLE_COMDTY_CODES is the outer gate, but it is a coarse one: E400
# ("EQUIPMENT") is a broad electric bucket and supplies ~96% of everything that
# passes. Measured over Jun-Aug 2026, 65% of the lines it admitted were dry-cell
# batteries or vacuums, both of which the bonus rate card excludes outright.
# A queue made of batteries trains the reviewer to dismiss on reflex, and the one
# genuine scrubber gets dismissed along with them - so they are dropped here.
#
# Extractors are deliberately NOT excluded: the rate card only excludes those
# under 10 gallon, which is a judgment call the manager makes in the confirm
# modal. Same for manual push sweepers, which are rare and cheap but are a policy
# question, not a data one.
#
# Every dropped line is logged with its reason, so the exclusion stays auditable
# from the daily log rather than silently shrinking the queue.

# Product-code families that are entirely consumable batteries.
BATTERY_PROD_PREFIXES = ("373000", "120300", "135001")

# Vacuum families whose descriptions do not say "vacuum" anywhere:
#   506*    ProTeam backpacks / uprights (SUPER COACH, PROFORCE, BLITZ, GOFREE)
#   743*    Sanitaire uprights (SC886/SC887/SC899/SC679)
#   755*    Windsor Versamatic
#   110650* Sanitaire canister / vacuum
VACUUM_PROD_PREFIXES = ("506", "743", "755", "110650")


def line_exclusion_reason(prod_code, description):
    """Return why this line is not bonus-eligible, or None if it is.

    `description` must be Synergy's Desc1 ONLY, never Desc1 + Desc2. Desc2 carries
    accessory and spec text that defeats keyword matching: the T260 scrubber reads
    Desc2 "OFFBOARD CHARGER AGM BATTERIES" and would be dropped as a consumable.

    Pure and side-effect free so it can be checked against real Synergy rows.
    """
    code = (prod_code or "").strip()
    desc = (description or "").strip().upper()

    # Batteries. Every real battery row reads "BATTERIES" (plural); machines that
    # happen to be battery-powered read "BATTERY" singular, so the plural is a
    # safe discriminator and the prefixes are belt and braces.
    if "BATTERIES" in desc or code.startswith(BATTERY_PROD_PREFIXES):
        return "battery (consumable)"

    # Vacuums - excluded by the rate card regardless of price.
    if "VACUUM" in desc or " VAC" in " " + desc or desc.endswith(" VAC"):
        return "vacuum (excluded by rate card)"
    if code.startswith(VACUUM_PROD_PREFIXES):
        return "vacuum (excluded by rate card)"

    return None


def build_candidate_rows(conn, leads: list[dict]) -> tuple[list[dict], set[str], int]:
    """Query Synergy for each lead.

    Returns (candidate_rows, lead_ids_with_candidates, excluded_line_count).

    Two sources, unioned by OrdNum:

      roh / rolnew   the open-order file. An order sits here only briefly after
                     invoicing before Synergy moves it to invoice history.
      invh / invl    invoice history. The permanent record.

    Reading roh alone was the original design and it does not work. Of every 2026
    invoiced order carrying an eligible equipment line, six were still resident in
    roh when this was measured. The scan missed BOTH real equipment sales of 2026,
    including a $5,454.63 T260 scrubber to a customer with an open lead, and both
    bonuses had to be keyed in by hand. invh is the source of truth; roh is kept so
    an order that is invoiced but not yet posted is still caught.

    invh.Status 30 = invoice, 31 = credit memo. Only 30 is a sale.

    PERFORMANCE: invl has no index on InvNum or OrdNum -- its only index is the
    PRIMARY on (KeyInvCMNo, LineNum, RepairLine), which invh also carries. Joining
    on KeyInvCMNo rather than InvNum turns a full scan of invl into an index seek
    (14s -> 0.4s on a real customer). Do not "simplify" this join back to InvNum.
    Filtering the lines inside the same query, rather than looping orders and
    querying lines per order, is the other half of keeping this job to seconds.
    """
    cursor = conn.cursor()
    candidate_rows: list[dict] = []
    leads_with_candidates: set[str] = set()
    excluded_lines = 0

    comdty_placeholders = ",".join("?" for _ in BONUS_ELIGIBLE_COMDTY_CODES)
    sales_type_placeholders = ",".join("?" for _ in SALES_ORDER_TYPES)

    # Open-order file. InvNum <> 0 means actually invoiced. NOTE: InvDate is a
    # *scheduled* invoice date set at order entry -- it is populated on orders that
    # have NOT been invoiced yet (incl. every repair order), so it is the wrong
    # signal. InvNum is only assigned at true invoicing.
    #
    # QtyOrd / UnitPrice > 0 ensures the machine was actually SOLD, not merely
    # referenced: a repair order lists the serviced machine as a zero-qty $0 line
    # carrying the same commodity code.
    open_orders_sql = f"""
        SELECT h.OrdNum, h.OrdDate, h.InvNum, h.TotDol4Prof,
               l.ProdCode, l.Desc1, l.Desc2, l.QtyOrd, l.UnitPrice, l.ComdtyCode
        FROM roh h
        JOIN rolnew l ON l.OrdNum = h.OrdNum
        WHERE h.CustNum = ?
          AND h.OrdDate >= ?
          AND h.OrdType IN ({sales_type_placeholders})
          AND h.InvNum <> 0
          AND l.ComdtyCode IN ({comdty_placeholders})
          AND l.QtyOrd > 0
          AND l.UnitPrice > 0
    """

    invoiced_sql = f"""
        SELECT h.OrdNum, h.OrdDate, h.InvNum, h.TotDol4Prof,
               l.ProdCode, l.Desc1, l.Desc2, l.QtyOrd, l.UnitPrice, l.ComdtyCode
        FROM invh h
        JOIN invl l ON l.KeyInvCMNo = h.KeyInvCMNo
        WHERE h.CustNum = ?
          AND h.OrdDate >= ?
          AND h.OrdType IN ({sales_type_placeholders})
          AND h.Status = 30
          AND l.ComdtyCode IN ({comdty_placeholders})
          AND l.QtyOrd > 0
          AND l.UnitPrice > 0
    """

    for lead in leads:
        lead_id = lead["id"]
        cust_num = int((lead.get("customers") or {})["synergy_id"])
        # Synergy OrdDate is a date - compare to the date portion of submitted_at.
        since_date = lead["submitted_at"][:10]
        args = (cust_num, since_date, *SALES_ORDER_TYPES, *BONUS_ELIGIBLE_COMDTY_CODES)

        rows = []
        for sql in (open_orders_sql, invoiced_sql):
            cursor.execute(sql, args)
            rows.extend(cursor.fetchall())

        if not rows:
            continue

        # Collapse to one candidate per order. An order invoiced in several
        # shipments has one invh row per shipment, and the same order can appear in
        # both files at once; the (tech_lead_id, synergy_order_number) unique index
        # expects one row per order either way.
        orders: dict[int, dict] = {}
        for ord_num, ord_date, inv_num, tot_dollars, prod_code, desc1, desc2, qty, unit_price, comdty_code in rows:
            ord_num = int(ord_num)
            order = orders.setdefault(ord_num, {
                "ord_date": ord_date,
                "invoice_totals": {},
                "lines": {},
            })
            # Earliest order date wins; totals sum once per distinct invoice.
            if ord_date is not None and (order["ord_date"] is None or ord_date < order["ord_date"]):
                order["ord_date"] = ord_date
            if tot_dollars is not None:
                order["invoice_totals"][inv_num] = float(tot_dollars)

            code = (prod_code or "").strip()
            primary = (desc1 or "").strip()
            description = primary
            if desc2 and desc2.strip():
                description = f"{primary} {desc2.strip()}".strip()

            order["lines"][(code, description)] = {
                "prod_code": code,
                # Classify on Desc1 alone. Desc2 is a spec/accessory note and lies:
                # the T260 scrubber this scan exists to catch carries Desc2
                # "OFFBOARD CHARGER AGM BATTERIES", which would drop a $5,454.63
                # machine as a consumable if the concatenation were classified.
                "primary_description": primary,
                "description": description or None,
                "qty": int(qty) if qty is not None else None,
                "unit_price": float(unit_price) if unit_price is not None else None,
                "comdty_code": (comdty_code or "").strip() or None,
            }

        for ord_num in sorted(orders):
            order = orders[ord_num]
            order_lines = []
            for line in order["lines"].values():
                reason = line_exclusion_reason(line["prod_code"], line["primary_description"])
                if reason:
                    excluded_lines += 1
                    log.info(
                        f"  Order {ord_num}: dropped '{line['description']}' "
                        f"({line['prod_code']}) - {reason}"
                    )
                    continue
                order_lines.append({k: line[k] for k in
                                    ("prod_code", "description", "qty", "unit_price", "comdty_code")})

            # Every eligible-coded line was noise - this is not an equipment sale.
            if not order_lines:
                continue

            ord_date = order["ord_date"]
            total = sum(order["invoice_totals"].values()) if order["invoice_totals"] else None

            candidate_rows.append({
                "tech_lead_id": lead_id,
                "synergy_order_number": ord_num,
                "synergy_order_date": ord_date.isoformat() if hasattr(ord_date, "isoformat") else str(ord_date),
                "synergy_order_total": total,
                "order_lines": order_lines,
                "status": "pending",
            })
            leads_with_candidates.add(lead_id)

    return candidate_rows, leads_with_candidates, excluded_lines


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
    # --dry-run reads everything and writes nothing. Use it to prove a filter or
    # source change against live data before letting the scheduled task act on it.
    dry_run = "--dry-run" in sys.argv

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        log.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)

    log.info("=" * 60)
    log.info("Equipment-Sale Lead Candidate Scan - starting" + (" (DRY RUN, no writes)" if dry_run else ""))
    log.info("=" * 60)

    # Step 1: expiration sweep
    if dry_run:
        expired_count = 0
        log.info("Expiration sweep: skipped (dry run).")
    else:
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
    scannable, unlinked = split_linked_leads(open_leads)
    log.info(f"Open equipment-sale leads: {len(open_leads)}")
    log.info(f"Open equipment-sale leads to scan: {len(scannable)}")

    # A lead with no linked Synergy customer can never match. It used to be
    # filtered out in the PostgREST query and never mentioned again, so it sat in
    # "Awaiting Match" looking healthy until it expired. Say so, loudly, so the
    # 10:30 AM automation digest surfaces it.
    for lead in unlinked:
        label = (lead.get("customer_name_text") or "").strip() or "(no customer name)"
        log.warning(
            f"Lead {lead['id']} has no linked Synergy customer ('{label}') - "
            "it cannot be matched and will expire unless someone links it."
        )

    if not scannable:
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
        candidate_rows, leads_with_candidates, excluded_lines = build_candidate_rows(conn, scannable)
    finally:
        conn.close()

    log.info(f"Candidate rows to upsert: {len(candidate_rows)}")
    log.info(f"Leads with at least one candidate: {len(leads_with_candidates)}")

    for row in candidate_rows:
        descs = ", ".join(
            (ln.get("description") or ln.get("prod_code") or "?")
            for ln in row["order_lines"]
        )
        log.info(
            f"  Candidate: order {row['synergy_order_number']} "
            f"({row['synergy_order_date']}) - {descs}"
        )

    if dry_run:
        log.info("-" * 40)
        log.info("DRY RUN - nothing written.")
        log.info(f"  Leads scanned:            {len(scannable)}")
        log.info(f"  Leads skipped (no link):  {len(unlinked)}")
        log.info(f"  Ineligible lines dropped: {excluded_lines}")
        log.info(f"  Candidates that would be upserted: {len(candidate_rows)}")
        log.info("=" * 60)
        return

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
    log.info(f"  Leads scanned:           {len(scannable)}")
    log.info(f"  Leads skipped (no customer link): {len(unlinked)}")
    log.info(f"  Ineligible lines dropped: {excluded_lines}")
    log.info(f"  Leads w/ new candidates: {len(leads_with_candidates)}")
    log.info(f"  Candidates upserted:     {len(candidate_rows)}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
