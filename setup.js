#!/usr/bin/env node
/**
 * OpenClaude Interactive Setup Wizard
 * Manages providers in ~/.openclaude/config.db
 */

import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { probeProvider } from './proxy/provider-probe.js';

const __dir = dirname(fileURLToPath(import.meta.url));

const { saveProvider, getProviders, getProvider, deleteProvider, setDefault, hasProviders, dbPath } = await import('./proxy/db.js');

// ─── Colors (ANSI) ──────────────────────────────────────────────────────────
const C = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    cyan:    '\x1b[36m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    red:     '\x1b[31m',
    magenta: '\x1b[35m',
    blue:    '\x1b[34m',
    white:   '\x1b[37m',
    bgBlue:  '\x1b[44m',
    bgCyan:  '\x1b[46m',
};

const c = (color, text) => `${C[color]}${text}${C.reset}`;
const bold = t => `${C.bold}${t}${C.reset}`;
const dim = t => `${C.dim}${t}${C.reset}`;

function shouldForceProxy(baseUrl, apiType) {
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        return apiType === 'anthropic' && host.includes('siliconflow.com');
    } catch {
        return false;
    }
}

// ─── Readline helpers ────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt) {
    return new Promise(resolve => {
        let settled = false;
        const onClose = () => {
            if (settled) return;
            settled = true;
            resolve('q');
        };

        rl.once('close', onClose);
        rl.question(prompt, a => {
            if (settled) return;
            settled = true;
            rl.removeListener('close', onClose);
            resolve((a || '').trim());
        });
    });
}

async function askDefault(prompt, def) {
    const ans = await ask(`${prompt} ${dim(`[${def}]`)}: `);
    return ans || def;
}

async function askChoice(prompt, choices, def) {
    while (true) {
        const ans = await ask(`${prompt} ${dim(`[${def}]`)}: `);
        const val = (ans || def).toLowerCase();
        if (choices.map(c => c.toLowerCase()).includes(val)) return val;
        console.log(c('red', `  Please choose one of: ${choices.join(', ')}`));
    }
}

async function confirm(prompt, def = 'y') {
    const hint = def === 'y' ? 'Y/n' : 'y/N';
    const ans = await ask(`${prompt} ${dim(`[${hint}]`)}: `);
    return ans === '' ? def === 'y' : ans.toLowerCase() === 'y';
}

function clearLine() { process.stdout.write('\x1b[2K\x1b[1A\x1b[2K'); }

function printDiscoveredModels(models) {
    const limit = 20;
    models.slice(0, limit).forEach((modelId, index) => {
        console.log(`  ${c('yellow', `[${index + 1}]`)} ${modelId}`);
    });
    if (models.length > limit) {
        info(`...and ${models.length - limit} more. You can still paste any exact model id.`);
    }
}

async function askDiscoveredModel(prompt, models, def) {
    while (true) {
        const ans = await ask(`${prompt} ${dim(`[${def}]`)}: `);
        const value = ans || def;
        if (/^\d+$/.test(value)) {
            const idx = parseInt(value, 10) - 1;
            if (idx >= 0 && idx < models.length) return models[idx];
        }
        if (value.trim()) return value.trim();
        console.log(c('red', '  Enter a model id or one of the listed numbers.'));
    }
}

function modelMapFromProvider(provider) {
    const map = {};
    for (const m of (provider?.models || [])) {
        if (m?.tier && m?.model_id && !map[m.tier]) map[m.tier] = m.model_id;
    }
    return map;
}

function launchOpenClaude(alias) {
    const script = process.platform === 'win32' ? join(__dir, 'openclaude.ps1') : join(__dir, 'openclaude.sh');
    const args = process.platform === 'win32'
        ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '--switch', alias]
        : [script, '--switch', alias];
    const cmd = process.platform === 'win32' ? 'powershell' : 'bash';

    console.log('');
    info(`Starting OpenClaude with provider alias: ${alias}`);
    console.log('');
    rl.close();

    const child = spawnSync(cmd, args, {
        cwd: __dir,
        stdio: 'inherit',
        env: process.env,
    });

    process.exit(child.status ?? 1);
}

