"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDeliveryLocation = normalizeDeliveryLocation;
exports.deliveryLocationName = deliveryLocationName;
// Match only equivalent spellings. Similar addresses must be reviewed by a person.
function normalizeDeliveryLocation(value) {
    return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
function deliveryLocationName(value) {
    if (typeof value !== 'string' || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value) || [...value.trim()].length > 255) {
        throw new Error('納品場所は改行・制御文字を含まない255文字以内で入力してください。');
    }
    return value.trim();
}
