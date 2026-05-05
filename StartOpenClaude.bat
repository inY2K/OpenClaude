@echo off
:: OpenClaude - Main launcher (double-click this on Windows)
:: Central entrypoint for setup, provider management, and launching.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0StartOpenClaude.ps1" %*
