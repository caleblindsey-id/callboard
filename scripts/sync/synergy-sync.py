#!/usr/bin/env python3
"""
PM Scheduler — Nightly Synergy Sync
Reads customers, contacts, and products from SynergyERP MySQL
and upserts them to Supabase via REST API.

Runs nightly at 5:00 AM via Windows Task Scheduler.
"""

import os
import sys
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

# Deployed app — used after the sync to trigger the credit-hold sweep (backfills
# AR credit reviews for on-hold customers' un-started open orders). Optional:
# the sweep is skipped if either is unset.
APP_BASE_URL = os.environ.get("APP_BASE_URL", "").rstrip("/")
CREDIT_SWEEP_SECRET = os.environ.get("CREDIT_SWEEP_SECRET", "")

BATCH_SIZE = 500  # Max records per Supabase upsert request

# Product commodity codes to include (service-relevant items only)
PRODUCT_COMMODITY_CODES = (
    "P210",  # PARTS
    "E400",  # EQUIPMENT
    "E401",  # EQUIPMENTSHOP
    "E402",  # USEDEQUIP
    "L175",  # LABOR
    "V175",  # VACUUMPRODUCTS
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

    log_filename = logs_dir / f"sync-{datetime.now().strftime('%Y-%m-%d')}.log"
    log_format = "%(asctime)s [%(levelname)s] %(message)s"

    logger = logging.getLogger("synergy_sync")
    logger.setLevel(logging.DEBUG)

    # File handler — DEBUG and above
    fh = logging.FileHandler(log_filename, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(log_format))

    # Console handler — INFO and above
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter(log_format))

    logger.addHandler(fh)
    logger.addHandler(ch)

    return logger


log = setup_logging()


# ============================================================
# Helpers
# ============================================================

def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def build_address(addr1, addr2, city, state, zip_code) -> str | None:
    parts = []
    if addr1 and str(addr1).strip():
        parts.append(str(addr1).strip())
    if addr2 and str(addr2).strip():
        parts.append(str(addr2).strip())
    city_state_zip = " ".join(
        p for p in [
            str(city).strip() if city else "",
            str(state).strip() if state else "",
            str(zip_code).strip() if zip_code else "",
        ]
        if p
    )
    if city_state_zip:
        parts.append(city_state_zip)
    return ", ".join(parts) if parts else None


def safe_str(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


# ============================================================
# Supabase REST helpers
# ============================================================

def supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }


def supabase_upsert(table: str, records: list[dict], on_conflict: str | None = "synergy_id") -> int:
    """POST a batch of records to Supabase with upsert semantics. Returns count upserted."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"
    response = requests.post(url, json=records, headers=supabase_headers(), timeout=60)
    if not response.ok:
        raise RuntimeError(
            f"Supabase upsert to '{table}' failed [{response.status_code}]: {response.text[:500]}"
        )
    return len(records)


def upsert_in_batches(records: list[dict], table: str, on_conflict: str | None = "synergy_id") -> int:
    """Upsert records in batches of BATCH_SIZE. Returns total count upserted."""
    if not records:
        log.info(f"  No records to upsert for table '{table}'.")
        return 0

    total = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        count = supabase_upsert(table, batch, on_conflict=on_conflict)
        total += count
        log.debug(f"  Upserted batch {i // BATCH_SIZE + 1} ({len(batch)} records) to '{table}'.")

    return total


def supabase_post(table: str, record: dict) -> dict:
    """POST a single record (no upsert). Used for sync_log inserts."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    response = requests.post(url, json=record, headers=headers, timeout=30)
    if not response.ok:
        raise RuntimeError(
            f"Supabase POST to '{table}' failed [{response.status_code}]: {response.text[:500]}"
        )
    data = response.json()
    return data[0] if isinstance(data, list) and data else {}


def supabase_patch(table: str, row_id: int, record: dict) -> None:
    """PATCH a row by integer id. Used to update the sync_log entry on completion."""
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    response = requests.patch(url, json=record, headers=headers, timeout=30)
    if not response.ok:
        raise RuntimeError(
            f"Supabase PATCH to '{table}' id={row_id} failed [{response.status_code}]: {response.text[:500]}"
        )


# ============================================================
# Sync log helpers
# ============================================================

def write_sync_log_start(sync_type: str, started_at: str) -> int | None:
    """Insert a 'running' sync_log row. Returns the new row id."""
    try:
        row = supabase_post("sync_log", {
            "sync_type": sync_type,
            "started_at": started_at,
            "status": "running",
            "records_synced": 0,
            "completed_at": None,
            "error_message": None,
        })
        return row.get("id")
    except Exception as e:
        log.warning(f"Could not write sync_log start entry: {e}")
        return None


