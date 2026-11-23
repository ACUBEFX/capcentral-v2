'use strict';

const crypto = require('node:crypto');
const db = require('../models/database');

const STALE_RECEIPT_MINUTES = 30;

/**
 * Claims a receipt reference once, with a bounded lease for crash recovery.
 * The callback must be safe to retry: SMTP cannot provide true exactly-once
 * delivery if the process dies after the provider accepts a message.
 */
async function sendReceiptOnce(reference, send, database = db.promise()) {
    const normalizedReference = String(reference || '').trim();
    if (!normalizedReference || typeof send !== 'function') return false;
    const claimToken = crypto.randomUUID();

    const [insert] = await database.execute(
        `INSERT IGNORE INTO capcentral_receipt_emails (reference, status, lease_token)
         VALUES (?, 'sending', ?)`,
        [normalizedReference, claimToken]
    );

    let claimed = insert.affectedRows === 1;

    if (!claimed) {
        const [reclaim] = await database.execute(
            `UPDATE capcentral_receipt_emails
             SET status = 'sending', lease_token = ?, updated_at = NOW()
             WHERE reference = ?
               AND (
                   status = 'failed'
                   OR (
                       status = 'sending'
                       AND updated_at <= DATE_SUB(NOW(), INTERVAL ${STALE_RECEIPT_MINUTES} MINUTE)
                   )
               )`,
            [claimToken, normalizedReference]
        );
        claimed = reclaim.affectedRows === 1;
    }

    if (!claimed) return false;

    let heartbeatBusy = false;
    const heartbeat = setInterval(async () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        try {
            const [renewed] = await database.execute(
                `UPDATE capcentral_receipt_emails SET updated_at = NOW()
                 WHERE reference = ? AND status = 'sending' AND lease_token = ?`,
                [normalizedReference, claimToken]
            );
            if (renewed.affectedRows !== 1) clearInterval(heartbeat);
        } catch (error) {
            console.error('Could not renew receipt delivery lease:', error.code || error.message);
        } finally {
            heartbeatBusy = false;
        }
    }, Math.max(1000, Math.floor(STALE_RECEIPT_MINUTES * 60 * 1000 / 3)));
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    try {
        await send();
    } catch (error) {
        clearInterval(heartbeat);
        await database.execute(
            `UPDATE capcentral_receipt_emails
             SET status = 'failed', lease_token = NULL
             WHERE reference = ? AND status = 'sending' AND lease_token = ?`,
            [normalizedReference, claimToken]
        ).catch(updateError => {
            console.error('Could not persist receipt failure state:', updateError.message);
        });
        return false;
    }

    clearInterval(heartbeat);
    try {
        const [updated] = await database.execute(
            `UPDATE capcentral_receipt_emails
             SET status = 'sent', lease_token = NULL
             WHERE reference = ? AND status = 'sending' AND lease_token = ?`,
            [normalizedReference, claimToken]
        );
        return updated.affectedRows === 1;
    } catch (error) {
        // Leave the row in sending; marking it failed could cause an immediate
        // duplicate if the mail provider already accepted the message.
        console.error('Could not persist receipt sent state:', error.message);
        return false;
    }
}

module.exports = { sendReceiptOnce, STALE_RECEIPT_MINUTES };
