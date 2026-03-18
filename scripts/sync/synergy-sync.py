#!/usr/bin/env python3
"""
PM Scheduler — Nightly Synergy Sync
Reads customers, contacts, and products from SynergyERP MySQL
and upserts them to Supabase via REST API.

Runs nightly at 5:00 AM via Windows Task Scheduler.
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

BATCH_SIZE = 500  # Max records per Supabase upsert request

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


def supabase_upsert(table: str, records: list[dict]) -> int:
    """POST a batch of records to Supabase with upsert semantics. Returns count upserted."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    response = requests.post(url, json=records, headers=supabase_headers(), timeout=60)
    if not response.ok:
        raise RuntimeError(
            f"Supabase upsert to '{table}' failed [{response.status_code}]: {response.text[:500]}"
        )
    return len(records)


def upsert_in_batches(records: list[dict], table: str) -> int:
    """Upsert records in batches of BATCH_SIZE. Returns total count upserted."""
    if not records:
        log.info(f"  No records to upsert for table '{table}'.")
        return 0

    total = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        count = supabase_upsert(table, batch)
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
    log.debug(f"Discovered ERP tables: {sorted(tables)}")
    return tables


# ============================================================
# Sync: Customers
# ============================================================

def sync_customers(conn) -> int:
    log.info("--- Syncing customers ---")
    cursor = conn.cursor()

    # Try with Active filter first; if column doesn't exist fall back to no filter
    try:
        cursor.execute("""
            SELECT CustNo, Name, ARTerms, CreditHold,
                   BillAddr1, BillAddr2, BillCity, BillState, BillZip
            FROM cust
            WHERE Active = 'Y'
            ORDER BY CustNo
        """)
    except Exception:
        log.debug("'Active' column not found on cust — querying all rows.")
        cursor.execute("""
            SELECT CustNo, Name, ARTerms, CreditHold,
                   BillAddr1, BillAddr2, BillCity, BillState, BillZip
            FROM cust
            ORDER BY CustNo
        """)

    rows = cursor.fetchall()
    log.info(f"  Fetched {len(rows)} customer rows from Synergy.")

    customers = []
    for row in rows:
        billing_address = build_address(
            row.BillAddr1, row.BillAddr2, row.BillCity, row.BillState, row.BillZip
        )
        customers.append({
            "synergy_id": str(row.CustNo).strip(),
            "name": str(row.Name).strip(),
            "account_number": str(row.CustNo).strip(),  # CustNo doubles as account number
            "ar_terms": safe_str(row.ARTerms),
            "credit_hold": (safe_str(row.CreditHold) or "N").upper() == "Y",
            "billing_address": billing_address,
            "synced_at": utcnow_iso(),
        })

    count = upsert_in_batches(customers, "customers")
    log.info(f"  Customers synced: {count}")
    return count


# ============================================================
# Sync: Products
# ============================================================

