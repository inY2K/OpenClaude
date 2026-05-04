import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelsPath, buildOpenAIPath } from './provider-url.js';
import { anthropicToOpenAI, openAIJsonToAnthropic } from './openai-translate.js';

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