import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelsPath, buildOpenAIPath } from './provider-url.js';
import { anthropicToOpenAI, openAIJsonToAnthropic, OpenAIToAnthropicStream } from './openai-translate.js';

function estimateInputTokensFromAnthropic(body) {
    const req = JSON.parse(body.toString());
    const collectTextParts = (value, out = []) => {
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
    };

    const text = [
        ...collectTextParts(req.system),
        ...collectTextParts(req.messages),
        ...collectTextParts(req.tools),
        ...collectTextParts(req.tool_choice),
    ].join('\n');

    return text.trim() ? Math.max(1, Math.ceil(text.length / 4)) : 0;
}

test('buildOpenAIPath handles versioned provider bases', () => {
    assert.equal(buildOpenAIPath('/api/coding/paas/v4', '/v1/messages'), '/api/coding/paas/v4/chat/completions');
    assert.equal(buildOpenAIPath('/v1', '/v1/messages'), '/v1/chat/completions');
    assert.equal(buildOpenAIPath('', '/v1/messages'), '/v1/chat/completions');
});

test('buildModelsPath handles versioned and v1 bases', () => {
    assert.equal(buildModelsPath('/api/coding/paas/v4'), '/api/coding/paas/v4/models');
    assert.equal(buildModelsPath('/v1'), '/v1/models');
    assert.equal(buildModelsPath(''), '/v1/models');
});

test('anthropic request translates to OpenAI request shape', () => {
    const source = Buffer.from(JSON.stringify({
        model: 'glm-5.1',
        system: 'Follow instructions.',
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 32,
        stream: false,
    }));

    const translated = JSON.parse(anthropicToOpenAI(source).toString());
    assert.equal(translated.model, 'glm-5.1');
    assert.equal(translated.stream, false);
    assert.equal(translated.max_tokens, 32);
    assert.deepEqual(translated.messages, [
        { role: 'system', content: 'Follow instructions.' },
        { role: 'user', content: 'Say hello' },
    ]);
});

test('OpenAI JSON translates back to Anthropic message shape', () => {
    const source = Buffer.from(JSON.stringify({
        id: 'chatcmpl-test',
        model: 'glm-5.1',
        choices: [{
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'proxy ok' },
        }],
        usage: { prompt_tokens: 11, completion_tokens: 5 },
    }));

    const translated = JSON.parse(openAIJsonToAnthropic(source, 'glm-5.1').toString());
    assert.equal(translated.type, 'message');
    assert.equal(translated.model, 'glm-5.1');
    assert.equal(translated.stop_reason, 'end_turn');
    assert.deepEqual(translated.content, [{ type: 'text', text: 'proxy ok' }]);
    assert.deepEqual(translated.usage, { input_tokens: 11, output_tokens: 5 });
});

test('OpenAI stream translation includes input_tokens in message_delta usage', async () => {
    const stream = new OpenAIToAnthropicStream('test-model');
    let out = '';

    stream.on('data', chunk => {
        out += chunk.toString();
    });

    const sse = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"hello"},"finish_reason":null}],"usage":{"prompt_tokens":7,"completion_tokens":1}}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
    ].join('');

    stream.end(Buffer.from(sse));
    await new Promise(resolve => stream.on('end', resolve));

    const messageDeltaEvent = out
        .split('\n\n')
        .find(block => block.startsWith('event: message_delta'));

    assert.ok(messageDeltaEvent, 'message_delta event should be present');
    const dataLine = messageDeltaEvent.split('\n').find(line => line.startsWith('data: '));
    const payload = JSON.parse(dataLine.slice('data: '.length));

    assert.deepEqual(payload.usage, { input_tokens: 7, output_tokens: 2 });
});

test('OpenAI stream finalizes without [DONE] and preserves usage', async () => {
    const stream = new OpenAIToAnthropicStream('test-model');
    let out = '';

    stream.on('data', chunk => {
        out += chunk.toString();
    });

    const sseWithoutDone = [
        'data: {"id":"chatcmpl-2","choices":[{"delta":{"content":"hello"},"finish_reason":null}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
    ].join('');

    stream.end(Buffer.from(sseWithoutDone));
    await new Promise(resolve => stream.on('end', resolve));

    assert.ok(out.includes('event: message_delta'), 'message_delta should be emitted');
    assert.ok(out.includes('event: message_stop'), 'message_stop should be emitted');

    const messageDeltaEvent = out
        .split('\n\n')
        .find(block => block.startsWith('event: message_delta'));
    const dataLine = messageDeltaEvent.split('\n').find(line => line.startsWith('data: '));
    const payload = JSON.parse(dataLine.slice('data: '.length));

    assert.deepEqual(payload.usage, { input_tokens: 3, output_tokens: 2 });
});

test('count_tokens fallback returns an input_tokens estimate for Anthropic-shaped requests', () => {
    const source = Buffer.from(JSON.stringify({
        system: 'You are helpful.',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Testing model' }] }],
        tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
    }));

    const tokens = estimateInputTokensFromAnthropic(source);
    assert.equal(typeof tokens, 'number');
    assert.ok(tokens > 0);
});

test('anthropic stop_sequences drops empty values for OpenAI compatibility', () => {
    const source = Buffer.from(JSON.stringify({
        model: 'deepseek-ai/DeepSeek-V4-Pro',
        messages: [{ role: 'user', content: 'hello' }],
        stop_sequences: ['', 'END'],
    }));

    const translated = JSON.parse(anthropicToOpenAI(source).toString());
    assert.deepEqual(translated.stop, ['END']);
});

test('anthropic stop field drops empty values for OpenAI compatibility', () => {
    const source = Buffer.from(JSON.stringify({
        model: 'deepseek-ai/DeepSeek-V4-Pro',
        messages: [{ role: 'user', content: 'hello' }],
        stop: ['', 'DONE'],
    }));

    const translated = JSON.parse(anthropicToOpenAI(source).toString());
    assert.deepEqual(translated.stop, ['DONE']);
});

test('tool_result messages are ordered before user text after tool calls', () => {
    const source = Buffer.from(JSON.stringify({
        model: 'deepseek-ai/DeepSeek-V4-Pro',
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: 'please continue' },
                { type: 'tool_result', tool_use_id: 'call_1', content: 'ok' },
            ],
        }],
    }));

    const translated = JSON.parse(anthropicToOpenAI(source).toString());
    assert.equal(translated.messages[0].role, 'tool');
    assert.equal(translated.messages[0].tool_call_id, 'call_1');
    assert.equal(translated.messages[1].role, 'user');
});