def write_sync_log_complete(
    row_id: int | None,
    completed_at: str,
    records_synced: int,
    status: str,
    error_message: str | None = None,
) -> None:
    if row_id is None:
        return
    try:
        supabase_patch("sync_log", row_id, {
            "completed_at": completed_at,
            "records_synced": records_synced,
            "status": status,
            "error_message": error_message,
        })
    except Exception as e:
        log.warning(f"Could not update sync_log row {row_id}: {e}")


# ============================================================
# ERP table discovery
# ============================================================

def discover_tables(conn) -> set[str]:
    cursor = conn.cursor()
    cursor.execute("SHOW TABLES")
    tables = {row[0].lower() for row in cursor.fetchall()}
    log.info(f"Discovered {len(tables)} ERP tables.")
    log.debug(f"Tables: {sorted(tables)}")
    return tables


# ============================================================
# Sync: Customers
# ============================================================

def derive_credit_hold(row) -> bool:
    """Compute credit_hold per the AR-office definition (confirmed by Tamara).

    A customer is on hold if EITHER:
      1. Their AR balance exceeds their credit limit, OR
      2. They have AR balance older than their CreditCheckDays grace period.

    Synergy AR aging buckets (`vwCustomer`):
      AgeARAmount1 = current (not past due)
      AgeARAmount2 = first past-due bucket  (~1–30 days past due)
      AgeARAmount3 = second past-due bucket (~31–60)
      AgeARAmount4 = oldest past-due bucket (~61+)

    Mapping CreditCheckDays (per-customer grace period) onto those coarse buckets:
      ccd ≤ 30  → past-due = A2 + A3 + A4 (anything past due counts)
      31–60     → past-due = A3 + A4
      ccd > 60  → past-due = A4
    """
    balance = float(row.CurrentARAgeBalance or 0)
    limit = float(row.CreditLimit or 0)
    ccd = int(row.CreditCheckDays or 0)
    age2 = float(row.AgeARAmount2 or 0)
    age3 = float(row.AgeARAmount3 or 0)
    age4 = float(row.AgeARAmount4 or 0)

    over_limit = limit > 0 and balance > limit

    if ccd <= 30:
        past_due = age2 + age3 + age4
    elif ccd <= 60:
        past_due = age3 + age4
    else:
        past_due = age4
    overdue = past_due > 0

    return over_limit or overdue


