@echo off
rem ASCII-only launcher: avoids cmd.exe reading UTF-8 Chinese as GBK.
rem Prefers PowerShell 7 (pwsh), falls back to Windows PowerShell 5.1.
chcp 65001 >nul
cd /d "%~dp0"

set "PSEXE="
where pwsh >nul 2>nul
if errorlevel 1 goto try_winps
set "PSEXE=pwsh"
goto run

:try_winps
where powershell >nul 2>nul
if errorlevel 1 goto no_ps
set "PSEXE=powershell"

:run
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\menu.ps1"
goto end

:no_ps
echo.
echo   No PowerShell found on this computer.
echo   Please send this line to the person helping you:
echo     no PowerShell: pwsh=pwsh missing, powershell=powershell missing
echo.

:end
echo.
pause
