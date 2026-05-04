#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  OpenClaude Setup — macOS / Linux
#  Installs dependencies and launches the interactive provider wizard.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'; DIM='\033[2m'
c()  { echo -e "${!1}${2}${RESET}"; }
cb() { echo -e "${BOLD}${!1}${2}${RESET}"; }

echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}  ║${RESET}${BOLD}      OpenClaude — macOS/Linux Setup             ${RESET}${CYAN}║${RESET}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    c RED "  [ERROR] Node.js is not installed or not in PATH."
    echo ""
    echo "  Install options:"
    echo "    macOS:  brew install node    (or https://nodejs.org/)"
    echo "    Ubuntu: sudo apt install nodejs npm"
    echo "    Other:  https://nodejs.org/"
    echo ""
    exit 1
fi

NODE_VER=$(node --version)
echo -e "  Node.js found: ${GREEN}${NODE_VER}${RESET}"

# ── Check npm ─────────────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
    c RED "  [ERROR] npm not found. Please reinstall Node.js."
    exit 1
fi

# ── Check Node.js version (22.5+ required for built-in sqlite) ───────────────
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [[ "$NODE_MAJOR" -lt 22 ]]; then
    c RED "  [ERROR] Node.js 22.5 or later is required (you have $NODE_VER)."
    echo "  Download: https://nodejs.org/"
    exit 1
fi
echo -e "  Node.js version: ${GREEN}OK${RESET} (built-in SQLite available)"

# ── Check claude CLI ──────────────────────────────────────────────────────────
echo ""
if command -v claude &>/dev/null; then
    CLAUDE_VER=$(claude --version 2>/dev/null || echo "unknown")
    echo -e "  Claude Code: ${GREEN}${CLAUDE_VER}${RESET}"
else
    c YELLOW "  [WARNING] 'claude' CLI not found in PATH."
    echo "  Install Claude Code: https://claude.ai/code"
    echo "  OpenClaude will still configure providers, but you'll need"
    echo "  Claude Code installed to use 'openclaude' to launch it."
fi

# ── Make scripts executable ───────────────────────────────────────────────────
chmod +x "$SCRIPT_DIR/openclaude.sh" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/setup.sh" 2>/dev/null || true

# ── Add to PATH (optional) ────────────────────────────────────────────────────
echo ""
printf "  Add OpenClaude to PATH so you can run 'openclaude' from anywhere? [Y/n]: "
read -r ADD_PATH
ADD_PATH="${ADD_PATH:-y}"

if [[ "${ADD_PATH,,}" == "y" ]]; then
    SHELL_NAME="$(basename "${SHELL:-bash}")"
    case "$SHELL_NAME" in
        zsh)   RC_FILE="$HOME/.zshrc" ;;
        fish)  RC_FILE="$HOME/.config/fish/config.fish" ;;
        *)     RC_FILE="$HOME/.bashrc" ;;
    esac

    EXPORT_LINE="export PATH=\"\$PATH:$SCRIPT_DIR\""
    # For fish use different syntax
    if [[ "$SHELL_NAME" == "fish" ]]; then
        EXPORT_LINE="fish_add_path \"$SCRIPT_DIR\""
    fi

    if ! grep -qF "$SCRIPT_DIR" "$RC_FILE" 2>/dev/null; then
        echo "" >> "$RC_FILE"
        echo "# OpenClaude" >> "$RC_FILE"
        echo "$EXPORT_LINE" >> "$RC_FILE"
        c GREEN "  Added to $RC_FILE"
        echo -e "  ${DIM}Run: source $RC_FILE   (or open a new terminal)${RESET}"
    else
        echo "  Already in PATH."
    fi

    # Also create symlink in /usr/local/bin if writable
    if [[ -w /usr/local/bin ]] && [[ ! -f /usr/local/bin/openclaude ]]; then
        ln -sf "$SCRIPT_DIR/openclaude.sh" /usr/local/bin/openclaude
        c GREEN "  Symlink created: /usr/local/bin/openclaude"
    fi
fi

# ── Run provider setup wizard ─────────────────────────────────────────────────
echo ""
echo -e "  ${DIM}─────────────────────────────────────────────────────${RESET}"
c CYAN "  Launching provider configuration wizard..."
echo -e "  ${DIM}─────────────────────────────────────────────────────${RESET}"
echo ""

node "$SCRIPT_DIR/setup.js"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${DIM}─────────────────────────────────────────────────────${RESET}"
c GREEN "  Setup complete!"
echo ""
echo "  To start Claude Code with your provider:"
echo -e "    ${BOLD}openclaude${RESET}"
echo ""
echo "  To add more providers or change settings:"
echo -e "    ${BOLD}openclaude --setup${RESET}"
echo ""
echo "  To see all options:"
echo -e "    ${BOLD}openclaude --help${RESET}"
echo -e "  ${DIM}─────────────────────────────────────────────────────${RESET}"
echo ""
