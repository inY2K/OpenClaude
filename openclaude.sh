#!/usr/bin/env bash
# openclaude — Use Claude Code with any LLM provider
# Usage: openclaude [--switch <alias>] [--setup] [--list] [--status] [--remote] [--help]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_PID=""

cleanup_proxy() {
    if [[ -n "$PROXY_PID" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
        kill "$PROXY_PID" 2>/dev/null || true
        echo "  Proxy stopped."
    fi
}
trap cleanup_proxy EXIT

# ─── Parse args ───────────────────────────────────────────────────────────────
ACTION="launch"
SWITCH_ALIAS=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --switch|-s)   SWITCH_ALIAS="$2"; shift 2 ;;
        --setup)       ACTION="setup"; shift ;;
        --list)        ACTION="list"; shift ;;
        --status)      ACTION="status"; shift ;;
        --remote|-r)   ACTION="remote"; shift ;;
        --help|-h)     ACTION="help"; shift ;;
        *)             break ;;
    esac
done

# ─── Node.js check ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo ""
    echo "  ERROR: Node.js is not installed or not in PATH." >&2
    echo "  Install Node.js from https://nodejs.org/ and try again." >&2
    echo ""
    exit 1
fi

# ─── Node.js version check (22.5+ for built-in sqlite) ───────────────────────
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [[ "$NODE_MAJOR" -lt 22 ]]; then
    echo "  ERROR: Node.js 22.5+ required. Download from https://nodejs.org/" >&2
    exit 1
fi

# ─── DB helpers ───────────────────────────────────────────────────────────────
get_provider_json() {
    local alias="${1:-}"
    if [[ -n "$alias" ]]; then
        node "$SCRIPT_DIR/proxy/get-provider.js" "$alias" 2>/dev/null
    else
        node "$SCRIPT_DIR/proxy/get-provider.js" 2>/dev/null
    fi
}

get_providers_json() {
    node "$SCRIPT_DIR/proxy/check-setup.js" 2>/dev/null
}

has_providers() {
    local count
    count=$(node --input-type=module <<EOF 2>/dev/null
import { hasProviders } from '$SCRIPT_DIR/proxy/db.js';
console.log(hasProviders() ? '1' : '0');
EOF
)
    [[ "$count" == "1" ]]
}

get_model_for_tier() {
    local provider_json="$1" tier="$2"
    echo "$provider_json" | node --input-type=module <<EOF 2>/dev/null
import { createInterface } from 'readline';
let raw = '';
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
    const p = JSON.parse(raw);
    const m = (p.models || []).find(m => m.tier === '$tier');
    console.log(m ? m.model_name : (p.models?.[0]?.model_name || ''));
});
EOF
}

# ─── Help ─────────────────────────────────────────────────────────────────────
if [[ "$ACTION" == "help" ]]; then
    echo ""
    echo "  openclaude — Claude Code with any LLM provider"
    echo ""
    echo "  Usage:"
    echo "    openclaude                       Launch with default provider"
    echo "    openclaude --switch <alias>      Use specific provider"
    echo "    openclaude --setup               Add/manage providers"
    echo "    openclaude --list                List configured providers"
    echo "    openclaude --status              Show proxy status"
    echo "    openclaude --remote              Remote control mode"
    echo ""
    exit 0
fi

# ─── Setup ────────────────────────────────────────────────────────────────────
if [[ "$ACTION" == "setup" ]] || ! has_providers; then
    if [[ "$ACTION" != "setup" ]]; then
        echo ""
        echo "  No providers configured. Starting setup wizard..."
        echo ""
    fi
    node "$SCRIPT_DIR/setup.js"
    if [[ "$ACTION" == "setup" ]]; then exit 0; fi
    if ! has_providers; then exit 0; fi
fi

# ─── List ─────────────────────────────────────────────────────────────────────
if [[ "$ACTION" == "list" ]]; then
    echo ""
    echo "  Configured Providers"
    echo "  ===================="
    echo ""
    get_providers_json | node --input-type=module <<'EOF'
import { createInterface } from 'readline';
let raw = '';
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
    const providers = JSON.parse(raw).providers || [];
    for (const p of providers) {
        const def = p.is_default ? ' [default]' : '';
        const fmt = p.api_format === 'openai' ? '(OpenAI)' : '(Anthropic)';
        console.log(`  \x1b[33m${p.alias}\x1b[0m${def} — ${p.name} ${fmt}`);
        console.log(`    \x1b[2m${p.url}\x1b[0m`);
        const tiers = (p.models || []).map(m => `${m.tier}=${m.model_name}`).join('  ');
        if (tiers) console.log(`    \x1b[2m${tiers}\x1b[0m`);
        console.log('');
    }
});
EOF
    exit 0
fi

