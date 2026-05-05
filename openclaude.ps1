<#
.SYNOPSIS
    openclaude - Use Claude Code with any LLM provider via an intelligent proxy.

.USAGE
    openclaude                          # Launch with default provider
    openclaude --switch <alias>         # Use a specific provider
    openclaude --setup                  # Open the provider setup wizard
    openclaude --status                 # Show current proxy status
    openclaude --list                   # List configured providers
    openclaude --remote                 # Remote control mode
    openclaude --remote --switch <alias># Remote control with a specific provider
    openclaude --help                   # Show help
#>

param(
    [Alias("s")]
    [string]$Switch,
    [Alias("r")]
    [switch]$Remote,
    [switch]$Status,
    [switch]$List,
    [switch]$Setup,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --------------------------------------------------------------------------
# Resolve the claude CLI executable
# Bare 'claude' on Windows resolves to the npm shell script (no extension)
# which Windows cannot run and triggers "choose a default app".
# Prefer claude.exe, then claude.cmd, then fall back.
# --------------------------------------------------------------------------
function Find-ClaudeExe {
    $exe = Get-Command claude.exe -ErrorAction SilentlyContinue
    if ($exe) { return $exe.Source }
    $cmd = Get-Command claude.cmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return "claude"
}
$script:ClaudeExe = Find-ClaudeExe

# --------------------------------------------------------------------------
# Node.js check
# --------------------------------------------------------------------------
function Assert-Node {
    try { $null = & node --version 2>&1 }
    catch {
        Write-Host ""
        Write-Host "  ERROR: Node.js is not installed or not in PATH." -ForegroundColor Red
        Write-Host "  Install Node.js from https://nodejs.org/ and try again." -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
}

# --------------------------------------------------------------------------
# DB helpers (via Node.js helper scripts)
# --------------------------------------------------------------------------
function Get-ProvidersJson {
    try {
        $raw = & node "$ScriptDir\proxy\check-setup.js" 2>$null
        $info = $raw | ConvertFrom-Json
        return $info.providers
    } catch { return @() }
}

function Get-ProviderJson([string]$Alias) {
    try {
        if ($Alias) {
            $raw = & node "$ScriptDir\proxy\get-provider.js" $Alias 2>$null
        } else {
            $raw = & node "$ScriptDir\proxy\get-provider.js" 2>$null
        }
        return $raw | ConvertFrom-Json
    } catch { return $null }
}

function Get-ModelForTier([object]$Provider, [string]$Tier) {
    $m = $Provider.models | Where-Object { $_.tier -eq $Tier } | Select-Object -First 1
    if ($m) { return $m.model_name }
    $fallback = $Provider.models | Select-Object -First 1
    if ($fallback) { return $fallback.model_name }
    return ''
}

function Has-Providers {
    $providers = Get-ProvidersJson
    return ($providers -and $providers.Count -gt 0)
}

# --------------------------------------------------------------------------
# Node.js version check (22.5+ for built-in sqlite)
# --------------------------------------------------------------------------
function Assert-Deps {
    $nodeMajor = [int](& node -e "console.log(process.versions.node.split('.')[0])" 2>&1)
    if ($nodeMajor -lt 22) {
        Write-Host "  ERROR: Node.js 22.5 or later is required. Download from https://nodejs.org/" -ForegroundColor Red
        exit 1
    }
}

function Test-ProxyAnthropicCompatibility([int]$Port, [string]$Model) {
    try {
        $body = @{
            model = $Model
            system = "You are a helpful assistant."
            messages = @(
                @{
                    role = "user"
                    content = @(
                        @{ type = "text"; text = "ping" }
                    )
                }
            )
        } | ConvertTo-Json -Depth 8

        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/messages/count_tokens" `
            -Method Post `
            -Headers @{ "x-api-key" = "openclaude-proxy"; "anthropic-version" = "2023-06-01" } `
            -ContentType "application/json" `
            -Body $body `
            -TimeoutSec 10

        return ($null -ne $resp -and $null -ne $resp.input_tokens)
    } catch {
        return $false
    }
}

# --------------------------------------------------------------------------
# Help
# --------------------------------------------------------------------------
if ($Help) {
    Write-Host ""
    Write-Host "  openclaude - Claude Code with any LLM provider" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Usage:"
    Write-Host "    openclaude                      Launch with default provider"
    Write-Host "    openclaude --switch <alias>     Use specific provider"
    Write-Host "    openclaude --setup              Add/manage providers"
    Write-Host "    openclaude --list               List configured providers"
    Write-Host "    openclaude --status             Show proxy status"
    Write-Host "    openclaude --remote             Remote control mode"
    Write-Host ""
    Write-Host "  Quick switch while running:"
    Write-Host "    openclaude --switch <alias>     (sends switch command to running proxy)"
    Write-Host ""
    exit 0
}

Assert-Node
Assert-Deps

# --------------------------------------------------------------------------
# Setup
# --------------------------------------------------------------------------
if ($Setup -or -not (Has-Providers)) {
    if (-not $Setup) {
        Write-Host ""
        Write-Host "  No providers configured. Starting setup wizard..." -ForegroundColor Cyan
        Write-Host ""
    }
    & node (Join-Path $ScriptDir "setup.js")
    if (-not $Setup) {
        if (-not (Has-Providers)) { exit 0 }
    } else {
        exit 0
    }
}

# --------------------------------------------------------------------------
# List
# --------------------------------------------------------------------------
if ($List) {
    $providers = Get-ProvidersJson
    Write-Host ""
    Write-Host "  Configured Providers" -ForegroundColor Cyan
    Write-Host "  ====================" -ForegroundColor DarkGray
    Write-Host ""
    foreach ($p in $providers) {
        $def = ""
        if ($p.is_default) { $def = " [default]" }
        $fmt = "(Anthropic)"
        if ($p.api_format -eq 'openai') { $fmt = "(OpenAI)" }
        Write-Host "  $($p.alias)$def" -ForegroundColor Yellow -NoNewline
        Write-Host " - $($p.name) $fmt"
        Write-Host "    $($p.url)" -ForegroundColor DarkGray
        $tiers = $p.models | ForEach-Object { "$($_.tier)=$($_.model_name)" }
        if ($tiers) { Write-Host "    $($tiers -join '  ')" -ForegroundColor DarkGray }
        Write-Host ""
    }
    exit 0
}

# --------------------------------------------------------------------------
# Status
# --------------------------------------------------------------------------
if ($Status) {
    Write-Host ""
    Write-Host "  openclaude - Proxy Status" -ForegroundColor Cyan
    Write-Host "  =========================" -ForegroundColor DarkGray
    Write-Host ""
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:3200/_proxy/status" -TimeoutSec 2
        Write-Host "  Proxy: RUNNING" -ForegroundColor Green
        Write-Host "    Mode:     $($status.mode)"
        Write-Host "    Format:   $($status.api_format)"
        Write-Host "    Requests: $($status.requests)"
        Write-Host "    Uptime:   $($status.uptime)s"
    } catch {
        Write-Host "  Proxy: not running" -ForegroundColor DarkGray
    }
    Write-Host ""
    exit 0
}

# --------------------------------------------------------------------------
# Load provider
# --------------------------------------------------------------------------
if ($Switch) {
    $provider = Get-ProviderJson $Switch
} else {
    $provider = Get-ProviderJson ""
}

if (-not $provider) {
    Write-Host ""
    Write-Host "  ERROR: Provider '$Switch' not found. Run 'openclaude --list' to see available providers." -ForegroundColor Red
    Write-Host ""
    exit 1
}

$opusModel     = Get-ModelForTier $provider "opus"
$sonnetModel   = Get-ModelForTier $provider "sonnet"
$haikuModel    = Get-ModelForTier $provider "haiku"
$subagentModel = Get-ModelForTier $provider "subagent"
$useProxy = ($provider.api_format -eq 'openai') -or $provider.force_proxy
$effortLevel = if ($provider.force_proxy -and $provider.api_format -eq 'anthropic') { $null } else { 'max' }

# --------------------------------------------------------------------------
# Remote control
# --------------------------------------------------------------------------
if ($Remote) {
    $proxyScript = Join-Path $ScriptDir "proxy\start-proxy.js"
    $proxyArgs = @($proxyScript)
    if ($Switch) { $proxyArgs += '--alias'; $proxyArgs += $Switch }

    $tmpFile = [System.IO.Path]::GetTempFileName()
    $tmpErr = [System.IO.Path]::GetTempFileName()
    $proxyProc = Start-Process -FilePath "node" -ArgumentList $proxyArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput $tmpFile -RedirectStandardError $tmpErr

    $tries = 0
    while ($tries -lt 100) {
        Start-Sleep -Milliseconds 200; $tries++
        $content = Get-Content $tmpFile -ErrorAction SilentlyContinue
        $portLine = $content | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1
        if ($portLine) { break }
    }

    $proxyPort = ($content | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1)
    Remove-Item $tmpFile -ErrorAction SilentlyContinue
    $stderrLines = Get-Content $tmpErr -ErrorAction SilentlyContinue
    Remove-Item $tmpErr -ErrorAction SilentlyContinue

    if (-not $proxyPort) {
        Write-Host "  ERROR: Proxy failed to start" -ForegroundColor Red
        if ($stderrLines) {
            Write-Host "  Proxy error output:" -ForegroundColor Yellow
            $stderrLines | Select-Object -Last 8 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        if ($proxyProc -and -not $proxyProc.HasExited) { Stop-Process -Id $proxyProc.Id -Force }
        exit 1
    }

    Write-Host ""
    Write-Host "  Proxy on :$proxyPort -> $($provider.url)" -ForegroundColor DarkGray
    Write-Host "  Launching remote control via $($provider.name)..." -ForegroundColor Cyan
    Write-Host ""

    $env:ANTHROPIC_BASE_URL              = "http://127.0.0.1:$proxyPort"
    $env:ANTHROPIC_DEFAULT_OPUS_MODEL    = $opusModel
    $env:ANTHROPIC_DEFAULT_SONNET_MODEL  = $sonnetModel
    $env:ANTHROPIC_DEFAULT_HAIKU_MODEL   = $haikuModel
    $env:CLAUDE_CODE_SUBAGENT_MODEL      = $subagentModel
    if ($effortLevel) {
        $env:CLAUDE_CODE_EFFORT_LEVEL    = $effortLevel
    } else {
        Remove-Item Env:CLAUDE_CODE_EFFORT_LEVEL -ErrorAction SilentlyContinue
    }
    Remove-Item Env:ANTHROPIC_API_KEY    -ErrorAction SilentlyContinue
    Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue

    try {
        & $script:ClaudeExe remote-control @Args
    } finally {
        if ($proxyProc -and -not $proxyProc.HasExited) {
            Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue
            Write-Host "  Proxy stopped." -ForegroundColor DarkGray
        }
    }
    exit 0
}

# --------------------------------------------------------------------------
# Launch Claude Code
# --------------------------------------------------------------------------
Write-Host ""
Write-Host "  Launching Claude Code via $($provider.name)..." -ForegroundColor Cyan
Write-Host "  Endpoint: $($provider.url)" -ForegroundColor DarkGray
Write-Host "  Format:   $($provider.api_format)" -ForegroundColor DarkGray
Write-Host "  Opus:     $opusModel" -ForegroundColor DarkGray
Write-Host "  Haiku:    $haikuModel" -ForegroundColor DarkGray
Write-Host ""

if ($useProxy) {
    # OpenAI-format providers must go through the proxy for translation
    $proxyScript = Join-Path $ScriptDir "proxy\start-proxy.js"
    $proxyArgs = @($proxyScript)
    if ($Switch) { $proxyArgs += '--alias'; $proxyArgs += $Switch }

    $tmpFile = [System.IO.Path]::GetTempFileName()
    $tmpErr = [System.IO.Path]::GetTempFileName()
    $proxyProc = Start-Process -FilePath "node" -ArgumentList $proxyArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput $tmpFile -RedirectStandardError $tmpErr

    $tries = 0
    while ($tries -lt 100) {
        Start-Sleep -Milliseconds 200; $tries++
        $content = Get-Content $tmpFile -ErrorAction SilentlyContinue
        $portLine = $content | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1
        if ($portLine) { break }
    }
    $proxyPort = ($content | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1)
    Remove-Item $tmpFile -ErrorAction SilentlyContinue
    $stderrLines = Get-Content $tmpErr -ErrorAction SilentlyContinue
    Remove-Item $tmpErr -ErrorAction SilentlyContinue

    if (-not $proxyPort) {
        Write-Host "  ERROR: Proxy failed to start" -ForegroundColor Red
        if ($stderrLines) {
            Write-Host "  Proxy error output:" -ForegroundColor Yellow
            $stderrLines | Select-Object -Last 8 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        if ($proxyProc -and -not $proxyProc.HasExited) { Stop-Process -Id $proxyProc.Id -Force }
        exit 1
    }

    $proxyLabel = if ($provider.api_format -eq 'openai') { 'OpenAI->Anthropic translation' } else { 'Anthropic compatibility shim' }
    Write-Host "  Proxy on :$proxyPort ($proxyLabel)" -ForegroundColor DarkGray
    Write-Host ""

    if (-not (Test-ProxyAnthropicCompatibility -Port ([int]$proxyPort) -Model $opusModel)) {
        Write-Host "  ERROR: Proxy preflight failed. count_tokens response did not include input_tokens." -ForegroundColor Red
        if ($proxyProc -and -not $proxyProc.HasExited) {
            Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue
        }
        exit 1
    }

    $env:ANTHROPIC_BASE_URL              = "http://127.0.0.1:$proxyPort"
    $env:ANTHROPIC_AUTH_TOKEN            = "openclaude-proxy"
    $env:ANTHROPIC_DEFAULT_OPUS_MODEL    = $opusModel
    $env:ANTHROPIC_DEFAULT_SONNET_MODEL  = $sonnetModel
    $env:ANTHROPIC_DEFAULT_HAIKU_MODEL   = $haikuModel
    $env:CLAUDE_CODE_SUBAGENT_MODEL      = $subagentModel
    if ($effortLevel) {
        $env:CLAUDE_CODE_EFFORT_LEVEL    = $effortLevel
    } else {
        Remove-Item Env:CLAUDE_CODE_EFFORT_LEVEL -ErrorAction SilentlyContinue
    }
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

    try {
        & $script:ClaudeExe @Args
    } finally {
        if ($proxyProc -and -not $proxyProc.HasExited) {
            Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue
            Write-Host "  Proxy stopped." -ForegroundColor DarkGray
        }
    }
} else {
    # Anthropic-format: direct connection, no proxy needed
    $env:ANTHROPIC_BASE_URL              = $provider.url
    if ($provider.api_key) {
        $env:ANTHROPIC_AUTH_TOKEN        = $provider.api_key
    } else {
        $env:ANTHROPIC_AUTH_TOKEN        = "openclaude-nokey"
    }
    $env:ANTHROPIC_MODEL                 = $opusModel
    $env:ANTHROPIC_DEFAULT_OPUS_MODEL    = $opusModel
    $env:ANTHROPIC_DEFAULT_SONNET_MODEL  = $sonnetModel
    $env:ANTHROPIC_DEFAULT_HAIKU_MODEL   = $haikuModel
    $env:CLAUDE_CODE_SUBAGENT_MODEL      = $subagentModel
    if ($effortLevel) {
        $env:CLAUDE_CODE_EFFORT_LEVEL    = $effortLevel
    } else {
        Remove-Item Env:CLAUDE_CODE_EFFORT_LEVEL -ErrorAction SilentlyContinue
    }
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

    & $script:ClaudeExe @Args
}

foreach ($v in @("ANTHROPIC_BASE_URL","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL","ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL","CLAUDE_CODE_SUBAGENT_MODEL","CLAUDE_CODE_EFFORT_LEVEL")) {
    Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}
