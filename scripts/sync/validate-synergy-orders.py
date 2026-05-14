#!/usr/bin/env python3
"""
PM Scheduler — Nightly Synergy Order Validation

Validates two things for open service and PM tickets:

  1. `synergy_order_number` exists as `OrdNum` in Synergy `roh`
     → writes result to `synergy_validation_status` ('valid' / 'invalid')

  2. Each requested part's Synergy item number (`product_number`)
     appears as a `ProdCode` on that order in `rolnew`
     → writes result to `parts_validation_status`
        ('valid' = all parts match, 'partial' = some match, 'invalid' = none match,
         NULL = order invalid / no parts)

Runs nightly at 5:30 AM via Windows Task Scheduler (after the 5 AM sync).
"""

import argparse
import json
import os
import sys
import logging
import pyodbc
import requests
from datetime import datetime, timezone

# ============================================================
# Configuration
# ============================================================

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# ============================================================
# Logging setup
# ============================================================

def setup_logging() -> logging.Logger:
    # Stdout only — the PowerShell wrapper tees stdout/stderr into the daily
    # log file. A second writer here would race the wrapper's file handle and
    # silently drop tracebacks (this happened from 2026-04-25 through 2026-05-13).
    logger = logging.getLogger("synergy_validation")
    logger.setLevel(logging.DEBUG)

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
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
    headers["Prefer"] = "return=representation"
    response = requests.get(url, params=params, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def supabase_patch_by_id(table: str, row_id: str, data: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}"
    headers = supabase_headers()
    headers["Prefer"] = "return=minimal"
    response = requests.patch(url, json=data, headers=headers, timeout=15)
    response.raise_for_status()

# ============================================================
# Main validation logic
# ============================================================

EXCLUDED_SERVICE_STATUSES = ("canceled", "declined")
# For PM tickets, stop chasing once the ticket is billed or skipped. Billed
# tickets surface as invalid when their Synergy order has been archived out of
# `roh`, but there's no action the office can take post-billing so they're
# pure noise in the queue.
EXCLUDED_PM_STATUSES = ("skipped", "billed")


def fetch_candidates(table: str, excluded_statuses: tuple[str, ...]) -> list[dict]:
    """Fetch tickets from the given table that have an order # and are still actionable."""
    excluded = ",".join(excluded_statuses)
    return supabase_get(table, {
        "select": "id,synergy_order_number,parts_requested,status",
        "synergy_order_number": "not.is.null",
        "status": f"not.in.({excluded})",
    })


def fetch_single_ticket(table: str, ticket_id: str) -> dict | None:
    """Fetch one ticket by id for the on-demand re-validate path."""
    rows = supabase_get(table, {
        "select": "id,synergy_order_number,parts_requested,status",
        "id": f"eq.{ticket_id}",
    })
    return rows[0] if rows else None


def validate_single(table: str, ticket: dict) -> dict:
    """
    Validate a single ticket against Synergy and write the result back.
    Mirrors the per-ticket logic of the batch path. Returns a small result dict
    so the API route can echo it to the caller without re-fetching.
    """
    raw = str(ticket.get("synergy_order_number") or "").strip()
    now_iso = datetime.now(timezone.utc).isoformat()

    if not raw:
        patch = {
            "synergy_validation_status": None,
            "synergy_validated_at": now_iso,
            "parts_validation_status": None,
        }
        supabase_patch_by_id(table, ticket["id"], patch)
        return {"ok": True, **patch}

    try:
        ord_num = int(raw)
    except ValueError:
        patch = {
            "synergy_validation_status": "invalid",
            "synergy_validated_at": now_iso,
            "parts_validation_status": None,
        }
        supabase_patch_by_id(table, ticket["id"], patch)
        return {"ok": True, **patch, "reason": "non_numeric_order_number"}

    try:
        conn = pyodbc.connect("DSN=ERPlinked", autocommit=True, timeout=30)
        cursor = conn.cursor()
    except Exception as e:
        return {"ok": False, "error": f"synergy_connect_failed: {e}"}

    try:
        cursor.execute("SELECT OrdNum FROM roh WHERE OrdNum = ?", ord_num)
        order_ok = cursor.fetchone() is not None

        order_prodcodes: set[str] = set()
        if order_ok:
            cursor.execute("SELECT ProdCode FROM rolnew WHERE OrdNum = ?", ord_num)
            for (prod_code,) in cursor.fetchall():
                if prod_code is not None:
                    order_prodcodes.add(str(prod_code).strip())
    finally:
        conn.close()

    patch: dict = {
        "synergy_validation_status": "valid" if order_ok else "invalid",
        "synergy_validated_at": now_iso,
    }
    if not order_ok:
        patch["parts_validation_status"] = None
    else:
        patch["parts_validation_status"] = classify_parts(
            ticket.get("parts_requested") or [], order_prodcodes
        )
    supabase_patch_by_id(table, ticket["id"], patch)
    return {"ok": True, **patch}


def classify_parts(parts: list[dict], prodcodes_for_order: set[str]) -> str | None:
    """
    Return 'valid' / 'partial' / 'invalid' / None for the part set.
    Only considers parts that have moved past 'requested' (i.e. status in ordered/received).
    Returns None when there is nothing to validate.
    """
    checkable = [
        p for p in (parts or [])
        if p.get("status") in ("ordered", "received") and (p.get("product_number") or "").strip()
    ]
    if not checkable:
        return None

    matches = sum(1 for p in checkable if (p["product_number"] or "").strip() in prodcodes_for_order)
    if matches == len(checkable):
        return "valid"
    if matches == 0:
        return "invalid"
    return "partial"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Synergy order numbers and part numbers.")
    parser.add_argument(
        "--ticket-id",
        help="If set, validate only this one ticket and exit. Requires --source.",
    )
    parser.add_argument(
        "--source",
        choices=("pm", "service"),
        help="With --ticket-id, which table the ticket lives in.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="On single-ticket mode, write the result JSON to stdout (suppresses other stdout).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.ticket_id and not args.source:
        log.error("--ticket-id requires --source.")
        sys.exit(2)

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        log.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)

    # Single-ticket re-validate path (called by the /api/parts-queue/[id]/revalidate
    # endpoint). Same validation logic, no batching across the whole table.
    if args.ticket_id:
        # In --json mode, silence the human logger so stdout is pure JSON.
        if args.json:
            log.setLevel(logging.CRITICAL)
        table = "pm_tickets" if args.source == "pm" else "service_tickets"
        ticket = fetch_single_ticket(table, args.ticket_id)
        if not ticket:
            result = {"ok": False, "error": "ticket_not_found"}
            print(json.dumps(result) if args.json else result)
            sys.exit(1)
        result = validate_single(table, ticket)
        if args.json:
            print(json.dumps(result))
        else:
            log.info(f"Result: {result}")
        return

    log.info("=" * 60)
    log.info("Synergy Order + Parts Validation - starting")
    log.info("=" * 60)

    # 1. Fetch candidates from both ticket tables
    log.info("Fetching service_tickets with Synergy order numbers...")
    service_tickets = fetch_candidates("service_tickets", EXCLUDED_SERVICE_STATUSES)
    log.info(f"  service_tickets: {len(service_tickets)}")

    log.info("Fetching pm_tickets with Synergy order numbers...")
    pm_tickets = fetch_candidates("pm_tickets", EXCLUDED_PM_STATUSES)
    log.info(f"  pm_tickets: {len(pm_tickets)}")

    all_rows = [("service_tickets", t) for t in service_tickets] + \
               [("pm_tickets", t) for t in pm_tickets]

    if not all_rows:
        log.info("No tickets with order numbers found. Nothing to validate.")
        return

    # 2. Bucket order numbers (OrdNum -> list of (table, ticket_id))
    order_map: dict[int, list[tuple[str, str]]] = {}
    non_numeric: list[tuple[str, str, str]] = []  # (table, id, raw)
    for table, t in all_rows:
        raw = str(t.get("synergy_order_number") or "").strip()
        try:
            ord_num = int(raw)
        except ValueError:
            non_numeric.append((table, t["id"], raw))
            continue
        order_map.setdefault(ord_num, []).append((table, t["id"]))

    # Mark non-numeric order #s invalid straight away
    now_iso = datetime.now(timezone.utc).isoformat()
    for table, tid, raw in non_numeric:
        log.warning(f"  {table} {tid}: non-numeric order # '{raw}' - marking invalid")
        supabase_patch_by_id(table, tid, {
            "synergy_validation_status": "invalid",
            "synergy_validated_at": now_iso,
            "parts_validation_status": None,
        })

    unique_orders = list(order_map.keys())
    log.info(f"Unique numeric order numbers to validate: {len(unique_orders)} "
             f"({len(non_numeric)} skipped as non-numeric)")

    if not unique_orders:
        log.info("No numeric order numbers to validate.")
        return

    # 3. Query Synergy
    log.info("Connecting to Synergy ERP (DSN=ERPlinked)...")
    try:
        conn = pyodbc.connect("DSN=ERPlinked", autocommit=True, timeout=30)
        cursor = conn.cursor()
    except Exception as e:
        log.error(f"Failed to connect to Synergy: {e}")
        sys.exit(1)

    # 3a. Which orders exist?
    valid_orders: set[int] = set()
    batch_size = 100
    for i in range(0, len(unique_orders), batch_size):
        batch = unique_orders[i:i + batch_size]
        placeholders = ",".join(str(o) for o in batch)
        cursor.execute(f"SELECT OrdNum FROM roh WHERE OrdNum IN ({placeholders})")
        for row in cursor.fetchall():
            valid_orders.add(row[0])
    log.info(f"Synergy returned {len(valid_orders)} matching orders out of {len(unique_orders)} checked.")

    # 3b. Fetch every ProdCode on each valid order (one query, batched)
    prodcodes_by_order: dict[int, set[str]] = {}
    valid_list = sorted(valid_orders)
    for i in range(0, len(valid_list), batch_size):
        batch = valid_list[i:i + batch_size]
        placeholders = ",".join(str(o) for o in batch)
        cursor.execute(
            f"SELECT OrdNum, ProdCode FROM rolnew WHERE OrdNum IN ({placeholders})"
        )
        for ord_num, prod_code in cursor.fetchall():
            if prod_code is None:
                continue
            prodcodes_by_order.setdefault(ord_num, set()).add(str(prod_code).strip())

    conn.close()

    # 4. Write status per ticket
    valid_count = invalid_count = parts_valid = parts_partial = parts_invalid = 0
    rows_by_id: dict[tuple[str, str], dict] = {(tbl, t["id"]): t for tbl, t in all_rows}

    for ord_num, tickets in order_map.items():
        order_ok = ord_num in valid_orders
        order_prodcodes = prodcodes_by_order.get(ord_num, set())

        for table, tid in tickets:
            ticket = rows_by_id[(table, tid)]
            patch: dict = {
                "synergy_validation_status": "valid" if order_ok else "invalid",
                "synergy_validated_at": now_iso,
            }

            if not order_ok:
                # Order-level failure overrides parts validation
                patch["parts_validation_status"] = None
                invalid_count += 1
                log.warning(f"  INVALID: {table} {tid} - order #{ord_num} not found in Synergy")
            else:
                valid_count += 1
                parts_status = classify_parts(ticket.get("parts_requested") or [], order_prodcodes)
                patch["parts_validation_status"] = parts_status
                if parts_status == "valid":
                    parts_valid += 1
                elif parts_status == "partial":
                    parts_partial += 1
                    log.warning(
                        f"  PARTS PARTIAL: {table} {tid} - order #{ord_num} has some item #s not on the order")
                elif parts_status == "invalid":
                    parts_invalid += 1
                    log.warning(
                        f"  PARTS INVALID: {table} {tid} - none of the requested item #s appear on order #{ord_num}")

            supabase_patch_by_id(table, tid, patch)

    # 5. Summary
    log.info("-" * 40)
    log.info("Validation complete:")
    log.info(f"  Orders valid:        {valid_count}")
    log.info(f"  Orders invalid:      {invalid_count}")
    log.info(f"  Orders non-numeric:  {len(non_numeric)}")
    log.info(f"  Parts valid:         {parts_valid}")
    log.info(f"  Parts partial:       {parts_partial}")
    log.info(f"  Parts invalid:       {parts_invalid}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
