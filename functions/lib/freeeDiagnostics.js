"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeOAuthDescription = safeOAuthDescription;
// Never log the raw OAuth response or request credentials.
function safeOAuthDescription(value, secrets) {
    if (typeof value !== 'string')
        return 'unavailable';
    let text = value;
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
        for (const variant of [secret, encodeURIComponent(secret)])
            text = text.split(variant).join('[redacted]');
    }
    return text.replace(/https?:\/\/\S+/g, '[url]')
        .replace(/[A-Za-z0-9_+/%=.-]{20,}/g, '[redacted]')
        .replace(/[\r\n\t]/g, ' ').slice(0, 600);
}
