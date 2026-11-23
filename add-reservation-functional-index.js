const db = require('./models/database');

async function migrate() {
    try {
        await db.promise().query(`
            ALTER TABLE inventory_reservations
            ADD UNIQUE INDEX uq_reservation_product_variant
            (
                reservation_token,
                product_id,
                (COALESCE(variant_id, 0))
            )
        `);

        console.log('New reservation unique index created successfully.');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await db.end();
    }
}

migrate();
