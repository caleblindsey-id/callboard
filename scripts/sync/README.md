# WrenchDesk — Nightly Synergy Sync

Reads customers, contacts, and products from SynergyERP (MySQL 5.5) and upserts them to the WrenchDesk Supabase database via REST API. Runs nightly at 5 AM, after Synergy's own overnight refresh completes (~2 AM start, ~2 hour run).

---

## Prerequisites

- Python 3.9 or later
- ODBC DSN `ERPlinked` configured on this workstation (already set up)
- Supabase project with the WrenchDesk schema applied
- Required Python packages:

```
pip install pyodbc requests
```

---

## Environment Variables

The script reads two environment variables:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://abcdef.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key from Supabase dashboard — bypasses Row Level Security |

**Option A — Edit run-sync.ps1 directly (simple, acceptable for a workstation)**

Open `run-sync.ps1` and replace the placeholder values:

```powershell
$env:SUPABASE_URL              = "https://YOUR_PROJECT_ID.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_KEY"
```

**Option B — Windows System Environment Variables (more secure, keeps secrets out of scripts)**

1. Open Start → search "Environment Variables" → "Edit the system environment variables"
2. Click "Environment Variables..."
3. Under "User variables", click New and add:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key
4. Remove (or comment out) the two `$env:` lines in `run-sync.ps1`

Your Supabase URL and service role key are in the Supabase dashboard under **Project Settings → API**.

---

## Test Manually

From a terminal (with environment variables set):

```bash
python scripts/sync/synergy-sync.py
```

Or via PowerShell:

```powershell
.\scripts\sync\run-sync.ps1
```

The script exits with code `0` on success and `1` if any sync type fails. Check the `logs/` directory at the project root for detailed output.

---

## Windows Task Scheduler Setup

**Preferred:** run the setup scripts (auto-detects paths, handles legacy cleanup):

```powershell
# Right-click each and "Run as administrator" (or run from an elevated PowerShell)
.\setup-task-scheduler.ps1         # 5:00 AM nightly Synergy sync
.\setup-validation-task.ps1        # 5:30 AM parts/order validation
.\setup-equipment-sale-scan-task.ps1  # 5:35 AM equipment-sale lead scan
```

Each script:
- Removes any pre-rename `PM Scheduler - *` task with the matching role
- Registers the task as `WrenchDesk - *` pointing at the current folder location
- Uses `$PSScriptRoot` so it works from whatever path you run it from — re-run after folder renames without code changes

**Manual fallback** (only if the setup scripts won't run):

1. Open **Task Scheduler**
2. Click **Create Basic Task**
3. **Name:** `WrenchDesk - Nightly Synergy Sync`
4. **Trigger:** Daily at **5:00 AM**
5. **Action → Start a program:**
   - **Program/script:** `powershell.exe`
   - **Arguments:** `-ExecutionPolicy Bypass -File "<absolute path to>\scripts\sync\run-sync.ps1"`
   - **Start in:** the folder containing the repo

Test with right-click → **Run**.

---

## Checking Sync Status

- **Logs directory:** `<repo root>/logs/sync-YYYY-MM-DD.log` — one file per day, written by both the script and the PowerShell wrapper
- **Supabase sync_log table:** Each run writes a row with `sync_type`, `started_at`, `completed_at`, `records_synced`, `status`, and `error_message`
- **App dashboard:** The Sync Status Banner in the WrenchDesk app reads from the `sync_log` table

---

## Troubleshooting

**ODBC connection fails**

- Make sure the `ERPlinked` DSN is configured: Start → "ODBC Data Sources (64-bit)" → System DSN tab
- Confirm the MySQL server at `192.168.1.103:3306` is reachable from this workstation
- Check that the `pyodbc` package is installed for the correct Python executable

**Supabase returns 401 Unauthorized**

- Verify `SUPABASE_SERVICE_ROLE_KEY` is set correctly (not the anon key — the service role key)
- Service role key is under Supabase dashboard → Project Settings → API → `service_role` (secret)

**Supabase returns 409 Conflict or 400 Bad Request**

- The upsert uses `resolution=merge-duplicates`, which requires a `UNIQUE` constraint on the conflict column (`synergy_id`). Confirm the schema migrations have been applied.
- If the error message references a specific field, check that the column exists in both the Synergy query and the Supabase table.

**Contact table not found**

- The script searches for these table names in order: `cust_cont`, `custcont`, `contacts`, `contact`, `cust_contacts`
- If contacts live under a different name in your Synergy instance, add it to `CONTACT_TABLE_CANDIDATES` at the top of `synergy-sync.py`
- Contacts sync is non-fatal — if the table is missing, the script logs a message and continues

**Partial sync (some records synced, status = failed)**

- Each sync type (customers, contacts, products) runs independently
- If one fails, the others still complete
- Check the log file for the specific error under the failing section
