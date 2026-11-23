'use strict';

function isActiveVariant(variant) {
    return Boolean(variant) && Number(variant.is_active) === 1;
}

function isCapsCategory(category) {
    return String(category || '').trim().toLowerCase() === 'caps';
}

function resolveOrderUnitPrice(snapshotValue, currentDatabaseValue) {
    if (snapshotValue !== undefined && snapshotValue !== null && snapshotValue !== '') {
        const snapshot = Number(snapshotValue);
        if (!Number.isFinite(snapshot) || snapshot < 0 ||
            !Number.isSafeInteger(Math.round(snapshot * 100))) {
            throw new Error('Invalid verified order price snapshot.');
        }
        return snapshot;
    }

    const current = Number(currentDatabaseValue);
    if (!Number.isFinite(current) || current < 0 ||
        !Number.isSafeInteger(Math.round(current * 100))) {
        throw new Error('Invalid current order price.');
    }
    return current;
}

module.exports = { isActiveVariant, isCapsCategory, resolveOrderUnitPrice };
