import 'server-only';
import { cookies } from 'next/headers';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from './firebase-admin';

// Legacy Firebase administration is separate from the tenant-scoped office API.
// Never accept a browser-supplied user ID, profile role or office JWT as authority.
async function verifiedSession(): Promise<DecodedIdToken | null> {
  if (process.env.NEXT_PUBLIC_RECEPTION_BACKEND === 'api' ||
      !adminAuth) return null;
  try {
    const session = (await cookies()).get('__session')?.value;
    if (!session) return null;
    const identity = await adminAuth.verifySessionCookie(session, true);
    return identity;
  } catch {
    // Missing, expired, revoked and disabled-user sessions all fail closed.
    return null;
  }
}

export async function authorizeLegacyAdmin(): Promise<{uid:string}|null> {
  if (process.env.ENABLE_LEGACY_ADMIN_ACTIONS !== 'true') return null;
  const identity = await verifiedSession();
  return identity && (identity.admin === true || identity.superAdmin === true) ? {uid:identity.uid} : null;
}

export async function authorizeLegacyUser(): Promise<{uid:string}|null> {
  if (process.env.ENABLE_LEGACY_SERVER_ACTIONS !== 'true') return null;
  const identity = await verifiedSession();
  return identity ? {uid:identity.uid} : null;
}
