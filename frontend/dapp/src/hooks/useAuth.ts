'use client';

import { useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { getNonce, signIn as apiSignIn } from '@/lib/api';

export function useAuthFlow() {
  const { publicKey, signMessage, connected } = useWallet();

  const authenticate = useCallback(async (): Promise<string | null> => {
    if (!publicKey || !signMessage || !connected) return null;

    const walletAddress = publicKey.toBase58();

    // Step 1: Get nonce and message from API
    const { nonce, message } = await getNonce(walletAddress);

    // Step 2: Sign the message with wallet
    const encodedMessage = new TextEncoder().encode(message);
    const signatureBytes = await signMessage(encodedMessage);
    const signature = bs58.encode(signatureBytes);

    // Step 3: Verify signature and get JWT
    const { accessToken } = await apiSignIn({
      walletAddress,
      signature,
      message,
      nonce,
    });

    // Step 4: Store JWT
    localStorage.setItem('auth_token', accessToken);

    return accessToken;
  }, [publicKey, signMessage, connected]);

  return { authenticate };
}
