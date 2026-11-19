-- Fence concurrent receipt senders and renew long-running delivery claims.
-- Existing receipt status and history are preserved.
ALTER TABLE `capcentral_receipt_emails`
  ADD COLUMN `lease_token` CHAR(36) DEFAULT NULL;
