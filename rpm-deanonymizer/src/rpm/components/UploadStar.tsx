import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { parseStarComp, parseResponse } from '../../lib/rpm/parse';
import type { ParsedStar, RosterEntry } from '../../lib/rpm/types';

interface Props {
  onLoaded: (parsed: ParsedStar, roster: RosterEntry[]) => void | Promise<void>;
  summary?: string | null;
  label?: string;
}

export default function UploadStar({ onLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr('');
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    const reader = new FileReader();
    reader.onerror = () => { setErr('Could not read the file. Try again.'); setBusy(false); };
    reader.onload = async (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets['Comp'];
        if (!ws) {
          setErr('No "Comp" tab found — is this a Monthly STAR report? Tabs: ' + (wb.SheetNames || []).join(', '));
          setBusy(false); return;
        }
        const parsed = parseStarComp(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as (string | number | null)[][]);
        if (!parsed.order.length) { setErr('Parsed the Comp tab but found no monthly data.'); setBusy(false); return; }
        let roster: RosterEntry[] = [];
        try {
          const rs = wb.Sheets['Response'];
          if (rs) roster = parseResponse(XLSX.utils.sheet_to_json(rs, { header: 1, raw: true, defval: null }) as (string | number | null)[][]);
        } catch { /* roster optional */ }
        await onLoaded(parsed, roster);
      } catch (error) {
        setErr('Failed to read the spreadsheet: ' + (error instanceof Error ? error.message : String(error)));
      } finally {
        setBusy(false);
      }
    };
    reader.readAsArrayBuffer(f);
  };

  return (
    <>
      <button type="button" className="upload-icon-btn" onClick={() => inputRef.current?.click()}
        disabled={busy} title="Upload Monthly STAR (.xlsx)" aria-label="Upload Monthly STAR report">
        {busy ? (
          <span className="upload-spin" />
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M6 10l6-6 6 6" />
            <path d="M4 20h16" />
          </svg>
        )}
      </button>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={onFile} hidden />
      {err && <div className="admin-err" style={{ marginTop: 10, marginBottom: 0 }}>{err}</div>}
    </>
  );
}
