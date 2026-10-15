

export type RideStatus = 'pending' | 'waiting' | 'assigned' | 'driver-accepted' | 'driver-arriving' | 'arrived' | 'in-progress' | 'completed' | 'cancelled';

export type DriverStatus = 'available' | 'on-shift' | 'offline';

export type PaymentMethod = 'cash' | 'card' | 'check';

export enum Role {
    ALL = 0,
    DRIVER = 1,
    DISPATCHER = 2,
    OWNER = 4,
    ADMIN = 8,
    SUPER_ADMIN = 16,
}

export const DISPATCHER_ID = 'dispatcher-main';
export const SUPPORT_TICKETS_ID = 'support-tickets-main';

export const dispatcherUser: AppUser = {
    id: DISPATCHER_ID,
    uid: DISPATCHER_ID,
    name: 'Dispatch Log',
    displayName: 'Dispatch Log',
    email: '',
    role: Role.DISPATCHER,
};

export const supportTicketsUser: AppUser = {
    id: SUPPORT_TICKETS_ID,
    uid: SUPPORT_TICKETS_ID,
    name: 'Support Tickets',
    displayName: 'Support Tickets',
    email: '',
    role: Role.SUPER_ADMIN,
};


export type Location = {
  name: string;
  coords: { x: number; y: number };
};

export type UserSettings = {
  sendAssignmentNotifications?: boolean;
}

export type AppUser = {
    uid: string;
    id: string; 
    email: string | null;
    name: string | null;
    displayName?: string | null; // Keep for firebase compatibility, but prefer `name`
    phoneNumber?: string | null;
    defaultAddress?: string | Location;
    role: Role;
    photoURL?: string | null;
    createdAt?: Date;
    disabled?: boolean;
    settings?: UserSettings;
}

export type Driver = {
  id: string;
  name: string;
  phoneNumber: string;
  rating: number;
  status: DriverStatus;
  location: { x: number; y: number };
  currentShiftId?: string | null;
};

export type Vehicle = {
    id: string;
    nickname: string;
    make: string;
    model: string;
    year: number | null;
    vin: string;
    mileage: number | null;
    status: 'active' | 'maintenance' | 'decommissioned';
    currentShiftId: string | null;
    createdAt: Date;
    updatedAt: Date;
    notes?: string;
}

export type Shift = {
    id: string;
    driverId: string;
    vehicleId: string;
    status: 'active' | 'inactive';
    startTime: Date;
    endTime?: Date;
    notes?: string;
}

export type TicketActivity = {
    id: string;
    userId: string;
    timestamp: Date;
    type: 'comment' | 'status_change';
    content: string; 
};

export type MaintenanceTicket = {
    id:string;
    vehicleId: string;
    title: string;
    description: string;
    status: 'open' | 'in-progress' | 'closed';
    priority: 'low' | 'medium' | 'high';
    reportedById: string;
    createdAt: Date;
    updatedAt: Date;
    activity?: TicketActivity[];
}

export type RideTag = 'UNPAID';

export type Ride = {
  backendRideId?: string;
  rideVersion?: number;
  queuedDriverId?: string | null;
  jobPosition?: number | null;
  rideRequestId?: string;
  customerId?: string;
  savedAddressId?: string | null;
  addressText?: string;
  neighborhood?: string;
  street?: string;
  latitude?: number | null;
  longitude?: number | null;
  locationSource?: import('./customer-places').LocationSource;
  receptionVersion?: number;
  id: string;
  callEventId?: string;
  callTimestamp?: string;
  receptionPending?: boolean;
  orderDay?: string;
  orderNumber?: number;
  source?: 'WHATSAPP' | 'LANDLINE_ICALL' | 'MANUAL' | 'CUSTOMER_APP' | 'DRIVER_STREET' | 'OFFICE' | 'LANDLINE' | 'EXTERNAL' | 'BRIDGE';
  pickup: Location;
  totalFare: number | null;
  fareMode?: 'OFFICE_MANUAL'|'DRIVER_MANUAL'|'GPS_METER';
  fareSource?: string|null;
  finalFare?: number|null;
  meterCalculatedFare?: number|null;
  currency?: string;
  distanceKm?: number|null;
  durationSeconds?: number|null;
  waitingSeconds?: number|null;
  fareUpdatedBy?: string|null;
  passengerName?: string;
  addressStatus?: 'default' | 'variable';
  addressType?: 'FIXED' | 'VARIABLE';
  dispatchStatus?: import('./office-dispatch').DispatchStatus;
  rideStatus?: 'REQUESTED'|'SEARCHING_DRIVER'|'DRIVER_ASSIGNED'|'DRIVER_ARRIVING'|'DRIVER_ARRIVED'|'IN_PROGRESS'|'COMPLETED'|'CANCELLED'|'NO_DRIVER_AVAILABLE';
  dispatchMode?: 'MANUAL'|'AUTO_NEAREST'|'HYBRID';
  lastDispatchOutcome?: string | null;
  passengerPhone?: string;
  dropoff?: { name: string; coords?: Location['coords'] };
  stops?: Location[];
  status: RideStatus;
  driverId: string | null; // This will be deprecated in favor of shiftId
  shiftId?: string | null;
  isNew?: boolean;
  passengerCount?: number;
  movingFee: boolean;
  notes?: string;
  tags?: RideTag[];
  paymentDetails?: {
    cash?: number | null;
    card?: number | null;
    check?: number | null;
    tip?: number | null;
    cashTip?: number;
  };
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  scheduledTime?: Date;
  assignedAt?: Date;
  pickedUpAt?: Date;
  droppedOffAt?: Date;
  cancelledAt?: Date;
  completionTime?: Date;
};

export type Message = {
  id: string;
  threadId: string[];
  senderId: string;
  recipientId: string;
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  timestamp: Date;
  isReadBy: string[]; // Array of user IDs who have read the message
  isStarred?: boolean;
};

export type Ban = {
    id: string;
    name?: string;
    phone?: string;
    address?: string;
    reason: string;
    bannedById: string;
    createdAt: Date;
}
