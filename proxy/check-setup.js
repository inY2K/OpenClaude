#!/usr/bin/env node
// Outputs provider info as JSON — used by StartOpenClaude launchers.
import { hasProviders, getProviders, getDefaultProvider } from './db.js';

const providers = getProviders();
const def = getDefaultProvider();

console.log(JSON.stringify({
    configured: hasProviders(),
    count: providers.length,
    default: def ? { alias: def.alias, name: def.name } : null,
    providers: providers.map(p => ({
        alias: p.alias,
        name: p.name,
        is_default: !!p.is_default,
        url: p.base_url,
        api_format: p.api_type,
        models: p.models.map(m => ({
            tier: m.tier,
            model_name: m.model_id,
            model_id: m.model_id,
            name: m.name,
        })),
    })),
}));
