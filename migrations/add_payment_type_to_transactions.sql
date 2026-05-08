-- Migration: Add payment_type metadata to transactions for Daraja flow
-- This column is used to preserve deposit/activation/priority payment intent for idempotent callback handling.

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS payment_type TEXT;

COMMENT ON COLUMN transactions.payment_type IS 'Daraja payment intent for user STK push payments: deposit, activation, or priority';
