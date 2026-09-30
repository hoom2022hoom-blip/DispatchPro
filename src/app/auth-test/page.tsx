"use client";

import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';

export default function AuthTestPage() {
  const { user, firebaseUser, loading, signInWithGoogle, logout, refreshUser } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p>Loading authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Authentication Test</h1>
      
      {!firebaseUser ? (
        <div className="space-y-4">
          <p>Not authenticated</p>
          <Button onClick={signInWithGoogle}>
            Sign in with Google
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 border rounded-lg">
            <h2 className="text-lg font-semibold mb-2">Firebase User</h2>
            <p><strong>UID:</strong> {firebaseUser.uid}</p>
            <p><strong>Email:</strong> {firebaseUser.email}</p>
            <p><strong>Display Name:</strong> {firebaseUser.displayName}</p>
            <p><strong>Email Verified:</strong> {firebaseUser.emailVerified ? 'Yes' : 'No'}</p>
          </div>
          
          {user ? (
            <div className="p-4 border rounded-lg">
              <h2 className="text-lg font-semibold mb-2">App User</h2>
              <p><strong>ID:</strong> {user.id}</p>
              <p><strong>Email:</strong> {user.email}</p>
              <p><strong>Name:</strong> {user.name}</p>
              <p><strong>Role:</strong> {user.role}</p>
            </div>
          ) : (
            <div className="p-4 border rounded-lg bg-yellow-50">
              <h2 className="text-lg font-semibold mb-2">App User</h2>
              <p className="text-yellow-800">No app user data found</p>
            </div>
          )}
          
          <div className="space-x-2">
            <Button onClick={refreshUser} variant="outline">
              Refresh User Data
            </Button>
            <Button onClick={logout} variant="outline">
              Sign Out
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