def sync_customers(conn) -> int:
    log.info("--- Syncing customers ---")
    cursor = conn.cursor()

    # credit_hold is derived per AR/office-manager definition in derive_credit_hold():
    # hold if balance exceeds credit limit, OR has AR past their CreditCheckDays.
    # vwCustomer JOIN exposes credit fields + AR aging buckets.
    # artermcode JOIN provides human-readable payment terms description.
    # Exclude customers whose name contains "CLOSED" or "DO NOT USE" —
    # these are inactive accounts in Synergy that should not appear in CallBoard.
    cursor.execute("""
        SELECT
            cust.CustomerCode,
            cust.Name,
            artermcode.TermsDescription,
            cust.Addr1,
            cust.Addr2,
            cust.City,
            cust.State,
            cust.Zip4,
            cust.PORequiredFlag,
            cust.CreditLimit,
            cust.CreditCheckDays,
            vwCustomer.CurrentARAgeBalance,
            vwCustomer.AgeARAmount2,
            vwCustomer.AgeARAmount3,
            vwCustomer.AgeARAmount4
        FROM cust
        LEFT JOIN artermcode ON artermcode.xDL4RecNum = cust.Terms
        LEFT JOIN vwCustomer ON vwCustomer.CustomerCode = cust.CustomerCode
        WHERE cust.CustomerCode > 0
          AND UPPER(cust.Name) NOT LIKE '%CLOSED%'
          AND UPPER(cust.Name) NOT LIKE '%DO NOT USE%'
        ORDER BY cust.CustomerCode
    """)

    rows = cursor.fetchall()
    log.info(f"  Fetched {len(rows)} active customer rows from Synergy (inactive/closed filtered at query level).")

    # ----------------------------------------------------------------
    # ONE-TIME CLEANUP (commented out — run manually with caution)
    # ----------------------------------------------------------------
    # If you want to remove previously-synced closed/inactive customers
    # from Supabase, uncomment the block below and run the script once.
    #
    # WARNING: This will DELETE customers whose name contains these
    # patterns. Any equipment or PM tickets linked to those customers
    # may become orphaned. Review the count in the log before running.
    #
    # def cleanup_inactive_customers():
    #     patterns = ['*closed*', '*do not use*']
    #     for pattern in patterns:
    #         url = f"{SUPABASE_URL}/rest/v1/customers?name=ilike.{pattern}"
    #         headers = {
    #             "apikey": SUPABASE_SERVICE_ROLE_KEY,
    #             "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    #             "Prefer": "return=representation",
    #         }
    #         # Dry run: count matches first
    #         count_resp = requests.get(
    #             url + "&select=id,name",
    #             headers={**headers, "Prefer": "count=exact"},
    #             timeout=30
    #         )
    #         count = int(count_resp.headers.get("content-range", "0/0").split("/")[-1])
    #         log.info(f"  Cleanup preview: {count} customers matching '{pattern}'")
    #         if count > 0:
    #             del_resp = requests.delete(url, headers=headers, timeout=30)
    #             log.info(f"  Deleted {count} customers matching '{pattern}': {del_resp.status_code}")
    # cleanup_inactive_customers()
    # ----------------------------------------------------------------

    customers = []
    for row in rows:
        billing_address = build_address(
            row.Addr1, row.Addr2, row.City, row.State, row.Zip4
        )
        customers.append({
            "synergy_id": str(row.CustomerCode).strip(),
            "name": str(row.Name).strip() if row.Name else "",
            "account_number": str(row.CustomerCode).strip(),
            "ar_terms": safe_str(row.TermsDescription),
            "credit_hold": derive_credit_hold(row),
            "billing_address": billing_address,
            "billing_city": safe_str(row.City),
            "billing_state": safe_str(row.State),
            "billing_zip": safe_str(row.Zip4),
            "po_required": bool(row.PORequiredFlag) if row.PORequiredFlag is not None else False,
            "active": True,  # explicit — anything falling out of the result set will be deactivated below
            # A customer present in Synergy is confirmed: clear any provisional flag set
            # by a same-day in-app entry. Real synced rows always carry provisional=false.
            "provisional": False,
            "synced_at": utcnow_iso(),
        })

    count = upsert_in_batches(customers, "customers")
    log.info(f"  Customers synced: {count}")

    # Deactivate any customer whose synergy_id is NOT in this batch — handles
    # the "renamed to *CLOSED*" / "*DO NOT USE*" cases where the row drops out
    # of the source query but still exists in CallBoard. Done in chunks to
    # respect URL-length limits when the active set is large.
    deactivated = 0
    if customers:
        active_ids = [c["synergy_id"] for c in customers]
        # PostgREST in.() filter — chunk to ~250 ids per request to stay
        # well under any URL length cap.
        chunk_size = 250
        # First pass: collect ids of currently-active rows to deactivate.
        # We can't directly do "synergy_id NOT IN (...)" with a giant list
        # in one go, so deactivate via a server-side UPDATE that targets
        # only currently active rows and excludes the active set in chunks.
        # Simpler approach: pull current active synergy_ids, diff in Python,
        # then PATCH active=false for the diff.
        active_set = set(active_ids)
        # Exclude provisional rows: a same-day in-app customer awaiting its first sync
        # confirmation legitimately is not in this batch yet, and must NOT be deactivated.
        cursor_url = f"{SUPABASE_URL}/rest/v1/customers?select=synergy_id&active=eq.true&provisional=eq.false"
        try:
            existing_resp = requests.get(cursor_url, headers=supabase_headers(), timeout=30)
            existing_resp.raise_for_status()
            existing_active = [r["synergy_id"] for r in existing_resp.json() if r.get("synergy_id")]
            stale = [sid for sid in existing_active if sid not in active_set]
            for i in range(0, len(stale), chunk_size):
                batch = stale[i : i + chunk_size]
                in_filter = ",".join(batch)
                patch_url = f"{SUPABASE_URL}/rest/v1/customers?synergy_id=in.({in_filter})"
                patch_headers = supabase_headers()
                patch_headers["Prefer"] = "return=minimal"
                requests.patch(patch_url, json={"active": False}, headers=patch_headers, timeout=30)
                deactivated += len(batch)
            if deactivated:
                log.info(f"  Customers deactivated (no longer in Synergy result): {deactivated}")
        except Exception as e:
            log.warning(f"  Could not deactivate stale customers: {e}")

    return count


# ============================================================
# Sync: Products
# ============================================================

