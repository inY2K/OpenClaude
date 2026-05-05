#!/usr/bin/env node
// Outputs a single provider as JSON.  Used by openclaude launchers.
// Usage:  node get-provider.js [alias]
//   alias omitted  -> returns the default provider
//   alias given    -> returns that specific provider
import { getProvider, getDefaultProvider } from './db.js';

const alias = process.argv[2] || '';
const p = alias ? getProvider(alias) : getDefaultProvider();

if (!p) {
    console.log(JSON.stringify(null));
} else {
    // Transform new schema to launcher-compatible format
    const transformed = {
        alias: p.alias,
        name: p.name,
        is_default: p.is_default,
        api_format: p.api_type,  // for backward compat
        api_type: p.api_type,
        url: p.base_url,          // for backward compat
        base_url: p.base_url,
        api_key: p.options?.apiKey || null,
        auth_type: p.options?.auth_type || 'bearer',
        force_proxy: !!p.options?.force_proxy,
        models: p.models.map(m => ({
            tier: m.tier,
            model_name: m.model_id,  // for backward compat
            model_id: m.model_id,
            name: m.name
        }))
    };
    console.log(JSON.stringify(transformed));
}
