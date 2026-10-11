@echo off
REM ============================================================
REM  Daily sync - Segment 2 (LLM judgment + deterministic apply)
REM
REM  Architecture (changed after verification on 2026-10-09):
REM    The headless agent runs in a workspace-write sandbox whose workspace is
REM    D:\dsh\deepseek-import. It CANNOT write ..\dsh-kb-sync\data\kb or ..\health,
REM    and escalation needs an approval channel that does not exist unattended
REM    ("sandbox escalation to danger-full-access requires approval, but no
REM    approval channel is available"). So instead of widening permissions:
REM
REM      2a  headless : reads sync\inbox\, writes ONLY sync\out\  (pure judgment)
REM      2b  this file: validates and applies the result, then runs the build
REM                     scripts that write knowledge-base\ and health\
REM
REM    No escalation is ever needed, and the LLM output is inspectable JSON
REM    before anything is applied.
REM
REM  Session isolation (2026-10-09): the headless run gets its own DSH_HOME
REM  (%IMPORT_DIR%\.dsh-home). Previously it used the interactive home, so every
REM  automated run created a Session in the GUI's session list, where they piled
REM  up under "ungrouped". The isolated home was seeded once with
REM  .credentials.yaml plus a copy of profiles\headless; it needs no other state.
REM
REM  Self-guarded: does nothing unless ENABLE-SEGMENT-2.flag exists.
REM  Must stay PURE ASCII (see sync-daily.cmd for why).
REM ============================================================
setlocal enableextensions
set "PIPE_DIR=%~dp0"
if "%PIPE_DIR:~-1%"=="\" set "PIPE_DIR=%PIPE_DIR:~0,-1%"
set "PIPE_CFG=%PIPE_DIR%\pipeline.json"
if defined DSH_IMPORT_DIR set "IMPORT_DIR=%DSH_IMPORT_DIR%"
if not defined IMPORT_DIR for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "if(Test-Path '%PIPE_CFG%'){(Get-Content -Raw -Encoding UTF8 '%PIPE_CFG%' | ConvertFrom-Json).importDir}"`) do set "IMPORT_DIR=%%v"
if not defined IMPORT_DIR set "IMPORT_DIR=D:\dsh\dsh-kb-sync\data\import"
set "SYNC_DIR=%PIPE_DIR%"
set "DSH_HOME=%IMPORT_DIR%\.dsh-home"
set "LOG=%~1"
if "%LOG%"=="" set "LOG=%IMPORT_DIR%\sync\logs\ad-hoc.log"

cd /d "%IMPORT_DIR%"

if not exist "%SYNC_DIR%\ENABLE-SEGMENT-2.flag" (
  echo [%DATE% %TIME%] segment 2 skipped - flag not present >> "%LOG%"
  exit /b 0
)

echo [%DATE% %TIME%] segment 2 start >> "%LOG%"

REM ---- 2a-prep: build the inbox (unsandboxed) ----
echo ---- prep inbox ---- >> "%LOG%"
node "%SYNC_DIR%\prep-inbox.mjs" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] prep-inbox failed >> "%LOG%"
  goto fail
)

REM ---- 2a: headless judgment, sandboxed, writes only sync\out\ ----
REM  NOTE: redirect only here, on the outside. Adding a second redirection inside
REM  the -Command (e.g. *>> '%LOG%') makes two handles fight over the same file
REM  and pwsh dies with "cannot access the file ... being used by another process".
echo ---- headless ---- >> "%LOG%"
if not exist "%DSH_HOME%\.credentials.yaml" (
  echo [%DATE% %TIME%] isolated DSH_HOME has no credentials: %DSH_HOME%\.credentials.yaml >> "%LOG%"
  goto fail
)
REM ---- 2a: guard - dsh must be resolvable on PATH ----
REM  2026-10-12: the npm global CLI (@deepseek-ai/dsh) was removed; dsh now resolves to the
REM  app's bundled CLI (see D:\dsh\TECH.md, section on dsh entry points). Checked right before
REM  the run so a missing/mis-PATH'd dsh fails fast with an actionable line, instead of only
REM  showing up as a bare "headless failed".
where dsh >nul 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] dsh not found on PATH - headless cannot run; see D:\dsh\TECH.md (dsh entry points) >> "%LOG%"
  goto fail
)

pwsh -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Continue'; $p = Get-Content -Raw -Encoding UTF8 '%PIPE_DIR%\headless-prompt.md'; Set-Location '%IMPORT_DIR%'; $p | dsh headless" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] headless failed >> "%LOG%"
  goto fail
)

REM ---- 2b: validate + apply the judgment (unsandboxed) ----
REM  Same rule as segment 1: a non-zero exit alone is not proof of failure, because
REM  Node can crash on exit AFTER finishing. Confirm with this stage's marker.
echo ---- apply ---- >> "%LOG%"
node "%SYNC_DIR%\apply-extraction.mjs" >> "%LOG%" 2>&1
if errorlevel 1 (
  node "%SYNC_DIR%\check-log.mjs" "%LOG%" apply >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo [%DATE% %TIME%] apply-extraction failed >> "%LOG%"
    goto fail
  )
  echo [%DATE% %TIME%] apply exited non-zero but validated (libuv teardown crash) >> "%LOG%"
)

REM ---- 2b: rebuild knowledge base ----
REM  Every script is called by absolute path: nothing below depends on the caller's
REM  working directory any more (each .mjs reads tools\pipeline\pipeline.json).
echo ---- rebuild kb ---- >> "%LOG%"
node "%PIPE_DIR%\apply-update-topics.mjs" >> "%LOG%" 2>&1
node "%PIPE_DIR%\build-kb.mjs" >> "%LOG%" 2>&1
node "%PIPE_DIR%\build-specialties.mjs" >> "%LOG%" 2>&1
node "%PIPE_DIR%\map-specialties.mjs" >> "%LOG%" 2>&1

REM ---- 2b: rebuild health dossier ----
echo ---- rebuild health ---- >> "%LOG%"
node "%PIPE_DIR%\build-health-profile.mjs" >> "%LOG%" 2>&1
node "%PIPE_DIR%\sync-knowledge.mjs" >> "%LOG%" 2>&1
pushd "D:\dsh\控制台中心\health-console"
node make-snapshot.mjs >> "%LOG%" 2>&1
popd

echo [%DATE% %TIME%] segment 2 done >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SYNC_DIR%\notify.ps1" -Case segment2-done -LogPath "%LOG%" -SyncDir "%IMPORT_DIR%" >nul 2>&1
exit /b 0

:fail
powershell -NoProfile -ExecutionPolicy Bypass -File "%SYNC_DIR%\notify.ps1" -Case segment2-failed -LogPath "%LOG%" -SyncDir "%IMPORT_DIR%" >nul 2>&1
exit /b 1
