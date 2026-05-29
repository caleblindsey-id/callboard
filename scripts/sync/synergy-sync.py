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
        cursor_url = f"{SUPABASE_URL}/rest/v1/customers?select=synergy_id&active=eq.true"
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
        cursor.execute(f"""
            SELECT
                prod.ProdCode,
                prod.Desc1,
                prod.Desc2,
                prod.ListPrice1,
                prod.CostLoad,
                prod.CostPO,
                prod.SupersedeCode
            FROM prod
            WHERE prod.ComdtyCode IN ({placeholders})
              AND (prod.SupersedeCode IS NULL OR prod.SupersedeCode = '')
              AND (prod.Desc2 NOT LIKE '%OBSOLETE%' OR prod.Desc2 IS NULL)
            ORDER BY prod.ProdCode
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

        products.append({
            "synergy_id": str(row.ProdCode).strip(),
            "number": str(row.ProdCode).strip(),
            "description": description,
            "unit_price": float(row.ListPrice1) if row.ListPrice1 is not None else None,
            "unit_cost": unit_cost,
            "synced_at": utcnow_iso(),
        })

    count = upsert_in_batches(products, "products")
    log.info(f"  Products synced: {count}")
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

def main() -> None:
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
        try:
            count = sync_customers(erp_conn)
            total_synced += count
        except Exception as e:
            log.error(f"Customer sync failed: {e}", exc_info=True)
            failures.append(f"customers: {e}")

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
