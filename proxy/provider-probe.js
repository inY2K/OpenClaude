import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { URL } from 'url';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib';
import { buildModelsPath } from './provider-url.js';

const REQUEST_TIMEOUT_MS = 15000;

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

function buildHeaders(apiType, authType, apiKey) {
    const headers = {
        accept: 'application/json',
        'user-agent': 'openclaude-setup/1.0',
    };

    if (apiType === 'anthropic') {
        headers['anthropic-version'] = '2023-06-01';
    }

    if (authType === 'bearer' && apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
    } else if (authType === 'x-api-key' && apiKey) {
        headers['x-api-key'] = apiKey;
    }

    return headers;
}

function extractModelIds(payload) {
    const candidates = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.models)
                ? payload.models
                : [];

    const ids = [];
    for (const item of candidates) {
        const modelId = item?.id || item?.name || item?.model || item?.model_id;
        if (typeof modelId === 'string' && modelId.trim()) ids.push(modelId.trim());
    }

    return [...new Set(ids)];
}

function requestJson(urlString, headers) {
    return new Promise((resolve) => {
        let settled = false;
        const target = new URL(urlString);
        const reqFn = target.protocol === 'https:' ? httpsRequest : httpRequest;
        const req = reqFn({
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: `${target.pathname}${target.search}`,
            method: 'GET',
            headers,
            timeout: REQUEST_TIMEOUT_MS,
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                if (settled) return;
                settled = true;
                const raw = decodeResponseBody(Buffer.concat(chunks), res.headers['content-encoding']);
                const text = raw.toString('utf8');
                let json = null;
                try { json = JSON.parse(text); } catch {}
                resolve({
                    ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
                    status: res.statusCode || 0,
                    headers: res.headers,
                    json,
                    text,
                });
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('Request timeout'));
        });

        req.on('error', (error) => {
            if (settled) return;
            settled = true;
            resolve({ ok: false, status: 0, error: error.message, json: null, text: '' });
        });

        req.end();
    });
}

export async function probeProvider({ baseUrl, apiType, authType, apiKey }) {
    const headers = buildHeaders(apiType, authType, apiKey);
    const target = new URL(baseUrl);
    const modelsUrl = new URL(buildModelsPath(target.pathname), `${target.protocol}//${target.host}`).toString();
    const response = await requestJson(modelsUrl, headers);

    if (response.error) {
        return {
            ok: false,
            models: [],
            checkedUrl: modelsUrl,
            message: `Connection failed: ${response.error}`,
        };
    }

    if (response.ok) {
        const models = extractModelIds(response.json);
        return {
            ok: true,
            models,
            checkedUrl: modelsUrl,
            message: models.length
                ? `Connected successfully and discovered ${models.length} model(s).`
                : 'Connected successfully, but the provider returned no models.',
        };
    }

    if (response.status === 404) {
        return {
            ok: true,
            models: [],
            checkedUrl: modelsUrl,
            message: 'Provider responded, but model discovery is not available on this endpoint.',
        };
    }

    if (response.status === 401 || response.status === 403) {
        return {
            ok: false,
            models: [],
            checkedUrl: modelsUrl,
            message: `Authentication failed (HTTP ${response.status}). Check the API key and auth type.`,
        };
    }

    return {
        ok: false,
        models: [],
        checkedUrl: modelsUrl,
        message: `Provider probe failed with HTTP ${response.status}.`,
    };
}