export const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export interface MetricBlock {
  subject: number; compSet: number; index: number; subjectRank: number; setSize: number;
}
export interface MonthData {
  key: string; month: string; year: number;
  occ: MetricBlock; adr: MetricBlock; revpar: MetricBlock;
}
export interface ParsedStar {
  subjectName: string | null;
  order: string[];
  byMonth: Record<string, MonthData>;
}
export interface RosterEntry { str: string; name: string; rooms: number; }

export interface Hotel {
  id: number; name: string; rooms: number | ''; isSubject: boolean;
  pinOcc: string; pinAdr: string; rankOcc: string; rankAdr: string;
  locked: boolean; lockOcc: number | null; lockAdr: number | null;
}

export interface Bounds { oLo: number; oHi: number; aLo: number; aHi: number; }

export interface Solution {
  occ: Record<number, number>;
  adr: Record<number, number>;
  warn: string[];
  tie: boolean;
  blendOcc?: number;
  blendAdr?: number;
}

export interface HotelRow {
  id: number; name: string; isSubject: boolean;
  rooms: number; avail: number; occ: number; sold: number;
  adr: number; rev: number; revpar: number;
  occIdx: number; adrIdx: number; rpi: number;
  occRk: number; adrRk: number; rgiRk: number;
}
export interface StrRow {
  label: string; rooms: number; avail: number; occ: number;
  sold: number; adr: number; rev: number; revpar: number; idx: boolean;
}
export interface Rows { hs: HotelRow[]; strRow: StrRow; D: number; }

// Persisted per-month shape: properties/{propertyId}/months/{monthKey}
export interface MonthState {
  locked: boolean;
  limits: { oLo: number; oHi: number; aLo: number; aHi: number; zoom: number };
  hotels: Array<{
    name: string; rooms: number | '';
    pinOcc: string; pinAdr: string; rankOcc: string; rankAdr: string;
    locked: boolean; lockOcc: number | null; lockAdr: number | null;
  }>;
}
