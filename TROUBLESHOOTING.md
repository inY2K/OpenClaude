<div align="center">

<img src="assets/logo.svg" width="72" alt="OpenClaude Logo"/>

# OpenClaude — Troubleshooting Guide

**Something not working? You'll find the answer here.**
*Written for everyone — no technical background needed.*

[← Back to README](README.md) &nbsp;·&nbsp; [📖 Full How-To Guide](HOW_TO.md)

</div>

---

## 🚦 Start Here — Quick Checklist

Before digging into specific errors, run through this checklist. Most problems come from one of these:

- [ ] **Node.js is installed and version 22 or higher** → `node --version`
- [ ] **Claude Code is installed** → `claude --version`
- [ ] **You're in the right folder** when running commands
- [ ] **Your API key is correct** — not a URL, not a username, not a password
- [ ] **Your provider endpoint URL is correct** — see the [Provider Reference Table](#-provider-reference-table) below
- [ ] **You chose the right API format** — OpenAI-compat vs Anthropic-compat (see below)

---

## Table of Contents

1. [Understanding API Formats — The Most Common Source of Confusion](#1-understanding-api-formats--the-most-common-source-of-confusion)
2. [Provider Reference Table](#2-provider-reference-table)
3. [Common Error Messages](#3-common-error-messages)
4. [API Key Problems](#4-api-key-problems)
5. [Connection Problems](#5-connection-problems)
6. [Model Name Problems](#6-model-name-problems)
7. [Local Model Problems (Ollama / LM Studio)](#7-local-model-problems-ollama--lm-studio)
8. [Windows-Specific Problems](#8-windows-specific-problems)
9. [macOS / Linux-Specific Problems](#9-macos--linux-specific-problems)
10. [Advanced Proxy Errors](#10-advanced-proxy-errors)
11. [Still Stuck? How to Get Help](#11-still-stuck-how-to-get-help)

---

## 1. Understanding API Formats — The Most Common Source of Confusion

This is the **#1 cause of failures**. Every AI provider speaks one of two "languages":

### What's an API format?

Think of it like this: you want to order pizza. Some restaurants take orders in English, others in Italian. OpenClaude is the translator. You need to tell it which language your restaurant speaks.

There are two formats:

---

### 🅰️ Anthropic-Compatible Format

The provider expects requests formatted like Anthropic's Claude API.

**How to recognise it:**
- The provider's documentation shows endpoints like `POST /v1/messages`
- They explicitly say "Claude-compatible" or "Anthropic-compatible"
- Providers: DeepSeek (on their anthropic endpoint), OpenRouter, Fireworks AI, Anthropic itself

**When to choose this in OpenClaude:**
→ Select **[1] Anthropic-compatible** in the setup wizard

---

### 🅾️ OpenAI-Compatible Format

The provider expects requests formatted like OpenAI's ChatGPT API. This is the most common format in the industry.

**How to recognise it:**
- The provider's documentation shows endpoints like `POST /v1/chat/completions`
- They say "OpenAI-compatible" or "drop-in replacement for OpenAI"
- Providers: OpenAI, Ollama, LM Studio, Groq, SiliconFlow, Together AI, Mistral, Perplexity

**When to choose this in OpenClaude:**
→ Select **[2] OpenAI-compatible** in the setup wizard

---

### What happens if I choose the wrong one?

You'll typically get an error like:
- `400 Bad Request`
- `"unknown field"` or `"unexpected property"`
- `"model not found"`
- The model responds with garbled or empty output

**The fix:** Go back to setup (`openclaude --setup`), edit the provider, and switch the format.

---

## 2. Provider Reference Table

Use this table when setting up a provider. **Copy these values exactly.**

| Provider | Endpoint URL | API Format | Auth Type | Key Prefix / Notes |
|----------|-------------|------------|-----------|---------------------|
| **OpenAI** | `https://api.openai.com/v1` | OpenAI-compat | Bearer token | `sk-proj-...` or `sk-...` |
| **Anthropic** | `https://api.anthropic.com` | Anthropic-compat | x-api-key | `sk-ant-...` |
| **DeepSeek** | `https://api.deepseek.com/anthropic` | Anthropic-compat | x-api-key | `sk-...` |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Anthropic-compat | Bearer token | `sk-or-v1-...` |
| **Fireworks AI** | `https://api.fireworks.ai/inference/v1` | Anthropic-compat | Bearer token | `fw_...` |
| **SiliconFlow** | `https://api.siliconflow.com/v1` | **OpenAI-compat** ⚠️ | Bearer token | `sk-...` |
| **Groq** | `https://api.groq.com/openai/v1` | OpenAI-compat | Bearer token | `gsk_...` |
| **Together AI** | `https://api.together.xyz/v1` | OpenAI-compat | Bearer token | any |
| **Mistral AI** | `https://api.mistral.ai/v1` | OpenAI-compat | Bearer token | any |
| **Perplexity** | `https://api.perplexity.ai` | OpenAI-compat | Bearer token | `pplx-...` |
| **Anyscale** | `https://api.endpoints.anyscale.com/v1` | OpenAI-compat | Bearer token | any |
| **Ollama (local)** | `http://localhost:11434/v1` | OpenAI-compat | **None** | no key needed |
| **LM Studio (local)** | `http://localhost:1234/v1` | OpenAI-compat | **None** | no key needed |

> ⚠️ **SiliconFlow note:** Even though SiliconFlow *also* has an Anthropic-style endpoint, always use the **OpenAI-compatible** format with OpenClaude. Using Anthropic-compat with SiliconFlow will cause errors.

---

### Auth type explained (simply)

**Bearer token** — Your key goes in the request like this:
```
Authorization: Bearer sk-abc123...
```
Think of it like a VIP card you show at the door.

**x-api-key** — Your key goes in the request like this:
```
x-api-key: sk-abc123...
```
Think of it like a different kind of badge. Functionally the same, just a different pocket.

**None** — No key needed. Used for local models running on your own machine.

---

## 3. Common Error Messages

### ❌ `400 Bad Request` or `"Invalid request body"`

**What it means:** The API format is wrong — OpenClaude sent the request in the wrong "language."

**How to fix:**
1. Run `openclaude --setup`
2. Edit your provider
3. Switch the format (if it was Anthropic-compat, try OpenAI-compat, and vice versa)

---

### ❌ `401 Unauthorized` or `"Invalid API key"`

**What it means:** Your API key is wrong, expired, or pasted incorrectly.

**Common mistakes:**
- You pasted the **URL** instead of the key (e.g. `https://api.openai.com/v1`)
- You pasted your **username or email** instead of the key
- The key has a **space** at the beginning or end
- The key has **expired** or was deleted from the provider's dashboard

**How to fix:**
1. Go to your provider's website and copy the key again
2. Run `openclaude --setup` → edit provider → re-enter the key
3. Make sure to paste the key and press Enter immediately (no spaces)

---

### ❌ `403 Forbidden`

**What it means:** Your account doesn't have permission. Usually means:
- You haven't added a payment method / billing
- Your free trial has expired
- The model you're trying to use requires a higher plan

**How to fix:**
- Log into the provider's website and check your account status
- Add a payment method if required (most providers give free credits on signup)
- Try a different model that's included in your plan

---

### ❌ `404 Not Found` on model or endpoint

**What it means:** The URL is wrong, or the model name doesn't exist.

**How to fix:**
- Double-check the endpoint URL in the provider table above
- Double-check your model name (see [Section 6](#6-model-name-problems))

---

### ❌ `429 Too Many Requests` or `"Rate limit exceeded"`

**What it means:** You've sent too many requests too quickly. Slow down!

**How to fix:**
- Wait a few seconds and try again
- If it keeps happening, check the provider's rate limits (usually in their docs)
- Consider upgrading your plan for higher limits

---

### ❌ `500 Internal Server Error`

**What it means:** The provider's servers are having a problem — this is not your fault.

**How to fix:**
- Wait a few minutes and try again
- Check the provider's status page (usually at `status.providerName.com`)

---

### ❌ `"stop cannot contain an empty string"`

**What it means:** A known compatibility issue with some providers. OpenClaude automatically fixes this — if you still see it, update to the latest version.

**How to fix:**
```bash
cd OpenClaude
git pull
```

---

### ❌ `"model not found"` or `"The model does not exist"`

**What it means:** The model name you entered doesn't exist on that provider.

**How to fix:** See [Section 6 — Model Name Problems](#6-model-name-problems).

---

### ❌ `ECONNREFUSED` or `"Connection refused"`

**What it means:** Nothing is listening on that address. For local models — Ollama or LM Studio isn't running.

**How to fix:** See [Section 7 — Local Model Problems](#7-local-model-problems-ollama--lm-studio).

---

### ❌ `"No providers configured. Starting setup wizard..."`

**What it means:** OpenClaude hasn't been set up yet (first time running), or the config was deleted.

**How to fix:** Just run the setup — it will start automatically, or:
```bash
openclaude --setup
```

---

## 4. API Key Problems

### Where do I get an API key?

An API key is like a password that lets you use a provider's AI service. Here's where to get one for the most common providers:

| Provider | Where to get the key | Free tier? |
|----------|---------------------|------------|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | No (credit card required) |
| **Anthropic** | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | $5 free credit |
| **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com) → API Keys | Small free credit |
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) | Free tier available |
| **Fireworks AI** | [fireworks.ai](https://fireworks.ai) → API Keys | Free trial |
| **SiliconFlow** | [siliconflow.cn](https://siliconflow.cn) → API Keys | Free trial credits |
| **Groq** | [console.groq.com/keys](https://console.groq.com/keys) | Free tier |
| **Ollama** | N/A — completely free | ✅ Always free |
| **LM Studio** | N/A — completely free | ✅ Always free |

---

### My key looks right but still doesn't work

Try these steps in order:

1. **Copy it fresh** — go back to the provider's dashboard and copy the key again. Don't retype it.

2. **Check for invisible characters** — sometimes copying from a browser adds invisible spaces. When pasting in the terminal, paste it and immediately press Enter.

3. **Check if the key is active** — some providers let you disable keys. Make sure it shows as "Active" or "Enabled" in the dashboard.

4. **Check your account has credits** — even if you have a key, you need credits to make API calls. Check your usage/billing page.

5. **Re-enter in OpenClaude:**
   ```
   openclaude --setup
   → Edit your provider
   → Re-enter the API key
   ```

---

### Where is my API key stored? Is it safe?

Your API key is stored in a local database file at:
- **Windows:** `C:\Users\YourName\.openclaude\config.db`
- **macOS/Linux:** `~/.openclaude/config.db`

This file **never leaves your computer**. OpenClaude only sends your key to the provider you configured — the same place you'd send it anyway. The key is not included in any telemetry, logs, or network requests to anyone else.

> 🔒 **Never share your `config.db` file or paste your API key anywhere public** (e.g. GitHub, Discord, support chats).

---

## 5. Connection Problems

### `openclaude` command is not recognised

The `openclaude` command wasn't added to your PATH. Fix it:

**Windows (PowerShell):**
```powershell
# Run this from the OpenClaude folder:
$dir = (Get-Location).Path
[Environment]::SetEnvironmentVariable("PATH", "$env:PATH;$dir", "User")
```
Then **close and reopen** your terminal.

**macOS/Linux:**
```bash
# Run this from the OpenClaude folder:
echo "export PATH=\"\$PATH:$(pwd)\"" >> ~/.bashrc   # bash users
echo "export PATH=\"\$PATH:$(pwd)\"" >> ~/.zshrc    # zsh users (default on Mac)
source ~/.bashrc  # or source ~/.zshrc
```

Or just run it directly from the folder:
```bash
./StartOpenClaude.sh        # macOS/Linux
StartOpenClaude.bat         # Windows (double-click)
```

---

### Proxy won't start — port 3200 is in use

OpenClaude runs a local proxy on port 3200. If something else is using that port, or a previous OpenClaude process didn't shut down cleanly:

**Windows:**
```powershell
# Kill any lingering Node.js proxy processes:
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

**macOS/Linux:**
```bash
pkill -f start-proxy.js
```

Then run OpenClaude again.

---

### Network/firewall blocking the connection

If you're on a corporate network or VPN, the network may block connections to AI API endpoints.

Signs: connections time out even with a valid key, or you get SSL/TLS errors.

**Options:**
- Use a local model (Ollama or LM Studio) — these don't need internet
- Ask your IT department to whitelist the provider's domain
- Try a different network (mobile hotspot, home network)

---

## 6. Model Name Problems

### Why does the model name matter so much?

When you set up a provider, you enter a model name like `gpt-4o` or `llama3.2`. This name is sent **exactly as-is** to the provider. If the name is even slightly wrong, you get a "model not found" error.

### Common model name mistakes

| Wrong | Correct | Provider |
|-------|---------|----------|
| `gpt4o` | `gpt-4o` | OpenAI |
| `GPT-4o` | `gpt-4o` | OpenAI |
| `gpt-4` | `gpt-4o` | OpenAI |
| `llama3` | `llama3.2` | Ollama |
| `deepseek-v3` | `deepseek-ai/DeepSeek-V4-Pro` | SiliconFlow |
| `claude-sonnet` | (not valid here — OpenClaude replaces Claude) | — |

### How to find the correct model name

**For cloud providers (OpenAI, SiliconFlow, Groq, etc.):**
- OpenClaude can list available models for you! When you run setup and choose "edit" or "add provider", it will offer to fetch models automatically.
- Or check the provider's models page:
  - OpenAI: [platform.openai.com/docs/models](https://platform.openai.com/docs/models)
  - OpenRouter: [openrouter.ai/models](https://openrouter.ai/models)
  - Groq: [console.groq.com/docs/models](https://console.groq.com/docs/models)

**For Ollama (local):**
```bash
ollama list    # Shows all models you've downloaded
```

**For LM Studio:**
Look at the "Local Server" tab — the model name is shown at the top.

---

### How to change the model in OpenClaude

```
StartOpenClaude.bat (Windows) or ./StartOpenClaude.sh (Mac/Linux)
→ Press [E] to Edit
→ Press [M] to Change model(s)
→ Follow the prompts
```

Or via command line:
```bash
openclaude --setup
```

---

## 7. Local Model Problems (Ollama / LM Studio)

### "Connection refused" with Ollama

Ollama isn't running. Start it:

```bash
ollama serve
```

Or on Windows, look for the Ollama icon in your system tray (bottom-right of taskbar). If it's not there, open Ollama from the Start menu.

**Then check it's working:**
```bash
ollama list        # Should show your downloaded models
```

---

### Ollama is running but OpenClaude can't connect

The default Ollama address is `http://localhost:11434/v1`. Make sure this is what you have in your provider config.

If you changed Ollama's port or bound it to a specific IP:
```bash
openclaude --setup
→ Edit your Ollama provider
→ Update the endpoint URL to match
```

---

### "Model not found" with Ollama

You haven't downloaded the model yet. Download it:
```bash
ollama pull llama3.2          # ~2GB — good general model
ollama pull codellama          # ~4GB — great for coding
ollama pull mistral            # ~4GB — good alternative
ollama pull phi3               # ~2GB — fast and lightweight
```

Then update OpenClaude to use the model name you downloaded.

**List all your downloaded models:**
```bash
ollama list
```

---

### Ollama is slow or responses are very short

This is normal if your computer doesn't have a lot of RAM or a GPU. Local models run on your hardware.

**Tips:**
- Use a smaller model: `phi3`, `mistral:7b`, or `llama3.2:3b`
- Close other heavy applications while using Claude Code
- If you have an NVIDIA GPU, make sure CUDA is enabled (Ollama does this automatically if installed properly)

---

### LM Studio server won't start

1. Make sure a model is loaded in LM Studio first (click on a model → Load)
2. Go to the **Local Server** tab (left sidebar, the `</>` icon)
3. Click **Start Server**
4. The server should say "Running on port 1234"

If port 1234 is already in use, you can change it in LM Studio's settings.

---

### "No model loaded" error with LM Studio

You need to load a model before starting the server. In LM Studio:
1. Go to the **My Models** tab
2. Click on a model to select it
3. Click **Load** (or it loads automatically when you start the server)
4. Then start the local server

---

## 8. Windows-Specific Problems

### PowerShell says "execution of scripts is disabled on this system"

Windows blocks PowerShell scripts by default. Fix:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Type `Y` when prompted. Then run `StartOpenClaude.bat` again.

---

### "Access denied" when running setup

Try running the terminal as Administrator:
1. Click Start → search "PowerShell"
2. Right-click → **Run as administrator**
3. Navigate to the OpenClaude folder and run again

---

### The terminal window opens and immediately closes

This usually means a script error. To see the error:
1. Open PowerShell manually (Start → PowerShell)
2. Navigate to OpenClaude: `cd C:\path\to\OpenClaude`
3. Run: `.\StartOpenClaude.ps1`
4. The error message will stay visible

---

### Double-clicking `StartOpenClaude.bat` does nothing

1. Right-click `StartOpenClaude.bat` → **Run as administrator**
2. If it still does nothing, open PowerShell and run it manually:
   ```powershell
   cd C:\path\to\OpenClaude
   .\StartOpenClaude.ps1
   ```

---

## 9. macOS / Linux-Specific Problems

### "Permission denied" when running `./StartOpenClaude.sh`

The script doesn't have execute permission. Fix:
```bash
chmod +x StartOpenClaude.sh
./StartOpenClaude.sh
```

---

### "env: node: No such file or directory"

Node.js isn't installed or isn't in your PATH.

```bash
node --version    # Should show v22.x.x or higher
```

If not found, download from [nodejs.org](https://nodejs.org/). On macOS with Homebrew:
```bash
brew install node
```

---

### `openclaude` command not found after adding to PATH

The PATH change only takes effect in new terminals. Either:
- Close and reopen your terminal
- Run `source ~/.zshrc` (macOS) or `source ~/.bashrc` (Linux)

---

## 10. Advanced Proxy Errors

### "count_tokens endpoint returned 404"

This is normal for providers that don't support token counting. OpenClaude automatically handles this by estimating the token count. No action needed.

---

### Streaming responses appear garbled or cut off

This can happen with providers that compress their responses (Brotli/gzip). OpenClaude handles this automatically. If you're seeing this, you may be on an older version:

```bash
git pull   # Update to latest
```

---

### "reasoning_effort not supported"

Some models don't support OpenAI's `reasoning_effort` parameter. OpenClaude automatically strips it when not needed.

---

### "tool_calls must be followed by tool messages"

This is a provider-specific ordering issue that OpenClaude fixes automatically. Update to the latest version if you see this.

---

### The proxy starts but Claude Code still connects to Anthropic

Make sure the environment variables are being set correctly. When you run `openclaude`, it should print something like:

```
✓ Proxy listening on http://127.0.0.1:3200
✓ Starting Claude Code with provider: MyProvider
```

If it says it's connecting directly to Anthropic, you may have `ANTHROPIC_BASE_URL` set somewhere else that's overriding OpenClaude. Check:

**Windows:**
```powershell
[Environment]::GetEnvironmentVariable("ANTHROPIC_BASE_URL", "User")
[Environment]::GetEnvironmentVariable("ANTHROPIC_BASE_URL", "Machine")
```

**macOS/Linux:**
```bash
echo $ANTHROPIC_BASE_URL
```

If there's a value set, remove it:
**Windows:**
```powershell
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", $null, "User")
```

**macOS/Linux:**
```bash
unset ANTHROPIC_BASE_URL
```

---

## 11. Still Stuck? How to Get Help

If none of the above solved your problem:

### Before asking for help, collect this info:

```bash
node --version         # Your Node.js version
claude --version       # Your Claude Code version
openclaude --list      # Your configured providers
```

Also note:
- Your operating system and version
- The **exact** error message (copy-paste it, don't rephrase)
- What you were trying to do when the error happened

### Where to get help:

**GitHub Issues (best for bugs):**
👉 [github.com/inY2K/OpenClaude/issues](https://github.com/inY2K/OpenClaude/issues)

Click **New issue** and paste your information. Be as specific as possible — "it doesn't work" is hard to help with; "I get `401 Unauthorized` when using OpenAI with key `sk-proj-...`" is easy to help with.

---

<div align="center">

[← Back to README](README.md) &nbsp;·&nbsp; [📖 Full How-To Guide](HOW_TO.md)

<br/>

<img src="assets/logo.svg" width="48" alt="OpenClaude"/>

*OpenClaude — Your AI, Your Rules, Your Provider.*

</div>
