"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREEE_TOKEN_METADATA_PATH = void 0;
exports.freeeTokenMetadata = freeeTokenMetadata;
const firestore_1 = require("firebase-admin/firestore");
// Only a Secret Manager version identifier is stored here, never token values.
exports.FREEE_TOKEN_METADATA_PATH = 'integrationSecrets/freeeOAuthTokens';
function freeeTokenMetadata(parent) {
    const ref = (0, firestore_1.getFirestore)().doc(exports.FREEE_TOKEN_METADATA_PATH);
    function number(name) {
        if (typeof name !== 'string' || !name.startsWith(`${parent}/versions/`))
            throw new Error('freee token version metadata is invalid');
        const version = name.slice(`${parent}/versions/`.length);
        if (!/^[1-9]\d*$/.test(version))
            throw new Error('freee token version metadata is invalid');
        return BigInt(version);
    }
    return {
        async read() {
            const snapshot = await ref.get();
            if (!snapshot.exists)
                return null;
            const name = snapshot.get('currentVersion');
            number(name);
            return name;
        },
        async advance(name) {
            const incoming = number(name);
            return (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
                const snapshot = await transaction.get(ref);
                if (snapshot.exists && number(snapshot.get('currentVersion')) >= incoming)
                    return false;
                transaction.set(ref, { currentVersion: name, updatedAt: firestore_1.FieldValue.serverTimestamp() });
                return true;
            });
        },
    };
}
