import { MON } from './types';
import type { ParsedStar, MonthData, MetricBlock, RosterEntry } from './types';

type Grid = (string | number | null)[][];

export function parseStarComp(grid: Grid): ParsedStar {
  const cs = (v: unknown) => (v == null ? '' : String(v).trim());
  const cn = (v: unknown) => {
    if (typeof v === 'number') return v;
    const n = parseFloat(cs(v));
    return Number.isFinite(n) ? n : NaN;
  };
  const parseRank = (v: unknown) => {
    const m = cs(v).match(/(\d+)\s*(?:of|\/)\s*(\d+)/i);
    return m ? { rank: +m[1], size: +m[2] } : { rank: 0, size: 0 };
  };

  let labelCol = 1;
  outer: for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[r].length; c++)
      if (cs(grid[r][c]).toLowerCase() === 'my property') { labelCol = c; break outer; }

  const findHdr = (re: RegExp) => {
    for (let r = 0; r < grid.length; r++) if (re.test(cs(grid[r][labelCol]))) return r;
    return -1;
  };

  const monthCols = (yearRow: (string | number | null)[], monthRow: (string | number | null)[]) => {
    const out = new Map<number, { month: string; year: number }>();
    let year = 0, stop = false;
    for (let c = 0; c < monthRow.length && !stop; c++) {
      const y = cn(yearRow[c]);
      if (Number.isFinite(y) && y > 1900 && y < 3000) year = Math.round(y);
      const yt = cs(yearRow[c]).toLowerCase();
      if (yt.includes('year to date') || yt.includes('running')) stop = true;
      const mon = cs(monthRow[c]);
      if (MON.includes(mon) && year > 0 && !stop) out.set(c, { month: mon, year });
    }
    return out;
  };

  const block = (hdr: number) => {
    if (hdr < 0) return null;
    const cols = monthCols(grid[hdr] || [], grid[hdr + 1] || []);
    let mp = -1, csr = -1, idx = -1, rank = -1;
    for (let r = hdr + 2; r < Math.min(hdr + 8, grid.length); r++) {
      const l = cs(grid[r][labelCol]).toLowerCase();
      if (l === 'my property' && mp < 0) mp = r;
      else if (l === 'competitive set' && csr < 0) csr = r;
      else if (l.indexOf('index') === 0 && idx < 0) idx = r;
      else if (l === 'rank' && rank < 0) rank = r;
      if (mp >= 0 && csr >= 0 && idx >= 0 && rank >= 0) break;
    }
    if (mp < 0 || csr < 0) return null;
    return { cols, mp, csr, idx, rank };
  };

  const occ = block(findHdr(/^occupancy/i));
  const adr = block(findHdr(/^adr$/i));
  const rev = block(findHdr(/^revpar$/i));

  const metric = (b: NonNullable<ReturnType<typeof block>>, col: number): MetricBlock => {
    const rk = parseRank(grid[b.rank] && grid[b.rank][col]);
    return {
      subject: cn(grid[b.mp] && grid[b.mp][col]),
      compSet: cn(grid[b.csr] && grid[b.csr][col]),
      index: b.idx >= 0 ? cn(grid[b.idx] && grid[b.idx][col]) : NaN,
      subjectRank: rk.rank, setSize: rk.size,
    };
  };

  const byMonth: Record<string, MonthData> = {};
  const order: string[] = [];
  if (occ) {
    for (const [col, my] of occ.cols.entries()) {
      const key = my.month + ' ' + my.year;
      const m: MonthData = {
        key, month: my.month, year: my.year,
        occ: metric(occ, col),
        adr: adr && adr.cols.has(col) ? metric(adr, col) : metric(occ, col),
        revpar: rev && rev.cols.has(col) ? metric(rev, col) : metric(occ, col),
      };
      if (Number.isFinite(m.occ.subject)) { byMonth[key] = m; order.push(key); }
    }
  }

  let subjectName: string | null = null;
  for (let r = 0; r < Math.min(6, grid.length); r++) {
    const s = cs(grid[r][labelCol]);
    if (s && !/competitive set report|property id|for the month/i.test(s) && /[A-Za-z]/.test(s)) {
      subjectName = s.split(/\s{2,}/)[0].trim();
      break;
    }
  }

  return { subjectName, order, byMonth };
}

export function parseResponse(grid: Grid): RosterEntry[] {
  const cs = (v: unknown) => (v == null ? '' : String(v).trim());
  let hr = -1, cStr = -1, cName = -1, cRooms = -1;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    let s = -1, n = -1, rm = -1;
    for (let c = 0; c < row.length; c++) {
      const t = cs(row[c]).toLowerCase();
      if (t === 'str#') s = c;
      else if (t === 'name') n = c;
      else if (t === 'rooms') rm = c;
    }
    if (s >= 0 && n >= 0 && rm >= 0) { hr = r; cStr = s; cName = n; cRooms = rm; break; }
  }
  if (hr < 0) return [];
  const out: RosterEntry[] = [];
  for (let r = hr + 1; r < grid.length; r++) {
    const strv = cs(grid[r][cStr]);
    if (!/^\d+$/.test(strv)) break;
    const name = cs(grid[r][cName]);
    const rooms = parseInt(cs(grid[r][cRooms]), 10) || 0;
    if (name) out.push({ str: strv, name, rooms });
  }
  return out;
}
