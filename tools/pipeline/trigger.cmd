@echo off
REM ============================================================
REM  Nightly trigger for the dsh-kb-sync chain (phase 3).
REM
REM  The chain itself runs INSIDE the plugin now (POST /__dsh-kb-sync/pipeline:
REM  token -> recon -> fetch -> judgement/validate/apply/rebuild -> doctor).
REM  This file only pokes it, so the Windows task no longer orchestrates
REM  anything and `dsh headless` is not involved at all.
REM
REM  Where to POST: the plugin writes trigger.json into ITS OWN tools\pipeline,
REM  which may be the installed snapshot under the profile. This file lives in
REM  the source tree, so it reads trigger-source.json (same folder, also written
REM  by the plugin) to learn where that snapshot is. Nothing here guesses a port.
REM
REM  Why the wait loop: the task may fire at logon, before the DSH host has
REM  finished starting - and the chain only exists inside that host. We poll the
REM  plugin's own /status until it answers, so a slow start is not reported as a
REM  failure (and a host that never comes up says so explicitly).
REM
REM  IMPORTANT: this file must stay PURE ASCII (cmd.exe reads .cmd as the OEM
REM  codepage; Chinese text would be mangled). All messages are ASCII.
REM ============================================================
setlocal enableextensions
set "PIPE_DIR=%~dp0"
if "%PIPE_DIR:~-1%"=="\" set "PIPE_DIR=%PIPE_DIR:~0,-1%"
set "HINT=%PIPE_DIR%\trigger-source.json"
REM Two candidate pointers: the plugin writes its hint inside the profile snapshot,
REM and (when installed there) into this source tree as well. Either copy can be
REM stale - a throwaway instance with a temp data dir overwrites the source one -
REM so the block below only trusts a hint whose pipelineDir really contains a
REM trigger.json. Nothing here guesses a port.
set "HINT2=%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-kb-sync\tools\pipeline\trigger-source.json"
set "LOG=%PIPE_DIR%\trigger.log"

REM Where the human-visible status line goes. The plugin's own data dir is the
REM authority (freshness is read from this same file), so prefer the picked hint's
REM dataDir and fall back to the source tree's data dir. Format of each line:
REM <date time>  <status-kind>  <detail> -- same naive-local shape the retired
REM .cmd chain used, which is what the plugin's reader parses.
set "STATE=%PIPE_DIR%\..\..\data\import\LAST-SYNC.txt"
for %%f in ("%STATE%") do set "STATE=%%~ff"
if not exist "%STATE%" set "STATE_FALLBACK=1"

REM ---- --force: bypass the plugin's 6h freshness gate ----
REM Why: after a failed run the status line just written makes the next manual rerun
REM look "fresh", so the plugin returns skipped and the chain never runs. The control
REM page button passes force, but a person at a console could not - this closes that.
REM Note for cmd: the body is assembled with delayed expansion and the quotes are
REM written from a variable, so the braces/quotes never have to survive `for` parsing.
set "BODY={\"apply\":true}"
set "ARGF=%1"
if /i "%ARGF%"=="--force" set "BODY={\"apply\":true,\"force\":true}"
if /i "%ARGF%"=="-f"      set "BODY={\"apply\":true,\"force\":true}"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format s"') do set "STAMP=%%i"
echo [%STAMP%] trigger start (pipe=%PIPE_DIR%) >> "%LOG%"
if /i "%ARGF%"=="--force" echo [%STAMP%] force requested: freshness gate bypassed >> "%LOG%"
if /i "%ARGF%"=="-f"      echo [%STAMP%] force requested: freshness gate bypassed >> "%LOG%"

REM Size of the state file just before the POST. If it grows afterwards, the
REM plugin itself wrote the outcome line (its writeStatusLine) and this file must
REM NOT add a second line for the same run. If it does not grow, nothing was
REM reported - which is exactly the silent case this block exists for.
set "STATE_BEFORE="
if exist "%STATE%" for %%s in ("%STATE%") do set "STATE_BEFORE=%%~zs"

