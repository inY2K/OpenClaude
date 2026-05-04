<div align="center">

# OpenClaude Proxy — Technical Reference

*The intelligent API translation layer at the heart of OpenClaude.*

[← Back to main README](../README.md) &nbsp;·&nbsp; [HOW_TO Guide](../HOW_TO.md)

</div>

---

## Overview

The OpenClaude proxy is a lightweight Node.js HTTP server that:

1. **Listens** on `127.0.0.1:3200` (or the next available port)
2. **Intercepts** API calls from Claude Code
3. **Translates** requests between Anthropic and OpenAI formats (when needed)
4. **Forwards** to your configured LLM provider
5. **Translates back** the response before returning it to Claude Code

```
Claude Code ──► 127.0.0.1:3200 (proxy)
                     │
                     ├─ Anthropic-format providers ──► Direct passthrough
                     │  (DeepSeek, OpenRouter, Fireworks…)
                     │
                     └─ OpenAI-format providers ──► Translate ► Forward ► Translate back
                        (OpenAI, Ollama, LM Studio, Groq…)
```

---

## Files

| File | Purpose |
|------|---------|
| `model-proxy.js` | The HTTP proxy server and API translation logic |
| `start-proxy.js` | Entry point — reads config from SQLite and starts the proxy |
| `db.js` | SQLite interface for provider configuration |
| `openai-translate.js` | Bidirectional Anthropic ↔ OpenAI format translation |

---

## Starting the Proxy

### Via openclaude (normal usage)

```bash
openclaude              # starts proxy automatically, manages lifecycle
openclaude --remote     # same, but for remote control mode
```

### Standalone (advanced)

```bash
# Use the default provider from ~/.openclaude/config.db
node proxy/start-proxy.js

# Use a specific saved provider
node proxy/start-proxy.js --alias openai

# Use a custom port
node proxy/start-proxy.js --port 4000

# Combine flags
node proxy/start-proxy.js --alias local --port 3300
```

When started, the proxy prints:
```
[PROXY] Starting with provider: My OpenAI (openai)
[PROXY] Format: openai | Auth: bearer
[PROXY] Endpoint: https://api.openai.com/v1
[PROXY] Listening on 127.0.0.1:3200 → https://api.openai.com/v1 (openai, mode: openai)
3200
```

The bare number on the last line (`3200`) is the actual port — used by `openclaude.ps1` / `openclaude.sh` to configure Claude Code's environment.

---

## API Format Translation

### Anthropic → OpenAI (request)

When the active provider uses OpenAI-compatible format, the proxy transforms each incoming Claude Code request:

| Anthropic field | OpenAI equivalent |
|----------------|------------------|
| `system` string | `messages[0]` with `role: "system"` |
| `messages[].content[]` blocks | Flattened to string or `content` array |
| `tool_use` content block | `tool_calls` array in assistant message |
| `tool_result` in user message | Separate `role: "tool"` message |
| `tools[].input_schema` | `tools[].function.parameters` |
| `tool_choice: {type: "tool"}` | `tool_choice: {type: "function", function: {name}}` |

### OpenAI → Anthropic (streaming response)

The proxy transforms OpenAI SSE chunks into the Anthropic SSE event sequence Claude Code expects:

```
OpenAI chunks:                    Anthropic events emitted:
─────────────                     ─────────────────────────
(first chunk)         ──►         event: message_start
                                  event: ping
delta.content         ──►         event: content_block_start (index 0, type: text)
                                  event: content_block_delta (text_delta)
delta.tool_calls      ──►         event: content_block_stop (text, if any)
                                  event: content_block_start (index N, type: tool_use)
                                  event: content_block_delta (input_json_delta)
finish_reason         ──►         event: content_block_stop
[DONE]                ──►         event: message_delta (stop_reason)
                                  event: message_stop
```

Tool call arguments are streamed as `input_json_delta` events, matching Claude Code's expectations for progressive tool input rendering.

---

## Control Endpoints

The proxy exposes control endpoints at `/_proxy/*` that never conflict with LLM API paths (`/v1/*`).

### `GET /_proxy/status`

Returns current proxy state.

```bash
curl -s http://127.0.0.1:3200/_proxy/status
```

```json
{
  "mode": "openai",
  "api_format": "openai",
  "uptime": 142,
  "requests": 7
}
```

| Field | Description |
|-------|-------------|
| `mode` | Active provider alias |
| `api_format` | `"anthropic"` or `"openai"` |
| `uptime` | Seconds since proxy started |
| `requests` | Total requests proxied |

---

### `GET /_proxy/cost`

Returns token usage statistics for the current session.

```bash
curl -s http://127.0.0.1:3200/_proxy/cost
```

```json
{
  "backends": {
    "openai": {
      "input_tokens": 42150,
      "output_tokens": 8320,
      "requests": 7
    }
  },
  "total_requests": 7
}
```

---

### `POST /_proxy/mode`

Switches the active provider without restarting the proxy.

```bash
# Switch to a saved provider by alias
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=openai"
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=local"
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=anthropic"
```

**Success response:**
```json
{ "mode": "openai", "previous": "local" }
```

**Error responses:**
```json
{ "error": "Unknown backend: foo. Valid: anthropic, openai, local, ds" }
{ "error": "API key not set for openai" }
```

> **Security note:** This endpoint rejects requests from any `Origin` header that isn't `http://127.0.0.1` or `http://localhost`. It is only accessible from the local machine.

