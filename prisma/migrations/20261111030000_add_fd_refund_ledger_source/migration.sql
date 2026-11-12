-- Refunds of a verified Fixed Deposit were previously written to the ledger with
-- the non-existent source type 'FD_WITHDRAWAL', which made the insert fail and
-- rolled the whole refund transaction back. Give FD refunds their own type so
-- they can be reported separately from Investment Fund refunds.
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'FD_REFUND';
