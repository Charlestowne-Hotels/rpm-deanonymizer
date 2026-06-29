import {
  collection, query, where, getDocs, doc, getDoc, setDoc, deleteDoc, deleteField,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Property, UserProfile } from '../types';
import type { MonthState, MonthData, ParsedStar, RosterEntry } from './types';
import { MON } from './types';

/* ============ properties access ============ */
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
export async function loadMonthState(propertyId: string, monthKey: string): Promise<MonthState | null> {
  const s = await getDoc(doc(db, 'properties', propertyId, 'months', monthKey));
  if (!s.exists()) return null;
  const data = s.data() as Partial<MonthState>;
  if (!Array.isArray(data.hotels)) return null;
  return { locked: !!data.locked, limits: data.limits!, hotels: data.hotels };
}

export async function saveMonthState(propertyId: string, monthKey: string, state: MonthState): Promise<void> {
  await setDoc(doc(db, 'properties', propertyId, 'months', monthKey), state, { merge: true });
}

/* ============ report library ============ */
interface MonthDoc {
  report?: MonthData;
  subjectName?: string;
  roster?: RosterEntry[];
  reportConflict?: boolean;
  reportConflictWith?: MonthData;
}

export interface ReportBundle { parsed: ParsedStar; roster: RosterEntry[]; }
export interface UploadResult { added: string[]; conflicts: string[]; unchanged: string[]; }

const sortKey = (m: MonthData) => m.year * 100 + MON.indexOf(m.month);

export async function loadReportLibrary(propertyId: string): Promise<ReportBundle | null> {
  const snap = await getDocs(collection(db, 'properties', propertyId, 'months'));
  const byMonth: Record<string, MonthData> = {};
  let subjectName: string | null = null;
  let roster: RosterEntry[] = [];
  snap.docs.forEach((d) => {
    const data = d.data() as MonthDoc;
    if (data.report) {
      byMonth[d.id] = data.report;
      if (!subjectName && data.subjectName) subjectName = data.subjectName;
      if (roster.length === 0 && Array.isArray(data.roster) && data.roster.length) roster = data.roster;
    }
  });
  const keys = Object.keys(byMonth);
  if (keys.length === 0) return null;
  const order = keys.sort((a, b) => sortKey(byMonth[a]) - sortKey(byMonth[b]));
  return { parsed: { subjectName, order, byMonth }, roster };
}

/** Month keys that have a stored report, newest first. */
export async function listStoredMonths(propertyId: string): Promise<string[]> {
  const snap = await getDocs(collection(db, 'properties', propertyId, 'months'));
  const items = snap.docs
    .filter((d) => (d.data() as MonthDoc).report)
    .map((d) => ({ key: d.id, sk: sortKey((d.data() as MonthDoc).report!) }));
  items.sort((a, b) => b.sk - a.sk);
  return items.map((i) => i.key);
}

/** Delete one upload (its report AND any saved working state). */
export async function deleteMonth(propertyId: string, monthKey: string): Promise<void> {
  await deleteDoc(doc(db, 'properties', propertyId, 'months', monthKey));
}

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

/** Find the most-recent month in a parsed report. */
function mostRecentKey(parsed: ParsedStar): string | null {
  if (!parsed.order.length) return null;
  let key = parsed.order[0];
  let best = sortKey(parsed.byMonth[key]);
  for (const k of parsed.order) {
    const sk = sortKey(parsed.byMonth[k]);
    if (sk > best) { best = sk; key = k; }
  }
  return key;
}

/**
 * Option 1: store ONLY the most-recent month from the upload.
 * Keep-existing on conflict (flag, don't overwrite).
 */
export async function saveUploadedReport(
  propertyId: string, parsed: ParsedStar, roster: RosterEntry[],
): Promise<UploadResult> {
  const key = mostRecentKey(parsed);
  if (!key) return { added: [], conflicts: [], unchanged: [] };

  const incoming = parsed.byMonth[key];
  const subjectName = parsed.subjectName || '';
  const ref = doc(db, 'properties', propertyId, 'months', key);
  const snap = await getDoc(ref);
  const prior = snap.exists() ? (snap.data() as MonthDoc) : null;

  if (!prior || !prior.report) {
    await setDoc(ref, { report: incoming, subjectName, roster }, { merge: true });
    return { added: [key], conflicts: [], unchanged: [] };
  }
  if (reportsDiffer(prior.report, incoming)) {
    await setDoc(ref, { reportConflict: true, reportConflictWith: incoming }, { merge: true });
    return { added: [], conflicts: [key], unchanged: [] };
  }
  return { added: [], conflicts: [], unchanged: [key] };
}

export async function resolveKeepStored(propertyId: string, monthKey: string): Promise<void> {
  await setDoc(doc(db, 'properties', propertyId, 'months', monthKey),
    { reportConflict: deleteField(), reportConflictWith: deleteField() }, { merge: true });
}

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
