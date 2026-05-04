@echo off
:: OpenClaude - Main launcher (double-click this on Windows)
:: Keeps the window open via the menu loop in StartOpenClaude.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0StartOpenClaude.ps1"
