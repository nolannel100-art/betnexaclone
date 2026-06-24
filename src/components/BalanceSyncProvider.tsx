import { useEffect } from 'react';
import { useUser } from '@/context/UserContext';
import { useBets } from '@/context/BetContext';
import balanceSyncService from '@/lib/balanceSyncService';

/**
 * Global Balance Sync Provider
 * Ensures user balance is always synced from server when logged in
 * This component should wrap the main app content
 */
export function BalanceSyncProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoggedIn, updateUser } = useUser();
  const { syncBalance } = useBets();

  useEffect(() => {
    if (!isLoggedIn || !user?.id) {
      console.log('📊 Balance sync disabled: user not logged in');
      return;
    }

    console.log(`📊 Setting up global balance sync for user: ${user.id}`);

    // Subscribe to balance changes from the sync service
    const unsubscribe = balanceSyncService.subscribe(user.id, (newBalance) => {
      console.log(`💰 Global balance sync triggered: ${newBalance}`);
      syncBalance(newBalance);
    });

    // Subscribe to activation status changes
    const unsubActivation = balanceSyncService.subscribeActivation(user.id, (activated, activationDate) => {
      console.log(`🔐 Activation status synced: ${activated}`);
      updateUser({ withdrawalActivated: activated, withdrawalActivationDate: activationDate });
    });

    // DISABLED: Balance auto-sync removed (was fetching every 5 seconds)
    // Balance now syncs event-based: on bet placement, deposit, withdrawal, or bet settlement
    // This change: -12 requests/min per user (removes 100% of scheduled balance syncs)
    // Note: Balance updates still happen in real-time on transactions via listeners above
    // balanceSyncService.startAutoSync(user.id, 5000);

    return () => {
      unsubscribe();
      unsubActivation();
      balanceSyncService.stopAutoSync();
    };
  }, [isLoggedIn, user?.id, syncBalance]);

  return <>{children}</>;
}
