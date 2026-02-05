-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create hypertable after transactions table is created by Prisma migrations
-- This will be run manually or via a migration script
-- SELECT create_hypertable('transactions', 'timestamp', if_not_exists => TRUE);

-- Create indexes for common queries (optional, Prisma handles basic indexes)
-- These are TimescaleDB-specific optimizations

-- Commented out until table exists:
-- CREATE INDEX IF NOT EXISTS idx_transactions_wallet_time
--   ON transactions (wallet_id, timestamp DESC);

-- CREATE INDEX IF NOT EXISTS idx_transactions_type_time
--   ON transactions (type, timestamp DESC);
