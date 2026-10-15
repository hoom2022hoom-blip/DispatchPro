
"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User as FirebaseAuthUser } from 'firebase/auth';
import { onAuthStateChanged, signOut, signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword as firebaseCreateUserWithEmailAndPassword, signInWithEmailAndPassword as firebaseSignInWithEmailAndPassword, getAdditionalUserInfo } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { doc, getDoc, setDoc, serverTimestamp, collection, onSnapshot, query, where, Timestamp, getDocs, updateDoc } from 'firebase/firestore';
import type { AppUser, Driver } from '@/lib/types';
import { Role } from '@/lib/types';

interface AuthContextType {
  user: AppUser | null;
  firebaseUser: FirebaseAuthUser | null;
  allUsers: AppUser[];
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  registerWithGoogle: (inviteCode: string) => Promise<void>;
  signInWithEmailAndPassword: (email: string, pass: string) => Promise<void>;
  createUserWithEmailAndPassword: (email: string, pass: string, inviteCode: string) => Promise<any>;
  logout: () => Promise<void>;
  hasRole: (role: Role) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseAuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Helper to ensure Firebase is properly connected
  const ensureFirebaseConnection = async (): Promise<boolean> => {
    try {
      // Try to get current auth state
      const currentUser = auth.currentUser;
      if (currentUser) {
        // Verify the token is still valid
        await currentUser.getIdToken(true);
        return true;
      }
      return false;
    } catch (error: any) {
      console.warn('Firebase connection issue:', error.message);
      return false;
    }
  };

  const validateInviteCode = async (code: string) => {
    try {
      const invitesQuery = query(
        collection(db, 'invites'),
        where('code', '==', code),
        where('status', '==', 'pending'),
        where('expiresAt', '>', Timestamp.now())
      );
      const inviteSnapshot = await getDocs(invitesQuery);
      if (inviteSnapshot.empty) {
        throw new Error("Invalid or expired invite code.");
      }
      return inviteSnapshot.docs[0];
    } catch (error: any) {
      console.error('Error validating invite code:', error);
      
      if (error.code === 'permission-denied') {
        throw new Error("Unable to validate invite code. Please ensure you're signed in and try again.");
      }
      
      throw error;
    }
  };