def sync_products(conn) -> int:
    log.info("--- Syncing products ---")
    cursor = conn.cursor()

    # Build the IN clause for commodity codes
    placeholders = ", ".join("?" * len(PRODUCT_COMMODITY_CODES))

    try:
        # LEFT JOIN a80vm to resolve the primary vendor's display name. prod
        # carries a single primary vendor (PrimVend, 100% populated on parts) and
        # its vendor part # (VendItem) — both prefilled onto a service-ticket part
        # request when a tech picks this stock item.
        #
        # LEFT JOIN prodwhse (Whse = 4, the service department's warehouse) carries
        # the service stock position — QtyOnHand (on hand) + QtyOnPO (inbound on
        # open POs) — onto the catalog so the parts-queue Review step can show "pull
        # from stock vs order". LEFT JOIN so non-stocked parts still sync (qty stays
        # NULL). QtyOnPO is the purchasing-side inbound column; do NOT use rolnew
        # (that's outbound sales demand). QtyOnHand may be negative when oversold.
        cursor.execute(f"""
            SELECT
                p.ProdCode,
                p.Desc1,
                p.Desc2,
                p.ListPrice1,
                p.CostLoad,
                p.CostPO,
                p.PrimVend,
                p.VendItem,
                v.Name AS VendName,
                pw.QtyOnHand,
                pw.QtyOnPO,
                pl.BinLoc
            FROM prod p
            LEFT JOIN a80vm v ON v.VendorCode = p.PrimVend
            LEFT JOIN prodwhse pw ON pw.ProdCode = p.ProdCode AND pw.Whse = 4
            LEFT JOIN (
                SELECT ProdCode,
                       GROUP_CONCAT(Loc ORDER BY PermPrim DESC, PLDATE DESC SEPARATOR ', ') AS BinLoc
                FROM prodloc WHERE Whse = 4 GROUP BY ProdCode
            ) pl ON pl.ProdCode = p.ProdCode
            WHERE p.ComdtyCode IN ({placeholders})
              AND (p.SupersedeCode IS NULL OR p.SupersedeCode = '')
              AND (p.Desc2 NOT LIKE '%OBSOLETE%' OR p.Desc2 IS NULL)
            ORDER BY p.ProdCode
        """, PRODUCT_COMMODITY_CODES)
    except Exception as e:
        log.warning(f"  Could not query 'prod' table: {e}. Skipping products sync.")
        return 0

    rows = cursor.fetchall()
    log.info(f"  Fetched {len(rows)} product rows from Synergy.")

    products = []
    for row in rows:
        # Combine Desc1 and Desc2, skip Desc2 if blank
        desc1 = safe_str(row.Desc1) or ""
        desc2 = safe_str(row.Desc2)
        description = (f"{desc1} {desc2}".strip()) if desc2 else desc1 or None

        # Loaded cost backs the service-ticket margin floor. Prefer CostLoad
        # (cost + allocated overhead); fall back to CostPO (last PO cost) when
        # CostLoad is missing or non-positive. NULL = cost unknown (floor not
        # enforced on that part). Internal only — never exposed to techs.
        cost_load = float(row.CostLoad) if row.CostLoad is not None else None
        cost_po = float(row.CostPO) if row.CostPO is not None else None
        unit_cost = cost_load if (cost_load is not None and cost_load > 0) else cost_po

        # Primary vendor + vendor part #, for prefill on the service-ticket parts
        # request. PrimVend is the a80vm vendor code; treat blank/"0" as no vendor.
        prim_vend = safe_str(row.PrimVend)
        vendor_code = int(prim_vend) if (prim_vend and prim_vend != "0" and prim_vend.isdigit()) else None
        vendor_name = safe_str(row.VendName) if vendor_code is not None else None
        vendor_item_code = safe_str(row.VendItem)

        # Service-dept stock position (Whse 4) for the parts-queue Review step. NULL
        # = no stock record at Whse 4 (non-stocked part). Cast through int() so the
        # decimal/int ODBC value lands as a plain JSON integer; negatives are kept
        # (oversold), and the Review UI treats anything <= 0 as "not in stock".
        qty_on_hand = int(row.QtyOnHand) if row.QtyOnHand is not None else None
        qty_on_po = int(row.QtyOnPO) if row.QtyOnPO is not None else None

        # Service-dept (Whse 4) bin/shelf location(s) from prodloc, for the
        # parts pick list. A part can sit in >1 bin; the subquery GROUP_CONCATs
        # them primary-first (PermPrim DESC), comma-joined (e.g. "E5, E5-D").
        # NULL = no bin record (shows blank on the pick list).
        bin_location = safe_str(row.BinLoc)

        # NOTE: do NOT add `requires_detail` to this payload. It's a hand-curated
        # flag (migration 088) that marks catch-all items like SHOP SUPPLIES to
        # prompt for a free-text detail. The upsert is ON CONFLICT (synergy_id)
        # DO UPDATE and only touches the columns present here, so omitting
        # requires_detail leaves the curated value intact across nightly syncs.
        # Adding it here would reset every flagged item to false.
        products.append({
            "synergy_id": str(row.ProdCode).strip(),
            "number": str(row.ProdCode).strip(),
            "description": description,
            "unit_price": float(row.ListPrice1) if row.ListPrice1 is not None else None,
            "unit_cost": unit_cost,
            "vendor_code": vendor_code,
            "vendor": vendor_name,
            "vendor_item_code": vendor_item_code,
            "qty_on_hand": qty_on_hand,
            "qty_on_po": qty_on_po,
            "bin_location": bin_location,
            "synced_at": utcnow_iso(),
        })

    count = upsert_in_batches(products, "products")
    log.info(f"  Products synced: {count}")
    return count


