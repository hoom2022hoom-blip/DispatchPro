

"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, where, or, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import type { Ride, Driver } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, DollarSign, Edit } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { formatUserName, formatPhoneNumber } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ResponsiveDialog } from './responsive-dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useToast } from '@/hooks/use-toast';
import { updateRide, updateRideTags } from '@/app/admin/actions';
import { EditRideForm } from './edit-ride-form';


export function UnpaidRidesTable() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRide, setEditingRide] = useState<Ride | null>(null);
  const [settlingFareRide, setSettlingFareRide] = useState<Ride | null>(null);

  const [fareCash, setFareCash] = useState<number | undefined>();
  const [fareCard, setFareCard] = useState<number | undefined>();
  const [fareCheck, setFareCheck] = useState<number | undefined>();
  const [fareTip, setFareTip] = useState<number | undefined>();
  
  const { toast } = useToast();

  useEffect(() => {
    if (settlingFareRide) {
        setFareCash(settlingFareRide.paymentDetails?.cash ?? undefined);
        setFareCard(settlingFareRide.paymentDetails?.card ?? undefined);
        setFareCheck(settlingFareRide.paymentDetails?.check ?? undefined);
        setFareTip(settlingFareRide.paymentDetails?.tip ?? undefined);
    } else {
        setFareCash(undefined);
        setFareCard(undefined);
        setFareCheck(undefined);
        setFareTip(undefined);
    }
  }, [settlingFareRide]);

  const cardPaymentAmount = useMemo(() => {
    return (fareCard || 0) + (fareTip || 0);
  }, [fareCard, fareTip]);
  
  const cardFee = useMemo(() => {
    if (!cardPaymentAmount || cardPaymentAmount <= 0) return 0;
    return 1 + Math.floor(cardPaymentAmount / 40);
  }, [cardPaymentAmount]);

  const totalPayment = useMemo(() => {
    return (fareCash || 0) + (fareCard || 0) + (fareCheck || 0);
  }, [fareCash, fareCard, fareCheck]);


  useEffect(() => {
    const ridesQuery = query(collection(db, 'rides'), 
      or(
        where('status', '==', 'completed'),
        where('tags', 'array-contains', 'UNPAID')
      )
    );
    const unsubRides = onSnapshot(ridesQuery, (snapshot) => {
      const ridesData = snapshot.docs.map(doc => ({ 
        id: doc.id,
        ...doc.data(),
        droppedOffAt: doc.data().droppedOffAt?.toDate(),
       } as Ride));
      setRides(ridesData);
      setLoading(false);
    });

    const driversQuery = query(collection(db, 'drivers'));
    const unsubDrivers = onSnapshot(driversQuery, (snapshot) => {
        setDrivers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Driver)));
    });

    return () => {
      unsubRides();
      unsubDrivers();
    };
  }, []);

  const unpaidRides = useMemo(() => {
    return rides
      .map(ride => {
        const paymentTotal = (ride.paymentDetails?.cash || 0) + (ride.paymentDetails?.card || 0) + (ride.paymentDetails?.check || 0);
        const amountOwed = (ride.totalFare ?? 0) - paymentTotal;
        return { ...ride, amountOwed };
      })
      .filter(ride => ride.amountOwed > 0.01 || ride.tags?.includes('UNPAID')) // Use epsilon and check for UNPAID tag
      .sort((a, b) => {
        const dateA = a.droppedOffAt;
        const dateB = b.droppedOffAt;
        if (dateA && dateB && isValid(dateA) && isValid(dateB)) {
            return dateB.getTime() - dateA.getTime();
        }
        return 0;
      });
  }, [rides]);

  const getDriverName = (driverId: string | null) => {
    if (!driverId) return 'N/A';
    return formatUserName(drivers.find(d => d.id === driverId)?.name);
  };
  
  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const handleSetFare = async () => {
    if (!settlingFareRide) return;
    const newTotalFare = totalPayment > 0 ? totalPayment : settlingFareRide.totalFare
    
    const result = await updateRide(settlingFareRide.id, {
      totalFare: newTotalFare,
      paymentDetails: {
        cash: fareCash || undefined,
        card: fareCard || undefined,
        check: fareCheck || undefined,
        tip: fareTip || undefined,
      }
    });

    if (result.type === 'success') {
      toast({ title: 'Success', description: 'Fare updated successfully.' });
    } else {
       toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setSettlingFareRide(null);
  };

  const handleSaveAndSettle = async () => {
    if (!settlingFareRide) return;
    const newTotalFare = totalPayment > 0 ? totalPayment : settlingFareRide.totalFare
    
    const result = await updateRide(settlingFareRide.id, {
      totalFare: newTotalFare,
      paymentDetails: {
        cash: fareCash || undefined,
        card: fareCard || undefined,
        check: fareCheck || undefined,
        tip: fareTip || undefined,
      }
    });

    if (result.type === 'success') {
      // Always remove UNPAID tag when using "Save and Settle"
      if (settlingFareRide.tags?.includes('UNPAID')) {
        const tagResult = await updateRideTags(settlingFareRide.id, 'UNPAID', false);
        if (tagResult.type === 'success') {
          toast({ title: 'Success', description: 'Fare saved and ride settled (UNPAID tag removed).' });
        } else {
          toast({ title: 'Partial Success', description: 'Fare updated but failed to remove UNPAID tag.' });
        }
      } else {
        toast({ title: 'Success', description: 'Fare saved and ride settled.' });
      }
    } else {
       toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setSettlingFareRide(null);
  };


  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (unpaidRides.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 rounded-lg border-2 border-dashed border-muted-foreground/30 text-center text-muted-foreground">
        <p>No unpaid rides found.</p>
      </div>
    );
  }

  return (
    <>
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Passenger</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>Total Fare</TableHead>
            <TableHead>Amount Owed</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {unpaidRides.map(ride => (
            <TableRow key={ride.id}>
              <TableCell>{ride.droppedOffAt && isValid(ride.droppedOffAt) ? format(ride.droppedOffAt, 'PP') : 'N/A'}</TableCell>
              <TableCell>{formatPhoneNumber(ride.passengerPhone)}</TableCell>
              <TableCell>{getDriverName(ride.driverId)}</TableCell>
              <TableCell>{formatCurrency(ride.totalFare ?? 0)}</TableCell>
              <TableCell>
                <Badge variant="destructive">{formatCurrency(ride.amountOwed)}</Badge>
              </TableCell>
               <TableCell>
                <div className="flex gap-1">
                    {ride.tags?.map(tag => (
                    <Badge key={tag} variant="outline">{tag}</Badge>
                    ))}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                    <Button variant="outline" size="icon" onClick={() => setEditingRide(ride)}>
                        <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => setSettlingFareRide(ride)}>
                        <DollarSign className="h-4 w-4" />
                    </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    
    <EditRideForm
        ride={editingRide}
        isOpen={!!editingRide}
        onOpenChange={(isOpen) => !isOpen && setEditingRide(null)}
    />

    <ResponsiveDialog
      open={!!settlingFareRide}
      onOpenChange={(isOpen) => !isOpen && setSettlingFareRide(null)}
      title="Settle Ride Fare"
    >
      {settlingFareRide && (
           <div className="space-y-4 py-4 max-h-[80vh] overflow-y-auto pr-2">
             <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <h4 className="font-medium">Ride Summary</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <div className="flex justify-between"><span>Passengers:</span> <span className="font-medium text-foreground">{settlingFareRide.passengerCount || 1}</span></div>
                    <div className="flex justify-between"><span>Stops:</span> <span className="font-medium text-foreground">{settlingFareRide.stops?.length || 0}</span></div>
                    <div className="flex justify-between"><span>Moving Fee:</span> <span className="font-medium text-foreground">{settlingFareRide.movingFee ? 'Yes' : 'No'}</span></div>
                </div>
            </div>

            <div className="space-y-2">
              <Label>Payment Details</Label>
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-1">
                    <Label htmlFor="fare-cash">Cash Amount</Label>
                    <Input
                        id="fare-cash"
                        type="number"
                        step="0.1"
                        placeholder="e.g., 20.00"
                        value={fareCash || ''}
                        onChange={(e) => setFareCash(parseFloat(e.target.value) || undefined)}
                    />
                 </div>
                 <div className="space-y-1">
                    <Label htmlFor="fare-card">Card Amount</Label>
                    <Input
                        id="fare-card"
                        type="number"
                        step="0.1"
                        placeholder="e.g., 25.50"
                        value={fareCard || ''}
                        onChange={(e) => setFareCard(parseFloat(e.target.value) || undefined)}
                    />
                 </div>
                 <div className="space-y-1">
                    <Label htmlFor="fare-check">Check Amount</Label>
                    <Input
                        id="fare-check"
                        type="number"
                        step="0.1"
                        placeholder="e.g., 50.00"
                        value={fareCheck || ''}
                        onChange={(e) => setFareCheck(parseFloat(e.target.value) || undefined)}
                    />
                 </div>
                  <div className="space-y-1">
                    <Label htmlFor="fare-tip">Tip (Card)</Label>                    <Input
                        id="fare-tip"
                        type="number"
                        step="0.1"
                        placeholder="e.g., 5.00"
                        value={fareTip || ''}
                        onChange={(e) => setFareTip(parseFloat(e.target.value) || undefined)}
                    />
                 </div>
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/50 p-4">
                <div className="flex justify-between font-medium">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(totalPayment)}</span>
                </div>
                 {fareTip && fareTip > 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Tip:</span>
                        <span>+ {formatCurrency(fareTip)}</span>
                    </div>
                )}
                {cardFee > 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Card Fee:</span>
                        <span>+ {formatCurrency(cardFee)}</span>
                    </div>
                )}
                <hr className="my-2" />
                <div className="flex justify-between text-lg font-bold">
                    <span>Total Charged to Customer:</span>
                    <span>{formatCurrency(totalPayment + cardFee)}</span>
                </div>
            </div>
            
            {cardFee > 0 && (
              <p className="text-xs text-center text-muted-foreground">
                A {formatCurrency(cardFee)} card processing fee will be applied.
              </p>
            )}
             <div className="sm:h-80 md:h-0" />
            <div className="flex justify-end gap-2 p-4">
                <Button variant="outline" onClick={handleSetFare}>
                Save Fare
                </Button>
                <Button onClick={handleSaveAndSettle}>
                Save and Settle
                </Button>
            </div>
          </div>
      )}
    </ResponsiveDialog>
    </>
  );
}
