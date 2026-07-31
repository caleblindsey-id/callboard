#!/usr/bin/env python3
"""
CallBoard - Synergy labor facts sync (tech payouts Round 3)

Pulls invoiced service labor per technician per month out of SynergyERP and
lands it in public.synergy_labor_facts, the staging table migration 153 added.
Round 4 turns those rows into payout_lines and the commission report.

Synergy is the AUTHORITY for billed labor dollars. CallBoard applies tier math
on top and adds its own ACE / PM / equipment bonus data. This script replaces a
Phocas dashboard read through browser automation on a logged-in Chrome session.

--------------------------------------------------------------------------
THE RECIPE -- do not "improve" it without re-running the Round 1 gate
--------------------------------------------------------------------------
Validated 2026-07-31 against the manual workbook: June 2026 reproduces to the
penny across all 11 technicians on every bucket, the subtotal, and the final
commission. Five of six 2026 months are clean on the ERP-sourced buckets.
Gate script: Compass projects/work/tech-payouts/analysis/validate_months.py

  attribution : invh.Slsm1  -- the invoice HEADER salesman, NOT invl.Slsm.
                Both produce the same grand total but different per-tech splits.
                On the line basis Wyatt landed at $7,324.62 (5% tier); on the
                header basis $7,921.75 (7.5%). His commission moved $366.23 ->
                $594.13, and $594.13 is what was actually paid. A 3% subtotal
                error produced a 62% commission error, because the rate applies
                to the WHOLE subtotal and the tier boundaries are cliffs.

  scope       : invh.OrdType IN (21, 22) AND Ot19Comp = 0,
                invh.InvDate within the month (invoice-date basis, matching the
                workbook, Phocas, and the P&L).

  sign        : invh.Status 30 = invoice (+), 31 = credit memo (-).
                This is what nets reversals the way the Phocas totals already do.

  value       : invl.ExtShipAmt. NOT invh.TotDol4Prof (runs 6-9% high).

  buckets     : invl.ProdCode
                  444000000 LABOR SHOP -> labor_warranty if OrdType 21
                                          labor_shop     if OrdType 22
                  444000300 TRIP CHARGE    -> trip_charge
                  444000400 PM             -> pm_labor, taken at a FLAT 85%
                  444000001 DIAGNOSTIC FEE -> diagnostic_fee

  PM at 85%   : Phocas "PM Profit Est." is a standing 15% parts allowance, NOT
                value minus actual parts. The name is literal: it is an
                ESTIMATE. Netting real P210 parts per invoice was wrong in both
                directions (some techs high, some low); the flat factor held to
                the penny for all seven techs with PM revenue in June and for
                every month tested. pm_factor_applied records it per row so a
                future change to the factor is visible in the data.

--------------------------------------------------------------------------
TIMEZONE
--------------------------------------------------------------------------
The period here comes from invh.InvDate, which is a MySQL DATE -- a calendar
day with no zone -- so the month is unambiguous and needs no anchoring. That is
NOT true on the CallBoard side, where billed_at / earned_at / approved_at are
timestamptz and must be bucketed through src/lib/business-time.ts. Do not copy
a UTC month boundary from here into TypeScript; see migration 154.

--------------------------------------------------------------------------
IDEMPOTENCY
--------------------------------------------------------------------------
Keyed on (synergy_id, period, bucket), so re-running a still-open month
REFRESHES rather than doubles. Every tech seen in the period gets all five
buckets written, zeros included, so a bucket that drops to nothing is
overwritten rather than left stale. After the upsert, any row for the period
NOT touched by this run (a tech who no longer has activity at all) is swept by
pulled_at. Rows are never deleted before the new ones land, so the table is
never momentarily empty.

The ERP replica lags one day. A month is only safe to LOCK after the first
business day of the following month, which is also when the written plan says
commission is calculated.

Usage:
    python sync-labor-facts.py                  # current month (Central)
    python sync-labor-facts.py --period 2026-06
    python sync-labor-facts.py --months 6       # last 6 months, oldest first
    python sync-labor-facts.py --period 2026-06 --dry-run
"""

import os
import sys
import argparse
import logging
from collections import defaultdict
from datetime import datetime, timezone, date
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

import pyodbc
import requests

