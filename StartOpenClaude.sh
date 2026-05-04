#!/usr/bin/env bash
# StartOpenClaude — Main launcher with menu (Mac / Linux)
# Make executable: chmod +x StartOpenClaude.sh
# Then run: ./StartOpenClaude.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────
C_CYAN='\033[0;36m'
C_DCYAN='\033[0;34m'
C_YELLOW='\033[1;33m'
C_WHITE='\033[1;37m'
C_GREEN='\033[0;32m'
C_RED='\033[0;31m'
C_GRAY='\033[0;90m'
C_RESET='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
write_banner() {
    clear
    echo ""
    echo -e "  ${C_CYAN}============================================================${C_RESET}"
    echo -e "  ${C_CYAN}                O P E N C L A U D E${C_RESET}"
    echo -e "  ${C_DCYAN}         Use Claude Code with any LLM provider${C_RESET}"
    echo -e "  ${C_CYAN}============================================================${C_RESET}"
    echo ""
}

write_divider() {
    echo -e "  ${C_GRAY}------------------------------------------------------------${C_RESET}"
}

assert_node() {
    if ! command -v node &>/dev/null; then
        echo -e "  ${C_RED}[ERROR] Node.js is not installed. Get it from https://nodejs.org/${C_RESET}"
        echo ""
        read -rp "  Press Enter to exit"
        exit 1
    fi
}

get_setup_info() {
    node "$SCRIPT_DIR/proxy/check-setup.js" 2>/dev/null || echo "null"
}

