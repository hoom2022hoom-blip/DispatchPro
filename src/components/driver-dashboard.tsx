

"use client";
import { activeRideStatuses } from "@/lib/ride-status";

import React, { useState, useMemo, useEffect } from 'react';
import type { Ride, Driver, Message, Shift, AppUser } from '@/lib/types';
import { DISPATCHER_ID, dispatcherUser } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DriverRideCard } from './driver-ride-card';
import { CheckCircle, MessageCircle, LogOut, Users, X, ShieldCheck } from 'lucide-react';
import { Separator } from './ui/separator';
import { ResponsiveDialog } from './responsive-dialog';
import { DriverEditForm } from './driver-edit-form';
import { ChatView } from './chat-view';
import { Button } from './ui/button';
import { useAuth } from '@/context/auth-context';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, where, doc, updateDoc, addDoc, serverTimestamp, getDoc, Timestamp, orderBy, writeBatch, or, getDocs } from 'firebase/firestore';
import { sendBrowserNotification } from '@/lib/notifications';
import { formatUserName, getThreadIds } from '@/lib/utils';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { toggleStarMessage } from '@/app/actions';


function DriverChatListDialog({ drivers, onSelectDriver, onSelectDispatch, onClose }: { drivers: Driver[], onSelectDriver: (driver: Driver) => void, onSelectDispatch: () => void, onClose: () => void }) {
    return (
        <ResponsiveDialog open={true} onOpenChange={(isOpen) => !isOpen && onClose()} title="New Chat">
            <ScrollArea className="h-[60vh] p-2">
                <div className="space-y-2">
                 <Button variant="ghost" className="w-full justify-start h-14" onClick={onSelectDispatch}>
                     <Avatar className="h-10 w-10 mr-4">
                        <AvatarFallback><MessageCircle /></AvatarFallback>
                    </Avatar>
                    <span className="text-left font-semibold">Dispatch Log</span>
                </Button>
                <Separator />
                {drivers.map(driver => (
                    <Button key={driver.id} variant="ghost" className="w-full justify-start h-14" onClick={() => onSelectDriver(driver)}>
                         <Avatar className="h-10 w-10 mr-4">
                            <AvatarImage src={`https://i.pravatar.cc/40?u=${driver.id}`} />
                            <AvatarFallback>{(driver.name || '')[0] || 'D'}</AvatarFallback>
                        </Avatar>
                        <span className="text-left">{formatUserName(driver.name)}</span>
                    </Button>
                ))}
                </div>
            </ScrollArea>
        </ResponsiveDialog>
    )
}

