'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { HoneycombBackground } from '@/components/visuals/HoneycombBackground';
import { WalletConnectHero } from '@/components/onboarding/WalletConnectHero';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated } = useAuthContext();

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  // Authenticated users get redirected above
  if (isAuthenticated) return null;

  return (
    <HoneycombBackground>
      <WalletConnectHero />
    </HoneycombBackground>
  );
}