// ─── UI components ───────────────────────────────────────────────────────────
function banner() {
    console.log('');
    console.log(c('cyan', '  ╔══════════════════════════════════════════════════╗'));
    console.log(c('cyan', '  ║') + bold('         🤖  OpenClaude Setup Wizard  🤖          ') + c('cyan', '║'));
    console.log(c('cyan', '  ║') + dim('     Use Claude Code with any LLM provider        ') + c('cyan', '║'));
    console.log(c('cyan', '  ╚══════════════════════════════════════════════════╝'));
    console.log('');
}

function section(title) {
    console.log('');
    console.log(c('yellow', `  ── ${title} `).padEnd(60, '─'));
    console.log('');
}

function success(msg) { console.log(c('green', `  ✓ ${msg}`)); }
function info(msg)    { console.log(c('cyan',  `  ℹ ${msg}`)); }
function warn(msg)    { console.log(c('yellow',`  ⚠ ${msg}`)); }
function err(msg)     { console.log(c('red',   `  ✗ ${msg}`)); }

function providerRow(p, idx) {
    const def = p.is_default ? c('green', ' ★ default') : '';
    const fmt = p.api_type === 'openai' ? c('blue', 'OpenAI') : c('magenta', 'Anthropic');
    const apiKey = p.options?.apiKey;
    const key = apiKey ? dim('key:****' + apiKey.slice(-4)) : dim('no key');
    console.log(`  ${c('yellow', `[${idx}]`)} ${bold(p.name)} ${dim(`(${p.alias})`)}${def}`);
    console.log(`       ${dim(p.base_url)}  ${fmt}  ${key}`);
    const tiers = p.models.map(m => `${m.tier}=${c('cyan', m.model_id)}`).join('  ');
    if (tiers) console.log(`       ${tiers}`);
}

// ─── Provider wizard ─────────────────────────────────────────────────────────
const PROVIDER_PRESETS = {
    '1': { name: 'OpenAI',        base_url: 'https://api.openai.com/v1',       api_type: 'openai',     auth: 'bearer', models: { opus: 'gpt-4o', sonnet: 'gpt-4o-mini', haiku: 'gpt-4o-mini', subagent: 'gpt-4o-mini' } },
    '2': { name: 'DeepSeek',      base_url: 'https://api.deepseek.com/anthropic', api_type: 'anthropic', auth: 'x-api-key', models: { opus: 'deepseek-v4-pro', sonnet: 'deepseek-v4-pro', haiku: 'deepseek-v4-flash', subagent: 'deepseek-v4-flash' } },
    '3': { name: 'OpenRouter',    base_url: 'https://openrouter.ai/api/v1',    api_type: 'anthropic',  auth: 'bearer', models: { opus: 'deepseek/deepseek-v4-pro', sonnet: 'deepseek/deepseek-v4-pro', haiku: 'deepseek/deepseek-v4-pro', subagent: 'deepseek/deepseek-v4-pro' } },
    '4': { name: 'Fireworks AI',  base_url: 'https://api.fireworks.ai/inference/v1', api_type: 'anthropic', auth: 'bearer', models: { opus: 'accounts/fireworks/models/deepseek-v4-pro', sonnet: 'accounts/fireworks/models/deepseek-v4-pro', haiku: 'accounts/fireworks/models/deepseek-v4-pro', subagent: 'accounts/fireworks/models/deepseek-v4-pro' } },
    '5': { name: 'Ollama (local)', base_url: 'http://localhost:11434/v1',   api_type: 'openai',  auth: 'none', models: { opus: 'llama3.2', sonnet: 'llama3.2', haiku: 'llama3.1', subagent: 'llama3.1' } },
    '6': { name: 'LM Studio',     base_url: 'http://localhost:1234/v1',     api_type: 'openai',  auth: 'none', models: { opus: 'local-model', sonnet: 'local-model', haiku: 'local-model', subagent: 'local-model' } },
    '7': { name: 'Custom',        base_url: '',                              api_type: 'openai',  auth: 'bearer', models: {} },
};

