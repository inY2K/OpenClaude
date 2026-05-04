function normalizeBasePath(basePath) {
    return (basePath || '').replace(/\/$/, '');
}

export function buildOpenAIPath(basePath, urlPath) {
    const normalizedBase = normalizeBasePath(basePath);

    if (urlPath !== '/v1/messages') {
        if (!normalizedBase) return urlPath;
        return `${normalizedBase}${urlPath}`;
    }

    if (!normalizedBase) return '/v1/chat/completions';
    if (/\/chat\/completions$/i.test(normalizedBase)) return normalizedBase;
    if (/\/v\d+(?:\.\d+)?$/i.test(normalizedBase)) return `${normalizedBase}/chat/completions`;
    if (/\/v1$/i.test(normalizedBase)) return `${normalizedBase}/chat/completions`;
    return `${normalizedBase}/v1/chat/completions`;
}

export function buildModelsPath(basePath) {
    const normalizedBase = normalizeBasePath(basePath);

    if (!normalizedBase) return '/v1/models';
    if (/\/models$/i.test(normalizedBase)) return normalizedBase;
    if (/\/v\d+(?:\.\d+)?$/i.test(normalizedBase)) return `${normalizedBase}/models`;
    if (/\/v1$/i.test(normalizedBase)) return `${normalizedBase}/models`;
    return `${normalizedBase}/v1/models`;
}