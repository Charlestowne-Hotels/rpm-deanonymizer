import {
  collection, query, where, getDocs, doc, getDoc, setDoc, writeBatch, deleteField,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Property, UserProfile } from '../types';
import type { MonthState, MonthData, ParsedStar } from './types';
import { MON } from './types';

/* ============ properties access (unchanged) ============ */
export async function listAccessibleProperties(profile: UserProfile): Promise<Property[]> {
  if (profile.role === 'admin') {
    const snap = await getDocs(query(collection(db, 'properties'), where('orgId', '==', profile.orgId)));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Property, 'id'>) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const ids = profile.properties || [];
  if (ids.length === 0) return [];
  const results = await Promise.all(
    ids.map(async (id) => {
      const s = await getDoc(doc(db, 'properties', id));
      return s.exists() ? ({ id: s.id, ...(s.data() as Omit<Property, 'id'>) }) : null;
    }),
  );
  return results.filter((p): p is Property => p !== null).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProperty(propertyId: string): Promise<Property | null> {
  const s = await getDoc(doc(db, 'properties', propertyId));
  return s.exists() ? ({ id: s.id, ...(s.data() as Omit<Property, 'id'>) }) : null;
}

/* ============ per-month WORKING STATE ============ */

/**
 * Returns saved working state only. A month doc that holds a report but no
 * saved pins (hotels) returns null, so the tool falls back to defaults.
 */
export async function loadMonthState(propertyId: string, monthKey: string): Promise<MonthState | null> {
  const s = await getDoc(doc(db, 'properties', propertyId, 'months', monthKey));
  if (!s.exists()) return null;
  const data = s.data() as Partial<MonthState>;
  if (!Array.isArray(data.hotels)) return null; // report-only doc, no working state yet
  return { locked: !!data.locked, limits: data.limits!, hotels: data.hotels };
}

/**
 * Save working state. MERGE so report fields in the same doc survive.
 */
export async function saveMonthState(propertyId: string, monthKey: string, state: MonthState): Promise<void> {
  await setDoc(doc(db, 'properties', propertyId, 'months', monthKey), state, { merge: true });
}

/* ============ accumulated REPORT library ============ */

interface MonthDoc {
  report?: MonthData;
  subjectName?: string;
  reportConflict?: boolean;
  reportConflictWith?: MonthData;
}

export interface ConflictInfo { monthKey: string; }
export interface UploadResult { added: string[]; conflicts: string[]; unchanged: string[]; }

const sortKey = (m: MonthData) => m.year * 100 + MON.indexOf(m.month);

/** Reconstruct a ParsedStar from stored month docs. Null if no report stored yet. */
export async function loadReportLibrary(propertyId: string): Promise<ParsedStar | null> {
  const snap = await getDocs(collection(db, 'properties', propertyId, 'months'));
  const byMonth: Record<string, MonthData> = {};
  let subjectName: string | null = null;
  snap.docs.forEach((d) => {
    const data = d.data() as MonthDoc;
    if (data.report) {
      byMonth[d.id] = data.report;
      if (!subjectName && data.subjectName) subjectName = data.subjectName;
    }
  });
  const keys = Object.keys(byMonth);
  if (keys.length === 0) return null;
  const order = keys.sort((a, b) => sortKey(byMonth[a]) - sortKey(byMonth[b]));
  return { subjectName, order, byMonth };
}

/** Which months currently carry an unresolved conflict flag. */
export async function listConflicts(propertyId: string): Promise<string[]> {
  const snap = await getDocs(collection(db, 'properties', propertyId, 'months'));
  return snap.docs.filter((d) => (d.data() as MonthDoc).reportConflict).map((d) => d.id);
}

const EPS = 0.05;
function reportsDiffer(a: MonthData, b: MonthData): boolean {
  const pairs: [number, number][] = [
    [a.occ.subject, b.occ.subject], [a.occ.compSet, b.occ.compSet], [a.occ.subjectRank, b.occ.subjectRank],
    [a.adr.subject, b.adr.subject], [a.adr.compSet, b.adr.compSet], [a.adr.subjectRank, b.adr.subjectRank],
    [a.revpar.compSet, b.revpar.compSet],
  ];
  return pairs.some(([x, y]) => {
    if (!isFinite(x) && !isFinite(y)) return false;
    if (!isFinite(x) || !isFinite(y)) return true;
    return Math.abs(x - y) > EPS;
  });
}

/**
 * Accumulate an uploaded report. KEEP EXISTING months; for any month already
 * stored, if the upload's numbers differ, flag a conflict (and stash the
 * uploaded values for later review) without overwriting the stored report.
 */
export async function saveUploadedReport(propertyId: string, parsed: ParsedStar): Promise<UploadResult> {
  const existingSnap = await getDocs(collection(db, 'properties', propertyId, 'months'));
  const existing = new Map<string, MonthDoc>();
  existingSnap.docs.forEach((d) => existing.set(d.id, d.data() as MonthDoc));

  const batch = writeBatch(db);
  const added: string[] = [], conflicts: string[] = [], unchanged: string[] = [];
  const subjectName = parsed.subjectName || '';

  parsed.order.forEach((key) => {
    const incoming = parsed.byMonth[key];
    const ref = doc(db, 'properties', propertyId, 'months', key);
    const prior = existing.get(key);
    if (!prior || !prior.report) {
      batch.set(ref, { report: incoming, subjectName }, { merge: true });
      added.push(key);
    } else if (reportsDiffer(prior.report, incoming)) {
      batch.set(ref, { reportConflict: true, reportConflictWith: incoming }, { merge: true });
      conflicts.push(key);
    } else {
      unchanged.push(key);
    }
  });

  await batch.commit();
  return { added, conflicts, unchanged };
}

/** Resolve a conflict by KEEPING the stored report (just clears the flag). */
export async function resolveKeepStored(propertyId: string, monthKey: string): Promise<void> {
  await setDoc(doc(db, 'properties', propertyId, 'months', monthKey),
    { reportConflict: deleteField(), reportConflictWith: deleteField() }, { merge: true });
}

/** Resolve by REPLACING the stored report with the uploaded values. */
export async function resolveUseUploaded(propertyId: string, monthKey: string): Promise<void> {
  const ref = doc(db, 'properties', propertyId, 'months', monthKey);
  const s = await getDoc(ref);
  const data = s.exists() ? (s.data() as MonthDoc) : null;
  if (!data?.reportConflictWith) return;
  await setDoc(ref, {
    report: data.reportConflictWith,
    reportConflict: deleteField(),
    reportConflictWith: deleteField(),
  }, { merge: true });
}
