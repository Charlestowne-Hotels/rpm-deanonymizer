import {
  collection, query, where, getDocs, doc, getDoc, setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Property, UserProfile } from '../types';
import type { MonthState } from './types';

/**
 * Properties the user may open.
 * Admins see every property in the org; everyone else sees only assigned IDs.
 */
export async function listAccessibleProperties(profile: UserProfile): Promise<Property[]> {
  if (profile.role === 'admin') {
    const snap = await getDocs(query(collection(db, 'properties'), where('orgId', '==', profile.orgId)));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Property, 'id'>) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const ids = profile.properties || [];
  if (ids.length === 0) return [];
  // Fetch each assigned property doc directly (avoids the 'in' query's 10-ID cap).
  const results = await Promise.all(
    ids.map(async (id) => {
      const s = await getDoc(doc(db, 'properties', id));
      return s.exists() ? ({ id: s.id, ...(s.data() as Omit<Property, 'id'>) }) : null;
    }),
  );
  return results
    .filter((p): p is Property => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Single property's metadata (for the tool header). */
export async function getProperty(propertyId: string): Promise<Property | null> {
  const s = await getDoc(doc(db, 'properties', propertyId));
  return s.exists() ? ({ id: s.id, ...(s.data() as Omit<Property, 'id'>) }) : null;
}

/** Load a saved month, or null if this month hasn't been worked yet. */
export async function loadMonthState(propertyId: string, monthKey: string): Promise<MonthState | null> {
  const s = await getDoc(doc(db, 'properties', propertyId, 'months', monthKey));
  return s.exists() ? (s.data() as MonthState) : null;
}

/**
 * Save one month. Writes only this property+month doc (not a global blob),
 * so concurrent edits to other months/properties can't clobber each other.
 */
export async function saveMonthState(
  propertyId: string, monthKey: string, state: MonthState,
): Promise<void> {
  await setDoc(doc(db, 'properties', propertyId, 'months', monthKey), state);
}