  const fetchAppUser = useCallback(async (fbUser: FirebaseAuthUser, retryCount = 0): Promise<AppUser | null> => {
    try {
      // Ensure the user is fully authenticated before making Firestore requests
      if (!fbUser || !fbUser.uid) {
        console.warn('Cannot fetch user data: Firebase user not fully authenticated');
        return null;
      }

      console.log(`Fetching app user data for ${fbUser.uid}, attempt ${retryCount + 1}`);

      // Wait for the ID token to be ready with a fresh token
      const idToken = await fbUser.getIdToken(true);
      console.log(`Got ID token for ${fbUser.uid}:`, {
        tokenExists: !!idToken,
        tokenLength: idToken?.length,
        uid: fbUser.uid,
        emailVerified: fbUser.emailVerified
      });
      
      // Verify token claims
      try {
        const tokenResult = await fbUser.getIdTokenResult(true);
        console.log('Token claims:', {
          authTime: tokenResult.authTime,
          issuedAtTime: tokenResult.issuedAtTime,
          expirationTime: tokenResult.expirationTime,
          claims: tokenResult.claims
        });
      } catch (tokenError) {
        console.warn('Could not get token result:', tokenError);
      }
      
      // Add a small delay to ensure token propagation
      await new Promise(resolve => setTimeout(resolve, 500));

      // Test Firestore connection and auth
      console.log('Testing Firestore connection...');
      console.log('Auth state:', {
        currentUser: auth.currentUser?.uid,
        app: auth.app.name,
        config: {
          projectId: auth.app.options.projectId,
          authDomain: auth.app.options.authDomain
        }
      });
      
      const userDocRef = doc(db, 'users', fbUser.uid);
      console.log(`Attempting to read document: users/${fbUser.uid}`);
      
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        const data = userDoc.data();
        const appUser = {
            ...data,
            id: userDoc.id,
            uid: userDoc.id,
            name: data.displayName,
            displayName: data.displayName
        } as AppUser;

        console.log(`Successfully fetched user data for ${fbUser.uid}:`, appUser);

        // Only create driver profile if user has driver role
        if (appUser.role && (appUser.role & Role.DRIVER)) {
          try {
            const driverDocRef = doc(db, 'drivers', fbUser.uid);
            const driverDoc = await getDoc(driverDocRef);
            if (!driverDoc.exists()) {
              const newDriver: Omit<Driver, 'id'> = {
                name: appUser.displayName || appUser.email || 'Unnamed Driver',
                phoneNumber: appUser.phoneNumber || '',
                rating: 5,
                status: 'offline',
                location: { x: 50, y: 50 },
              };
              await setDoc(driverDocRef, newDriver);
              console.log('Created driver profile for:', fbUser.uid);
            }
          } catch (driverError) {
            console.warn('Error creating driver profile:', driverError);
            // Don't fail the whole auth process if driver profile creation fails
          }
        }
        return appUser;
      } else {
        console.warn(`User document does not exist for ${fbUser.uid}, creating basic user profile`);
        
        // Create a basic user profile for authenticated users who don't have one
        try {
          const basicAppUser: AppUser = {
            uid: fbUser.uid,
            id: fbUser.uid,
            email: fbUser.email,
            displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
            name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
            role: Role.ALL, // Default role - can be updated later by admins
            photoURL: fbUser.photoURL || null,
          };
          
          await setDoc(doc(db, 'users', fbUser.uid), {
            ...basicAppUser,
            createdAt: serverTimestamp(),
          });
          
          console.log(`Created basic user profile for ${fbUser.uid}`);
          return basicAppUser;
        } catch (createError) {
          console.warn(`Could not create basic user profile for ${fbUser.uid}:`, createError);
          return null;
        }
      }
    } catch (error: any) {
      console.error(`Error fetching app user (attempt ${retryCount + 1}):`, error);
      
      // Handle permission errors gracefully
      if (error.code === 'permission-denied' || error.message?.includes('Missing or insufficient permissions')) {
        if (retryCount < 2) {
          console.log(`Retrying fetch for ${fbUser.uid} after permission error (attempt ${retryCount + 1})...`);
          // Wait longer between retries for permission errors
          await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
          return fetchAppUser(fbUser, retryCount + 1);
        }
        
        console.warn(`Permission denied for ${fbUser.uid} after ${retryCount + 1} attempts. This should not happen with proper Firestore rules.`);
        
        // If we still get permission denied after deploying rules, this indicates a deeper issue
        throw new Error(`Authentication failed: User ${fbUser.uid} cannot access Firestore. Please check Firebase rules deployment.`);
      }
      
      // Retry on network or temporary errors
      if (retryCount < 2 && (error.code === 'unavailable' || error.message?.includes('network'))) {
        console.log(`Retrying fetch for ${fbUser.uid} after network error...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return fetchAppUser(fbUser, retryCount + 1);
      }
      
      throw error;
    }
  }, []);
const LOCAL_DEV_MODE = process.env.NODE_ENV === 'development';

  useEffect(() => {
        if (pathname.startsWith('/office') || pathname === '/login' || pathname === '/driver' || (process.env.NEXT_PUBLIC_RECEPTION_BACKEND === 'api' && (pathname === '/' || pathname === '/admin/map'))) {
          setUser(null); setAllUsers([]); setFirebaseUser(null); setLoading(false);
          return;
        }
        if (LOCAL_DEV_MODE) {
      const localUser = {
        uid: 'local-admin',
        id: 'local-admin',
        email: 'admin@taxinablus.local',
        displayName: 'مدير مكتب تكسي نابلس والمهندس',
        name: 'مدير المكتب',
    role: Role.DISPATCHER | Role.ADMIN | Role.OWNER,
        photoURL: null,
      } as AppUser;

      setUser(localUser);
      setAllUsers([localUser]);
      setFirebaseUser(null);
      setLoading(false);

      if (pathname === '/login' || pathname === '/register') {
        router.push('/');
      }

      return;
    }
    let unsubscribeUsers: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (fbUser) => {
      console.log('Auth state changed:', fbUser ? `User ${fbUser.uid} logged in` : 'User logged out');
      setLoading(true);
      
      try {
        if (fbUser) {
          setFirebaseUser(fbUser);
          
          // Try to fetch app user data with timeout
          const timeoutPromise = new Promise<null>((_, reject) => 
            setTimeout(() => reject(new Error('User fetch timeout')), 10000)
          );
          
          const appUser = await Promise.race([
            fetchAppUser(fbUser),
            timeoutPromise
          ]);
          
          setUser(appUser);
          
          // Set up users listener only when authenticated and we have app user data
          if (appUser && !unsubscribeUsers) {
            try {
              unsubscribeUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
                const usersData = snapshot.docs.map(doc => ({
                  id: doc.id,
                  uid: doc.id,
                  ...doc.data()
                } as AppUser));
                setAllUsers(usersData);
              }, (error) => {
                console.warn('Users listener error:', error.message);
                setAllUsers([]);
              });
            } catch (listenerError) {
              console.warn('Failed to set up users listener:', listenerError);
              setAllUsers([]);
            }
          }
          
          // Centralized redirection logic - only if we have valid app user data
          if (appUser && (pathname === '/login' || pathname === '/register')) {
            try {
              const roleParam = searchParams.get('role');
              if (roleParam === 'driver' && (appUser.role & Role.DRIVER)) {
                router.push('/driver');
              } else if (appUser.role & Role.DISPATCHER || appUser.role & Role.ADMIN || appUser.role & Role.OWNER) {
                router.push('/');
              } else if (appUser.role & Role.DRIVER) { // Fallback for driver if no role param
                router.push('/driver');
              } else {
                router.push('/'); // Fallback for users with no specific role
              }
            } catch (routerError) {
              console.warn('Error during redirection:', routerError);
            }
          }
        } else {
          // Clean up when user logs out
          if (unsubscribeUsers) {
            unsubscribeUsers();
            unsubscribeUsers = null;
          }
          setFirebaseUser(null);
          setUser(null);
          setAllUsers([]);
        }
      } catch (error: any) {
        console.error('Error in auth state change handler:', {
          error: error.message,
          code: error.code,
          fbUser: fbUser ? { uid: fbUser.uid, email: fbUser.email } : null,
          timestamp: new Date().toISOString()
        });
        
        // Even on error, keep Firebase user if we have one
        if (fbUser) {
          setFirebaseUser(fbUser);
        } else {
          setFirebaseUser(null);
        }
        setUser(null);
        setAllUsers([]);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      console.log('Cleaning up auth listeners');
      unsubscribeAuth();
      if (unsubscribeUsers) {
        unsubscribeUsers();
      }
    };
  }, [fetchAppUser, pathname, router, searchParams]);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      
      // Wait a bit for the auth state to settle
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const appUser = await fetchAppUser(result.user);

      if (!appUser) {
          // This case is for when a user signs in with Google but isn't in our DB.
          // We sign them out and throw an error to be caught by the form.
          await signOut(auth);
          const error = new Error("Account not found. Please register first.") as any;
          error.code = "auth/user-not-found";
          throw error;
      }
      // Redirection is handled by the onAuthStateChanged effect
    } catch (error: any) {
      console.error("Error signing in with Google", error);
      
      // Handle Firebase-specific errors
      if (error.code === 'permission-denied') {
        const permissionError = new Error("Permission denied. Please try again or contact support.") as any;
        permissionError.code = error.code;
        throw permissionError;
      }
      
      throw error;
    }
  };
  
  const registerWithGoogle = async (inviteCode: string) => {
    const inviteDoc = await validateInviteCode(inviteCode);
    const provider = new GoogleAuthProvider();

    try {
      const result = await signInWithPopup(auth, provider);
       const fbUser = result.user;
       const additionalInfo = getAdditionalUserInfo(result);

       if (additionalInfo?.isNewUser) {
         // Check if a driver with this email already exists
         const driverQuery = query(collection(db, 'drivers'), where('email', '==', fbUser.email));
         const driverSnapshot = await getDocs(driverQuery);

         let role = Role.ALL; // Default role
         if (!driverSnapshot.empty) {
             role = Role.DRIVER; // Assign driver role if email matches
         }

         const newAppUser: AppUser = {
           uid: fbUser.uid,
           id: fbUser.uid,
           email: fbUser.email,
           displayName: fbUser.displayName,
           name: fbUser.displayName,
           role: role, 
           photoURL: fbUser.photoURL,
         };
         await setDoc(doc(db, "users", fbUser.uid), {
             ...newAppUser,
             createdAt: serverTimestamp()
         });
         setUser(newAppUser);
         
         // Mark invite as completed
         await updateDoc(inviteDoc.ref, { status: 'completed', usedBy: fbUser.uid });
       }
      // Redirection is handled by the onAuthStateChanged effect
    } catch (error) {
      console.error("Error registering with Google", error);
      throw error;
    }
  };
  
  const signInWithEmailAndPassword = async (email: string, pass: string) => {
    try {
      const result = await firebaseSignInWithEmailAndPassword(auth, email, pass);
      
      // Wait a bit for the auth state to settle before trying to fetch user data
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Redirection is handled by the onAuthStateChanged effect
    } catch (error: any) {
       console.error("Error signing in with email and password", error);
       
       // Handle specific Firebase errors
       if (error.code === 'permission-denied') {
         const permissionError = new Error("Permission denied. Please check your credentials and try again.") as any;
         permissionError.code = error.code;
         throw permissionError;
       }
       
       throw error;
    }
  };
  
  const createUserWithEmailAndPassword = async (email: string, pass: string, inviteCode: string) => {
    const inviteDoc = await validateInviteCode(inviteCode);
    
    const result = await firebaseCreateUserWithEmailAndPassword(auth, email, pass);
    const fbUser = result.user;
    
    // Check if a driver with this email already exists
    const driverQuery = query(collection(db, 'drivers'), where('email', '==', email));
    const driverSnapshot = await getDocs(driverQuery);

    let role = Role.ALL; // Default role
    if (!driverSnapshot.empty) {
        role = Role.DRIVER; // Assign driver role if email matches
    }
    
    const newAppUser: AppUser = {
        uid: fbUser.uid,
        id: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName, 
        name: fbUser.displayName,
        role: role, 
    };
    await setDoc(doc(db, 'users', fbUser.uid), {
        ...newAppUser,
        createdAt: serverTimestamp(),
    });
    setUser(newAppUser);

    // Mark invite as completed
    await updateDoc(inviteDoc.ref, { status: 'completed', usedBy: fbUser.uid });

    return result;
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setFirebaseUser(null);
      router.push('/login');
    } catch (error) {
      console.error("Error signing out", error);
    }
  };
  
  const hasRole = useCallback((role: Role) => {
    if (!user) return false;
    // Super Admins have all roles
    if ((user.role & Role.SUPER_ADMIN) > 0) return true;
    return (user.role & role) > 0;
  }, [user]);

  const refreshUser = useCallback(async () => {
    if (firebaseUser) {
      console.log('Manually refreshing user data...');
      setLoading(true);
      try {
        const appUser = await fetchAppUser(firebaseUser);
        setUser(appUser);
      } catch (error) {
        console.error('Error refreshing user data:', error);
      } finally {
        setLoading(false);
      }
    }
  }, [firebaseUser, fetchAppUser]);

  return (
    <AuthContext.Provider value={{ user, firebaseUser, allUsers, loading, signInWithGoogle, registerWithGoogle, signInWithEmailAndPassword, createUserWithEmailAndPassword, logout, hasRole, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
