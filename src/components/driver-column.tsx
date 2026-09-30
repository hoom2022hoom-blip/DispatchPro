

"use client";
import { activeRideStatuses } from "@/lib/ride-status";

import React, { useState, useMemo } from 'react';
import type { Ride, Driver, RideStatus, Shift, Vehicle } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RideCard } from './ride-card';
import { cn, formatUserName } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useIsMobile } from '@/hooks/use-mobile';
import { StrictModeDroppable } from './strict-mode-droppable';
import { CheckCircle2, ChevronDown, ChevronUp, Briefcase, Car, PowerOff, MessageSquare, MoreHorizontal, DollarSign, FileText, Edit } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { toggleStarMessage } from '@/app/actions';
import { Badge } from './ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';


type DriverColumnProps = {
  shift: Shift & { driver?: Driver; vehicle?: Vehicle, totalFare: number };
  rides: Ride[];
  allShifts: (Shift & { driver?: any; vehicle?: any })[];
  allDrivers: Driver[];
  onAssignDriver: (rideId: string, shiftId: string) => void;
  onChangeStatus: (rideId: string, newStatus: RideStatus) => void;
  onSetFare: (rideId: string, details: { totalFare: number; paymentDetails: { cash?: number | null; card?: number | null; check?: number | null; tip?: number | null; } }) => void;
  onUnassignDriver: (rideId: string) => void;
  onEditRide: (ride: Ride) => void;
  onUnscheduleRide: (rideId: string) => void;
  onToggleStar: typeof toggleStarMessage;
  onEndShift: (shift: Shift) => void;
  onOpenChat?: () => void;
  onEditShift: (shift: Shift) => void;
  onEditVehicle: (vehicle: Vehicle) => void;
  unreadCount: number;
  className?: string;
};

const statusSortOrder: Record<RideStatus, number> = {
  waiting: 3,
  'driver-accepted': 2,
  'driver-arriving': 2,
  arrived: 2,
  'in-progress': 1,
  'assigned': 2,
  'pending': 3,
  'completed': 4,
  'cancelled': 5,
};

export function DriverColumn({ 
    shift,
    rides, 
    allShifts,
    onAssignDriver, 
    onChangeStatus, 
    onSetFare, 
    onUnassignDriver, 
    onEditRide, 
    onUnscheduleRide, 
    onToggleStar,
    onEndShift,
    onOpenChat,
    onEditShift,
    onEditVehicle,
    unreadCount,
    className
}: DriverColumnProps) {
  const [showCompleted, setShowCompleted] = useState(false);
  
  const isMobile = useIsMobile();
  const driver = shift.driver;
  const vehicle = shift.vehicle;

  const activeRides = useMemo(() => {
    return rides
      .filter(r => activeRideStatuses.includes(r.status))
      .sort((a, b) => statusSortOrder[a.status] - statusSortOrder[b.status]);
  }, [rides]);

  const completedRides = rides.filter(r => r.status === 'completed');
  
  const hasActiveRides = activeRides.length > 0;
  const hasCompletedRides = completedRides.length > 0;
  
  if (!driver || !vehicle) return null;

  const renderContent = () => (
    <>
      <CardHeader>
        <CardTitle className="flex items-start justify-between">
            <div className='flex items-center gap-3'>
              <Avatar>
                <AvatarImage src={`https://i.pravatar.cc/40?u=${driver.id}`} />
                <AvatarFallback>{driver.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className='flex flex-col gap-1'>
                <span className="font-semibold">{formatUserName(driver.name)}</span>
                 <div className='flex items-center gap-4 text-xs text-muted-foreground'>
                    <div className='flex items-center gap-1.5'>
                        <Car />
                        <span>{vehicle.nickname}</span>
                    </div>
                 </div>
              </div>
            </div>
            <div className='flex gap-1 relative'>
                {onOpenChat && (
                    <Button variant="outline" size="icon" onClick={onOpenChat} className="relative">
                        <MessageSquare />
                        {unreadCount > 0 && (
                            <Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 justify-center p-0">{unreadCount}</Badge>
                        )}
                    </Button>
                )}
                 <AlertDialog>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled>
                            <DollarSign /> Total Fare: ${shift.totalFare.toFixed(2)}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onEditShift(shift)}>
                           <Edit /> Edit Shift
                        </DropdownMenuItem>
                         <DropdownMenuItem onSelect={() => onEditShift(shift)}>
                            <FileText /> Shift Notes
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onEditVehicle(vehicle)}>
                            <Car /> Vehicle Notes
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <AlertDialogTrigger asChild>
                            <DropdownMenuItem className="text-destructive" onSelect={(e) => e.preventDefault()} disabled={hasActiveRides}>
                              <PowerOff /> End Shift
                            </DropdownMenuItem>
                        </AlertDialogTrigger>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                          <AlertDialogDescription>
                           This action will end the shift for "{driver.name}".
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onEndShift(shift)}>
                            Confirm End Shift
                          </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-2 p-2">
        {hasActiveRides && (
          activeRides.map(ride => (
            <RideCard
              key={ride.id}
              ride={ride}
              shifts={allShifts}
              onAssignDriver={onAssignDriver}
              onChangeStatus={onChangeStatus}
              onSetFare={onSetFare}
              onUnassignDriver={onUnassignDriver}
              onEdit={onEditRide}
              onUnschedule={onUnscheduleRide}
              onToggleStar={onToggleStar}
            />
          ))
        )}
        
        {showCompleted && hasCompletedRides && (
          <div className={cn(hasActiveRides && 'pt-4 mt-4 border-t')}>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              Completed Rides
            </h4>
            <div className="space-y-2">
              {completedRides.map(ride => (
                <RideCard
                  key={ride.id}
                  ride={ride}
                  shifts={allShifts}
                  onAssignDriver={onAssignDriver}
                  onChangeStatus={onChangeStatus}
                  onSetFare={onSetFare}
                  onUnassignDriver={onUnassignDriver}
                  onEdit={onEditRide}
                  onUnschedule={onUnscheduleRide}
                  onToggleStar={onToggleStar}
                />
              ))}
            </div>
          </div>
        )}
        
        {!hasActiveRides && !showCompleted && (
            <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-center text-muted-foreground p-4">
              <p>Available for rides. Drag a pending ride here to assign.</p>
            </div>
        )}
        
      </CardContent>
      {hasCompletedRides && (
        <CardFooter className="p-2 mt-auto">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowCompleted(!showCompleted)}>
            {showCompleted ? <ChevronUp/> : <ChevronDown/>}
            {showCompleted ? 'Hide' : 'Show'} Completed ({completedRides.length})
          </Button>
        </CardFooter>
      )}
    </>
  );

  if (isMobile) {
    return (
      <div className="w-full shrink-0 flex flex-col space-y-4">
        <Card>
          {renderContent()}
        </Card>
      </div>
    );
  }

  return (
    <>
    <StrictModeDroppable droppableId={`shift-${shift.id}`} isDropDisabled={driver.status === 'offline'}>
      {(provided, snapshot) => (
        <Card
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={cn(
            "shrink-0 flex flex-col",
            snapshot.isDraggingOver && "bg-primary/20",
            driver.status === 'offline' && "bg-muted/50",
            className
          )}
        >
          {renderContent()}
          {provided.placeholder}
        </Card>
      )}
    </StrictModeDroppable>
    </>
  );
}
