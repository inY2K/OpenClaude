/**
 * Translates between Anthropic API format (what Claude Code sends)
 * and OpenAI-compatible API format (what OpenAI/Ollama/LM Studio etc. expect).
 */

import { Transform } from 'stream';
import { appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const LOG_FILE = join(homedir(), '.openclaude', 'translate-debug.log');
function debugLog(msg) {
    try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// ─── Request: Anthropic → OpenAI ────────────────────────────────────────────

export function anthropicToOpenAI(body) {
    const req = JSON.parse(body.toString());

    const messages = [];

    if (req.system) {
        const sysContent = Array.isArray(req.system)
            ? req.system.map(b => (typeof b === 'string' ? b : b.text || '')).join('\n')
            : req.system;
        messages.push({ role: 'system', content: sysContent });
    }

    for (const msg of (req.messages || [])) {
        const converted = convertMessage(msg);
        if (Array.isArray(converted)) messages.push(...converted);
        else messages.push(converted);
    }

    const out = {
        model: req.model,
        messages,
        stream: req.stream !== false,
        ...(req.max_tokens && { max_tokens: req.max_tokens }),
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.top_p !== undefined && { top_p: req.top_p }),
    };

    if (req.tools?.length) {
        debugLog(`tools[${req.tools.length}]: ${req.tools.map((t, i) => `[${i}] name=${t.name} type=${t.type}`).join(', ')}`);
        // Filter to only tools that work with external LLM providers
        // Exclude: Agent, Task*, Cron*, Schedule*, infrastructure, integrations
        const allowedToolPattern = /^(Bash|Read|Write|Edit|WebFetch|WebSearch|Glob|Grep|PowerShell|Monitor|NotebookEdit)$/;
        const filteredTools = req.tools.filter(t => allowedToolPattern.test(t.name));
        debugLog(`filtered ${req.tools.length} tools to ${filteredTools.length} (kept: ${filteredTools.map(t => t.name).join(', ')})`);

        out.tools = filteredTools.map((t, i) => {
            // Anthropic built-in tools (computer_20241022, bash_20250124, etc.) may omit
            // name or carry it only in `type`. Derive a name so OpenAI providers don't 400.
            const name = t.name || (t.type ? t.type.replace(/_\d{8}$/, '') : `tool_${i}`);
            if (!t.name) {
                debugLog(`tools[${i}] has no name — full object: ${JSON.stringify(t)}`);
            }
            return {
                type: 'function',
                function: {
                    name,
                    description: t.description || '',
                    parameters: t.input_schema || { type: 'object', properties: {} },
                },
            };
        });
    }

    if (req.tool_choice) {
        if (req.tool_choice === 'auto') out.tool_choice = 'auto';
        else if (req.tool_choice === 'none') out.tool_choice = 'none';
        else if (req.tool_choice?.type === 'tool') {
            out.tool_choice = { type: 'function', function: { name: req.tool_choice.name } };
        }
    }

    return Buffer.from(JSON.stringify(out));
}

function convertMessage(msg) {
    const { role, content } = msg;

    if (role === 'user') {
        // May contain tool_result blocks mixed with text
        if (typeof content === 'string') return { role: 'user', content };
        if (!Array.isArray(content)) return { role: 'user', content: String(content) };

        const toolResults = content.filter(b => b.type === 'tool_result');
        const others = content.filter(b => b.type !== 'tool_result');

        const results = [];

        if (others.length) {
            results.push({
                role: 'user',
                content: others.map(b => {
                    if (b.type === 'text') return { type: 'text', text: b.text };
                    if (b.type === 'image') return { type: 'image_url', image_url: { url: b.source?.url || '' } };
                    return { type: 'text', text: JSON.stringify(b) };
                }),
            });
        }

        for (const tr of toolResults) {
            results.push({
                role: 'tool',
                tool_call_id: tr.tool_use_id,
                content: typeof tr.content === 'string'
                    ? tr.content
                    : Array.isArray(tr.content)
                        ? tr.content.map(b => b.text || '').join('')
                        : JSON.stringify(tr.content),
            });
        }

        return results.length === 1 ? results[0] : results;
    }

    if (role === 'assistant') {
        if (typeof content === 'string') return { role: 'assistant', content };
        if (!Array.isArray(content)) return { role: 'assistant', content: String(content) };

        const textBlocks = content.filter(b => b.type === 'text');
        const toolUses = content.filter(b => b.type === 'tool_use');

        const out = { role: 'assistant', content: textBlocks.map(b => b.text).join('') || null };

        if (toolUses.length) {
            out.tool_calls = toolUses.map(t => ({
                id: t.id,
                type: 'function',
                function: {
                    name: t.name,
                    arguments: typeof t.input === 'string' ? t.input : JSON.stringify(t.input),
                },
            }));
        }

        return out;
    }

    return { role, content: typeof content === 'string' ? content : JSON.stringify(content) };
}

// ─── Response: OpenAI → Anthropic (streaming SSE) ───────────────────────────

export class OpenAIToAnthropicStream extends Transform {
    constructor(model, onUsage) {
        super();
        this._buf = '';
        this._model = model;
        this._onUsage = onUsage;
        this._started = false;
        this._contentIndex = 0;
        this._toolCalls = {}; // index → {id, name, args}
        this._inputTokens = 0;
        this._outputTokens = 0;
        this._msgId = `msg_${Date.now()}`;
    }

    _transform(chunk, _enc, cb) {
        this._buf += chunk.toString();
        const parts = this._buf.split('\n\n');
        this._buf = parts.pop();
        for (const part of parts) this._processEvent(part);
        cb();
    }

    _flush(cb) {
        if (this._buf.trim()) this._processEvent(this._buf);
        if (this._onUsage) this._onUsage(this._inputTokens, this._outputTokens);
        cb();
    }

    _emit(event, data) {
        this.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    _processEvent(raw) {
        const line = raw.replace(/^data:\s*/, '').trim();
        if (!line || line === '[DONE]') {
            if (line === '[DONE]') this._finalize();
            return;
        }

        let chunk;
        try { chunk = JSON.parse(line); } catch { return; }

        if (!this._started) {
            this._started = true;
            this._emit('message_start', {
                type: 'message_start',
                message: {
                    id: chunk.id || this._msgId,
                    type: 'message',
                    role: 'assistant',
                    content: [],
                    model: this._model,
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 },
                },
            });
            this._emit('ping', { type: 'ping' });
        }

        const choice = chunk.choices?.[0];
        if (!choice) {
            // usage-only chunk
            if (chunk.usage) {
                this._inputTokens = chunk.usage.prompt_tokens || 0;
                this._outputTokens = chunk.usage.completion_tokens || 0;
            }
            return;
        }

        const delta = choice.delta || {};

        // Text content
        if (typeof delta.content === 'string' && delta.content) {
            if (this._contentIndex === 0 && !this._textBlockStarted) {
                this._textBlockStarted = true;
                this._emit('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
            }
            this._emit('content_block_delta', {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: delta.content },
            });
        }

        // Tool calls
        if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const blockIdx = 1 + idx; // text is always block 0

                if (!this._toolCalls[idx]) {
                    this._toolCalls[idx] = { id: tc.id, name: tc.function?.name || '', args: '' };
                    if (this._textBlockStarted) {
                        this._emit('content_block_stop', { type: 'content_block_stop', index: 0 });
                        this._textBlockStarted = false;
                    }
                    this._emit('content_block_start', {
                        type: 'content_block_start',
                        index: blockIdx,
                        content_block: { type: 'tool_use', id: tc.id, name: tc.function?.name || '', input: {} },
                    });
                }

                const toolState = this._toolCalls[idx];
                if (tc.function?.name && !toolState.name) toolState.name = tc.function.name;
                if (tc.function?.arguments) {
                    toolState.args += tc.function.arguments;
                    this._emit('content_block_delta', {
                        type: 'content_block_delta',
                        index: blockIdx,
                        delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
                    });
                }
            }
        }

        // Usage in chunk
        if (chunk.usage) {
            this._inputTokens = chunk.usage.prompt_tokens || this._inputTokens;
            this._outputTokens = chunk.usage.completion_tokens || this._outputTokens;
        }

        // Finish
        if (choice.finish_reason) {
            this._finishReason = choice.finish_reason;
        }
    }

    _finalize() {
        if (this._textBlockStarted) {
            this._emit('content_block_stop', { type: 'content_block_stop', index: 0 });
        }
        for (const idx of Object.keys(this._toolCalls)) {
            this._emit('content_block_stop', { type: 'content_block_stop', index: 1 + parseInt(idx) });
        }

        const stopReason = this._finishReason === 'tool_calls' ? 'tool_use'
            : this._finishReason === 'length' ? 'max_tokens'
            : 'end_turn';

        this._emit('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: this._outputTokens },
        });
        this._emit('message_stop', { type: 'message_stop' });
    }
}

// ─── Response: OpenAI → Anthropic (non-streaming JSON) ─────────────────────

export function openAIJsonToAnthropic(buf, model) {
    let obj;
    try { obj = JSON.parse(buf.toString()); } catch { return buf; }

    if (!obj.choices) return buf;

    const choice = obj.choices[0];
    const msg = choice?.message || {};
    const content = [];

    if (msg.content) content.push({ type: 'text', text: msg.content });

    if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
            let input = {};
            try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
            content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
        }
    }

    const fr = choice?.finish_reason;
    const stopReason = fr === 'tool_calls' ? 'tool_use' : fr === 'length' ? 'max_tokens' : 'end_turn';

    const result = {
        id: obj.id || `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content,
        model: model || obj.model || '',
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: obj.usage?.prompt_tokens || 0,
            output_tokens: obj.usage?.completion_tokens || 0,
        },
    };

    return Buffer.from(JSON.stringify(result));
}