# ─── Status ───────────────────────────────────────────────────────────────────
if [[ "$ACTION" == "status" ]]; then
    echo ""
    echo "  openclaude — Proxy Status"
    echo "  ========================="
    echo ""
    local_status=$(curl -s http://127.0.0.1:3200/_proxy/status 2>/dev/null || true)
    if [[ -n "$local_status" ]]; then
        echo "  Proxy: RUNNING"
        echo "    $local_status"
    else
        echo "  Proxy: not running"
    fi
    echo ""
    exit 0
fi

# ─── Load provider ────────────────────────────────────────────────────────────
PROVIDER_JSON=$(get_provider_json "${SWITCH_ALIAS:-}")
if [[ "$PROVIDER_JSON" == "null" ]] || [[ -z "$PROVIDER_JSON" ]]; then
    echo ""
    echo "  ERROR: Provider '${SWITCH_ALIAS}' not found. Run 'openclaude --list' to see available providers." >&2
    echo ""
    exit 1
fi

PROVIDER_NAME=$(echo "$PROVIDER_JSON" | node -e "process.stdin.on('data',d=>{const p=JSON.parse(d);console.log(p.name)})")
PROVIDER_URL=$(echo "$PROVIDER_JSON" | node -e "process.stdin.on('data',d=>{const p=JSON.parse(d);console.log(p.url)})")
PROVIDER_KEY=$(echo "$PROVIDER_JSON" | node -e "process.stdin.on('data',d=>{const p=JSON.parse(d);console.log(p.api_key||'')})")
PROVIDER_FORMAT=$(echo "$PROVIDER_JSON" | node -e "process.stdin.on('data',d=>{const p=JSON.parse(d);console.log(p.api_format)})")

OPUS_MODEL=$(echo "$PROVIDER_JSON"    | node -e "process.stdin.on('data',d=>{const p=JSON.parse(d);const m=p.models?.find(m=>m.tier==='opus');console.log(m?.model_name||p.models?.[0]?.model_name||'')})")
SONNET_MODEL=$(echo "$PROVIDER_JSON"  | node -e "process.stdin.on('data',d=>{const p=JSON.parse(d);const m=p.models?.find(m=>m.tier==='sonnet');console.log(m?.model_name||p.models?.[0]?.model_name||'')})")
HAIKU_MODEL=$(echo "$PROVIDER_JSON"   | node -e "process.stdin.on('data',d=>{const p=JSON.parse(d);const m=p.models?.find(m=>m.tier==='haiku');console.log(m?.model_name||p.models?.[0]?.model_name||'')})")
SUBAGENT_MODEL=$(echo "$PROVIDER_JSON"| node -e "process.stdin.on('data',d=>{const p=JSON.parse(d);const m=p.models?.find(m=>m.tier==='subagent');console.log(m?.model_name||p.models?.[0]?.model_name||'')})")

set_model_env() {
    export ANTHROPIC_DEFAULT_OPUS_MODEL="$OPUS_MODEL"
    export ANTHROPIC_DEFAULT_SONNET_MODEL="$SONNET_MODEL"
    export ANTHROPIC_DEFAULT_HAIKU_MODEL="$HAIKU_MODEL"
    export CLAUDE_CODE_SUBAGENT_MODEL="$SUBAGENT_MODEL"
    export CLAUDE_CODE_EFFORT_LEVEL="max"
}

start_proxy() {
    local port_file
    port_file=$(mktemp)
    local proxy_args=("$SCRIPT_DIR/proxy/start-proxy.js")
    if [[ -n "$SWITCH_ALIAS" ]]; then proxy_args+=(--alias "$SWITCH_ALIAS"); fi

    node "${proxy_args[@]}" > "$port_file" 2>/dev/null &
    PROXY_PID=$!

    local tries=0
    while [[ $tries -lt 40 ]]; do
        sleep 0.2; tries=$((tries + 1))
        # Look for a line that is just a port number
        if grep -qE '^\d+$' "$port_file" 2>/dev/null; then break; fi
    done

    PROXY_PORT=$(grep -E '^\d+$' "$port_file" | tail -1)
    rm -f "$port_file"

    if [[ -z "$PROXY_PORT" ]]; then
        echo "  ERROR: Proxy failed to start" >&2
        exit 1
    fi
}

# ─── Remote control ───────────────────────────────────────────────────────────
if [[ "$ACTION" == "remote" ]]; then
    echo ""
    echo "  Starting proxy for $PROVIDER_NAME..."
    start_proxy
    echo "  Proxy on :$PROXY_PORT → $PROVIDER_URL"
    echo "  Launching remote control via $PROVIDER_NAME..."
    echo ""

    export ANTHROPIC_BASE_URL="http://127.0.0.1:$PROXY_PORT"
    export ANTHROPIC_AUTH_TOKEN="openclaude-proxy"
    set_model_env
    unset ANTHROPIC_API_KEY 2>/dev/null || true

    exec claude remote-control "$@"
fi

# ─── Launch ───────────────────────────────────────────────────────────────────
echo ""
echo "  Launching Claude Code via $PROVIDER_NAME..."
echo "  Endpoint: $PROVIDER_URL"
echo "  Format:   $PROVIDER_FORMAT"
echo "  Opus:     $OPUS_MODEL"
echo "  Haiku:    $HAIKU_MODEL"
echo ""

if [[ "$PROVIDER_FORMAT" == "openai" ]]; then
    echo "  Starting OpenAI→Anthropic translation proxy..."
    start_proxy
    echo "  Proxy on :$PROXY_PORT"
    echo ""

    export ANTHROPIC_BASE_URL="http://127.0.0.1:$PROXY_PORT"
    export ANTHROPIC_AUTH_TOKEN="openclaude-proxy"
    set_model_env
    unset ANTHROPIC_API_KEY 2>/dev/null || true

    exec claude "$@"
else
    # Anthropic-format: direct connection
    export ANTHROPIC_BASE_URL="$PROVIDER_URL"
    export ANTHROPIC_AUTH_TOKEN="${PROVIDER_KEY:-openclaude-nokey}"
    export ANTHROPIC_MODEL="$OPUS_MODEL"
    set_model_env
    unset ANTHROPIC_API_KEY 2>/dev/null || true

    exec claude "$@"
fi