def sync_products(conn) -> int:
    log.info("--- Syncing products ---")
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT ProdNo, Desc1, SellPrice
            FROM prod
            ORDER BY ProdNo
        """)
    except Exception as e:
        log.warning(f"  Could not query 'prod' table: {e}. Skipping products sync.")
        return 0

    rows = cursor.fetchall()
    log.info(f"  Fetched {len(rows)} product rows from Synergy.")

    products = []
    for row in rows:
        products.append({
            "synergy_id": str(row.ProdNo).strip(),
            "number": str(row.ProdNo).strip(),
            "description": safe_str(row.Desc1),
            "unit_price": float(row.SellPrice) if row.SellPrice is not None else None,
            "synced_at": utcnow_iso(),
        })

    count = upsert_in_batches(products, "products")
    log.info(f"  Products synced: {count}")
    return count


# ============================================================
# Sync: Contacts
# ============================================================

CONTACT_TABLE_CANDIDATES = ["cust_cont", "custcont", "contacts", "contact", "cust_contacts"]


def sync_contacts(conn, known_tables: set[str]) -> int:
    log.info("--- Syncing contacts ---")

    # Find the right table name
    contact_table = None
    for candidate in CONTACT_TABLE_CANDIDATES:
        if candidate in known_tables:
            contact_table = candidate
            break

    if contact_table is None:
        log.info(
            f"  No contact table found in Synergy (tried: {', '.join(CONTACT_TABLE_CANDIDATES)}). "
            "Skipping contacts sync."
        )
        return 0

    log.debug(f"  Using contact table: '{contact_table}'")

    # Discover columns in the contact table
    cursor = conn.cursor()
    try:
        cursor.execute(f"SHOW COLUMNS FROM {contact_table}")
        columns = {row[0].lower() for row in cursor.fetchall()}
        log.debug(f"  Contact table columns: {sorted(columns)}")
    except Exception as e:
        log.warning(f"  Could not inspect contact table columns: {e}. Skipping contacts sync.")
        return 0

    # Build query based on available columns
    col_map = {
        "custno": next((c for c in columns if c in ("custno", "cust_no", "customerid")), None),
        "name": next((c for c in columns if c in ("name", "contactname", "contact_name", "fullname")), None),
        "email": next((c for c in columns if c in ("email", "emailaddress", "email_address")), None),
        "phone": next((c for c in columns if c in ("phone", "phoneno", "phone_no", "telephone")), None),
        "synergy_id": next((c for c in columns if c in ("contno", "cont_no", "contactid", "contact_id", "id")), None),
        "is_primary": next((c for c in columns if c in ("primary", "isprimary", "is_primary", "primarycontact")), None),
    }

    log.debug(f"  Column mapping: {col_map}")

    # We need at least a customer reference to link contacts
    if col_map["custno"] is None:
        log.warning(
            f"  Could not identify a customer foreign key column in '{contact_table}'. "
            "Skipping contacts sync."
        )
        return 0

    # Build SELECT dynamically based on what's available
    select_cols = [col_map["custno"]]
    if col_map["synergy_id"]:
        select_cols.append(col_map["synergy_id"])
    if col_map["name"]:
        select_cols.append(col_map["name"])
    if col_map["email"]:
        select_cols.append(col_map["email"])
    if col_map["phone"]:
        select_cols.append(col_map["phone"])
    if col_map["is_primary"]:
        select_cols.append(col_map["is_primary"])

    sql = f"SELECT {', '.join(select_cols)} FROM {contact_table} ORDER BY {col_map['custno']}"
    log.debug(f"  Contact query: {sql}")

    try:
        cursor.execute(sql)
        rows = cursor.fetchall()
    except Exception as e:
        log.warning(f"  Failed to query contact table: {e}. Skipping contacts sync.")
        return 0

    log.info(f"  Fetched {len(rows)} contact rows from Synergy.")

    # We need customer synergy_id → Supabase customer.id mapping
    # Fetch all customers from Supabase to build the map
    cust_map = fetch_customer_synergy_id_map()

    contacts = []
    skipped = 0
    for row in rows:
        row_dict = dict(zip(select_cols, row))
        cust_no = safe_str(row_dict.get(col_map["custno"]))
        customer_id = cust_map.get(cust_no) if cust_no else None

        if customer_id is None:
            skipped += 1
            continue

        synergy_id = safe_str(row_dict.get(col_map["synergy_id"])) if col_map["synergy_id"] else None
        name = safe_str(row_dict.get(col_map["name"])) if col_map["name"] else None
        email = safe_str(row_dict.get(col_map["email"])) if col_map["email"] else None
        phone = safe_str(row_dict.get(col_map["phone"])) if col_map["phone"] else None
        is_primary_raw = row_dict.get(col_map["is_primary"]) if col_map["is_primary"] else None
        is_primary = (safe_str(is_primary_raw) or "N").upper() == "Y" if is_primary_raw is not None else False

        contacts.append({
            "customer_id": customer_id,
            "synergy_id": synergy_id,
            "name": name,
            "email": email,
            "phone": phone,
            "is_primary": is_primary,
        })

    if skipped:
        log.debug(f"  Skipped {skipped} contacts with no matching customer in Supabase.")

    # Contacts upsert: if synergy_id is present, use it; otherwise skip upsert (no conflict key)
    upsertable = [c for c in contacts if c.get("synergy_id")]
    non_upsertable = len(contacts) - len(upsertable)
    if non_upsertable:
        log.debug(f"  {non_upsertable} contacts have no synergy_id — skipping (cannot upsert without conflict key).")

    count = upsert_in_batches(upsertable, "contacts")
    log.info(f"  Contacts synced: {count}")
    return count


def fetch_customer_synergy_id_map() -> dict[str, int]:
    """Fetch all customers from Supabase and return a dict of synergy_id -> id."""
    url = f"{SUPABASE_URL}/rest/v1/customers?select=id,synergy_id&limit=10000"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
        return {row["synergy_id"]: row["id"] for row in data if row.get("synergy_id")}
    except Exception as e:
        log.warning(f"Could not fetch customer map from Supabase: {e}")
        return {}


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

        # --- Contacts ---
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