---

## Programmatic Usage

You can import and start the proxy directly from your own Node.js code:

```javascript
import { startModelProxy } from './proxy/model-proxy.js';

const proxy = await startModelProxy({
    // Required: the upstream provider URL
    targetUrl: 'https://api.openai.com/v1',

    // Required: your API key (null for no-auth providers)
    apiKey: process.env.OPENAI_API_KEY,

    // Optional: api_format ('anthropic' or 'openai', default: 'anthropic')
    api_format: 'openai',

    // Optional: auth_type ('bearer', 'x-api-key', 'none', default: 'bearer')
    auth_type: 'bearer',

    // Optional: starting port (default: 3200, auto-increments if taken)
    startPort: 3200,

    // Optional: additional backends available for live switching
    backends: {
        local: {
            url: 'http://localhost:11434/v1',
            apiKey: null,
            api_format: 'openai',
            auth_type: 'none',
        },
        ds: {
            url: 'https://api.deepseek.com/anthropic',
            apiKey: process.env.DEEPSEEK_API_KEY,
            api_format: 'anthropic',
            auth_type: 'x-api-key',
        },
    },

    // Optional: which backend to start in (default: use targetUrl directly)
    defaultMode: 'openai',
});

console.log(`Proxy running on port ${proxy.port}`);

// Switch backends programmatically
proxy.switchMode('local');

// Stop the proxy
proxy.close();
```

---

## Environment Variables Set by openclaude

When `openclaude` starts, it sets these variables before launching Claude Code:

| Variable | Value | Purpose |
|----------|-------|---------|
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:<port>` | Routes Claude Code through the proxy |
| `ANTHROPIC_AUTH_TOKEN` | `openclaude-proxy` (dummy) | Satisfies Claude Code's auth check — real auth done by proxy |
| `ANTHROPIC_MODEL` | Your Opus model | Primary model |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Your Opus model | Opus tier |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Your Sonnet model | Sonnet tier |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Your Haiku model | Haiku tier |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Your Subagent model | Background agents |
| `CLAUDE_CODE_EFFORT_LEVEL` | `max` | Full effort mode |

For Anthropic-compatible providers, `ANTHROPIC_BASE_URL` points directly to the provider (no proxy started). For OpenAI-compatible providers, it always points to the local proxy.

---

## Remote Control Mode

When using `openclaude --remote`, Claude Code opens a browser-accessible session. This requires Anthropic's bridge server for the WebSocket connection, but model calls can go to any provider.

```
Browser ──► claude.ai ──► wss://bridge.claudeusercontent.com (Anthropic WebSocket, hardcoded)
                                        │
                                        └─► Model API calls ──► 127.0.0.1:3200 (proxy) ──► Your provider
```

The proxy allows Claude Code to authenticate its bridge connection with Anthropic (which it does via OAuth, not the `ANTHROPIC_AUTH_TOKEN` env var) while all model inference goes to your chosen provider.

---

## Path Deduplication

Providers have different URL structures. The proxy automatically handles the overlap to avoid double-path issues:

| Provider URL | Claude Code sends | Proxy sends to |
|-------------|-------------------|----------------|
| `https://api.deepseek.com/anthropic` | `/v1/messages` | `/anthropic/v1/messages` |
| `https://openrouter.ai/api/v1` | `/v1/messages` | `/api/v1/messages` |
| `https://api.openai.com/v1` | `/v1/messages` | `/v1/messages` |
| `http://localhost:11434/v1` | `/v1/messages` | `/v1/messages` |

The deduplication logic finds the longest common suffix between the base path and the request path and avoids repeating it.

---

## Request Timeout

All proxied requests have a **5-minute timeout**. Long-running Claude Code tasks (large file operations, complex reasoning) typically complete well within this window. If you hit timeouts on very large operations, this is configurable in `model-proxy.js`:

```javascript
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // Change as needed
```

---

## Database Location

Provider configuration is stored in:

| Platform | Path |
|----------|------|
| Windows | `C:\Users\<you>\.openclaude\config.db` |
| macOS | `/Users/<you>/.openclaude/config.db` |
| Linux | `/home/<you>/.openclaude/config.db` |

This is a standard SQLite file. You can inspect it with any SQLite browser (e.g. [DB Browser for SQLite](https://sqlitebrowser.org/)).

**Schema:**

```sql
CREATE TABLE providers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    alias      TEXT UNIQUE NOT NULL,   -- short name, e.g. "openai"
    name       TEXT NOT NULL,          -- display name, e.g. "My OpenAI"
    url        TEXT NOT NULL,          -- endpoint URL
    api_key    TEXT,                   -- API key (null for no-auth providers)
    api_format TEXT NOT NULL,          -- 'anthropic' or 'openai'
    auth_type  TEXT NOT NULL,          -- 'bearer', 'x-api-key', or 'none'
    is_default INTEGER NOT NULL,       -- 1 if this is the default provider
    created_at INTEGER NOT NULL        -- Unix timestamp
);

CREATE TABLE models (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id  INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    tier         TEXT NOT NULL,        -- 'opus', 'sonnet', 'haiku', 'subagent'
    model_name   TEXT NOT NULL,        -- exact model name for the provider
    UNIQUE(provider_id, tier)
);
```

---

<div align="center">

[← Back to main README](../README.md) &nbsp;·&nbsp; [HOW_TO Guide](../HOW_TO.md)

</div>