# ============================================================
# Sync: Open PO lines (estimated arrival dates for ordered parts)
# ============================================================

def sync_po_lines(conn) -> int:
    """Sync open SynergyERP purchase-order lines into `synergy_po_lines` so the
    parts queue and tech ticket views can show an estimated arrival date for a
    part the office has ordered.

    Keyed by (po_number, product_number) — matched against the PO # the office
    enters on a part request. `poline.DueDate` is the expected receipt date;
    Status=1 = an open (not yet fully received / closed) line. A product can sit
    on more than one line of the same PO, so we aggregate to the EARLIEST DueDate
    per (PO, product). PO# is stored as text (the office enters it as text) so the
    parts_order_queue view join is a clean text=text match.

    Open lines are a tiny set (~900 rows all-warehouse), so we full-refresh: every
    row gets this run's `synced_at`, then rows older than that are deleted — lines
    that were received/closed since the last run thus drop out automatically.
    Writes go through PostgREST (no direct PG connection), same as every other
    sync here.
    """
    log.info("--- Syncing open PO lines ---")
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT pl.PONum, pl.ProdCode, MIN(pl.DueDate) AS DueDate,
                   SUM(pl.QtyOrd) AS QtyOrd, SUM(pl.QtyRcvdToDate) AS QtyRcvd,
                   ph.OrderDate, MIN(pl.Whse) AS Whse
            FROM poline pl
            LEFT JOIN pohead ph ON ph.PurchaseOrder = pl.PONum
            WHERE pl.Status = 1
            GROUP BY pl.PONum, pl.ProdCode, ph.OrderDate
        """)
    except Exception as e:
        log.warning(f"  Could not query 'poline' table: {e}. Skipping PO-lines sync.")
        return 0

    rows = cursor.fetchall()
    log.info(f"  Fetched {len(rows)} open PO line(s) from Synergy.")

    run_ts = utcnow_iso()
    po_lines = []
    for row in rows:
        prod_code = safe_str(row.ProdCode)
        po_num = safe_str(row.PONum)
        if not prod_code or not po_num:
            continue
        po_lines.append({
            "po_number": po_num,
            "product_number": prod_code,
            "due_date": row.DueDate.isoformat() if row.DueDate is not None else None,
            "qty_ordered": int(row.QtyOrd) if row.QtyOrd is not None else None,
            "qty_received": int(row.QtyRcvd) if row.QtyRcvd is not None else None,
            "order_date": row.OrderDate.isoformat() if row.OrderDate is not None else None,
            "whse": int(row.Whse) if row.Whse is not None else None,
            "synced_at": run_ts,
        })

    count = upsert_in_batches(po_lines, "synergy_po_lines",
                              on_conflict="po_number,product_number")
    log.info(f"  PO lines synced: {count}")

    # Drop lines that closed/received since the last run — anything we did NOT
    # touch this run (older synced_at) is no longer open. Single PostgREST DELETE,
    # works cleanly with the composite key.
    if po_lines:
        try:
            del_url = f"{SUPABASE_URL}/rest/v1/synergy_po_lines?synced_at=lt.{run_ts}"
            del_headers = supabase_headers()
            del_headers["Prefer"] = "return=minimal"
            resp = requests.delete(del_url, headers=del_headers, timeout=30)
            if not resp.ok:
                log.warning(f"  Could not prune stale PO lines [{resp.status_code}]: {resp.text[:300]}")
        except Exception as e:
            log.warning(f"  Could not prune stale PO lines: {e}")

    return count


# ============================================================
# Sync: Contacts
# ============================================================

def sync_contacts(conn, known_tables: set[str]) -> int:
    log.info("--- Syncing contacts ---")

    if "contlist" not in known_tables:
        log.info("  'contlist' table not found. Skipping contacts sync.")
        return 0

    cursor = conn.cursor()
    try:
        # Only sync contacts that have at least an email or a real phone number
        cursor.execute("""
            SELECT CustCode, Contact, FirstName, LastName, Email, Phone
            FROM contlist
            WHERE (Email IS NOT NULL AND Email != '')
               OR (Phone IS NOT NULL AND Phone > 0)
            ORDER BY CustCode, Contact
        """)
        rows = cursor.fetchall()
    except Exception as e:
        log.warning(f"  Failed to query 'contlist': {e}. Skipping contacts sync.")
        return 0

    log.info(f"  Fetched {len(rows)} contact rows from Synergy.")

    cust_map = fetch_customer_synergy_id_map()

    contacts = []
    skipped = 0
    for row in rows:
        customer_id = cust_map.get(str(row.CustCode)) if row.CustCode is not None else None
        if customer_id is None:
            skipped += 1
            continue

        # Build full name from first + last
        first = safe_str(row.FirstName)
        last = safe_str(row.LastName)
        name = " ".join(p for p in [first, last] if p) or None

        # Phone stored as int — convert to string, skip zeros
        phone_raw = row.Phone
        phone = str(phone_raw).strip() if phone_raw and int(phone_raw) != 0 else None

        # Composite synergy_id: CustCode_Contact (underscore separator)
        synergy_id = f"{row.CustCode}_{row.Contact}" if row.Contact is not None else None

        contacts.append({
            "customer_id": customer_id,
            "synergy_id": synergy_id,
            "name": name,
            "email": safe_str(row.Email),
            "phone": phone,
            "is_primary": False,
        })

    if skipped:
        log.debug(f"  Skipped {skipped} contacts with no matching customer in Supabase.")

    # Deduplicate on synergy_id (guard against duplicate CustCode+Contact rows in ERP)
    seen: set[str] = set()
    insertable = []
    for c in contacts:
        sid = c.get("synergy_id")
        if sid and sid not in seen:
            seen.add(sid)
            insertable.append(c)

    # KNOWN LIMITATION (QC-section-6 EQ-3): delete-then-insert is non-atomic.
    # If the network drops between the DELETE and the upsert below, the contacts
    # table will be wiped until the next nightly run. Future fix: add a UNIQUE
    # constraint on (customer_id, synergy_id) and switch to PostgREST upsert
    # with on_conflict, eliminating the destructive sweep. Tracked in the
    # callboard-qc Section 6 doc.
    if insertable:
        try:
            del_url = f"{SUPABASE_URL}/rest/v1/contacts?id=gte.0"
            del_headers = {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Prefer": "return=minimal",
            }
            requests.delete(del_url, headers=del_headers, timeout=30)
            log.debug("  Cleared existing contacts before re-insert.")
        except Exception as e:
            log.warning(f"  Could not clear contacts: {e}")

    count = upsert_in_batches(insertable, "contacts", on_conflict=None)
    log.info(f"  Contacts synced: {count}")
    return count


# ============================================================
# Sync: Ship-To Locations
# ============================================================

def sync_ship_to_locations(conn) -> int:
    log.info("--- Syncing ship-to locations ---")
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            shiplist.CustomerCode,
            shiplist.ShiplistCode,
            shiplist.Name,
            shiplist.Address,
            shiplist.City,
            shiplist.State,
            shiplist.ZipCode,
            shiplist.Contact,
            shiplist.Email
        FROM shiplist
        WHERE shiplist.CustomerCode > 0
        ORDER BY shiplist.CustomerCode, shiplist.ShiplistCode
    """)

    rows = cursor.fetchall()
    log.info(f"  Fetched {len(rows)} ship-to location rows from Synergy.")

    cust_map = fetch_customer_synergy_id_map()

    locations = []
    skipped = 0
    for row in rows:
        customer_id = cust_map.get(str(row.CustomerCode).strip()) if row.CustomerCode is not None else None
        if customer_id is None:
            skipped += 1
            continue

        address = build_address(
            row.Address, None, row.City, row.State, row.ZipCode
        )

        locations.append({
            "customer_id": customer_id,
            "synergy_customer_code": str(row.CustomerCode).strip(),
            "synergy_shiplist_code": str(row.ShiplistCode).strip(),
            "name": safe_str(row.Name),
            "address": address,
            "city": safe_str(row.City),
            "state": safe_str(row.State),
            "zip": safe_str(row.ZipCode),
            "contact": safe_str(row.Contact),
            "email": safe_str(row.Email),
            # Present in Synergy = confirmed; clears any same-day in-app provisional flag.
            "provisional": False,
            "synced_at": utcnow_iso(),
        })

    if skipped:
        log.debug(f"  Skipped {skipped} ship-to locations with no matching customer in Supabase.")

    count = upsert_in_batches(
        locations,
        "ship_to_locations",
        on_conflict="synergy_customer_code,synergy_shiplist_code"
    )
    log.info(f"  Ship-to locations synced: {count}")
    return count


