# Payment initialization and receipt recovery

## Service payments

Service checkout creates a server-side `service_payment_attempts` record before contacting Paystack. The unique idempotency key returns the same attempt for a retried browser request. Its stored service details, payer email, expected kobo amount, currency, and reference are checked against Paystack's independently verified transaction before a `cap_services` row is written. Callback and webhook processing use the same transactional completion path. The reservation expiry worker also verifies stale service attempts and retries receipts for completed service payments.

The service table is added by `db/migrations/008_service_payment_attempts.sql`. For a new empty database, `db/fresh-install.sql` already includes it.

## Receipt delivery

Receipt claims use a database lease token. Only the current token owner can renew a sending lease or mark the receipt sent/failed. A heartbeat renews a long-running send, and crashed `sending` claims become eligible for recovery after 30 minutes. Failed sends are retried by the recovery worker.

SMTP does not support a transaction shared with MySQL. If the mail provider accepts a message and the process dies before recording `sent`, recovery cannot know whether delivery occurred. After the lease expires it may send a duplicate. The lease and fencing token prevent normal concurrent retries, but cannot provide true exactly-once delivery across that provider/database crash window.

The nullable receipt lease column is added by `db/migrations/009_receipt_delivery_lease.sql`; existing receipt history remains intact. Apply migrations 008 and 009 once, in order, to an existing database. Do not run them against a fresh database installed from `db/fresh-install.sql`.

## MySQL integration tests

`test/mysqlWorkflow.integration.test.js` runs only when explicitly enabled. It requires a loopback `DB_HOST`, an unused database name beginning with `capcentral_test_`, and `CONFIRM_CAPCENTRAL_MYSQL_TESTS=true`. It creates that database and installs the fresh schema. It intentionally does not drop the database afterward; use a new unique name for each run.
