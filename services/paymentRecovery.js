async function recoverPayment({
    state,
    reference,
    reservationToken,
    verify,
    associate,
    complete,
    releasePrepared,
    releaseRejected,
    releaseTerminal
}) {
    if (state === 'prepared') {
        await releasePrepared(reference);
        return 'released-prepared';
    }

    if (state === 'rejected') {
        await releaseRejected(reference);
        return 'released-rejected';
    }

    if (!['in_flight', 'initialized', 'legacy'].includes(state)) {
        return 'unhandled-state';
    }

    if (!reference) return 'missing-reference';
    if (!reservationToken) return 'missing-reservation-token';

    let paymentData;

    try {
        paymentData = await verify(reference);
    } catch (error) {
        return 'unverifiable';
    }

    if (
        !paymentData ||
        String(paymentData.reference || '') !== reference ||
        String(paymentData.metadata?.reservationToken || '').trim() !== reservationToken
    ) {
        return 'verification-mismatch';
    }

    const status = String(paymentData.status || '').toLowerCase();

    if (status === 'success') {
        await associate(paymentData, reference, reservationToken);
        await complete(paymentData, reservationToken);
        return 'completed';
    }

    if (status === 'failed' || status === 'abandoned') {
        await associate(paymentData, reference, reservationToken);
        await releaseTerminal(reference);
        return 'released-terminal';
    }

    return 'pending';
}

module.exports = { recoverPayment };
