export interface KnownExchange {
  name: string;
  label: string;
}

export const KNOWN_EXCHANGES: Map<string, KnownExchange> = new Map([
  // Binance
  ['5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', { name: 'Binance', label: 'Binance Hot Wallet 1' }],
  ['9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', { name: 'Binance', label: 'Binance Hot Wallet 2' }],
  ['2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S', { name: 'Binance', label: 'Binance Hot Wallet 3' }],

  // Coinbase
  ['GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', { name: 'Coinbase', label: 'Coinbase Hot Wallet 1' }],
  ['H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS', { name: 'Coinbase', label: 'Coinbase Hot Wallet 2' }],

  // Kraken
  ['FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5', { name: 'Kraken', label: 'Kraken Hot Wallet 1' }],
  ['CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq', { name: 'Kraken', label: 'Kraken Hot Wallet 2' }],

  // OKX
  ['5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD', { name: 'OKX', label: 'OKX Hot Wallet 1' }],

  // FTX (historical - useful for tax)
  ['2AQdpHJ2JpcEgPiATUXjQxA8QMAHgQGFx51kGtjzSYS2', { name: 'FTX', label: 'FTX Hot Wallet (Historical)' }],
]);

export function getKnownExchange(address: string): KnownExchange | undefined {
  return KNOWN_EXCHANGES.get(address);
}