show_provider_list() {
    local info="$1"
    local count
    count=$(echo "$info" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(String(d.count||0));
" 2>/dev/null || echo "0")

    echo -e "  ${C_YELLOW}Your configured providers:${C_RESET}"
    echo ""

    for ((i=1; i<=count; i++)); do
        local idx=$((i-1))
        local pname pfmt purl pdef
        pname=$(echo "$info" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.providers[$idx].name||'');
" 2>/dev/null)
        pfmt=$(echo "$info" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.providers[$idx].api_format==='openai'?'OpenAI':'Anthropic');
" 2>/dev/null)
        purl=$(echo "$info" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.providers[$idx].url||'');
" 2>/dev/null)
        pdef=$(echo "$info" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.providers[$idx].is_default?'[DEFAULT]':'');
" 2>/dev/null)
        local defstr=""
        [[ "$pdef" == "[DEFAULT]" ]] && defstr=" ${C_GREEN}[DEFAULT]${C_RESET}"
        echo -e "    ${C_YELLOW}[$i]${C_RESET} ${C_WHITE}$pname${C_RESET}$defstr  ${C_GRAY}($pfmt)  $purl${C_RESET}"
    done
    echo ""
}

launch_provider() {
    local alias="$1"
    echo ""
    echo -e "  ${C_CYAN}Starting OpenClaude...${C_RESET}"
    echo -e "  ${C_GRAY}(Close the Claude Code session to return here)${C_RESET}"
    echo ""
    if [[ -n "$alias" ]]; then
        bash "$SCRIPT_DIR/openclaude.sh" --switch "$alias"
    else
        bash "$SCRIPT_DIR/openclaude.sh"
    fi
}

# ── Main loop ─────────────────────────────────────────────────────────────────
assert_node

while true; do
    write_banner
    INFO=$(get_setup_info)

    CONFIGURED=$(echo "$INFO" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d&&d.configured?'yes':'no');
" 2>/dev/null || echo "no")

    # ── First run: no providers configured ────────────────────────────────────
    if [[ "$CONFIGURED" != "yes" ]]; then
        echo -e "  ${C_CYAN}Welcome to OpenClaude!${C_RESET}"
        echo ""
        echo -e "  ${C_YELLOW}No providers are configured yet.${C_RESET}"
        echo -e "  ${C_GRAY}Let's add one now — it only takes about 2 minutes.${C_RESET}"
        echo ""
        write_divider
        echo ""
        node "$SCRIPT_DIR/setup.js"
        echo ""

        INFO=$(get_setup_info)
        CONFIGURED=$(echo "$INFO" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d&&d.configured?'yes':'no');
" 2>/dev/null || echo "no")

        if [[ "$CONFIGURED" != "yes" ]]; then
            echo -e "  ${C_GRAY}No providers were added. Exiting.${C_RESET}"
            echo ""
            read -rp "  Press Enter to close"
            exit 0
        fi

        echo ""
        echo -e "  ${C_GREEN}Provider saved! Ready to launch.${C_RESET}"
        echo ""
        read -rp "  Start OpenClaude now? [Y/n]: " choice
        if [[ -z "$choice" || "${choice,,}" == "y" ]]; then
            launch_provider ""
        fi
        continue
    fi

    # ── Main menu ─────────────────────────────────────────────────────────────
    PROVIDER_COUNT=$(echo "$INFO" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(String(d.count||0));
" 2>/dev/null || echo "0")

    show_provider_list "$INFO"

    write_divider
    echo ""
    echo -e "  ${C_YELLOW}Press a number to launch, or choose an action:${C_RESET}"
    echo ""
    echo -e "    ${C_WHITE}[1-$PROVIDER_COUNT] Start with that provider${C_RESET}"
    echo -e "    ${C_WHITE}[A]  Add a new provider${C_RESET}"
    echo -e "    ${C_WHITE}[D]  Delete a provider${C_RESET}"
    echo -e "    ${C_WHITE}[S]  Open full setup / settings${C_RESET}"
    echo -e "    ${C_WHITE}[Q]  Quit${C_RESET}"
    echo ""
    read -rp "  Choice: " CHOICE
    CHOICE="${CHOICE// /}"   # trim spaces

    if [[ "${CHOICE,,}" == "q" ]]; then
        echo ""
        echo -e "  ${C_GRAY}Bye!${C_RESET}"
        echo ""
        break
    fi

    if [[ "${CHOICE,,}" == "a" || "${CHOICE,,}" == "s" ]]; then
        echo ""
        node "$SCRIPT_DIR/setup.js"
        continue
    fi

    if [[ "${CHOICE,,}" == "d" ]]; then
        echo ""
        local_count=$(echo "$INFO" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(String(d.count||0));
" 2>/dev/null || echo "0")
        for ((i=1; i<=local_count; i++)); do
            local idx=$((i-1))
            pname=$(echo "$INFO" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.providers[$idx].name||'');
" 2>/dev/null)
            palias=$(echo "$INFO" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.providers[$idx].alias||'');
" 2>/dev/null)
            echo -e "    ${C_YELLOW}[$i]${C_RESET} $pname ($palias)"
        done
        echo ""
        read -rp "  Delete which number? (Enter to cancel): " DNUM
        if [[ "$DNUM" =~ ^[0-9]+$ ]]; then
            didx=$((DNUM-1))
            if [[ $didx -ge 0 && $didx -lt $local_count ]]; then
                target_alias=$(echo "$INFO" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.providers[$didx].alias||'');
" 2>/dev/null)
                target_name=$(echo "$INFO" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.providers[$didx].name||'');
" 2>/dev/null)
                read -rp "  Delete '$target_name'? [y/N]: " CONFIRM
                if [[ "${CONFIRM,,}" == "y" ]]; then
                    TMP=$(mktemp /tmp/oc-del-XXXXXX.mjs)
                    DB_URL="file://$SCRIPT_DIR/proxy/db.js"
                    printf "import { deleteProvider } from '%s'; deleteProvider('%s'); console.log('ok');" \
                        "$DB_URL" "$target_alias" > "$TMP"
                    RESULT=$(node "$TMP" 2>/dev/null)
                    rm -f "$TMP"
                    if [[ "$RESULT" == "ok" ]]; then
                        echo -e "  ${C_GREEN}Deleted '$target_name'.${C_RESET}"
                    else
                        echo -e "  ${C_YELLOW}Could not delete. Use [S] Setup to manage providers.${C_RESET}"
                    fi
                fi
            fi
        fi
        sleep 0.8
        continue
    fi

    # Numeric selection
    if [[ "$CHOICE" =~ ^[0-9]+$ ]]; then
        idx=$((CHOICE-1))
        if [[ $idx -ge 0 && $idx -lt $PROVIDER_COUNT ]]; then
            sel_alias=$(echo "$INFO" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.providers[$idx].alias||'');
" 2>/dev/null)
            launch_provider "$sel_alias"
            continue
        fi
    fi

    echo -e "  ${C_RED}Invalid choice. Try again.${C_RESET}"
    sleep 0.7
done
