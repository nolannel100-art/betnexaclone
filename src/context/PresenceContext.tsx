import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

interface UserPresence {
  id: string;
  user_id: string;
  session_id: string;
  last_activity: string;
  login_time: string;
  status: 'online' | 'idle' | 'offline';
  users?: {
    id: string;
    username: string;
    phone_number: string;
    email: string;
    total_bets: number;
    total_winnings: number;
    account_balance: number;
  };
}

interface PresenceContextType {
  sessionId: string | null;
  activeUsers: UserPresence[];
  activeCount: number;
  isTracking: boolean;
  startTracking: (user: { id: string; username?: string; phone?: string }) => Promise<void>;
  stopTracking: () => Promise<void>;
  subscribeToPresence: () => void;
}

const PresenceContext = createContext<PresenceContextType | undefined>(undefined);

let heartbeatInterval: NodeJS.Timeout | null = null;
let activeUsersInterval: NodeJS.Timeout | null = null;
let presenceSubscription: any = null;

export function PresenceProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<UserPresence[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [isTracking, setIsTracking] = useState(false);

  const apiUrl = import.meta.env.VITE_API_URL || 'https://betnexaclone.vercel.app';

  // Start presence tracking (called on login)
  const startTracking = useCallback(async (user: { id: string; username?: string; phone?: string }) => {
    try {
      console.log('\n🟢 [PresenceContext] Starting presence tracking for user:', user.id);

      const userAgent = navigator.userAgent;
      const response = await fetch(`${apiUrl}/api/presence/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          username: user.username || '',
          phoneNumber: user.phone || '',
          userAgent,
          ipAddress: ''
        })
      });

      const data = await response.json();
      if (data.success && data.sessionId) {
        setSessionId(data.sessionId);
        console.log(`✅ Presence session created: ${data.sessionId}`);

        // Start heartbeat
        startHeartbeat(data.sessionId);
        setIsTracking(true);

        // Subscribe to real-time updates
        subscribeToPresence();
      }
    } catch (error) {
      console.error('❌ Error starting presence tracking:', error);
    }
  }, [apiUrl]);

  // Send heartbeat to keep session alive
  const startHeartbeat = useCallback((sId: string) => {
    // Clear any existing heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    // Send initial heartbeat immediately
    const sendHeartbeat = async () => {
      try {
        await fetch(`${apiUrl}/api/presence/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sId })
        });
      } catch (error) {
        console.warn('⚠️ Heartbeat send failed:', error);
      }
    };

    sendHeartbeat();

    // Send heartbeat every 5 s — well within the 30 s server active window.
    // Using a longer interval avoids the tight timing that caused users to
    // blink in/out of the online list due to network jitter.
    heartbeatInterval = setInterval(sendHeartbeat, 5000);
  }, [apiUrl]);

  // Stop presence tracking (called on logout)
  const stopTracking = useCallback(async () => {
    try {
      console.log('\n🔴 [PresenceContext] Stopping presence tracking');

      if (sessionId) {
        await fetch(`${apiUrl}/api/presence/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
      }

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      if (activeUsersInterval) {
        clearInterval(activeUsersInterval);
        activeUsersInterval = null;
      }

      setSessionId(null);
      setIsTracking(false);
      setActiveUsers([]);
      setActiveCount(0);
      sessionStorage.removeItem('presence_tracked_user_id');
    } catch (error) {
      console.error('❌ Error stopping presence tracking:', error);
    }
  }, [sessionId, apiUrl]);

  // Fetch active users
  const fetchActiveUsers = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/presence/active`, {
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();
      if (data.success && data.users) {
        setActiveUsers(data.users);
        setActiveCount(data.activeCount);
      }
    } catch (error) {
      // On network errors keep the existing list visible — don't blink
      // users away just because one poll failed.
      console.warn('⚠️ Error fetching active users (keeping current list):', error);
    }
  }, [apiUrl]);

  // Subscribe to presence updates.
  const subscribeToPresence = useCallback(() => {
    try {
      console.log('📡 Attempting to subscribe to real-time presence updates...');
      // For now, use polling as fallback
      // Real-time subscriptions will be handled if Supabase client is available
      fetchActiveUsers();
    } catch (error) {
      console.warn('⚠️ Subscription error:', error);
      fetchActiveUsers();
    }
  }, [fetchActiveUsers]);

  // Keep active users fresh for admin dashboard metrics.
  useEffect(() => {
    fetchActiveUsers();

    if (activeUsersInterval) {
      clearInterval(activeUsersInterval);
    }

    // Poll every 3 s — frequent enough for smooth updates, infrequent
    // enough to stop causing per-second list replacements that made users
    // appear to blink on the admin dashboard.
    activeUsersInterval = setInterval(() => {
      fetchActiveUsers();
    }, 3000);

    return () => {
      if (activeUsersInterval) {
        clearInterval(activeUsersInterval);
        activeUsersInterval = null;
      }
    };
  }, [fetchActiveUsers, isTracking]);

  // Attempt immediate logout signal when tab/app is closed.
  useEffect(() => {
    const handlePageClose = () => {
      if (!sessionId) return;

      const logoutUrl = `${apiUrl}/api/presence/logout?sessionId=${encodeURIComponent(sessionId)}`;
      try {
        navigator.sendBeacon(logoutUrl);
      } catch (_) {
        fetch(logoutUrl, { method: 'POST', keepalive: true }).catch(() => {});
      }
    };

    window.addEventListener('pagehide', handlePageClose);
    return () => {
      window.removeEventListener('pagehide', handlePageClose);
    };
  }, [sessionId, apiUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (activeUsersInterval) {
        clearInterval(activeUsersInterval);
      }
      if (presenceSubscription) {
        presenceSubscription.unsubscribe();
      }
    };
  }, []);

  return (
    <PresenceContext.Provider
      value={{
        sessionId,
        activeUsers,
        activeCount,
        isTracking,
        startTracking,
        stopTracking,
        subscribeToPresence
      }}
    >
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  const context = useContext(PresenceContext);
  if (context === undefined) {
    throw new Error("usePresence must be used within a PresenceProvider");
  }
  return context;
}
