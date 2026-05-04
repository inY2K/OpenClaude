@echo off
:: OpenClaude - Windows command launcher
:: cmd.exe does not execute .ps1 files from PATH, so this .bat wrapper
:: is what makes typing 'openclaude' work in any terminal.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0openclaude.ps1" %*
