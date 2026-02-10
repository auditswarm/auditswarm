-- Seed known addresses for exchange and bridge detection
INSERT INTO known_addresses (id, address, name, label, "entityType", source, "isVerified", "createdAt", "updatedAt")
VALUES
  -- Binance (existing in-memory)
  (gen_random_uuid(), '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', 'Binance', 'Binance Hot Wallet 1', 'EXCHANGE', 'SEED', true, NOW(), NOW()),
  (gen_random_uuid(), '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'Binance', 'Binance Hot Wallet 2', 'EXCHANGE', 'SEED', true, NOW(), NOW()),
  (gen_random_uuid(), '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S', 'Binance', 'Binance Hot Wallet 3', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- Coinbase (existing in-memory)
  (gen_random_uuid(), 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', 'Coinbase', 'Coinbase Hot Wallet 1', 'EXCHANGE', 'SEED', true, NOW(), NOW()),
  (gen_random_uuid(), 'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS', 'Coinbase', 'Coinbase Hot Wallet 2', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- Kraken (existing in-memory)
  (gen_random_uuid(), 'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5', 'Kraken', 'Kraken Hot Wallet 1', 'EXCHANGE', 'SEED', true, NOW(), NOW()),
  (gen_random_uuid(), 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq', 'Kraken', 'Kraken Hot Wallet 2', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- OKX (existing in-memory)
  (gen_random_uuid(), '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD', 'OKX', 'OKX Hot Wallet 1', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- FTX (existing in-memory)
  (gen_random_uuid(), '2AQdpHJ2JpcEgPiATUXjQxA8QMAHgQGFx51kGtjzSYS2', 'FTX', 'FTX Hot Wallet (Historical)', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- Bybit
  (gen_random_uuid(), 'AC5RDfQFmDS1deWZos921JfqscXdByf4BKHs5ACWjtW2', 'Bybit', 'Bybit Hot Wallet 1', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- KuCoin
  (gen_random_uuid(), 'BmFdpraQhkiDQE6SnfG5PkCEjMqVcQLTFnQvaMvLXoc', 'KuCoin', 'KuCoin Hot Wallet 1', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- Gate.io
  (gen_random_uuid(), 'u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w', 'Gate.io', 'Gate.io Hot Wallet 1', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- Crypto.com
  (gen_random_uuid(), 'AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATbo3s', 'Crypto.com', 'Crypto.com Hot Wallet 1', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- Gemini
  (gen_random_uuid(), '5PGfBEAnv46HXDQy86KnMN3jGduz7o5vxGCP3p6rYDEj', 'Gemini', 'Gemini Hot Wallet 1', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- HTX (Huobi)
  (gen_random_uuid(), '88xTWZMeKFo4t79aFyxqnJ6rY2zQ6KG8HD3gW57M1yJt', 'HTX', 'HTX Hot Wallet 1', 'EXCHANGE', 'SEED', true, NOW(), NOW()),

  -- Wormhole (bridges)
  (gen_random_uuid(), 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth', 'Wormhole', 'Wormhole Core Bridge', 'BRIDGE', 'SEED', true, NOW(), NOW()),
  (gen_random_uuid(), 'Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o', 'Wormhole', 'Wormhole Token Bridge', 'BRIDGE', 'SEED', true, NOW(), NOW()),

  -- deBridge
  (gen_random_uuid(), 'src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4', 'deBridge', 'deBridge Source', 'BRIDGE', 'SEED', true, NOW(), NOW()),

  -- Allbridge
  (gen_random_uuid(), 'ABrn41WMEfGSdMSLDaRoyJbuHYJzSBwgxZyRmvhpuBTB', 'Allbridge', 'Allbridge Core', 'BRIDGE', 'SEED', true, NOW(), NOW()),

  -- Portal (Wormhole Portal)
  (gen_random_uuid(), 'Portal11111111111111111111111111111111111111', 'Portal', 'Portal Token Bridge', 'BRIDGE', 'SEED', true, NOW(), NOW())

ON CONFLICT (address) DO NOTHING;
