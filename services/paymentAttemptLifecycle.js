async function initializeAttempt({
    reference,
    markInFlight,
    initialize,
    markInitialized,
    rejectAndRelease,
    isDefinitiveRejection,
    validateResponse
}) {
    await markInFlight(reference);

    let response;

    try {
        response = await initialize(reference);
    } catch (error) {
        if (isDefinitiveRejection(error)) {
            await rejectAndRelease(reference, error);
        }

        throw error;
    }

    if (String(response?.reference || '') !== reference) {
        throw new Error('Paystack returned a mismatched payment reference.');
    }

    validateResponse(response, reference);
    await markInitialized(reference);

    return response;
}

module.exports = { initializeAttempt };