export function DriverDashboard() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [currentDriver, setCurrentDriver] = useState<Driver | null>(null);
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editingRide, setEditingRide] = useState<Ride | null>(null);
  
  const [chatParticipant, setChatParticipant] = useState<Driver | AppUser | null>(null);
  const [isDriverListOpen, setIsDriverListOpen] = useState(false);
  
  const { user, logout } = useAuth();
  
  const toDate = (ts: any) => ts instanceof Timestamp ? ts.toDate() : ts;
  
  const prevRidesRef = React.useRef<Ride[]>([]);
  const prevMessagesRef = React.useRef<Message[]>([]);

  useEffect(() => {
    prevRidesRef.current = rides;
    prevMessagesRef.current = messages;
  }, [rides, messages]);

  useEffect(() => {
    if (!("Notification" in window)) {
      console.log("This browser does not support desktop notification");
    } else if (Notification.permission === "default") {
        Notification.requestPermission();
    }
  }, []);
  
  useEffect(() => {
    if (!user) return;

    const driversQuery = query(collection(db, "drivers"));
    const driversUnsub = onSnapshot(driversQuery, (snapshot) => {
        setAllDrivers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Driver)));
    });

    const usersQuery = query(collection(db, "users"));
    const usersUnsub = onSnapshot(usersQuery, (snapshot) => {
        setAllUsers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as AppUser)));
    });

    const driverRef = doc(db, "drivers", user.uid);
    const unsubDriver = onSnapshot(driverRef, (doc) => {
        if (doc.exists()) {
            setCurrentDriver({ ...doc.data(), id: doc.id } as Driver);
        } else {
            setCurrentDriver(null);
        }
    });

    return () => {
        driversUnsub();
        usersUnsub();
        unsubDriver();
    };
  }, [user]);

  useEffect(() => {
    if (!currentDriver || !currentDriver.currentShiftId) {
      setRides([]);
      return;
    }

    const ridesQuery = query(collection(db, "rides"), where("shiftId", "==", currentDriver.currentShiftId));
    const ridesUnsub = onSnapshot(ridesQuery, (snapshot) => {
        const newRides = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id,
            createdAt: toDate(doc.data().createdAt),
            updatedAt: toDate(doc.data().updatedAt),
            scheduledTime: doc.data().scheduledTime ? toDate(doc.data().scheduledTime) : undefined,
            assignedAt: doc.data().assignedAt ? toDate(doc.data().assignedAt) : undefined,
            pickedUpAt: doc.data().pickedUpAt ? toDate(doc.data().pickedUpAt) : undefined,
            droppedOffAt: doc.data().droppedOffAt ? toDate(doc.data().droppedOffAt) : undefined,
            cancelledAt: doc.data().cancelledAt ? toDate(doc.data().cancelledAt) : undefined,
        } as Ride));
        
        const newlyAssignedRide = newRides.find(nr => 
            nr.status === 'assigned' &&
            !prevRidesRef.current.some(pr => pr.id === nr.id)
        );

        if (newlyAssignedRide) {
            sendBrowserNotification(
                "New ride assigned!", 
                `Pickup at: ${newlyAssignedRide.pickup.name}`
            );
        }
        setRides(newRides);
    });

    const messagesQuery = query(
      collection(db, 'messages'),
      where('threadId', 'array-contains', currentDriver.id)
    );

    const unsubMessages = onSnapshot(messagesQuery, (snapshot) => {
      const allMessages = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
        timestamp: toDate(doc.data().timestamp),
      } as Message));

      const newIncomingMessages = allMessages.filter(m => 
          m.recipientId === currentDriver.id && 
          !prevMessagesRef.current.some(pm => pm.id === m.id)
      );

      if (newIncomingMessages.length > 0) {
          const lastMessage = newIncomingMessages.sort((a,b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))[0];
          let sender;
          let senderName;
          
          if (lastMessage.senderId === DISPATCHER_ID) {
              senderName = "Dispatcher";

          } else {
              // Try to find in drivers first, then users
              sender = allDrivers.find(d => d.id === lastMessage.senderId) || 
                       allUsers.find(u => u.id === lastMessage.senderId);
              if (!sender) {
                  senderName = "Unknown User";
              } else {
                  senderName = formatUserName(sender.name, (sender as AppUser)?.email);
              }
          }

          sendBrowserNotification(
              `New message from ${senderName}`,
              lastMessage.text || "Sent an image or audio"
          );
      }
      
      const sortedMessages = allMessages
        .filter(m => m.timestamp)
        .sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0));
        
      setMessages(sortedMessages);
    });


    return () => {
        ridesUnsub();
        unsubMessages();
    }
  }, [currentDriver]);


  const driverRides = useMemo(() => {
    if (!currentDriver) return [];
    return rides
      .filter(r => activeRideStatuses.includes(r.status))
      .sort((a, b) => {
        if (a.status === 'in-progress') return -1;
        if (b.status === 'in-progress') return 1;
        return (a.assignedAt?.getTime() ?? 0) - (b.assignedAt?.getTime() ?? 0);
      });
  }, [rides, currentDriver]);

  const completedRides = useMemo(() => {
    if (!currentDriver) return [];
    return rides
      .filter(r => r.driverId === currentDriver.id && r.status === 'completed')
      .sort((a,b) => (b.droppedOffAt?.getTime() ?? 0) - (a.droppedOffAt?.getTime() ?? 0));
  }, [rides, currentDriver]);

  const currentRide = useMemo(() => {
    return driverRides.find(r => r.status === 'in-progress') || driverRides[0] || null;
  }, [driverRides]);
  
  const upcomingRides = useMemo(() => {
    return driverRides.filter(r => r.id !== currentRide?.id)
  }, [driverRides, currentRide]);

  const { p2pMessages, dispatchLogMessages } = useMemo(() => {
    if (!currentDriver) return { p2pMessages: [], dispatchLogMessages: [] };

    const p2p: Message[] = [];
    const dispatchLog: Message[] = [];
    
    messages.forEach(m => {
        if (!m.threadId || m.threadId.length !== 2) return;
        
        if (m.threadId.includes(DISPATCHER_ID)) {
          dispatchLog.push(m);
        } else if (m.threadId.includes(currentDriver.id)) {
          p2p.push(m);
        }
    });

    return { p2pMessages: p2p, dispatchLogMessages: dispatchLog };
  }, [messages, currentDriver]);

  const unreadP2PCount = useMemo(() => {
    if(!currentDriver) return 0;
    return p2pMessages.filter(m => m.recipientId === currentDriver.id && !m.isReadBy?.includes(currentDriver.id)).length;
  }, [p2pMessages, currentDriver]);

  const unreadDispatchLogCount = useMemo(() => {
    if (!currentDriver) return 0;
    // A message in the dispatch log is unread if the driver has not read it.
    return dispatchLogMessages.filter(m => !m.isReadBy?.includes(currentDriver.id)).length;
  }, [dispatchLogMessages, currentDriver]);


  
  const handleEditRide = async (rideId: string, details: { cashTip?: number; notes?: string }) => {
    const rideToUpdate = rides.find(ride => ride.id === rideId);
    if (!rideToUpdate) return;
    
    const newPaymentDetails = { 
        ...(rideToUpdate.paymentDetails || {}), 
        cashTip: details.cashTip ?? null 
    };
    const newNotes = details.notes;

    await updateDoc(doc(db, 'rides', rideId), {
        notes: newNotes,
        paymentDetails: newPaymentDetails,
        updatedAt: serverTimestamp()
    });

    setEditingRide(null);
  };
  
  const handleOpenEdit = (ride: Ride) => {
    setEditingRide(ride);
  }

  const handleSendMessage = async (message: Omit<Message, 'id' | 'timestamp' | 'isReadBy'>) => {
    if (!currentDriver) return;
    await addDoc(collection(db, 'messages'), {
        ...message,
        timestamp: serverTimestamp(),
        isReadBy: [currentDriver.id],
    });
  };
  
  const openChatWith = async (participant: Driver | AppUser) => {
    if(!currentDriver) return;

    setChatParticipant(participant);
    const threadId = getThreadIds(currentDriver.id, participant.id);
    
    const messagesToMarkQuery = query(
        collection(db, 'messages'),
        where('threadId', '==', threadId)
    );
    const batch = writeBatch(db);
    const snapshot = await getDocs(messagesToMarkQuery);
    
    snapshot.forEach(docSnapshot => {
        const msg = docSnapshot.data() as Message;
        if (!msg.isReadBy?.includes(currentDriver.id)) {
            batch.update(docSnapshot.ref, { isReadBy: [...(msg.isReadBy || []), currentDriver.id] });
        }
    });
    
    if (snapshot.size > 0) {
        await batch.commit();
    }
  };

  const handleSelectDriverToChat = (driver: Driver) => {
      setIsDriverListOpen(false);
      openChatWith(driver);
  }
  
  const handleSelectDispatchToChat = () => {
    setIsDriverListOpen(false);
    openChatWith(dispatcherUser);
  }

  if (!currentDriver) {
    return (
      <div className="flex h-full items-center justify-center bg-secondary p-4 text-center">
        <Card>
          <CardHeader>
            <CardTitle>Driver Profile Not Found</CardTitle>
            <CardDescription>We could not find a driver profile associated with your account ({user?.email}). Please contact your dispatcher.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={logout}>
              <LogOut className="mr-2"/> Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-secondary/50">
      <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24">
        <div className="mx-auto max-w-2xl space-y-6">
            {!currentRide && completedRides.length === 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Ready for a New Ride</CardTitle>
                        <CardDescription>You have no assigned rides right now. You will be notified when a new ride is dispatched to you.</CardDescription>
                    </CardHeader>
                </Card>
            ) : (
                <>
                {currentRide && (
                    <div>
                        <h2 className="text-lg font-semibold mb-2">{currentRide.status === 'in-progress' ? 'Current Ride' : 'Next Ride'}</h2>
                        <DriverRideCard 
                            ride={currentRide}
                            onEdit={handleOpenEdit}
                        />
                    </div>
                )}

                {upcomingRides.length > 0 && (
                    <div>
                        <Separator className="my-6" />
                        <h2 className="text-lg font-semibold mb-2">Upcoming Queue ({upcomingRides.length})</h2>
                        <div className="space-y-4">
                            {upcomingRides.map(ride => (
                                <DriverRideCard 
                                    key={ride.id}
                                    ride={ride}
                                    isQueued={true}
                                    onEdit={handleOpenEdit}
                                />
                            ))}
                        </div>
                    </div>
                )}
                </>
            )}

            {completedRides.length > 0 && (
                 <div>
                    <Separator className="my-6" />
                    <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                        <CheckCircle />
                        Completed Today ({completedRides.length})
                    </h2>
                    <div className="space-y-4">
                        {completedRides.map(ride => (
                            <DriverRideCard 
                                key={ride.id}
                                ride={ride}
                                onEdit={handleOpenEdit}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
      </main>

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-3">
          <Button
            variant="secondary"
            size="lg"
            className="h-14 w-14 rounded-full shadow-lg p-0 relative"
            onClick={() => setIsDriverListOpen(true)}
          >
            <Users className="h-7 w-7" />
            <span className="sr-only">Chat with other drivers</span>
            {unreadP2PCount > 0 && (
              <Badge variant="destructive" className="absolute -top-1 -right-1 h-6 w-6 justify-center p-0">{unreadP2PCount}</Badge>
            )}
          </Button>
          <Button
            variant="default"
            size="lg"
            className="h-16 w-16 rounded-full shadow-lg p-0 relative"
            onClick={() => openChatWith(dispatcherUser)}
          >
            <MessageCircle className="h-8 w-8" />
            {unreadDispatchLogCount > 0 && (
              <Badge variant="destructive" className="absolute -top-1 -right-1 h-6 w-6 justify-center p-0">{unreadDispatchLogCount}</Badge>
            )}
            <span className="sr-only">Open Chat with Dispatch</span>
          </Button>

      </div>

      
      <ResponsiveDialog
        open={!!editingRide}
        onOpenChange={(isOpen) => !isOpen && setEditingRide(null)}
        title="Add Ride Details"
      >
        {editingRide && (
             <DriverEditForm 
                key={editingRide.id}
                ride={editingRide}
                onSave={handleEditRide}
             />
        )}
      </ResponsiveDialog>
      
      {isDriverListOpen && (
          <DriverChatListDialog 
            drivers={allDrivers.filter(d => d.id !== currentDriver.id)}
            onSelectDriver={handleSelectDriverToChat}
            onSelectDispatch={handleSelectDispatchToChat}
            onClose={() => setIsDriverListOpen(false)}
          />
      )}

      {chatParticipant && currentDriver && (
        <ResponsiveDialog
            open={!!chatParticipant}
            onOpenChange={(isOpen) => !isOpen && setChatParticipant(null)}
            title={`Chat with ${formatUserName(chatParticipant.name, (chatParticipant as AppUser).email)}`}
        >
          <ChatView
            participant={chatParticipant}
            messages={
              chatParticipant.id === DISPATCHER_ID 
                ? dispatchLogMessages 
                : p2pMessages.filter(m => m.threadId?.includes(currentDriver.id) && m.threadId?.includes(chatParticipant.id))
            }
            allDrivers={allDrivers}
            onSendMessage={handleSendMessage}
            onToggleStar={toggleStarMessage}
            threadId={
              chatParticipant.id === DISPATCHER_ID 
                ? getThreadIds(currentDriver.id, DISPATCHER_ID)
                : getThreadIds(currentDriver.id, chatParticipant.id)
            }
          />
      </ResponsiveDialog>
      )}

    </div>
  );
}
