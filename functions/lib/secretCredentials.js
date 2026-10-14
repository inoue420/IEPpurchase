"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFreeeAppCredentials = parseFreeeAppCredentials;
exports.parseRakutenCredentials = parseRakutenCredentials;
const https_1 = require("firebase-functions/v2/https");
function parseCredentialRecord(value, message) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        throw new https_1.HttpsError('failed-precondition', message);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new https_1.HttpsError('failed-precondition', message);
    return parsed;
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function parseFreeeAppCredentials(value) {
    const message = 'freeeの認証設定を確認してください。';
    const credentials = parseCredentialRecord(value, message);
    if (!nonEmptyString(credentials.clientId) || !nonEmptyString(credentials.clientSecret))
        throw new https_1.HttpsError('failed-precondition', message);
    return { clientId: credentials.clientId, clientSecret: credentials.clientSecret };
}
function parseRakutenCredentials(value) {
    const message = '楽天の認証設定を確認してください。';
    const credentials = parseCredentialRecord(value, message);
    if (!nonEmptyString(credentials.applicationId) || !nonEmptyString(credentials.accessKey))
        throw new https_1.HttpsError('failed-precondition', message);
    return { applicationId: credentials.applicationId, accessKey: credentials.accessKey };
}
