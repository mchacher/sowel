-- Spec 188 R5 — the gate's delivery receipt for a press.
--
-- An `opened` row records that the press was sent. When the gate's device
-- answers (a LoRa gate does), the row also carries what became of it:
-- pending / delivered / refused / not_received / unconfirmed. NULL means no
-- receipt is expected, which is every row written before this migration and
-- every gate whose device does not answer.
ALTER TABLE shared_access_journal ADD COLUMN receipt TEXT;
