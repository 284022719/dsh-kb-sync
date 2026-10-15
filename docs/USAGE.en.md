# Usage guide (dsh-kb-sync)

> **This document is the "how".** For "what it is, where its boundaries are, why it is built this way" read [`../README.en.md`](../README.en.md);
> for per-release changes see [`../CHANGELOG.md`](../CHANGELOG.md); for the capability-by-capability risk list see [`CAPABILITY-DISCLOSURE.md`](CAPABILITY-DISCLOSURE.md).
>
> `<plugin dir>` below is the installed plugin folder (`file:` installs are copied snapshots — see the last row of troubleshooting).

## 1. Five-minute quick start

1. **Install**: `dsh plugin --profile <your profile> add github:284022719/dsh-kb-sync`, then **restart DSH**.
2. **Open the control page** (on the author's machine the entry is the console **Sync** tab, which embeds it): `http://127.0.0.1:<your DSH web port>/__dsh-kb-sync/` (same port as the GUI).
3. **Paste the token (§①)**: sign in to chat.deepseek.com → F12 → Application → Local Storage → copy `userToken` → paste → Save.
   It only goes into the DSH credential service; the plugin writes it to no file, log or response.
4. **Pull once (§②)**: *Start pull* for everyday catching-up; *Full backfill* the first time you want complete history.
5. **Search (§③)**: a keyword; every hit can be expanded to the full markdown.
6. **Health check**: *Update knowledge base* does sign-in → check-for-new → fetch → organise → check-up in one go.

> There is also an in-app entry: **Settings → dsh-kb-sync** (status summary plus Fetch new chats / Update knowledge base).

## 2. "I want to…" → where to click

| I want to… | Do this | Writes to disk? | Uses model quota? |
|---|---|---|---|
| Bring in newly chatted conversations | §② *Start pull* (incremental) | yes (only new/continued) | no |
| Fill in older history | §② *Full backfill* (official export zip) | only when the export has more | no |
| Run the whole update once | *Update knowledge base* | yes (incl. rebuild) | **yes** (the organise step calls the model) |
| See what the model would decide, without writing | *Dry run (show what would change)* | no knowledge-base writes, only `sync/out/` | yes |
| Apply the judgement and rebuild | §⑤ *Run, write and rebuild* | yes | yes |
| Check the knowledge base for corruption | toolbar *Run knowledge-base check* | no | no |
| Read one conversation locally | §③ search → *open full text* | no | no |
| Replace/forget the stored token | §① *Save* / *Clear* | credential service only | no |

## 3. Choosing between the three sync paths

| Path | Coverage | When | Caveat |
|---|---|---|---|
| **Incremental pull** | the list endpoint returns **at most the newest 100** and **cannot page** (`count` caps at 100; `page`/`cursor`/… are ignored; `POST` → 405 — measured 2026-10-12) | every day | it only guarantees "grows forward each day"; gaps in the middle can never be filled by it |
| **Full backfill** | the official export package (the server generates one complete export) | the first time, or when you spot a gap | runs in the background for minutes; phases `trigger → waiting-export → downloading → parsing → merging → done` |
| **Update knowledge base** | both of the above + organise + check-up | one command for everything | **consumes model quota**; a 6-hour freshness gate applies (see §6) |

> New conversations are always inside the incremental window (the list is sorted by `updated_at` descending), so "the web clearly has new chats but it reports 0" is usually not a plugin defect — check the conversation's real time, then the `recon`/`fetch` readings in `/status`'s `chain.report`.

## 4. Search (§③)

- Substring match over **title and body**, case-insensitive; `role=user` restricts to your own messages.
- It **scans the JSONL with no index**: fine for a few thousand conversations, not for ten times that.
- *open full text* renders the normalized markdown (**thinking process and web-search records included**); originals over 400 KB are truncated and flagged.
- For scripting: `/__dsh-kb-sync/search?q=<words>&role=user` returns JSON.

## 5. Organise (model classification & extraction): dry run versus write

The default button is the **dry run**, and its value is seeing exactly what would be written:

1. prepare inputs (reusing the pipeline's `prep-inbox.mjs`) → 2. ask the host `llm` service for **one JSON judgement** →
3. write `<pipeline data>/sync/out/` → 4. validate with the pipeline's `apply-extraction.mjs` (classification index set must match the input exactly, topics must be legal, specialty parents must match).

**A failed validation writes nothing at all** — deliberately: letting the model edit the archive directly makes silently wrong money or health facts very hard to notice.
*Run, write and rebuild* then rebuilds in order: `apply-update-topics` → `build-kb` → `build-specialties` → `map-specialties` → `build-health-profile` → `sync-knowledge`.

- The per-call generation cap is configurable (`processMaxTokens`, default 4096); too small produces empty output (`unparseable-output`).
- Finance data only ever lands in the **candidate area**; nothing is booked automatically.

## 6. Manual and scheduled runs

**Manual (any platform)**

- The control-page buttons (they pass `force:true`, skipping the freshness gate).
- Double-click `<root>\tools\pipeline\trigger.cmd` (Windows): it only pokes the chain — picks a usable `trigger-source.json`, polls `/status` until the host answers (~3 minutes), `POST`s `/pipeline`, and appends each stage's result to `trigger.log`. If the host is not running it exits **3** and leaves a line in `LAST-SYNC.txt`.

**Scheduled (optional, Windows Task Scheduler)**

```powershell
$action    = New-ScheduledTaskAction -Execute '<plugin dir>\tools\pipeline\trigger.cmd' -WorkingDirectory '<plugin dir>\tools\pipeline'
$trigger   = New-ScheduledTaskTrigger -Daily -At 21:00
$set       = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" -LogonType Interactive
Register-ScheduledTask -TaskName 'DSH-KB-DailySync' -Action $action -Trigger $trigger -Settings $set -Principal $principal

Disable-ScheduledTask   -TaskName 'DSH-KB-DailySync'
Enable-ScheduledTask    -TaskName 'DSH-KB-DailySync'
Unregister-ScheduledTask -TaskName 'DSH-KB-DailySync' -Confirm:$false
```

The task must be "run only when the user is logged on" (`Interactive`): the chain POSTs to the **DSH host running in your session**.

**Freshness gate**: when the last success is less than `chainMinIntervalMs` ago (default 6 h) the chain returns `skipped`, avoiding duplicate pulls and backup rotation.
The scheduled task does not bypass it; the page button / `{"force":true}` does.

## 7. Configuration: which file wins

**Precedence** (first non-empty wins): loader `config` → environment → **user settings file** → **`config.json` in the plugin folder** → built-in defaults.

| Channel | Where |
|---|---|
| loader config | the plugin-id row in your profile's `cordis.patch.yml` |
| environment | `DSH_KB_SYNC_ROOT` / `DSH_KB_SYNC_OUT_DIR` / `DSH_PIPELINE_DIR` |
| settings file | `$DSH_HOME/.dsh-kb-sync.json` (`~/.dsh/.dsh-kb-sync.json` when `DSH_HOME` is unset) |
| plugin folder | `<plugin dir>/config.json` (copy the shipped `config.example.json`) |

Frequently used keys: `root` (pipeline root; `syncScript`/`logDir`/`lastSyncFile`/`tokenFile` derive from it), `outDir` (knowledge base, default `<plugin>/data/kb`),
`tokenOldDays` (21), `chainMinIntervalMs` (6 h), `processProvider`/`processModel`/`processMaxTokens`. `/status` reports which sources were used under `configFile` (`used` / `localUsed`).

> ⚠️ **A restart is required after changing configuration**: `resolveSettings()` runs once at load and caches — without a restart `/status` keeps reporting the old values (measured 2026-10-12).

## 8. Data, backups, migration

| Content | Default location |
|---|---|
| Knowledge base | `<plugin dir>/data/kb/`: `conversations/*.md` + `conversations.jsonl` + `catalog.json` |
| Pipeline runtime data | `<plugin dir>/data/import/`: logs, `LAST-SYNC.txt`, `sync/inbox|out`, health facts, finance candidates |
| The expiring credential file (only `stat`ed) | the pipeline's own `.token` (configurable) |

- **Backup rotation**: before a fetch writes, the old listings are rotated to `*.backup-<timestamp>`; the knowledge base keeps the newest few generations (`KEEP_BACKUP_GENERATIONS`).
- **Migration**: copy the whole plugin folder (config travels with the code) — the data lives under `data/`.
- **Sharing a library**: point `outDir` at another script's directory, knowing both sides then read-modify-write the same listings.

## 9. Troubleshooting

| Symptom | Diagnosis / action |
|---|---|
| Pull reports unauthorized, a chain stage reports `token-expired` | the token expired (hours to days) → paste a new one in §①; the marker is `AUTH_UNAUTHORIZED`, not a random network hiccup |
| `trigger.cmd` exits **3** | it never saw `/status` for ~3 minutes → **the DSH app was not running**; start it and retry |
| Chain returns `skipped: fresh` | a success happened less than 6 h ago; use the page button (`force`) or lower `chainMinIntervalMs` |
| 409 `already-running` / `already-processing` | the previous run of that kind is still going; wait |
| Empty segment-2 output / `unparseable-output` | the generation cap is too small → raise `processMaxTokens` and restart |
| `/doctor` says `doctor-script-missing` | the check script does not exist; an empty `doctorScript` merely falls back to the default (there is no off switch) |
| Page returns 403 / "forbidden" | access it via `127.0.0.1` / `localhost`; cross-site requests are refused by design |
| Source changes have no effect | `file:` installs are **copied snapshots**: remove and re-add the bundle, then **restart the app** (the running instance keeps the module it cached at startup) |
| "open full text" shows a time 8 hours early | pre-0.1.0 data; the new version writes and displays local offsets (existing `.md` files were repaired in place) |
| The list endpoint only returns 100 conversations | a hard server-side limit with no paging; use **full backfill** for history |
| The scheduled run left the knowledge base unchanged | check `trigger.log` and `LAST-SYNC.txt` — usually the upstream simply had nothing new (`fetch` says "nothing needed updating") |

## 10. Language

- **Control page**: Chinese by default; `?lang=en` forces English; without the parameter it follows the browser's `Accept-Language` (unknown → Chinese); switchable in the top-right corner.
- **In-app settings section**: follows the host UI language (Chinese/English dictionaries).
- **Server-side diagnostics** (`/status` messages, per-stage output, the pipeline scripts' own output) are currently Chinese — they are troubleshooting text.

## 11. Disabling and uninstalling

```powershell
dsh plugin --profile <profile> remove dsh-kb-sync     # uninstall the plugin
# the knowledge base and pipeline data stay under <plugin dir>/data/ — copy them before deleting the folder
```

Security boundaries (enforced in code, not advice): loopback-only Host, 403 for non-same-origin, `x-dsh-kb-sync: 1` required on writes,
log-name allowlist, explicit argv, the credential file is only `stat`ed. Item-by-item detail: [`CAPABILITY-DISCLOSURE.md`](CAPABILITY-DISCLOSURE.md).
