'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import traccarService, { TraccarDevice, TraccarPosition, TraccarSession } from '@/lib/traccar-service';

interface TraccarContextType {
  devices: TraccarDevice[];
  positions: TraccarPosition[];
  session: TraccarSession | null;
  loading: boolean;
  authenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshData: () => Promise<void>;
  getDevicePosition: (deviceId: number) => TraccarPosition | null;
  getOnlineDevices: () => TraccarDevice[];
}

const TraccarContext = createContext<TraccarContextType | undefined>(undefined);

interface TraccarProviderProps {
  children: ReactNode;
  autoLogin?: boolean;
}

export function TraccarProvider({ children, autoLogin = true }: TraccarProviderProps) {
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [positions, setPositions] = useState<TraccarPosition[]>([]);
  const [session, setSession] = useState<TraccarSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setLoading(true);
    try {
      const sessionData = await traccarService.login(email, password);
      setSession(sessionData);
      setAuthenticated(true);
      await refreshData();
      return true;
    } catch (error) {
      console.error('Traccar login failed:', error);
      setAuthenticated(false);
      setSession(null);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      await traccarService.logout();
    } catch (error) {
      console.error('Traccar logout error:', error);
    } finally {
      setSession(null);
      setAuthenticated(false);
      setDevices([]);
      setPositions([]);
      setLoading(false);
    }
  }, []);

  const refreshData = useCallback(async (): Promise<void> => {
    if (!authenticated && !traccarService.isAuthenticated()) {
      return;
    }

    setLoading(true);
    try {
      const [devicesData, positionsData] = await Promise.all([
        traccarService.getDevices(),
        traccarService.getLatestPositions()
      ]);

      setDevices(devicesData);
      setPositions(positionsData);
    } catch (error) {
      console.error('Failed to refresh Traccar data:', error);
      // If we get auth errors, try to re-authenticate
      if (error instanceof Error && error.message.includes('401')) {
        setAuthenticated(false);
        setSession(null);
      }
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  const getDevicePosition = useCallback((deviceId: number): TraccarPosition | null => {
    return positions.find(p => p.deviceId === deviceId) || null;
  }, [positions]);

  const getOnlineDevices = useCallback((): TraccarDevice[] => {
    return devices.filter(d => d.status === 'online' && !d.disabled);
  }, [devices]);

  // Auto-login on mount if enabled
useEffect(() => {
    // Traccar disabled temporarily for local development
    setLoading(false);
  }, []);

  // Set up periodic refresh when authenticated
  useEffect(() => {
    if (!authenticated) return;

    const interval = setInterval(() => {
      refreshData();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [authenticated, refreshData]);

  const value: TraccarContextType = {
    devices,
    positions,
    session,
    loading,
    authenticated,
    login,
    logout,
    refreshData,
    getDevicePosition,
    getOnlineDevices,
  };

  return (
    <TraccarContext.Provider value={value}>
      {children}
    </TraccarContext.Provider>
  );
}

export function useTraccar(): TraccarContextType {
  const context = useContext(TraccarContext);
  if (context === undefined) {
    throw new Error('useTraccar must be used within a TraccarProvider');
  }
  return context;
}