async function addProviderWizard(isFirst = false, existingProvider = null) {
    const isEdit = !!existingProvider;
    section(isEdit ? `Edit Provider (${existingProvider.alias})` : (isFirst ? 'Add Your First Provider' : 'Add New Provider'));

    let preset;
    const existingModels = modelMapFromProvider(existingProvider);

    if (isEdit) {
        preset = {
            name: existingProvider.name,
            base_url: existingProvider.base_url,
            api_type: existingProvider.api_type,
            auth: existingProvider.options?.auth_type || (existingProvider.options?.apiKey ? 'bearer' : 'none'),
            models: {
                opus: existingModels.opus || 'gpt-4o',
                sonnet: existingModels.sonnet || existingModels.opus || 'gpt-4o-mini',
                haiku: existingModels.haiku || existingModels.opus || 'gpt-4o-mini',
                subagent: existingModels.subagent || existingModels.opus || 'gpt-4o-mini',
            },
        };
    } else {
        console.log('  Choose a preset or customize:\n');
        for (const [k, p] of Object.entries(PROVIDER_PRESETS)) {
            const fmt = p.api_type === 'openai' ? c('blue', 'OpenAI-compat') : c('magenta', 'Anthropic-compat');
            console.log(`  ${c('yellow', `[${k}]`)} ${bold(p.name)} ${dim(p.base_url ? `— ${p.base_url}` : '— enter your own')}  ${fmt}`);
        }
        console.log('');

        const choice = await askChoice('  Select preset', Object.keys(PROVIDER_PRESETS), '7');
        preset = PROVIDER_PRESETS[choice];
    }

    console.log('');

    // Name
    const name = await askDefault('  Provider display name', existingProvider?.name || preset.name);

    // Alias
    const originalAlias = existingProvider?.alias || '';
    const defaultAlias = originalAlias || (name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'custom');
    let alias = await askDefault('  Short alias (for --switch)', defaultAlias);
    alias = alias.replace(/[^a-z0-9_-]/g, '').slice(0, 20);

    // URL
    const base_url = await askDefault('  API endpoint URL', existingProvider?.base_url || preset.base_url || 'https://');

    // Format
    console.log('');
    console.log(`  API format:`);
    console.log(`  ${c('yellow', '[1]')} ${c('magenta', 'Anthropic-compatible')} ${dim('(DeepSeek native, OpenRouter, Fireworks, Anthropic)')}`);
    console.log(`  ${c('yellow', '[2]')} ${c('blue',    'OpenAI-compatible')}    ${dim('(OpenAI, Ollama, LM Studio, Groq, Together, etc.)')}`);
    console.log('');
    const fmtChoice = await askChoice('  Format', ['1', '2'], preset.api_type === 'anthropic' ? '1' : '2');
    const api_type = fmtChoice === '1' ? 'anthropic' : 'openai';

    // Auth
    console.log('');
    console.log(`  Authentication:`);
    console.log(`  ${c('yellow', '[1]')} Bearer token  ${dim('Authorization: Bearer <key>')}`);
    console.log(`  ${c('yellow', '[2]')} x-api-key     ${dim('x-api-key: <key>')}`);
    console.log(`  ${c('yellow', '[3]')} None           ${dim('(local models, no auth needed)')}`);
    console.log('');
    const defaultAuth = preset.auth === 'none' ? '3' : preset.auth === 'x-api-key' ? '2' : '1';
    const authChoice = await askChoice('  Auth type', ['1', '2', '3'], defaultAuth);
    const auth_type = authChoice === '3' ? 'none' : authChoice === '2' ? 'x-api-key' : 'bearer';

    // API Key
    let apiKey = '';
    if (auth_type !== 'none') {
        const currentKey = existingProvider?.options?.apiKey || '';
        const promptText = isEdit && currentKey
            ? `  API key ${dim('(leave blank to keep current)')}: `
            : `  API key ${dim('(input hidden in terminal)')}: `;
        const enteredKey = await ask(promptText);
        apiKey = enteredKey || currentKey;
        if (!apiKey) warn('No API key entered — you can update this later.');
    } else {
        info('No API key needed for local models.');
    }

    console.log('');
    info('Testing provider connection...');
    const probe = await probeProvider({ baseUrl: base_url, apiType: api_type, authType: auth_type, apiKey });
    const discoveredModels = probe.models || [];

    if (probe.ok) {
        success(probe.message);
        info(`Checked: ${probe.checkedUrl}`);
        if (discoveredModels.length) {
            console.log('');
            console.log('  Discovered models:');
            printDiscoveredModels(discoveredModels);
        }
    } else {
        err(probe.message);
        info(`Checked: ${probe.checkedUrl}`);
        const saveAnyway = await confirm('  Save this provider anyway?', 'n');
        if (!saveAnyway) {
            warn('Provider was not saved.');
            return null;
        }
    }

    // Models
    section('Model Configuration');
    let modelChoice;
    if (discoveredModels.length) {
        console.log(`  How should models be assigned to Claude tiers?\n`);
        console.log(`  ${c('yellow', '[1]')} Use one discovered model for everything`);
        console.log(`  ${c('yellow', '[2]')} Choose a discovered model per tier`);
        console.log(`  ${c('yellow', '[3]')} Enter model names manually`);
        console.log('');
        modelChoice = await askChoice('  Model setup', ['1', '2', '3'], '1');
    } else {
        console.log(`  How should models be assigned to Claude tiers?\n`);
        console.log(`  ${c('yellow', '[1]')} One model for everything  ${dim('(simplest)')}`);
        console.log(`  ${c('yellow', '[2]')} Different model per tier  ${dim('(Opus / Sonnet / Haiku / Subagent)')}`);
        console.log('');
        modelChoice = await askChoice('  Model setup', ['1', '2'], '1');
    }

    let models = [];
    const tiers = ['opus', 'sonnet', 'haiku', 'subagent'];

    const tierLabels = {
        opus:     'Opus    (main, complex tasks)',
        sonnet:   'Sonnet  (balanced)',
        haiku:    'Haiku   (fast, light tasks)',
        subagent: 'Subagent (background agents)',
    };

    if (discoveredModels.length && modelChoice === '1') {
        console.log('');
        console.log('  Available models:');
        printDiscoveredModels(discoveredModels);
        console.log('');
        const def = existingModels.opus || discoveredModels[0];
        const m = await askDiscoveredModel('  Model name (number or id)', discoveredModels, def);
        for (const t of tiers) {
            models.push({ model_id: m, tier: t, name: m });
        }
    } else if (discoveredModels.length && modelChoice === '2') {
        for (const t of tiers) {
            console.log('');
            console.log('  Available models:');
            printDiscoveredModels(discoveredModels);
            console.log('');
            const def = existingModels[t] || existingModels.opus || discoveredModels[0];
            const m = await askDiscoveredModel(`  ${tierLabels[t]} (number or id)`, discoveredModels, def);
            models.push({ model_id: m, tier: t, name: m });
        }
    } else if (modelChoice === '1') {
        const fallback = existingModels.opus || preset.models?.opus || 'gpt-4o';
        const m = await askDefault('  Model name', fallback);
        for (const t of tiers) {
            models.push({ model_id: m, tier: t, name: m });
        }
    } else {
        for (const t of tiers) {
            const fallback = existingModels[t] || preset.models?.[t] || preset.models?.opus || '';
            const m = await askDefault(`  ${tierLabels[t]}`, fallback);
            models.push({ model_id: m, tier: t, name: m });
        }
    }

    // Is default?
    const providers = getProviders();
    const defaultHint = existingProvider?.is_default ? 'y' : 'n';
    const makeDefault = providers.length === 0 || await confirm('\n  Set as default provider?', defaultHint);

    // Save with new schema
    const options = { auth_type };
    if (apiKey) options.apiKey = apiKey;
    if (auth_type === 'bearer' || auth_type === 'x-api-key') {
        options.timeout = 30000;
    }
    if (shouldForceProxy(base_url, api_type)) {
        options.force_proxy = true;
    }

    try {
        saveProvider({ alias, name, api_type, base_url, options, is_default: makeDefault, models });
        if (isEdit && originalAlias && alias !== originalAlias) {
            deleteProvider(originalAlias);
        }
        console.log('');
        success(`Provider "${name}" saved!`);
        info(`Use it with: ${bold(`openclaude --switch ${alias}`)}`);
        if (makeDefault) info(`This is now the default provider.`);
    } catch (e) {
        console.log('');
        err(`Failed to save provider: ${e.message}`);
        console.error(e);
    }

    return alias;
}