def fetch_customer_synergy_id_map() -> dict[str, int]:
    """Fetch all customers from Supabase and return a dict of synergy_id -> id.

    Paginates in batches of 1000 to avoid Supabase's default row limit.
    """
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    result: dict[str, int] = {}
    offset = 0
    page_size = 1000
    try:
        while True:
            url = f"{SUPABASE_URL}/rest/v1/customers?select=id,synergy_id&order=id&limit={page_size}&offset={offset}"
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            data = response.json()
            if not data:
                break
            for row in data:
                if row.get("synergy_id"):
                    result[row["synergy_id"]] = row["id"]
            if len(data) < page_size:
                break
            offset += page_size
        log.info(f"  Customer map loaded: {len(result)} entries (paginated).")
        return result
    except Exception as e:
        log.warning(f"Could not fetch customer map from Supabase: {e}")
        return {}


# ============================================================
# Sync: Technicians
# ============================================================

def sync_technicians(conn) -> int:
    log.info("--- Syncing technicians ---")
    cursor = conn.cursor()

    # Sales rep codes 400–450 are the service technicians in Synergy.
    # Names are stored in ALL CAPS — title-case them on import.
    # Email in Synergy for these codes is shared/unmaintained, so we
    # generate a synthetic unique email per code for PM Scheduler use.
    # These accounts are not Supabase Auth users — they are assignment
    # targets only and will never log in.
    cursor.execute("""
        SELECT SlsmCode, Name
        FROM sslsm
        WHERE SlsmCode >= 400 AND SlsmCode <= 450
          AND Name IS NOT NULL AND TRIM(Name) != ''
        ORDER BY SlsmCode
    """)

    rows = cursor.fetchall()
    log.info(f"  Fetched {len(rows)} technician rows from Synergy.")

    technicians = []
    for row in rows:
        code = str(int(row.SlsmCode))
        name = str(row.Name).strip().title() if row.Name else f"Tech {code}"
        email = f"tech{code}@imperialdade.com"

        technicians.append({
            "synergy_id": code,
            "name": name,
            "email": email,
            "role": "technician",
            "active": True,
        })

    count = upsert_in_batches(technicians, "users", on_conflict="synergy_id")
    log.info(f"  Technicians synced: {count}")
    return count


