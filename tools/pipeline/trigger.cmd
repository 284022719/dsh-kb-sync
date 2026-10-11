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

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format s"') do set "STAMP=%%i"
echo [%STAMP%] trigger start (pipe=%PIPE_DIR%) >> "%LOG%"

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
  "  $r = Invoke-WebRequest -Uri $t.url -Method POST -TimeoutSec 3600 -UseBasicParsing -Headers @{ $t.header = '1'; 'content-type' = 'application/json' } -Body '{\"apply\":true}';" ^
  "  $j = $r.Content | ConvertFrom-Json;" ^
  "  if ($j.skipped) { Write-Output ('chain skipped: ' + $j.reason); exit 0 };" ^
  "  foreach ($s in $j.stages) { Write-Output ('  {0,-8} {1,-14} {2,7} ms  {3}' -f $s.stage, $s.code, $s.ms, $s.message) };" ^
  "  Write-Output ('chain ok=' + $j.ok + '  reason=' + $j.reason);" ^
  "  exit ([int]([bool](-not $j.ok)))" ^
  "} catch { Write-Output ('trigger failed: ' + $_.Exception.Message); exit 1 }" >> "%LOG%" 2>&1

set "RC=%ERRORLEVEL%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format s"') do set "STAMP=%%i"
echo [%STAMP%] trigger done rc=%RC% >> "%LOG%"
exit /b %RC%