# ============================================================
# Configuration
# ============================================================

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

BUSINESS_TZ = ZoneInfo("America/Chicago")
BATCH_SIZE = 500

# invl.ProdCode -> bucket. Mirrors the CHECK constraint on
# synergy_labor_facts.bucket in migration 153.
PROD_LABOR = "444000000"
PROD_TRIP = "444000300"
PROD_PM = "444000400"
PROD_DIAG = "444000001"

BUCKETS = ("labor_shop", "labor_warranty", "trip_charge", "pm_labor", "diagnostic_fee")

# "PM Profit Est." standing parts allowance. See the recipe note above.
PM_PROFIT_FACTOR = 0.85

# Order types that carry service labor. 21 = warranty, 22 = non-warranty.
ORDER_TYPES = (21, 22)

# Synergy salesman codes that carry service labor but are NOT technicians, so
# their dollars can never reach a tech payout. Verified against the ERP `sslsm`
# master 2026-07-31 and confirmed by Caleb ("those are not tech numbers").
# Logged at INFO rather than WARNING so the genuinely unknown case stays loud.
# Keep in sync with KNOWN_NON_TECH_SYNERGY_IDS in
# src/lib/commission/report-types.ts.
KNOWN_NON_TECH_CODES = {
    "7": "Stanley Burt, outside sales",
    "9": "Andye Bramlett, outside sales",
    "38": "Tommy Mayson, outside sales",
    "200": "Tim Adams, outside sales",
    "999": "INTERNAL / house account",
}

# invh.Status: 30 = invoice (positive), 31 = credit memo (negative).
STATUS_CREDIT_MEMO = 31


# ============================================================
# Logging
# ============================================================

def setup_logging() -> logging.Logger:
    script_dir = Path(__file__).parent
    logs_dir = script_dir.parent.parent / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / f"labor-facts-{datetime.now().strftime('%Y-%m-%d')}.log"

    fmt = "%(asctime)s [%(levelname)s] %(message)s"
    logging.basicConfig(
        level=logging.INFO,
        format=fmt,
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )
    return logging.getLogger(__name__)


log = setup_logging()


# ============================================================
# Period helpers
# ============================================================

def current_period() -> str:
    """Current YYYY-MM in the BUSINESS timezone, not UTC and not the box's zone."""
    return datetime.now(BUSINESS_TZ).strftime("%Y-%m")


def parse_period(period: str) -> tuple[int, int]:
    try:
        year, month = period.split("-")
        y, m = int(year), int(month)
        if not (1 <= m <= 12) or y < 2000:
            raise ValueError
        return y, m
    except Exception:
        raise SystemExit(f"Invalid --period '{period}'. Expected YYYY-MM, e.g. 2026-06.")


def period_bounds(year: int, month: int) -> tuple[str, str]:
    """Half-open [start, end) calendar dates for the month, as YYYY-MM-DD."""
    nxt_y, nxt_m = (year + 1, 1) if month == 12 else (year, month + 1)
    return f"{year}-{month:02d}-01", f"{nxt_y}-{nxt_m:02d}-01"