# ============================================================
# Validation
# ============================================================

def validate_env() -> None:
    errors = []
    if not SUPABASE_URL:
        errors.append("SUPABASE_URL is not set.")
    if not SUPABASE_SERVICE_ROLE_KEY:
        errors.append("SUPABASE_SERVICE_ROLE_KEY is not set.")
    if errors:
        for e in errors:
            log.error(e)
        sys.exit(1)


# ============================================================
# Main
# ============================================================

def trigger_credit_hold_sweep() -> None:
    """Ask the app to backfill AR credit reviews for on-hold customers' open,
    un-started orders that never got one (customer went on hold after the order
    existed, or the order predates the feature). credit_hold was just refreshed
    by the customer sync. Non-fatal: a failure here must never fail the sync.
    Skipped if APP_BASE_URL / CREDIT_SWEEP_SECRET are not configured."""
    if not APP_BASE_URL or not CREDIT_SWEEP_SECRET:
        log.info("Credit-hold sweep skipped (APP_BASE_URL / CREDIT_SWEEP_SECRET not set).")
        return
    url = f"{APP_BASE_URL}/api/credit-review/sweep"
    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {CREDIT_SWEEP_SECRET}"},
            timeout=60,
        )
        if resp.status_code == 200:
            data = resp.json()
            log.info(
                "Credit-hold sweep: %s on-hold customer(s); %s order(s) routed to AR across %s customer(s).",
                data.get("onHoldCustomers"),
                data.get("created"),
                data.get("customersEnqueued"),
            )
        else:
            log.warning(f"Credit-hold sweep returned [{resp.status_code}]: {resp.text[:300]}")
    except Exception as e:
        log.warning(f"Credit-hold sweep request failed (non-fatal): {e}")


