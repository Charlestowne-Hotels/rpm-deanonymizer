import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { parseStarComp, parseResponse } from '../../lib/rpm/parse';
import type { ParsedStar, RosterEntry } from '../../lib/rpm/types';

interface Props {
  onLoaded: (parsed: ParsedStar, roster: RosterEntry[]) => void | Promise<void>;
  summary?: string | null;
  label?: string;
}
export default function UploadStar({ onLoaded, summary }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr('');
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onerror = () => setErr('Could not read the file. Try selecting it again.');
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets['Comp'];
        if (!ws) {
          setErr('No "Comp" tab found — is this the Monthly STAR report? Tabs: ' + (wb.SheetNames || []).join(', '));
          return;
        }
        const parsed = parseStarComp(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as (string | number | null)[][]);
        if (!parsed.order.length) { setErr('Parsed the Comp tab but found no monthly data.'); return; }
        let roster: RosterEntry[] = [];
        try {
          const rs = wb.Sheets['Response'];
          if (rs) roster = parseResponse(XLSX.utils.sheet_to_json(rs, { header: 1, raw: true, defval: null }) as (string | number | null)[][]);
        } catch { /* roster optional */ }
        onLoaded(parsed, roster);
      } catch (error) {
        setErr('Failed to read the spreadsheet: ' + (error instanceof Error ? error.message : String(error)));
      }
    };
    reader.readAsArrayBuffer(f);
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <label className="file-drop" onClick={() => inputRef.current?.click()}>
        <span>{summary ? `✅ ${summary}` : '📄  Choose Monthly STAR (.xlsx)'}</span>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={onFile} hidden />
      </label>
      {err && <div className="admin-err" style={{ marginTop: 12, marginBottom: 0 }}>{err}</div>}
    </div>
  );
}