def recent_periods(n: int) -> list[str]:
    """The last n periods ending with the current one, oldest first."""
    today = datetime.now(BUSINESS_TZ).date()
    out = []
    y, m = today.year, today.month
    for _ in range(n):
        out.append(f"{y}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


# ============================================================
# Supabase REST helpers (same shape as synergy-sync.py)
# ============================================================

def supabase_headers(prefer: str = "resolution=merge-duplicates,return=minimal") -> dict:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def upsert_labor_facts(records: list[dict]) -> int:
    if not records:
        return 0
    url = (
        f"{SUPABASE_URL}/rest/v1/synergy_labor_facts"
        "?on_conflict=synergy_id,period,bucket"
    )
    total = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        resp = requests.post(url, json=batch, headers=supabase_headers(), timeout=60)
        if not resp.ok:
            raise RuntimeError(
                f"Upsert to synergy_labor_facts failed [{resp.status_code}]: {resp.text[:500]}"
            )
        total += len(batch)
    return total


def known_synergy_ids() -> set[str]:
    """synergy_id values CallBoard knows about. Used only to WARN -- the sync
    deliberately lands every code it finds. synergy_labor_facts has no FK to
    users precisely so an unrecognised salesman surfaces as a reconciliation
    note instead of a failed insert."""
    url = f"{SUPABASE_URL}/rest/v1/users?select=synergy_id&synergy_id=not.is.null"
    resp = requests.get(url, headers=supabase_headers(prefer="return=representation"), timeout=30)
    if not resp.ok:
        log.warning(f"  Could not read users.synergy_id [{resp.status_code}]; skipping the unknown-code check.")
        return set()
    return {str(r["synergy_id"]).strip() for r in resp.json() if r.get("synergy_id")}


def sweep_stale(period: str, run_started_iso: str) -> int:
    """Delete rows for the period this run did not write (a tech with no activity
    at all any more). Runs AFTER the upsert so the table is never empty."""
    # quote() is required, not optional: an ISO timestamp ends in '+00:00', and a
    # bare '+' in a query string decodes to a SPACE, which PostgREST rejects as
    # 'invalid input syntax for type timestamp with time zone'.
    url = (
        f"{SUPABASE_URL}/rest/v1/synergy_labor_facts"
        f"?period=eq.{quote(period, safe='')}"
        f"&pulled_at=lt.{quote(run_started_iso, safe='')}"
    )
    resp = requests.delete(url, headers=supabase_headers(prefer="return=representation"), timeout=60)
    if not resp.ok:
        raise RuntimeError(
            f"Stale sweep failed [{resp.status_code}]: {resp.text[:500]}"
        )
    try:
        return len(resp.json())
    except Exception:
        return 0


# ============================================================
# Extraction
# ============================================================

def chunks(seq, n=500):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def extract(conn, year: int, month: int) -> dict[str, dict[str, float]]:
    """{synergy_id: {bucket: amount}} straight from Synergy for the month."""
    start, end = period_bounds(year, month)
    cur = conn.cursor()

    cur.execute(
        f"""SELECT KeyInvCMNo, OrdType, Slsm1, Status
              FROM invh
             WHERE InvDate >= ? AND InvDate < ?
               AND Ot19Comp = 0
               AND OrdType IN ({','.join(str(t) for t in ORDER_TYPES)})""",
        start,
        end,
    )
    headers = cur.fetchall()
    if not headers:
        log.info(f"  No invoice headers in {year}-{month:02d}.")
        return {}

    ktype = {h.KeyInvCMNo: int(h.OrdType) for h in headers}
    kstat = {h.KeyInvCMNo: int(h.Status) for h in headers}
    kslsm = {h.KeyInvCMNo: str(h.Slsm1).strip() for h in headers}
    log.info(f"  {len(headers):,} invoice headers.")

    out: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    line_count = 0

    for chunk in chunks(list(ktype)):
        placeholders = ",".join("?" for _ in chunk)
        cur.execute(
            f"""SELECT KeyInvCMNo, ProdCode, ExtShipAmt
                  FROM invl
                 WHERE KeyInvCMNo IN ({placeholders})""",
            *chunk,
        )
        for line in cur.fetchall():
            key = line.KeyInvCMNo
            amount = float(line.ExtShipAmt or 0)
            # Credit memos net against invoices.
            if kstat.get(key) == STATUS_CREDIT_MEMO:
                amount = -amount

            tech = kslsm[key]
            prod = (line.ProdCode or "").strip()

            if prod == PROD_LABOR:
                bucket = "labor_warranty" if ktype[key] == 21 else "labor_shop"
            elif prod == PROD_TRIP:
                bucket = "trip_charge"
            elif prod == PROD_PM:
                bucket = "pm_labor"
            elif prod == PROD_DIAG:
                bucket = "diagnostic_fee"
            else:
                continue

            out[tech][bucket] += amount
            line_count += 1

    # PM is taken at the flat profit factor, matching Phocas "PM Profit Est."
    for tech in out:
        out[tech]["pm_labor"] = round(out[tech]["pm_labor"] * PM_PROFIT_FACTOR, 2)

    log.info(f"  {line_count:,} labor lines across {len(out)} technicians.")
    return out


def to_records(period: str, extracted: dict, run_started_iso: str) -> list[dict]:
    """One row per tech per bucket, zeros included, so a bucket that drops to
    nothing is overwritten rather than left holding last run's value."""
    records = []
    for tech, buckets in sorted(extracted.items()):
        for bucket in BUCKETS:
            records.append(
                {
                    "synergy_id": tech,
                    "period": period,
                    "bucket": bucket,
                    "amount": round(buckets.get(bucket, 0.0), 2),
                    "pm_factor_applied": PM_PROFIT_FACTOR if bucket == "pm_labor" else None,
                    "pulled_at": run_started_iso,
                }
            )
    return records


# ============================================================
# Main
# ============================================================

def sync_period(conn, period: str, dry_run: bool, known: set[str]) -> dict:
    year, month = parse_period(period)
    run_started = datetime.now(timezone.utc)
    run_started_iso = run_started.isoformat()

    log.info(f"Period {period}:")
    extracted = extract(conn, year, month)
    records = to_records(period, extracted, run_started_iso)

    # Salesmen the ERP attributed service labor to that CallBoard has no user
    # for. Split two ways so the recurring, already-explained ones do not train
    # everyone to ignore this line.
    unknown = sorted(set(extracted) - known) if known else []
    for code in unknown:
        amounts = {k: round(v, 2) for k, v in extracted[code].items() if v}
        if not amounts:
            continue
        if code in KNOWN_NON_TECH_CODES:
            log.info(
                f"  Non-tech code '{code}' ({KNOWN_NON_TECH_CODES[code]}) has labor in "
                f"{period}: {amounts}. Expected -- not a technician, so no payout."
            )
        else:
            log.warning(
                f"  UNKNOWN salesman code '{code}' has labor in {period}: {amounts}. "
                "Not a CallBoard user and not a known sales rep. If this is a technician, "
                "set their Synergy ID on the user record or they will be underpaid."
            )

    total = sum(
        v for buckets in extracted.values() for k, v in buckets.items()
    )
    for tech in sorted(extracted):
        b = extracted[tech]
        log.info(
            f"    {tech}  shop {b.get('labor_shop', 0):>10,.2f}"
            f"  war {b.get('labor_warranty', 0):>8,.2f}"
            f"  trip {b.get('trip_charge', 0):>8,.2f}"
            f"  pm {b.get('pm_labor', 0):>10,.2f}"
            f"  diag {b.get('diagnostic_fee', 0):>8,.2f}"
        )
    log.info(f"  Period total across all buckets: {total:,.2f}")

    if dry_run:
        log.info(f"  DRY RUN - would upsert {len(records)} rows.")
        return {"period": period, "rows": len(records), "swept": 0, "total": total}

    upserted = upsert_labor_facts(records)
    swept = sweep_stale(period, run_started_iso)
    log.info(f"  Upserted {upserted} rows, swept {swept} stale.")
    return {"period": period, "rows": upserted, "swept": swept, "total": total}


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync Synergy labor facts into CallBoard.")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--period", help="Single period to sync, YYYY-MM.")
    group.add_argument("--months", type=int, help="Sync the last N periods, oldest first.")
    ap.add_argument("--dry-run", action="store_true", help="Extract and log, write nothing.")
    args = ap.parse_args()

    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            log.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
            return 1

    if args.period:
        periods = [args.period]
    elif args.months:
        periods = recent_periods(args.months)
    else:
        periods = [current_period()]

    log.info("=" * 60)
    log.info(f"Synergy labor facts sync - {len(periods)} period(s): {', '.join(periods)}")
    log.info("=" * 60)

    conn = None
    try:
        conn = pyodbc.connect("DSN=ERPlinked", autocommit=True)
        log.info("Connected to SynergyERP.")
        known = known_synergy_ids() if (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) else set()
        results = [sync_period(conn, p, args.dry_run, known) for p in periods]
    except pyodbc.Error as e:
        log.error(f"Could not connect to SynergyERP: {e}", exc_info=True)
        return 1
    except Exception as e:
        log.error(f"Sync failed: {e}", exc_info=True)
        return 1
    finally:
        if conn:
            conn.close()
            log.debug("ERP connection closed.")

    log.info("=" * 60)
    for r in results:
        log.info(f"  {r['period']}: {r['rows']} rows, {r['swept']} swept, {r['total']:,.2f} total")
    log.info("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