REM ---- one PowerShell block: pick a usable hint, wait for the host, POST, report ----
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Continue';" ^
  "$hints = @('%HINT%','%HINT2%');" ^
  "$picked = $null;" ^
  "foreach ($h in $hints) {" ^
  "  if (-not (Test-Path $h)) { continue }" ^
  "  try { $c = Get-Content -Raw -Encoding UTF8 $h | ConvertFrom-Json } catch { continue }" ^
  "  if (-not $c.pipelineDir) { continue }" ^
  "  $tg = Join-Path $c.pipelineDir 'trigger.json';" ^
  "  if (Test-Path $tg) { $picked = @{ hint = $h; trigger = $tg }; break }" ^
  "}" ^
  "if ($null -eq $picked) {" ^
  "  Write-Output 'no usable trigger hint: no candidate points at a directory containing trigger.json';" ^
  "  Write-Output ('  tried: ' + ($hints -join ' , '));" ^
  "  Write-Output 'start the DSH app once, then run the chain from the control page';" ^
  "  exit 2" ^
  "}" ^
  "Write-Output ('hint=' + $picked.hint);" ^
  "$t = Get-Content -Raw -Encoding UTF8 $picked.trigger | ConvertFrom-Json;" ^
  "$status = ($t.url -replace '/pipeline$','/status');" ^
  "$up = $false;" ^
  "for ($i = 0; $i -lt 60; $i++) {" ^
  "  try { $r = Invoke-WebRequest -Uri $status -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { $up = $true; break } } catch { }" ^
  "  Start-Sleep -Seconds 3" ^
  "}" ^
  "if (-not $up) { Write-Output ('host did not answer ' + $status + ' within ~3 minutes - is the DSH app running?'); exit 3 }" ^
  "Write-Output ('POST ' + $t.url);" ^
  "try {" ^
  "  $r = Invoke-WebRequest -Uri $t.url -Method POST -TimeoutSec 3600 -UseBasicParsing -Headers @{ $t.header = '1'; 'content-type' = 'application/json' } -Body '%BODY%';" ^
  "  $j = $r.Content | ConvertFrom-Json;" ^
  "  if ($j.skipped) { Write-Output ('chain skipped: ' + $j.reason); exit 0 };" ^
  "  foreach ($s in $j.stages) { Write-Output ('  {0,-8} {1,-14} {2,7} ms  {3}' -f $s.stage, $s.code, $s.ms, $s.message) };" ^
  "  Write-Output ('chain ok=' + $j.ok + '  reason=' + $j.reason);" ^
  "  exit ([int]([bool](-not $j.ok)))" ^
  "} catch {" ^
  "  $resp = $null;" ^
  "  try { $resp = $_.Exception.Response } catch { };" ^
  "  if ($null -ne $resp) {" ^
  "    $code = [int]$resp.StatusCode;" ^
  "    $body = '';" ^
  "    try { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $body = $sr.ReadToEnd() } catch { };" ^
  "    Write-Output ('chain reported failure (HTTP ' + $code + ')');" ^
  "    if ($body) { Write-Output ('  body: ' + $body) };" ^
  "    exit 1" ^
  "  }" ^
  "  Write-Output ('trigger failed (no HTTP response): ' + $_.Exception.Message);" ^
  "  exit 1" ^
  "}" >> "%LOG%" 2>&1

set "RC=%ERRORLEVEL%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format s"') do set "STAMP=%%i"
echo [%STAMP%] trigger done rc=%RC% >> "%LOG%"

REM ---- status line for humans + the freshness gate (never let this change RC) ----
for /f %%i in ('powershell -NoProfile -Command "$h='%HINT2%'; if (Test-Path $h) { try { $c = Get-Content -Raw -Encoding UTF8 $h | ConvertFrom-Json; if ($c.dataDir) { $d = Join-Path $c.dataDir 'LAST-SYNC.txt'; if (Test-Path (Split-Path $d -Parent)) { Write-Output $d } } } catch { } }"') do set "STATE=%%i"
set "STATE_AFTER="
if exist "%STATE%" for %%s in ("%STATE%") do set "STATE_AFTER=%%~zs"
set "KIND=trigger-failed"
set "DETAIL=rc=%RC% see trigger.log"
if "%RC%"=="0" set "KIND=chain-ok"
if "%RC%"=="0" set "DETAIL=ok via trigger.cmd"
if "%RC%"=="1" set "KIND=chain-failed"
if "%RC%"=="1" set "DETAIL=chain failed rc=1 see trigger.log"
if "%RC%"=="2" set "KIND=trigger-no-hint"
if "%RC%"=="2" set "DETAIL=no usable trigger hint: start DSH once (or resync plugin snapshot), then rerun"
if "%RC%"=="3" set "KIND=trigger-no-host"
if "%RC%"=="3" set "DETAIL=host did not answer /status within ~3 min - is the DSH app running?"
set "SKIPPED="
if "%RC%"=="0" for /f "delims=" %%s in ('findstr /c:"chain skipped" "%LOG%"') do set "SKIPPED=1"
if defined SKIPPED set "KIND=chain-skipped"
if defined SKIPPED set "DETAIL=chain returned skipped (freshness gate 6h; use the control page button to force)"
set "NEED_LINE=1"
if not defined STATE set "NEED_LINE="
if not "%STATE_BEFORE%"=="%STATE_AFTER%" set "NEED_LINE="
if not defined NEED_LINE goto :no_status_line
REM One call, and only one format string with no colon / parenthesis in it: cmd
REM treats those inside a `for /f ('...')` command as syntax. The 's' format gives
REM 2026-10-12T04:52:33, which cmd splits back into the space-separated shape the
REM plugin's LAST-SYNC reader parses (older attempts broke both ways on 2026-10-12).
for /f "tokens=1,2 delims=T" %%a in ('powershell -NoProfile -Command "Get-Date -Format s"') do set "WHEN=%%a %%b"
if not defined WHEN set "WHEN=%DATE% %TIME:~0,8%"
echo %WHEN%  %KIND%  %DETAIL%>> "%STATE%"
:no_status_line
exit /b %RC%
