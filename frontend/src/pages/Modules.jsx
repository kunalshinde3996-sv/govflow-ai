import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Spinner, ErrorBox } from '../ui.jsx';

const ENGINE = ['Document verification (OCR)', 'Eligibility rules', 'Decision / compensation', 'Milestones', 'Audit and analytics'];

/** Admin: every service is just a rule-set on the same engine. Live rule-sets are editable (versioned); previews are sample configs. */
export default function Modules() {
  const [mods, setMods] = useState(null);
  const [sel, setSel] = useState(null);
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState({ err: '', ok: '' });

  const load = () => api('/admin/modules').then((m) => { setMods(m); setSel((s) => s || m[0].scheme_type); });
  useEffect(() => { load(); }, []);
  const mod = mods?.find((m) => m.scheme_type === sel);
  useEffect(() => { if (mod) { const { _version, ...c } = mod; setText(JSON.stringify(c, null, 2)); setMsg({ err: '', ok: '' }); } }, [mod?.scheme_type, mod?._version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mods) return <Spinner />;
  async function publish() {
    setMsg({ err: '', ok: '' });
    try {
      const config = JSON.parse(text);
      const r = await api(`/admin/rules/${sel}`, { method: 'PUT', body: { config, reason } });
      setMsg({ err: '', ok: `Published as version ${r.version}. New applications use it immediately; existing cases keep the version they were evaluated under.` });
      setReason(''); load();
    } catch (e) { setMsg({ err: e instanceof SyntaxError ? 'Invalid JSON: ' + e.message : e.message, ok: '' }); }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Supported Modules and Rule-sets</h1>
      <p className="text-sm text-muted mb-3">One case engine serves every service. A module is only a JSON rule-set: form fields, required documents, eligibility rules and a compensation formula.</p>
      <div className="card card-b mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold mr-1">Shared engine:</span>
        {ENGINE.map((e, i) => <span key={e} className="flex items-center gap-2"><span className="border border-line bg-panel rounded px-2 py-1">{e}</span>{i < ENGINE.length - 1 && <span className="text-muted">&rarr;</span>}</span>)}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          {mods.map((m) => (
            <button key={m.scheme_type} onClick={() => setSel(m.scheme_type)} className={`card card-b card-hover w-full text-left ${sel === m.scheme_type ? 'ring-2 ring-navy' : 'hover:bg-panel'}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{m.name}</span>
                <span className={`text-[11px] border rounded px-1.5 py-0.5 ${m.status === 'live' ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-slate-100 border-slate-300 text-slate-600'}`}>{m.status === 'live' ? 'Live' : 'Sample config'}</span></div>
              <div className="text-xs text-muted mt-1">{m.department}</div>
              <div className="text-xs mt-1">{m.eligibility?.rules?.length || 0} eligibility rules &middot; {m.required_documents?.length || 0} documents &middot; version {m._version}</div>
            </button>
          ))}
        </div>
        <div className="lg:col-span-2 card">
          <div className="card-h">Rule-set JSON: {mod?.name}</div>
          <div className="card-b space-y-2">
            {mod?.status !== 'live' && <div className="text-xs border border-slate-300 bg-slate-50 rounded p-2">Preview module: the configuration below is accepted by the engine but this service is not yet open for citizen applications.</div>}
            <textarea className="input font-mono text-xs" rows={24} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
            {mod?.status === 'live' && (<>
              <input className="input" placeholder="Reason for change (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <ErrorBox error={msg.err} />
              {msg.ok && <div className="border border-emerald-300 bg-emerald-50 text-emerald-800 rounded p-3 text-sm">{msg.ok}</div>}
              <button className="btn" onClick={publish}>Validate and publish new version</button>
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
