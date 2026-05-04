#!/usr/bin/env node
/**
 * OpenClaude proxy entry point.
 * Loads provider configuration from SQLite (~/.openclaude/config.db)
 * and starts the model proxy.
 *
 * Usage:
 *   node proxy/start-proxy.js                          # use default provider
 *   node proxy/start-proxy.js --alias <alias>          # use specific provider
 *   node proxy/start-proxy.js --port <port>            # custom port
 *   node proxy/start-proxy.js --mode <alias>           # alias for --alias
 */

import { startModelProxy } from './model-proxy.js';
import { getDefaultProvider, getProvider, getProviders, getModelForTier } from './db.js';

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

const aliasArg  = get('--alias') || get('--mode');
const portArg   = get('--port');
const startPort = portArg ? parseInt(portArg, 10) : 3200;

function providerConfig(provider) {
    const options = provider.options || {};
    return {
        targetUrl: provider.base_url,
        apiKey: options.apiKey || null,
        api_format: provider.api_type,
        auth_type: options.auth_type || 'bearer',
        options,
    };
}

// Load provider from DB
let provider = aliasArg ? getProvider(aliasArg) : getDefaultProvider();

if (!provider) {
    if (aliasArg) {
        console.error(`[PROXY] Provider "${aliasArg}" not found in config.`);
    } else {
        console.error('[PROXY] No providers configured. Run: node setup.js');
    }
    process.exit(1);
}

// Build backends map (all other providers for live switching)
const allProviders = getProviders();
const backends = {};
for (const p of allProviders) {
    const config = providerConfig(p);
    backends[p.alias] = {
        base_url: config.targetUrl,
        api_type: config.api_format,
        options: config.options,
    };
}

const config = providerConfig(provider);

console.log(`[PROXY] Starting with provider: ${provider.name} (${provider.alias})`);
console.log(`[PROXY] Format: ${config.api_format} | Auth: ${config.auth_type}`);
console.log(`[PROXY] Endpoint: ${config.targetUrl}`);

const { port } = await startModelProxy({
    targetUrl:  config.targetUrl,
    apiKey:     config.apiKey,
    api_format: config.api_format,
    auth_type:  config.auth_type,
    startPort,
    backends,
    defaultMode: provider.alias,
});

// Output port on its own line — callers (openclaude.ps1 / .sh) read this
console.log(port);
