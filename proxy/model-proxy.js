import { createServer } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { URL } from 'url';
import { Transform } from 'stream';
import { anthropicToOpenAI, OpenAIToAnthropicStream, openAIJsonToAnthropic } from './openai-translate.js';
import { appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib';
import { createBrotliDecompress, createGunzip, createInflate } from 'zlib';
import { buildOpenAIPath } from './provider-url.js';

const LOG_FILE = join(homedir(), '.openclaude', 'translate-debug.log');
function debugLog(msg) {
    try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

const ANTHROPIC_FALLBACK = 'https://api.anthropic.com';
const MODEL_PATHS = ['/v1/messages'];
const COUNT_TOKENS_PATH = '/v1/messages/count_tokens';
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function collectTextParts(value, out = []) {
    if (typeof value === 'string') {
        out.push(value);
        return out;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectTextParts(item, out);
        return out;
    }
    if (!value || typeof value !== 'object') return out;

    if (typeof value.text === 'string') out.push(value.text);
    if (typeof value.content === 'string' || Array.isArray(value.content) || (value.content && typeof value.content === 'object')) {
        collectTextParts(value.content, out);
    }
    if (typeof value.name === 'string') out.push(value.name);
    if (typeof value.description === 'string') out.push(value.description);
    if (value.input_schema) collectTextParts(value.input_schema, out);
    if (value.input) collectTextParts(value.input, out);
    return out;
}

function estimateInputTokensFromAnthropic(body) {
    try {
        const req = JSON.parse(body.toString());
        const text = [
            ...collectTextParts(req.system),
            ...collectTextParts(req.messages),
            ...collectTextParts(req.tools),
            ...collectTextParts(req.tool_choice),
        ].join('\n');

        if (!text.trim()) return 0;

        // Cheap fallback for providers without a native count-tokens endpoint.
        // OpenAI-style tokenization is close enough for sizing and avoids client crashes.
        return Math.max(1, Math.ceil(text.length / 4));
    } catch {
        return 0;
    }
}

function normalizeAnthropicBodyForProvider(body, state) {
    // SiliconFlow Anthropic endpoint rejects requests that combine
    // thinking.type=disabled with reasoning_effort.
    if (!state?.options?.force_proxy || state?.api_format !== 'anthropic') return body;

    let parsed;
    try {
        parsed = JSON.parse(body.toString());
    } catch {
        return body;
    }

    const thinkingType = parsed?.thinking?.type;
    if (thinkingType === 'disabled' && parsed.reasoning_effort != null) {
        delete parsed.reasoning_effort;
    }

    if (Array.isArray(parsed.stop_sequences)) {
        parsed.stop_sequences = parsed.stop_sequences.filter(s => typeof s === 'string' && s.length > 0);
    }
    if (Array.isArray(parsed.stop)) {
        parsed.stop = parsed.stop.filter(s => typeof s === 'string' && s.length > 0);
    } else if (typeof parsed.stop === 'string' && parsed.stop.length === 0) {
        delete parsed.stop;
    }

    return Buffer.from(JSON.stringify(parsed));
}

function normalizeOpenAIBodyForProvider(body, state) {
    let parsed;
    try {
        parsed = JSON.parse(body.toString());
    } catch {
        return body;
    }

    const host = (state?.target?.hostname || '').toLowerCase();
    if (host.includes('siliconflow.com')) {
        // SiliconFlow may require reasoning_content carry-forward when thinking mode is enabled.
        // Disable thinking mode for Claude Code compatibility.
        parsed.enable_thinking = false;
        if (parsed.reasoning_effort != null) delete parsed.reasoning_effort;
    }

    if (Array.isArray(parsed.stop)) {
        parsed.stop = parsed.stop.filter(s => typeof s === 'string' && s.length > 0);
    } else if (typeof parsed.stop === 'string' && parsed.stop.length === 0) {
        delete parsed.stop;
    }

    return Buffer.from(JSON.stringify(parsed));
}

/**
 * Intercepts SSE events and injects missing `usage` fields.
 * DeepSeek/OpenRouter may omit `usage` in message_start or message_delta,
 * which crashes Claude Code ("$.input_tokens" is undefined).
 */
class UsageNormalizer extends Transform {
    constructor(onUsage) {
        super();
        this._buf = '';
        this._onUsage = onUsage;
        this._inputTokens = 0;
        this._outputTokens = 0;
    }

    _transform(chunk, _enc, cb) {
        this._buf += chunk.toString();
        const parts = this._buf.split('\n\n');
        this._buf = parts.pop();
        for (const part of parts) this.push(this._fix(part) + '\n\n');
        cb();
    }

    _fix(event) {
        const m = event.match(/^data: (.+)$/m);
        if (!m) return event;
        try {
            const d = JSON.parse(m[1]);
            let changed = false;
            if (d.type === 'message_start' && d.message) {
                if (d.message.usage) {
                    this._inputTokens = d.message.usage.input_tokens || 0;
                } else {
                    d.message.usage = { input_tokens: 0, output_tokens: 0 };
                    changed = true;
                }
            }
            if (d.type === 'message_delta') {
                if (d.usage) {
                    this._outputTokens = d.usage.output_tokens || 0;
                    if (d.usage.input_tokens == null) {
                        d.usage.input_tokens = this._inputTokens;
                        changed = true;
                    }
                } else {
                    d.usage = { input_tokens: this._inputTokens, output_tokens: 0 };
                    changed = true;
                }
            }
            if (changed) return event.replace(m[1], () => JSON.stringify(d));
        } catch { /* not JSON */ }
        return event;
    }

    _flush(cb) {
        if (this._buf.trim()) this.push(this._fix(this._buf) + '\n\n');
        if (this._onUsage) this._onUsage(this._inputTokens, this._outputTokens);
        cb();
    }
}

function normalizeJsonBody(buf) {
    try {
        const obj = JSON.parse(buf);
        if (obj.type === 'message' && !obj.usage) {
            obj.usage = { input_tokens: 0, output_tokens: 0 };
            return Buffer.from(JSON.stringify(obj));
        }
    } catch { /* not JSON */ }
    return buf;
}

function decodeResponseBody(buf, encoding) {
    const normalized = (encoding || '').toLowerCase();
    try {
        if (normalized.includes('gzip')) return gunzipSync(buf);
        if (normalized.includes('br')) return brotliDecompressSync(buf);
        if (normalized.includes('deflate')) return inflateSync(buf);
    } catch {
        return buf;
    }
    return buf;
}

function getDecompressionStream(encoding) {
    const normalized = (encoding || '').toLowerCase();
    if (normalized.includes('br')) return createBrotliDecompress();
    if (normalized.includes('gzip')) return createGunzip();
    if (normalized.includes('deflate')) return createInflate();
    return null;
}

function buildHeaders(state, clientHeaders, body) {
    const headers = { ...clientHeaders, host: state.target.host };
    delete headers['content-length'];
    delete headers['authorization'];
    delete headers['x-api-key'];

    const apiKey = state.options?.apiKey;
    const auth_type = state.options?.auth_type || 'bearer';

    if (auth_type === 'bearer' && apiKey) {
        headers['authorization'] = `Bearer ${apiKey}`;
    } else if (auth_type === 'x-api-key' && apiKey) {
        headers['x-api-key'] = apiKey;
    }
    // 'none': no auth headers

    if (state.api_format === 'openai') {
        // OpenAI format expects application/json, no anthropic-version
        delete headers['anthropic-version'];
        delete headers['anthropic-beta'];
        headers['content-type'] = 'application/json';
    }

    headers['content-length'] = body.length;
    return headers;
}

export function startModelProxy({ targetUrl, apiKey, startPort = 3200, backends, defaultMode, api_format, auth_type }) {
    return new Promise((resolve, reject) => {
        const initialTarget = new URL(targetUrl);
        const initialOptions = {};
        if (apiKey) initialOptions.apiKey = apiKey;
        initialOptions.auth_type = auth_type || 'bearer';

        const allBackends = {};
        if (backends) {
            for (const [name, cfg] of Object.entries(backends)) {
                const options = cfg.options || {};
                allBackends[name] = {
                    target: new URL(cfg.base_url || cfg.url),
                    options,
                    api_format: cfg.api_type || cfg.api_format || 'anthropic',
                };
            }
        }

        const startBackend = defaultMode && defaultMode !== 'anthropic' && allBackends[defaultMode];
        const state = {
            mode: defaultMode || '_single',
            target: startBackend ? startBackend.target : initialTarget,
            options: startBackend ? startBackend.options : initialOptions,
            api_format: startBackend ? startBackend.api_format : (api_format || 'anthropic'),
        };

        let reqCount = 0;
        const t0Global = Date.now();
        const costs = {};

        function recordUsage(backend, inputTokens, outputTokens) {
            if (!costs[backend]) costs[backend] = { input: 0, output: 0, requests: 0 };
            costs[backend].input += inputTokens || 0;
            costs[backend].output += outputTokens || 0;
            costs[backend].requests++;
        }

        function getCostSummary() {
            const summary = {};
            let totalReqs = 0;
            for (const [backend, tokens] of Object.entries(costs)) {
                totalReqs += tokens.requests;
                summary[backend] = {
                    input_tokens: tokens.input,
                    output_tokens: tokens.output,
                    requests: tokens.requests,
                };
            }
            return { backends: summary, total_requests: totalReqs };
        }

        function switchMode(name) {
            if (name === 'anthropic') {
                const prev = state.mode;
                state.mode = 'anthropic';
                state.target = new URL(ANTHROPIC_FALLBACK);
                state.options = { auth_type: 'none' };
                state.api_format = 'anthropic';
                return { mode: 'anthropic', previous: prev };
            }
            const b = allBackends[name];
            if (!b) return { error: `Unknown backend: ${name}. Valid: anthropic, ${Object.keys(allBackends).join(', ')}` };
            if (!b.options?.apiKey && (b.options?.auth_type || 'bearer') !== 'none') return { error: `API key not set for ${name}` };
            const prev = state.mode;
            state.mode = name;
            state.target = b.target;
            state.options = b.options;
            state.api_format = b.api_format;
            return { mode: name, previous: prev };
        }

        const server = createServer((clientReq, clientRes) => {
            const urlPath = clientReq.url.split('?')[0];

            // ── Control endpoints ──────────────────────────────────────────
            if (urlPath.startsWith('/_proxy/')) {
                if (urlPath === '/_proxy/status') {
                    clientRes.writeHead(200, { 'content-type': 'application/json' });
                    clientRes.end(JSON.stringify({
                        mode: state.mode,
                        api_format: state.api_format,
                        uptime: Math.round((Date.now() - t0Global) / 1000),
                        requests: reqCount,
                    }));
                    return;
                }
                if (urlPath === '/_proxy/cost') {
                    clientRes.writeHead(200, { 'content-type': 'application/json' });
                    clientRes.end(JSON.stringify(getCostSummary()));
                    return;
                }
                if (urlPath === '/_proxy/mode' && clientReq.method === 'POST') {
                    const origin = clientReq.headers['origin'] || '';
                    if (origin && !origin.startsWith('http://127.0.0.1') && !origin.startsWith('http://localhost')) {
                        clientRes.writeHead(403, { 'content-type': 'application/json' });
                        clientRes.end(JSON.stringify({ error: 'Forbidden' }));
                        return;
                    }
                    const chunks = [];
                    let bodySize = 0;
                    clientReq.on('data', c => {
                        bodySize += c.length;
                        if (bodySize > 1024) { clientReq.destroy(); return; }
                        chunks.push(c);
                    });
                    clientReq.on('end', () => {
                        const body = Buffer.concat(chunks).toString();
                        const m = body.match(/backend=([a-z0-9_-]+)/);
                        if (!m) {
                            clientRes.writeHead(400, { 'content-type': 'application/json' });
                            clientRes.end(JSON.stringify({ error: 'Missing backend= in body' }));
                            return;
                        }
                        const result = switchMode(m[1]);
                        if (result.error) {
                            clientRes.writeHead(400, { 'content-type': 'application/json' });
                            clientRes.end(JSON.stringify(result));
                            return;
                        }
                        console.log(`[PROXY] Mode switched: ${result.previous} → ${result.mode} (${state.api_format})`);
                        clientRes.writeHead(200, { 'content-type': 'application/json' });
                        clientRes.end(JSON.stringify(result));
                    });
                    return;
                }
                clientRes.writeHead(404, { 'content-type': 'application/json' });
                clientRes.end(JSON.stringify({ error: 'Not found' }));
                return;
            }

            // ── Proxy logic ────────────────────────────────────────────────
            const isAnthropicMode = state.mode === 'anthropic';
            const isCountTokensCall = !isAnthropicMode && urlPath === COUNT_TOKENS_PATH;
            const isModelCall = !isAnthropicMode && MODEL_PATHS.includes(urlPath);
            const dest = isModelCall ? state.target : new URL(ANTHROPIC_FALLBACK);

            if (isCountTokensCall) {
                const clientChunks = [];
                clientReq.on('data', c => clientChunks.push(c));
                clientReq.on('end', () => {
                    const input_tokens = estimateInputTokensFromAnthropic(Buffer.concat(clientChunks));
                    clientRes.writeHead(200, { 'content-type': 'application/json' });
                    clientRes.end(JSON.stringify({ input_tokens }));
                });
                return;
            }

            // Build upstream path (handle /v1 prefix dedup)
            let fullPath;
            if (isModelCall) {
                const base = state.target.pathname.replace(/\/$/, '');
                if (state.api_format === 'openai') {
                    fullPath = buildOpenAIPath(base, urlPath);
                } else {
                    let overlap = '';
                    for (let i = 1; i <= Math.min(base.length, urlPath.length); i++) {
                        if (base.endsWith(urlPath.substring(0, i))) overlap = urlPath.substring(0, i);
                    }
                    fullPath = overlap ? base + urlPath.substring(overlap.length) : base + urlPath;
                }
            } else {
                fullPath = clientReq.url;
            }

            const reqId = ++reqCount;
            const t0 = Date.now();
            if (isModelCall) {
                console.log(`[PROXY] #${reqId} → ${dest.hostname}${fullPath} (${state.api_format})`);
            }

            const clientChunks = [];
            clientReq.on('data', c => clientChunks.push(c));
            clientReq.on('end', () => {
                let body = Buffer.concat(clientChunks);
                let requestedModel = '';

                // For OpenAI-format providers, translate the request body
                if (isModelCall && state.api_format === 'openai') {
                    try {
                        const parsed = JSON.parse(body.toString());
                        requestedModel = parsed.model || '';
                        debugLog(`REQUEST model=${requestedModel} tools=${parsed.tools?.length || 0}`);
                        body = anthropicToOpenAI(body);
                        // Debug: log translated body structure
                        const outgoing = JSON.parse(body.toString());
                        debugLog(`TRANSLATED to OpenAI: tools=${outgoing.tools?.length} messages=${outgoing.messages?.length}`);
                        if (outgoing.tools?.length) {
                            debugLog(`TOOL_NAMES: ${outgoing.tools.map((t, i) => `[${i}]=${t.function?.name || 'MISSING'}`).join(' ')}`);
                            const toolSnip = JSON.stringify(outgoing.tools[0]).substring(0, 300);
                            debugLog(`TOOL[0]: ${toolSnip}`);
                        }
                        body = normalizeOpenAIBodyForProvider(body, state);
                        debugLog(`BODY_LENGTH: ${body.length} bytes`);
                    } catch (e) {
                        console.error(`[PROXY] #${reqId} Translation error: ${e.message}`);
                        debugLog(`TRANSLATION_ERROR: ${e.message}`);
                    }
                } else if (isModelCall) {
                    try { requestedModel = JSON.parse(body.toString()).model || ''; } catch {}
                    body = normalizeAnthropicBodyForProvider(body, state);
                }

                const headers = buildHeaders(state, clientReq.headers, body);
                const isHttps = dest.protocol === 'https:';
                const reqFn = isHttps ? httpsRequest : httpRequest;

                let queryStr = '';
                // For OpenAI-format model calls, strip Anthropic-specific query params
                if (isModelCall && state.api_format === 'openai') {
                    queryStr = ''; // Don't include query params for OpenAI endpoints
                } else if (clientReq.url.includes('?')) {
                    queryStr = '?' + clientReq.url.split('?')[1];
                }

                const opts = {
                    hostname: dest.hostname,
                    port: dest.port || (isHttps ? 443 : 80),
                    path: fullPath + queryStr,
                    method: clientReq.method,
                    headers,
                    timeout: REQUEST_TIMEOUT_MS,
                };

                if (isModelCall) {
                    debugLog(`HTTP_REQUEST ${opts.method} ${isHttps ? 'https' : 'http'}://${opts.hostname}${opts.path}`);
                    debugLog(`HEADERS content-type=${headers['content-type']} content-length=${headers['content-length']}`);
                    if (state.api_format === 'openai') {
                        debugLog(`BODY_FIRST_100: ${body.toString().substring(0, 100)}`);
                    }
                }

                const proxyReq = reqFn(opts, (proxyRes) => {
                    if (isModelCall) {
                        console.log(`[PROXY] #${reqId} TTFB ${Date.now() - t0}ms (status ${proxyRes.statusCode})`);
                        if (proxyRes.statusCode >= 400) {
                            debugLog(`ERROR_RESPONSE status=${proxyRes.statusCode}`);
                        }
                    }

                    const ct = proxyRes.headers['content-type'] || '';
                    const isSSE = ct.includes('text/event-stream');
                    const isJSON = ct.includes('application/json');

                    if (isModelCall && isSSE) {
                        const decoding = getDecompressionStream(proxyRes.headers['content-encoding']);
                        const sourceStream = decoding ? proxyRes.pipe(decoding) : proxyRes;

                        if (state.api_format === 'openai') {
                            // Translate OpenAI SSE → Anthropic SSE
                            const outHeaders = {
                                ...proxyRes.headers,
                                'content-type': 'text/event-stream',
                                'cache-control': 'no-cache',
                            };
                            delete outHeaders['content-encoding'];
                            delete outHeaders['content-length'];
                            clientRes.writeHead(proxyRes.statusCode, outHeaders);
                            const translator = new OpenAIToAnthropicStream(
                                requestedModel,
                                (inp, out) => recordUsage(state.mode, inp, out)
                            );
                            sourceStream.pipe(translator).pipe(clientRes);
                            proxyRes.on('end', () => {
                                console.log(`[PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
                            });
                        } else {
                            // Anthropic format — normalize usage fields
                            const outHeaders = { ...proxyRes.headers };
                            delete outHeaders['content-encoding'];
                            delete outHeaders['content-length'];
                            clientRes.writeHead(proxyRes.statusCode, outHeaders);
                            const norm = new UsageNormalizer((inp, out) => recordUsage(state.mode, inp, out));
                            sourceStream.pipe(norm).pipe(clientRes);
                            proxyRes.on('end', () => {
                                console.log(`[PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${norm._inputTokens}in/${norm._outputTokens}out)`);
                            });
                        }
                    } else if (isModelCall && isJSON) {
                        const respChunks = [];
                        proxyRes.on('data', c => respChunks.push(c));
                        proxyRes.on('end', () => {
                            let raw = Buffer.concat(respChunks);
                            raw = decodeResponseBody(raw, proxyRes.headers['content-encoding']);
                            if (proxyRes.statusCode >= 400) {
                                const errStr = raw.toString().substring(0, 300);
                                debugLog(`ERROR_BODY: ${errStr}`);
                            }
                            if (state.api_format === 'openai') {
                                raw = openAIJsonToAnthropic(raw, requestedModel);
                            } else {
                                raw = normalizeJsonBody(raw);
                            }
                            try {
                                const j = JSON.parse(raw);
                                if (j.usage) recordUsage(state.mode, j.usage.input_tokens, j.usage.output_tokens);
                            } catch {}
                            const outHeaders = { ...proxyRes.headers, 'content-length': raw.length };
                            delete outHeaders['content-encoding'];
                            delete outHeaders['transfer-encoding'];
                            clientRes.writeHead(proxyRes.statusCode, outHeaders);
                            clientRes.end(raw);
                            console.log(`[PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (json, ${raw.length}b)`);
                        });
                    } else {
                        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
                        proxyRes.pipe(clientRes);
                        if (isModelCall) {
                            proxyRes.on('end', () => {
                                console.log(`[PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
                            });
                        }
                    }
                });

                proxyReq.on('timeout', () => {
                    console.error(`[PROXY] #${reqId} TIMEOUT after ${REQUEST_TIMEOUT_MS / 1000}s`);
                    proxyReq.destroy(new Error('Request timeout'));
                });

                proxyReq.on('error', (err) => {
                    console.error(`[PROXY] #${reqId} ERROR after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}`);
                    if (!clientRes.headersSent) {
                        clientRes.writeHead(502, { 'content-type': 'application/json' });
                    }
                    clientRes.end(JSON.stringify({ error: { message: 'Upstream connection error' } }));
                });

                proxyReq.end(body);
            });
        });

        function tryListen(port, allowEphemeralFallback = true) {
            server.once('error', (err) => {
                if (err.code === 'EADDRINUSE' && port < startPort + 20) {
                    tryListen(port + 1, allowEphemeralFallback);
                    return;
                }
                if (err.code === 'EADDRINUSE' && allowEphemeralFallback) {
                    // If the default scan range is occupied, let the OS pick a free local port.
                    tryListen(0, false);
                    return;
                }
                reject(err);
            });
            server.listen(port, '127.0.0.1', () => {
                const actualPort = server.address().port;
                console.log(`[PROXY] Listening on 127.0.0.1:${actualPort} → ${targetUrl} (${state.api_format}, mode: ${state.mode})`);
                resolve({ port: actualPort, close: () => server.close(), switchMode });
            });
        }

        tryListen(startPort);
    });
}