def main_products_only() -> None:
    """Lightweight refresh of just the product catalog (incl. qty_on_hand /
    qty_on_po). Scheduled hourly so the parts-queue Review step shows fresh stock
    numbers, without re-running the heavy customer/contact/ship-to sync. Reuses
    sync_products (full upsert with complete data, so no risk of junk rows)."""
    log.info("=" * 60)
    log.info("PM Scheduler — Hourly Product/Inventory Refresh starting")
    log.info("=" * 60)

    validate_env()

    started_at = utcnow_iso()
    sync_log_id = write_sync_log_start("products", started_at)

    erp_conn = None
    total_synced = 0
    error_message = None
    try:
        log.info("Connecting to SynergyERP via ODBC DSN 'ERPlinked'...")
        erp_conn = pyodbc.connect("DSN=ERPlinked", autocommit=True)
        total_synced = sync_products(erp_conn)
        # Open PO lines ride the hourly refresh so the est. arrival date stays as
        # fresh as the stock numbers. Non-fatal: a failure here shouldn't fail the
        # product refresh.
        try:
            sync_po_lines(erp_conn)
        except Exception as e:
            log.error(f"PO-lines sync failed (non-fatal): {e}", exc_info=True)
    except Exception as e:
        log.error(f"Product/inventory refresh failed: {e}", exc_info=True)
        error_message = str(e)
    finally:
        if erp_conn:
            erp_conn.close()

    completed_at = utcnow_iso()
    if error_message:
        write_sync_log_complete(sync_log_id, completed_at, total_synced,
                                status="failed", error_message=error_message)
        sys.exit(1)
    log.info(f"Product/inventory refresh complete. Products synced: {total_synced}")
    write_sync_log_complete(sync_log_id, completed_at, total_synced, status="success")
    sys.exit(0)


def main() -> None:
    if "--products-only" in sys.argv:
        main_products_only()
        return

    log.info("=" * 60)
    log.info("PM Scheduler — Nightly Synergy Sync starting")
    log.info("=" * 60)

    validate_env()

    started_at = utcnow_iso()
    sync_log_id = write_sync_log_start("full", started_at)
    log.debug(f"sync_log row created: id={sync_log_id}")

    erp_conn = None
    total_synced = 0
    failures: list[str] = []

    try:
        log.info("Connecting to SynergyERP via ODBC DSN 'ERPlinked'...")
        erp_conn = pyodbc.connect("DSN=ERPlinked", autocommit=True)
        log.info("Connected.")

        known_tables = discover_tables(erp_conn)

        # --- Customers ---
        customers_ok = False
        try:
            count = sync_customers(erp_conn)
            total_synced += count
            customers_ok = True
        except Exception as e:
            log.error(f"Customer sync failed: {e}", exc_info=True)
            failures.append(f"customers: {e}")

        # --- Credit-hold sweep (depends on customers + credit_hold being fresh) ---
        # Backfills AR reviews for on-hold customers' un-started open orders.
        if customers_ok:
            trigger_credit_hold_sweep()

        # --- Technicians ---
        try:
            count = sync_technicians(erp_conn)
            total_synced += count
        except Exception as e:
            log.error(f"Technician sync failed: {e}", exc_info=True)
            failures.append(f"technicians: {e}")

        # --- Ship-To Locations (depends on customers) ---
        try:
            count = sync_ship_to_locations(erp_conn)
            total_synced += count
        except Exception as e:
            log.error(f"Ship-to locations sync failed: {e}", exc_info=True)
            failures.append(f"ship_to_locations: {e}")

        # --- Contacts (depends on customers being in Supabase) ---
        try:
            count = sync_contacts(erp_conn, known_tables)
            total_synced += count
        except Exception as e:
            log.error(f"Contact sync failed: {e}", exc_info=True)
            failures.append(f"contacts: {e}")

        # --- Products ---
        try:
            count = sync_products(erp_conn)
            total_synced += count
        except Exception as e:
            log.error(f"Product sync failed: {e}", exc_info=True)
            failures.append(f"products: {e}")

        # --- Open PO lines (est. arrival dates for ordered parts) ---
        try:
            sync_po_lines(erp_conn)
        except Exception as e:
            log.error(f"PO-lines sync failed: {e}", exc_info=True)
            failures.append(f"po_lines: {e}")

    except pyodbc.Error as e:
        log.error(f"Could not connect to SynergyERP: {e}", exc_info=True)
        failures.append(f"odbc_connection: {e}")

    finally:
        if erp_conn:
            erp_conn.close()
            log.debug("ERP connection closed.")

    completed_at = utcnow_iso()

    if failures:
        error_summary = "; ".join(failures)
        log.error(f"Sync completed with failures: {error_summary}")
        log.info(f"Total records synced before failure(s): {total_synced}")
        write_sync_log_complete(
            sync_log_id,
            completed_at,
            total_synced,
            status="failed",
            error_message=error_summary,
        )
        sys.exit(1)
    else:
        log.info(f"Sync completed successfully. Total records synced: {total_synced}")
        write_sync_log_complete(
            sync_log_id,
            completed_at,
            total_synced,
            status="success",
        )
        sys.exit(0)


if __name__ == "__main__":
    main()
