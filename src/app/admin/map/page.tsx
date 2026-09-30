
"use client";

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useRouter } from 'next/navigation';
import { Role, type Ride, type Driver } from '@/lib/types';
import { AdminBreadcrumb } from '@/components/admin-breadcrumb';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiReception } from '@/components/api-reception';

const DynamicTraccarMapView = dynamic(
  () => import('../../../components/TraccarMapView').then((mod) => mod.TraccarMapView),
  {
    ssr: false,
    loading: () => <Skeleton className="w-full h-full bg-muted" />,
  }
);

const DynamicMapView = dynamic(
  () => import('../../../components/map-view').then((mod) => mod.MapView),
  {
    ssr: false,
    loading: () => <Skeleton className="w-full h-full bg-muted" />,
  }
);


export default function MapPage() {
    return process.env.NEXT_PUBLIC_RECEPTION_BACKEND === 'api' ? <ApiReception initialShowPlaces /> : <LegacyMapPage />;
}
function LegacyMapPage() {
    const { user, loading: authLoading, hasRole } = useAuth();
    const router = useRouter();
    
    const [rides, setRides] = useState<Ride[]>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [dataLoading, setDataLoading] = useState(true);

    const canAccess = hasRole(Role.ADMIN) || hasRole(Role.OWNER);

    useEffect(() => {
        if (!authLoading) {
            if (!user) {
                router.push('/login');
            } else if (!canAccess) {
                router.push('/');
            }
        }
    }, [user, authLoading, router, canAccess]);
    
    useEffect(() => {
      if (!user || !canAccess) return;

      const toDate = (ts: any) => ts instanceof Timestamp ? ts.toDate() : ts;
      
      const ridesQuery = query(collection(db, "rides"), where("status", "in", ["pending", "waiting", "assigned", "driver-accepted", "driver-arriving", "arrived", "in-progress"]));
      const driversQuery = query(collection(db, "drivers"));

      let ridesLoaded = false;
      let driversLoaded = false;

      const checkDataLoaded = () => {
        if (ridesLoaded && driversLoaded) {
          setDataLoading(false);
        }
      };

      const unsubRides = onSnapshot(ridesQuery, (snapshot) => {
          setRides(snapshot.docs.map(doc => ({
              ...doc.data(),
              id: doc.id,
              createdAt: toDate(doc.data().createdAt),
          } as Ride)));
          ridesLoaded = true;
          checkDataLoaded();
      }, (error) => {
          console.error("Error fetching rides: ", error);
          ridesLoaded = true;
          checkDataLoaded();
      });

      const unsubDrivers = onSnapshot(driversQuery, (snapshot) => {
          setDrivers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Driver)));
          driversLoaded = true;
          checkDataLoaded();
      }, (error) => {
          console.error("Error fetching drivers: ", error);
          driversLoaded = true;
          checkDataLoaded();
      });
      
      return () => {
        unsubRides();
        unsubDrivers();
      };
    }, [user, canAccess]);

    if (authLoading || dataLoading || !user || !canAccess) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }
    
    return (
        <div className="flex h-full flex-col gap-6 bg-secondary/50 p-4 md:p-6">
            <AdminBreadcrumb segments={[{ name: 'Admin', href: '/admin' }, { name: 'Fleet Map' }]} />
            <div className="min-h-0 flex-1">
                <DynamicTraccarMapView 
                    className="h-full" 
                    mode="both" 
                    height="calc(100vh - 200px)"
                />
            </div>
        </div>
    );
}
