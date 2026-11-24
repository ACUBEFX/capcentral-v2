'use strict';

async function startServer({
    app,
    port,
    sessionStore,
    reservationExpiryService,
    logger = console
}) {
    if (sessionStore) {
        await sessionStore.onReady();
        logger.log('MySQL session store initialized.');
    }

    return new Promise((resolve, reject) => {
        let server;
        let settled = false;

        const onError = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };

        const onListening = () => {
            if (settled) return;

            try {
                logger.log(`Server running at http://localhost:${port}`);
                reservationExpiryService.start();

                settled = true;
                server.removeListener('error', onError);
                resolve(server);
            } catch (error) {
                settled = true;
                server.removeListener('error', onError);
                reject(error);
            }
        };

        try {
            server = app.listen(port, '0.0.0.0', onListening);
            server.once('error', onError);
        } catch (error) {
            settled = true;
            reject(error);
        }
    });
}

module.exports = { startServer };