// ─── Main menu ────────────────────────────────────────────────────────────────
async function mainMenu() {
    while (true) {
        const providers = getProviders();

        section('Configured Providers');
        if (providers.length === 0) {
            warn('No providers configured yet.');
        } else {
            providers.forEach((p, i) => providerRow(p, i + 1));
        }

        console.log('');
        console.log(`  ${c('yellow', '[A]')} Add new provider`);
        if (providers.length > 0) {
            console.log(`  ${c('yellow', '[E]')} Edit a provider`);
            console.log(`  ${c('yellow', '[D]')} Delete a provider`);
            console.log(`  ${c('yellow', '[X]')} Set default provider`);
            console.log(`  ${c('yellow', '[L]')} Launch OpenClaude now`);
        }
        console.log(`  ${c('yellow', '[Q]')} Quit`);
        console.log('');

        const validChoices = ['a', 'q'];
        if (providers.length > 0) validChoices.push('e', 'd', 'x', 'l');

        const choice = (await ask('  Choice: ')).toLowerCase();

        if (choice === 'q') break;

        if (choice === 'a') {
            await addProviderWizard(false);
        } else if (choice === 'e' && providers.length > 0) {
            const num = await ask(`  Edit provider number [1-${providers.length}]: `);
            const idx = parseInt(num) - 1;
            if (idx >= 0 && idx < providers.length) {
                await addProviderWizard(false, providers[idx]);
            } else {
                err('Invalid selection.');
            }
        } else if (choice === 'd' && providers.length > 0) {
            const num = await ask(`  Delete provider number [1-${providers.length}]: `);
            const idx = parseInt(num) - 1;
            if (idx >= 0 && idx < providers.length) {
                const p = providers[idx];
                if (await confirm(`  Delete "${p.name}"?`, 'n')) {
                    deleteProvider(p.alias);
                    success(`"${p.name}" deleted.`);
                }
            } else {
                err('Invalid selection.');
            }
        } else if (choice === 'x' && providers.length > 0) {
            const num = await ask(`  Set default provider number [1-${providers.length}]: `);
            const idx = parseInt(num) - 1;
            if (idx >= 0 && idx < providers.length) {
                const p = providers[idx];
                setDefault(p.alias);
                success(`"${p.name}" is now the default.`);
            } else {
                err('Invalid selection.');
            }
        } else if (choice === 'l' && providers.length > 0) {
            const defaultIndex = Math.max(0, providers.findIndex(p => p.is_default));
            const num = await askDefault(`  Launch with provider number [1-${providers.length}]`, String(defaultIndex + 1));
            const idx = parseInt(num, 10) - 1;
            if (idx >= 0 && idx < providers.length) {
                launchOpenClaude(providers[idx].alias);
            } else {
                err('Invalid selection.');
            }
        }
    }
}

// ─── Entry point ─────────────────────────────────────────────────────────────
banner();
info(`Config database: ${dbPath()}`);

if (!hasProviders()) {
    console.log('');
    console.log(c('cyan', '  Welcome! No providers are configured yet.'));
    console.log(c('cyan', '  Let\'s add your first one.\n'));
    await addProviderWizard(true);
    console.log('');

    const more = await confirm('  Add another provider?', 'n');
    if (more) await mainMenu();
} else {
    await mainMenu();
}

console.log('');
info('Setup complete. Run ' + bold('openclaude') + ' to start.');
console.log('');
rl.close();
