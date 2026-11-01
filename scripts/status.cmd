@echo off
rem 便捷入口：status.cmd next / show / set 1.1 done / init
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0status.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0status.ps1" %*
)
