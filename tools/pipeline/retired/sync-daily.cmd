@echo off
REM ============================================================
REM  Daily sync - Segment 1 (deterministic fetch, no LLM, no token cost)
REM
REM  IMPORTANT: this file must stay PURE ASCII.
REM  cmd.exe reads .cmd as the OEM codepage (GBK here); Chinese text in a
REM  .cmd gets mangled and the rest of the line is treated as a command.
REM  All Chinese messages live in notify.ps1, addressed by case code.
REM
REM  Layout (moved here 2026-10-12, phase 1 of the absorption plan):
REM    code : D:\dsh\dsh-kb-sync\tools\pipeline\   (this file)
REM    data : D:\dsh\dsh-kb-sync\data\import\      (knowledge\, raw\, logs\, ...)
REM    token: outside the repository (default %USERPROFILE%\.dsh\.dsh-kb-sync-token)
REM  Every path below is overridable by an environment variable, then by
REM  tools\pipeline\pipeline.json; the literals are only the last-resort default.
REM ============================================================
setlocal enableextensions
set "PIPE_DIR=%~dp0"
if "%PIPE_DIR:~-1%"=="\" set "PIPE_DIR=%PIPE_DIR:~0,-1%"
set "PIPE_CFG=%PIPE_DIR%\pipeline.json"

