@echo off
setlocal EnableDelayedExpansion

:: Get the directory this batch file lives in (no trailing backslash)
set "SCRIPT_DIR=%~dp0"
if "!SCRIPT_DIR:~-1!"=="\" set "SCRIPT_DIR=!SCRIPT_DIR:~0,-1!"

echo.
echo  ============================================================
echo   OpenClaude - Windows Setup
echo  ============================================================
echo.

:: ---------------------------------------------------------------------------
:: 1. Check Node.js
:: ---------------------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js is not installed or not in PATH.
    echo.
    echo  Download Node.js LTS from:  https://nodejs.org/
    echo  Install it, then run this setup again.
    echo.
    pause
    exit /b 1
)

for /f "usebackq tokens=*" %%v in (`node --version`) do set NODE_VER=%%v
echo  [OK] Node.js found: %NODE_VER%

:: ---------------------------------------------------------------------------
:: 2. Check Node.js version (need 22+ for built-in SQLite)
:: ---------------------------------------------------------------------------
for /f "usebackq tokens=*" %%v in (`node -e "process.stdout.write(process.versions.node.split('.')[0])"`) do set NODE_MAJOR=%%v

if "!NODE_MAJOR!"=="" (
    echo  [ERROR] Could not read the Node.js version number.
    pause
    exit /b 1
)

if !NODE_MAJOR! LSS 22 (
    echo  [ERROR] Node.js 22 or later is required. You have %NODE_VER%.
    echo  Download the latest LTS from:  https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js version is compatible

:: ---------------------------------------------------------------------------
:: 3. Check for Claude Code CLI
:: ---------------------------------------------------------------------------
echo.
where claude >nul 2>&1
if errorlevel 1 (
    echo  [WARNING] The 'claude' command was not found.
    echo            You can still set up providers now, but you will need
    echo            to install Claude Code before running 'openclaude'.
    echo            Get Claude Code from:  https://claude.ai/code
) else (
    for /f "usebackq tokens=*" %%v in (`claude --version 2^>nul`) do set CLAUDE_VER=%%v
    echo  [OK] Claude Code found: %CLAUDE_VER%
)

:: ---------------------------------------------------------------------------
:: 4. Offer to add OpenClaude to PATH
:: ---------------------------------------------------------------------------
echo.
set "ADD_PATH=y"
set /p ADD_PATH="  Add OpenClaude folder to PATH so 'openclaude' works from anywhere? [Y/n]: "

if /i "!ADD_PATH!"=="y" goto :do_add_path
if /i "!ADD_PATH!"==""  goto :do_add_path
goto :skip_path

:do_add_path
echo.
:: Pass the directory via an env var so spaces in the path are handled safely.
set "OC_DIR=!SCRIPT_DIR!"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=$env:OC_DIR; $p=[Environment]::GetEnvironmentVariable('PATH','User'); if (-not $p) { $p = '' }; if ($p -notlike ('*' + $d + '*')) { [Environment]::SetEnvironmentVariable('PATH', ($p.TrimEnd(';') + ';' + $d), 'User'); Write-Host '  [OK] Added to PATH successfully.' } else { Write-Host '  [OK] Already in PATH.' }"
echo.
echo  IMPORTANT: The PATH change only takes effect in NEW terminal windows.
echo             Close this window and open a fresh Command Prompt or
echo             PowerShell, then type:  openclaude

:skip_path

:: ---------------------------------------------------------------------------
:: 5. Run the provider wizard
:: ---------------------------------------------------------------------------
echo.
echo  ------------------------------------------------------------
echo   Starting the provider wizard...
echo   Answer the questions to add your first provider.
echo  ------------------------------------------------------------
echo.

cd /d "!SCRIPT_DIR!"
node setup.js

if errorlevel 1 (
    echo.
    echo  [ERROR] The setup wizard encountered a problem.
    echo  Check the output above for details.
    echo.
    pause
    exit /b 1
)

:: ---------------------------------------------------------------------------
:: 6. Done
:: ---------------------------------------------------------------------------
echo.
echo  ============================================================
echo   All done!
echo.
echo   NEXT STEPS:
echo.
echo   1. Close this window
echo   2. Open a NEW Command Prompt or PowerShell window
echo   3. Type:  openclaude
echo.
echo   If 'openclaude' is still not found, you can always run it
echo   directly from the OpenClaude folder:
echo     powershell -ExecutionPolicy Bypass -File "!SCRIPT_DIR!\openclaude.ps1"
echo.
echo   Other commands:
echo     openclaude --setup    (add or change providers)
echo     openclaude --list     (see configured providers)
echo     openclaude --help     (all options)
echo  ============================================================
echo.
pause
