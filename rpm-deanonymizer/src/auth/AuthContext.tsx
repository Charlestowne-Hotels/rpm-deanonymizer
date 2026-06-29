import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import type { UserProfile, Role } from '../lib/types';

const ORG_ID = 'charlestowne';

interface AuthState {
  firebaseUser: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

async function loadOrCreateProfile(user: User): Promise<UserProfile> {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { uid: user.uid, ...(snap.data() as Omit<UserProfile, 'uid'>) };
  }
  // First-login bootstrap. MUST satisfy the Firestore create rule:
  // role === 'none' AND properties.size() === 0.
  const fresh: Omit<UserProfile, 'uid'> = {
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    orgId: ORG_ID,
    role: 'none' as Role,
    properties: [],
    createdAt: Date.now(),
  };
  await setDoc(ref, fresh);
  return { uid: user.uid, ...fresh };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      setFirebaseUser(user);
      if (user) {
        try {
          setProfile(await loadOrCreateProfile(user));
        } catch (e) {
          console.error('Failed to load profile', e);
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const signIn = async () => {
    await signInWithPopup(auth, googleProvider);
  };
  const signOut = async () => {
    await fbSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ firebaseUser, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function hasAccess(profile: UserProfile | null): boolean {
  if (!profile) return false;
  return profile.role === 'admin' || profile.properties.length > 0;
}
