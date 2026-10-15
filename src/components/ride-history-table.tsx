
"use client";

import type { Ride, Driver } from '@/lib/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

type RideHistoryTableProps = {
  rides: Ride[];
  drivers: Driver[];
};

export function RideHistoryTable({ rides, drivers }: RideHistoryTableProps) {
    const getDriverName = (driverId: string | null) => {
        if (!driverId) return 'N/A';
        return drivers.find(d => d.id === driverId)?.name || 'Unknown';
    };

    const formatCurrency = (amount?: number) => {
      if (amount === undefined) return 'N/A';
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    }
    
    const getPaymentSummary = (ride: Ride) => {
        if (!ride.paymentDetails) return 'N/A';
        const parts = [];
        if (ride.paymentDetails.cash) parts.push('Cash');
        if (ride.paymentDetails.card) parts.push('Card');
        if (ride.paymentDetails.check) parts.push('Check');
        return parts.join(', ') || 'N/A';
    }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Passenger Phone</TableHead>
          <TableHead>Driver</TableHead>
          <TableHead>Pickup</TableHead>
          <TableHead>Dropoff</TableHead>
          <TableHead>Fare</TableHead>
          <TableHead>Payment</TableHead>
          <TableHead>Completed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rides.map(ride => (
          <TableRow key={ride.id}>
            <TableCell>
              <Badge variant={ride.status === 'completed' ? 'default' : 'destructive'} className={ride.status === 'completed' ? 'bg-green-600' : ''}>
                {ride.status}
              </Badge>
            </TableCell>
            <TableCell>{ride.passengerPhone}</TableCell>
            <TableCell>{getDriverName(ride.driverId)}</TableCell>
            <TableCell>{ride.pickup.name}</TableCell>
            <TableCell>{ride.dropoff?.name || 'Unknown'}</TableCell>
            <TableCell>{formatCurrency(ride.totalFare ?? undefined)}</TableCell>
            <TableCell>{getPaymentSummary(ride)}</TableCell>
            <TableCell>
              {ride.completionTime ? format(ride.completionTime, 'PPpp') : 'N/A'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
