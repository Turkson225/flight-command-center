import { useCallback, useEffect, useState } from 'react';
import type { Auth } from 'firebase/auth';
import type { Database } from 'firebase/database';

export interface FirebaseSessionUser {
  uid: string;
  email: string | null;
}

export interface FirebaseSession {
  configured: boolean;
  authLoading: boolean;
  user: FirebaseSessionUser | null;
  database: Database | null;
  aircraftId: string;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
}

const appName = 'flight-command-center';
const aircraftId = import.meta.env.VITE_FIREBASE_AIRCRAFT_ID?.trim() || 'FD-X1';
const configuration = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim(),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL?.trim(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim(),
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim(),
};
const configured = Object.values(configuration).every(Boolean) && /^[A-Za-z0-9_-]{1,40}$/.test(aircraftId);

interface FirebaseServices {
  auth: Auth;
  database: Database;
  authApi: typeof import('firebase/auth');
}

let servicesPromise: Promise<FirebaseServices> | null = null;

function firebaseServices(): Promise<FirebaseServices> {
  if (!servicesPromise) {
    servicesPromise = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/database'),
    ]).then(([appApi, authApi, databaseApi]) => {
      const app = appApi.getApps().find(candidate => candidate.name === appName)
        ?? appApi.initializeApp(configuration, appName);
      return {
        auth: authApi.getAuth(app),
        database: databaseApi.getDatabase(app),
        authApi,
      };
    }).catch(error => {
      servicesPromise = null;
      throw error;
    });
  }
  return servicesPromise;
}

function safeAuthMessage(error: unknown): string {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
  switch (code) {
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Check your email and password, then try again.';
    case 'auth/too-many-requests': return 'Too many attempts. Please try again later.';
    case 'auth/network-request-failed': return 'Network unavailable. Check your connection and try again.';
    case 'auth/user-disabled': return 'This account is disabled. Contact the Firebase project owner.';
    default: return 'Firebase authentication is unavailable. Please try again.';
  }
}

/** A signed-in owner's browser may subscribe to telemetry permitted by RTDB rules. */
export function useFirebaseSession(): FirebaseSession {
  const [firebase, setFirebase] = useState<FirebaseServices | null>(null);
  const [user, setUser] = useState<FirebaseSessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(configured);
  const [error, setError] = useState<string | null>(
    configured || !Object.values(configuration).every(Boolean)
      ? null
      : 'Invalid aircraft ID in Firebase configuration.',
  );

  useEffect(() => {
    if (!configured) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void firebaseServices().then(firebase => {
      if (!active) return;
      setFirebase(firebase);
      unsubscribe = firebase.authApi.onAuthStateChanged(
        firebase.auth,
        firebaseUser => {
          if (!active) return;
          setUser(firebaseUser ? { uid: firebaseUser.uid, email: firebaseUser.email } : null);
          setAuthLoading(false);
        },
        authError => {
          if (!active) return;
          setUser(null);
          setError(safeAuthMessage(authError));
          setAuthLoading(false);
        },
      );
    }).catch(() => {
      if (!active) return;
      setError('Firebase configuration could not be initialized.');
      setAuthLoading(false);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<void> => {
    if (!firebase) {
      const message = configured ? 'Firebase sign-in is not ready.' : 'Firebase is not configured.';
      setError(message);
      throw new Error(message);
    }
    setError(null);
    try {
      await firebase.authApi.signInWithEmailAndPassword(firebase.auth, email.trim(), password);
    } catch (authError) {
      const message = safeAuthMessage(authError);
      setError(message);
      throw new Error(message);
    }
  }, [firebase]);

  const signOut = useCallback(async (): Promise<void> => {
    if (!firebase) {
      const message = 'Firebase sign-out is not ready.';
      setError(message);
      throw new Error(message);
    }
    setError(null);
    try {
      await firebase.authApi.signOut(firebase.auth);
    } catch (authError) {
      const message = safeAuthMessage(authError);
      setError(message);
      throw new Error(message);
    }
  }, [firebase]);

  return { configured, authLoading, user, database: firebase?.database ?? null, aircraftId, signIn, signOut, error };
}
