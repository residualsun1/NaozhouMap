@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0map-server.ps1"
if errorlevel 1 pause
