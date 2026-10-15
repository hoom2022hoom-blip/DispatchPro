

"use client";

import React from 'react';
import type { Ride } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Users, Phone, Package, Edit, Milestone, MessageSquare } from 'lucide-react';
import { Separator } from './ui/separator';
import { cn, formatPhoneNumber } from '@/lib/utils';


type DriverRideCardProps = {
    ride: Ride;
    onEdit: (ride: Ride) => void;
    isQueued?: boolean;
};

export function DriverRideCard({ ride, onEdit, isQueued = false }: DriverRideCardProps) {

    const createMapLink = (address: string, coords?: {x:number;y:number}) => {
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords && (coords.x!==0||coords.y!==0) ? `${coords.x},${coords.y}` : address)}`;
    }

    return (
        <Card className={cn(
            isQueued && "bg-muted/50 border-dashed", 
            ride.status === 'completed' && "bg-secondary/70"
        )}>
            <CardHeader>
                <CardTitle className="text-lg flex items-start justify-between">
                    <div className='flex flex-col'>
                        <a href={createMapLink(ride.pickup.name,ride.latitude!=null&&ride.longitude!=null?{x:ride.latitude,y:ride.longitude}:ride.pickup.coords)} target="_blank" rel="noopener noreferrer" className="hover:underline text-primary">
                            {ride.pickup.name}
                        </a>
                        {ride.dropoff && 
                            <CardDescription>
                                to <a href={createMapLink(ride.dropoff.name,ride.dropoff.coords)} target="_blank" rel="noopener noreferrer" className="hover:underline text-primary">
                                    {ride.dropoff.name}
                                </a>
                            </CardDescription>
                        }
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => onEdit(ride)}>
                            <Edit className="mr-2" /> Edit Details
                        </Button>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                 <div className="grid grid-cols-2 gap-4 text-sm">
                     <div className="flex items-center gap-2 font-medium text-primary">
                        <span>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(ride.totalFare ?? 0)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Users className="text-muted-foreground" />
                        <span>{ride.passengerCount || 1} Passenger(s)</span>
                    </div>
                    {ride.passengerName && (
    <div className="flex items-center gap-2">
        <span className="font-semibold">اسم الزبون:</span>
        <span>{ride.passengerName}</span>
    </div>
)}
                    {ride.passengerPhone && (
                        <div className="flex items-center gap-2">
                            <Phone className="text-muted-foreground" />
                            <a href={`tel:${ride.passengerPhone}`} className="text-primary hover:underline">{formatPhoneNumber(ride.passengerPhone)}</a>
                        </div>
                    )}
                    {ride.movingFee && (
                         <div className="flex items-center gap-2">
                            <Package className="text-muted-foreground" />
                            <span>Moving Fee Applies</span>
                        </div>
                    )}
                     {ride.paymentDetails?.cashTip && ride.paymentDetails.cashTip > 0 && (
                         <div className="flex items-center gap-2">
                            <span className="font-semibold text-green-600">Cash Tip:</span>
                            <span>${ride.paymentDetails.cashTip.toFixed(2)}</span>
                        </div>
                    )}
                </div>
                 {ride.stops && ride.stops.length > 0 && (
                     <>
                        <Separator />
                        <div className="space-y-1 text-sm">
                            <p className="font-medium">Stops:</p>
                            {ride.stops.map((stop, index) => (
                                <div key={index} className="flex items-center gap-2 pl-2 text-muted-foreground">
                                    <Milestone className="h-4 w-4" />
                                    <a href={createMapLink(stop.name)} target="_blank" rel="noopener noreferrer" className="hover:underline text-primary">
                                        {stop.name}
                                    </a>
                                </div>
                            ))}
                        </div>
                     </>
                 )}
                {ride.notes && (
                    <>
                        <Separator />
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                            <MessageSquare className="mt-1 flex-shrink-0" />
                            <p className="italic">{ride.notes}</p>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