if defined DSH_IMPORT_DIR set "IMPORT_DIR=%DSH_IMPORT_DIR%"
if not defined IMPORT_DIR for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "if(Test-Path '%PIPE_CFG%'){(Get-Content -Raw -Encoding UTF8 '%PIPE_CFG%' | ConvertFrom-Json).importDir}"`) do set "IMPORT_DIR=%%v"
if not defined IMPORT_DIR set "IMPORT_DIR=D:\dsh\dsh-kb-sync\data\import"
set "SYNC_DIR=%PIPE_DIR%"
set "LOGDIR=%IMPORT_DIR%\sync\logs"
set "INBOX_DIR=%IMPORT_DIR%\sync\inbox"
set "OUT_DIR=%IMPORT_DIR%\sync\out"
set "KB_DIR=D:\dsh\dsh-kb-sync\data\kb"
set "DSH_HOME=%IMPORT_DIR%\.dsh-home"
set "PROMPT_FILE=%PIPE_DIR%\headless-prompt.md"

if not exist "%USERPROFILE%\.dsh\.dsh-kb-sync-token" goto :token_default
set "TOKEN_FILE=%USERPROFILE%\.dsh\.dsh-kb-sync-token"
goto :token_done
:token_default
set "TOKEN_FILE=%IMPORT_DIR%\.token"
:token_done

if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%i"
set "LOG=%LOGDIR%\sync-%STAMP%.log"

cd /d "%IMPORT_DIR%"

echo [%DATE% %TIME%] segment 1 start >> "%LOG%"
echo [%DATE% %TIME%] pipeline=%PIPE_DIR% import=%IMPORT_DIR% >> "%LOG%"

REM ---- notify.ps1 must carry a UTF-8 BOM ----
REM  Windows PowerShell 5.1 reads a BOM-less file as the OEM codepage (GBK here),
REM  which turns notify.ps1's Chinese strings into mojibake and makes the script
REM  fail to parse. The failure is SILENT because :notify redirects to nul - the
REM  sync still "succeeds" while every desktop notification is gone. Editing tools
REM  that emit UTF-8 without a BOM have stripped it before (2026-10-10). Repair in
REM  place on every run so this cannot rot again.
powershell -NoProfile -Command "$p=Join-Path '%SYNC_DIR%' 'notify.ps1'; if(Test-Path $p){ $b=[IO.File]::ReadAllBytes($p); if(-not($b.Length -ge 3 -and $b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191)){ [IO.File]::WriteAllText($p,[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8),(New-Object Text.UTF8Encoding $true)); Write-Output 'notify.ps1: UTF-8 BOM was missing - restored' } }" >> "%LOG%" 2>&1

REM ---- token presence check ----
if not exist "%TOKEN_FILE%" (
  echo [%DATE% %TIME%] token file missing: %TOKEN_FILE% >> "%LOG%"
  call :notify token-missing
  exit /b 1
)

REM ---- token age check (proactive) ----
REM  The token is hand-copied from the browser and expires silently. The
REM  'token-old' notify case existed in notify.ps1 but nothing ever fired it,
REM  so the first hint of trouble was a failed sync. Warn ahead of time
REM  instead. Threshold is in days; measured from the token file mtime,
REM  which moves every time the token is refreshed.
set "TOKEN_OLD_DAYS=21"
set "TOKEN_AGE="
for /f %%d in ('powershell -NoProfile -Command "[int]((Get-Date)-(Get-Item '%TOKEN_FILE%').LastWriteTime).TotalDays"') do set "TOKEN_AGE=%%d"
if not "%TOKEN_AGE%"=="" if %TOKEN_AGE% GEQ %TOKEN_OLD_DAYS% (
  echo [%DATE% %TIME%] token is %TOKEN_AGE% days old (threshold %TOKEN_OLD_DAYS%) >> "%LOG%"
  call :notify token-old
)

REM ---- recon: read-only ----
REM  A non-zero exit is NOT trusted on its own: Node can crash on exit with
REM  0xC0000409 (libuv assertion, src\win\async.c) AFTER the work is already done.
REM  So on a non-zero exit we look for this stage's success marker in the log via
REM  check-log.mjs. The .cmd passes an ASCII stage key; the Chinese marker text
REM  lives inside that .mjs, because a .cmd may not contain non-ASCII bytes.
REM  If the success marker is absent we then ask whether the failure was an
REM  authorization rejection (reconAuth marker). Only that case is reported as
REM  an expired token; anything else is reported as a plain fetch failure, so
REM  a network blip no longer sends you chasing the token.
node "%PIPE_DIR%\recon-update.mjs" 1 >> "%LOG%" 2>&1
if errorlevel 1 (
  node "%SYNC_DIR%\check-log.mjs" "%LOG%" recon >> "%LOG%" 2>&1
  if errorlevel 1 (
    node "%SYNC_DIR%\check-log.mjs" "%LOG%" reconAuth >> "%LOG%" 2>&1
    if errorlevel 1 (
      echo [%DATE% %TIME%] recon failed - cause not identified >> "%LOG%"
      call :notify sync-failed
      exit /b 1
    )
    echo [%DATE% %TIME%] recon failed - authorization rejected >> "%LOG%"
    call :notify token-expired
    exit /b 1
  )
  echo [%DATE% %TIME%] recon exited non-zero but completed (libuv teardown crash) >> "%LOG%"
)

REM ---- fetch: writes Markdown + updates catalog/jsonl ----
node "%PIPE_DIR%\update-from-api.mjs" >> "%LOG%" 2>&1
if errorlevel 1 (
  node "%SYNC_DIR%\check-log.mjs" "%LOG%" update >> "%LOG%" 2>&1
  if errorlevel 1 (
    node "%SYNC_DIR%\check-log.mjs" "%LOG%" updateAuth >> "%LOG%" 2>&1
    if errorlevel 1 (
      echo [%DATE% %TIME%] update failed - cause not identified >> "%LOG%"
      call :notify sync-failed
      exit /b 1
    )
    echo [%DATE% %TIME%] update failed - authorization rejected >> "%LOG%"
    call :notify token-expired
    exit /b 1
  )
  echo [%DATE% %TIME%] update exited non-zero but completed (libuv teardown crash) >> "%LOG%"
)

echo [%DATE% %TIME%] segment 1 done >> "%LOG%"
call :notify sync-ok

REM ---- segment 2 (LLM extraction) - self-guarded, inert until enabled ----
call "%SYNC_DIR%\sync-extract.cmd" "%LOG%"

REM ---- knowledge base integrity check ----
REM  Why: the KB rotted silently once before (its 42 per-topic GUI entry sessions
REM  vanished and nobody noticed for weeks). kb.mjs doctor READS ONLY - no cache,
REM  no index, no writes - and this step never aborts the run: a failed check is
REM  a warning, because the KB itself may still be usable.
echo ---- kb integrity ---- >> "%LOG%"
node "%KB_DIR%\tools\kb.mjs" doctor >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] kb integrity check FAILED >> "%LOG%"
  call :notify kb-check-failed
)

exit /b 0

:notify
powershell -NoProfile -ExecutionPolicy Bypass -File "%SYNC_DIR%\notify.ps1" -Case %1 -LogPath "%LOG%" -SyncDir "%IMPORT_DIR%" >nul 2>&1
exit /b 0
