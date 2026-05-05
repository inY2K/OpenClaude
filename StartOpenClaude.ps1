<#
.SYNOPSIS
    StartOpenClaude - Main launcher with menu.
    Double-click StartOpenClaude.bat to open this on Windows.
#>

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
function Write-Banner {
    Write-Host ""
    Write-Host "  ============================================================" -ForegroundColor Cyan
    Write-Host "                  O P E N C L A U D E" -ForegroundColor Cyan
    Write-Host "         Use Claude Code with any LLM provider" -ForegroundColor DarkCyan
    Write-Host "  ============================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Divider {
    Write-Host "  ------------------------------------------------------------" -ForegroundColor DarkGray
}

function Get-SetupInfo {
    try {
        $raw = & node "$ScriptDir\proxy\check-setup.js" 2>$null
        return $raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Assert-Node {
    $n = Get-Command node -ErrorAction SilentlyContinue
    if (-not $n) {
        Write-Host "  [ERROR] Node.js is not installed. Get it from https://nodejs.org/" -ForegroundColor Red
        Write-Host ""
        Read-Host "  Press Enter to exit"
        exit 1
    }
}

function Show-ProviderList($providers) {
    Write-Host "  Your configured providers:" -ForegroundColor Yellow
    Write-Host ""
    $i = 1
    foreach ($p in $providers) {
        $def = ""
        if ($p.is_default) { $def = " [DEFAULT]" }
        $fmt = "Anthropic"
        if ($p.api_format -eq "openai") { $fmt = "OpenAI" }
        Write-Host "    [$i] " -ForegroundColor Yellow -NoNewline
        Write-Host "$($p.name)" -ForegroundColor White -NoNewline
        Write-Host "$def" -ForegroundColor Green -NoNewline
        Write-Host "  ($fmt)  $($p.url)" -ForegroundColor DarkGray
        $i++
    }
    Write-Host ""
}

function Start-Provider($alias) {
    Write-Host ""
    Write-Host "  Starting OpenClaude..." -ForegroundColor Cyan
    Write-Host "  (Close the Claude Code session to return here)" -ForegroundColor DarkGray
    Write-Host ""
    if ($alias) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\openclaude.ps1" --switch $alias
    } else {
        & powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\openclaude.ps1"
    }
}

function Run-SetupWizard {
    Write-Host ""
    Write-Host "  Opening setup wizard..." -ForegroundColor Cyan

    $command = "Set-Location -LiteralPath '$($ScriptDir.Replace("'", "''"))'; node .\setup.js"
    $proc = Start-Process -FilePath "powershell" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-Command", $command) `
        -PassThru

    $proc.WaitForExit()

    if ($proc.ExitCode -ne 0) {
        Write-Host ""
        Write-Host "  Setup exited with error code $($proc.ExitCode)." -ForegroundColor Red
        Write-Host "  Please review the setup window output and try again." -ForegroundColor Yellow
        Write-Host ""
        Read-Host "  Press Enter to return to menu"
        return $false
    }
    return $true
}

# --------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------
Assert-Node

while ($true) {
    Write-Banner
    $info = Get-SetupInfo

    # First run: no providers configured
    if (-not $info -or -not $info.configured) {
        Write-Host "  Welcome to OpenClaude!" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  No providers are configured yet." -ForegroundColor Yellow
        Write-Host "  Let's add one now - it only takes about 2 minutes." -ForegroundColor DarkGray
        Write-Host ""
        Write-Divider
        Write-Host ""
        [void](Run-SetupWizard)
        Write-Host ""

        $info = Get-SetupInfo
        if (-not $info -or -not $info.configured) {
            Write-Host "  No providers were added. Exiting." -ForegroundColor DarkGray
            Write-Host ""
            Read-Host "  Press Enter to close"
            exit 0
        }

        Write-Host ""
        Write-Host "  Provider saved! Ready to launch." -ForegroundColor Green
        Write-Host ""
        $choice = Read-Host "  Start OpenClaude now? [Y/n]"
        if ($choice -eq "" -or $choice -ieq "y") {
            Start-Provider $null
        }
        continue
    }

    # Main menu
    Show-ProviderList $info.providers

    Write-Divider
    Write-Host ""
    Write-Host "  Press a number to launch, or choose an action:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    [1-$($info.count)] Start with that provider" -ForegroundColor White
    Write-Host "    [A]  Add a new provider" -ForegroundColor White
    Write-Host "    [E]  Edit a provider" -ForegroundColor White
    Write-Host "    [D]  Delete a provider" -ForegroundColor White
    Write-Host "    [S]  Open full setup / settings" -ForegroundColor White
    Write-Host "    [Q]  Quit" -ForegroundColor White
    Write-Host ""
    $choice = Read-Host "  Choice"
    $choice = $choice.Trim()

    if ($choice -ieq "q") {
        Write-Host ""
        Write-Host "  Bye!" -ForegroundColor DarkGray
        Write-Host ""
        break
    }

    if ($choice -ieq "a") {
        [void](Run-SetupWizard)
        continue
    }

    if ($choice -ieq "e") {
        Write-Host ""
        $providers = $info.providers
        for ($i = 0; $i -lt $providers.Count; $i++) {
            $p = $providers[$i]
            Write-Host "    [$($i+1)] $($p.name) ($($p.alias))" -ForegroundColor Yellow
        }
        Write-Host ""
        $num = Read-Host "  Edit which number? (Enter to cancel)"
        if ($num -match '^\d+$') {
            $idx = [int]$num - 1
            if ($idx -ge 0 -and $idx -lt $providers.Count) {
                $target = $providers[$idx]
                Write-Host ""
                Write-Host "  Editing: $($target.name)" -ForegroundColor Cyan
                Write-Host "    [M] Change model(s)" -ForegroundColor White
                Write-Host "    [U] Change URL" -ForegroundColor White
                Write-Host "    [K] Change API key" -ForegroundColor White
                Write-Host "    [A] Change auth type (bearer/x-api-key/none)" -ForegroundColor White
                Write-Host ""
                $editChoice = Read-Host "  What to edit? (Enter to cancel)"
                $dbUrl = "file:///" + ($ScriptDir -replace '\\', '/') + "/proxy/db.js"

                if ($editChoice -ieq "m") {
                    $tmp = [System.IO.Path]::GetTempFileName() + ".mjs"
                    $scriptContent = @"
import { getProvider, saveProvider } from '$dbUrl';
import { probeProvider } from 'file:///$($ScriptDir -replace '\\', '/')/proxy/provider-probe.js';
const p = getProvider('$($target.alias)');
const models = p.models.reduce((o, m) => { o[m.tier] = m.model_id; return o; }, {});
let discovered = [];
try {
  const probe = await probeProvider({
    baseUrl: p.base_url,
    apiType: p.api_type,
    authType: p.options?.auth_type || 'bearer',
    apiKey: p.options?.apiKey || '',
  });
  discovered = Array.isArray(probe?.models) ? probe.models : [];
} catch {}
console.log(JSON.stringify({ models, discovered }));
"@
                    Set-Content $tmp $scriptContent -Encoding UTF8
                    $modelInfo = & node $tmp 2>$null | ConvertFrom-Json
                    Remove-Item $tmp -Force -ErrorAction SilentlyContinue

                    if ($null -eq $modelInfo) {
                        Write-Host "  Could not load model information." -ForegroundColor Yellow
                        continue
                    }

                    $currentModels = $modelInfo.models
                    $discoveredModels = @()
                    if ($modelInfo.discovered) { $discoveredModels = @($modelInfo.discovered) }

                    Write-Host ""
                    Write-Host "  Current models:" -ForegroundColor Yellow
                    foreach ($tier in $currentModels | Get-Member -MemberType NoteProperty | ForEach-Object Name) {
                        Write-Host "    $tier : $($currentModels.$tier)"
                    }
                    Write-Host ""

                    if ($discoveredModels.Count -gt 0) {
                        Write-Host "  Discovered models:" -ForegroundColor Yellow
                        $limit = [Math]::Min(20, $discoveredModels.Count)
                        for ($i = 0; $i -lt $limit; $i++) {
                            Write-Host "    [$($i+1)] $($discoveredModels[$i])" -ForegroundColor White
                        }
                        if ($discoveredModels.Count -gt $limit) {
                            Write-Host "    ...and $($discoveredModels.Count - $limit) more" -ForegroundColor DarkGray
                        }
                        Write-Host ""
                    }

                    $newModelInput = Read-Host "  Enter new model name or list number (or leave blank to skip)"
                    $newModel = $null
                    if ($newModelInput) {
                        if ($newModelInput -match '^\d+$' -and $discoveredModels.Count -gt 0) {
                            $modelIdx = [int]$newModelInput - 1
                            if ($modelIdx -ge 0 -and $modelIdx -lt $discoveredModels.Count) {
                                $newModel = $discoveredModels[$modelIdx]
                            } else {
                                Write-Host "  Invalid model number." -ForegroundColor Yellow
                            }
                        } else {
                            $newModel = $newModelInput
                        }
                    }

                    if ($newModel) {
                        $newModelEscaped = ($newModel -replace '\\', '\\\\') -replace "'", "\\'"
                        $tmp = [System.IO.Path]::GetTempFileName() + ".mjs"
                        $scriptContent = @"
import { getProvider, saveProvider } from '$dbUrl';
const p = getProvider('$($target.alias)');
const models = p.models.map(m => ({ ...m, model_id: '$newModelEscaped', name: '$newModelEscaped' }));
saveProvider({ ...p, models });
console.log('updated');
"@
                        Set-Content $tmp $scriptContent -Encoding UTF8
                        $r = & node $tmp 2>$null
                        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
                        if ($r -eq "updated") {
                            Write-Host "  Updated model to '$newModel'" -ForegroundColor Green
                        } else {
                            Write-Host "  Could not update. Try [S] Setup for more options." -ForegroundColor Yellow
                        }
                    }
                } elseif ($editChoice -ieq "u") {
                    $newUrl = Read-Host "  New URL (current: $($target.url))"
                    if ($newUrl) {
                        $tmp = [System.IO.Path]::GetTempFileName() + ".mjs"
                        $scriptContent = @"
import { getProvider, saveProvider } from '$dbUrl';
const p = getProvider('$($target.alias)');
saveProvider({ ...p, base_url: '$newUrl', models: p.models });
console.log('updated');
"@
                        Set-Content $tmp $scriptContent -Encoding UTF8
                        $r = & node $tmp 2>$null
                        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
                        if ($r -eq "updated") {
                            Write-Host "  Updated URL" -ForegroundColor Green
                        } else {
                            Write-Host "  Could not update. Try [S] Setup." -ForegroundColor Yellow
                        }
                    }
                } elseif ($editChoice -ieq "k") {
                    $newKey = Read-Host "  New API key"
                    if ($newKey) {
                        $tmp = [System.IO.Path]::GetTempFileName() + ".mjs"
                        $scriptContent = @"
import { getProvider, saveProvider } from '$dbUrl';
const p = getProvider('$($target.alias)');
saveProvider({ ...p, options: { ...(p.options || {}), apiKey: '$newKey' }, models: p.models });
console.log('updated');
"@
                        Set-Content $tmp $scriptContent -Encoding UTF8
                        $r = & node $tmp 2>$null
                        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
                        if ($r -eq "updated") {
                            Write-Host "  Updated API key" -ForegroundColor Green
                        } else {
                            Write-Host "  Could not update. Try [S] Setup." -ForegroundColor Yellow
                        }
                    }
                } elseif ($editChoice -ieq "a") {
                    Write-Host ""
                    Write-Host "  Auth type options:" -ForegroundColor Yellow
                    Write-Host "    [1] bearer (Authorization: Bearer KEY)" -ForegroundColor White
                    Write-Host "    [2] x-api-key (X-API-Key: KEY header)" -ForegroundColor White
                    Write-Host "    [3] none (no authentication)" -ForegroundColor White
                    Write-Host ""
                    $authChoice = Read-Host "  Select (1-3)"
                    $newAuthType = ""
                    if ($authChoice -eq "1") { $newAuthType = "bearer" }
                    elseif ($authChoice -eq "2") { $newAuthType = "x-api-key" }
                    elseif ($authChoice -eq "3") { $newAuthType = "none" }

                    if ($newAuthType) {
                        $tmp = [System.IO.Path]::GetTempFileName() + ".mjs"
                        $cmd = "import { getProvider, saveProvider } from '$dbUrl'; const p = getProvider('$($target.alias)'); saveProvider({ ...p, options: { ...(p.options || {}), auth_type: '$newAuthType' }, models: p.models }); console.log('updated');"
                        Set-Content $tmp $cmd -Encoding UTF8
                        $r = & node $tmp 2>$null
                        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
                        if ($r -eq "updated") {
                            Write-Host "  Updated auth type to '$newAuthType'" -ForegroundColor Green
                        } else {
                            Write-Host "  Could not update. Try [S] Setup." -ForegroundColor Yellow
                        }
                    }
                }
                Start-Sleep -Milliseconds 500
            }
        }
        continue
    }

    if ($choice -ieq "s") {
        [void](Run-SetupWizard)
        continue
    }

    if ($choice -ieq "d") {
        Write-Host ""
        $providers = $info.providers
        for ($i = 0; $i -lt $providers.Count; $i++) {
            $p = $providers[$i]
            Write-Host "    [$($i+1)] $($p.name) ($($p.alias))" -ForegroundColor Yellow
        }
        Write-Host ""
        $num = Read-Host "  Delete which number? (Enter to cancel)"
        if ($num -match '^\d+$') {
            $idx = [int]$num - 1
            if ($idx -ge 0 -and $idx -lt $providers.Count) {
                $target = $providers[$idx]
                $confirm = Read-Host "  Delete '$($target.name)'? [y/N]"
                if ($confirm -ieq "y") {
                    $tmp = [System.IO.Path]::GetTempFileName() + ".mjs"
                    $dbUrl = "file:///" + ($ScriptDir -replace '\\', '/') + "/proxy/db.js"
                    Set-Content $tmp "import { deleteProvider } from '$dbUrl'; deleteProvider('$($target.alias)'); console.log('ok');" -Encoding UTF8
                    $r = & node $tmp 2>$null
                    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
                    if ($r -eq "ok") {
                        Write-Host "  Deleted '$($target.name)'." -ForegroundColor Green
                    } else {
                        Write-Host "  Could not delete. Use [S] Setup to manage providers." -ForegroundColor Yellow
                    }
                }
            }
        }
        Start-Sleep -Milliseconds 800
        continue
    }

    # Numeric selection
    if ($choice -match '^\d+$') {
        $idx = [int]$choice - 1
        if ($idx -ge 0 -and $idx -lt $info.providers.Count) {
            $selected = $info.providers[$idx]
            Start-Provider $selected.alias
            continue
        }
    }

    Write-Host "  Invalid choice. Try again." -ForegroundColor Red
    Start-Sleep -Milliseconds 700
}
