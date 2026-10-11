@echo off
REM Publish dsh-kb-sync from this repository.
REM ASCII-only on purpose: cmd.exe reads a .cmd file as the OEM code page, so
REM non-ASCII text here gets mangled and the rest of the line runs as a command.
REM Keep this file free of parentheses and angle brackets inside echo text.
REM
REM Prerequisite, one time, by the repo owner:
REM   winget install --id GitHub.cli -e
REM   gh auth login
REM
REM Then double-click this file, or run it from a terminal.
setlocal
set "HERE=%~dp0"
pushd "%HERE%.."
pwsh -NoProfile -ExecutionPolicy Bypass -File "%HERE%publish.ps1" %*
set "CODE=%ERRORLEVEL%"
popd
echo.
if "%CODE%"=="0" goto ok
echo publish stopped with exit code %CODE% - read the message above.
echo If gh is not authenticated, run: gh auth login
echo Without gh: create an empty public repo, then run
echo   pwsh -File tools\publish.ps1 -NoGh -RemoteUrl https://github.com/USER/REPO.git
goto done
:ok
echo publish finished - the repo and topic URLs are printed above.
:done
echo.
pause
exit /b %CODE%
