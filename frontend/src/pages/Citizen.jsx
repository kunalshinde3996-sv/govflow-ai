import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { StatusBadge, SCHEME_LABEL, day, inr, Spinner, ErrorBox } from '../ui.jsx';

export function MyCases() {
  const [cases, setCases] = useState(null);
  useEffect(() => { api('/cases').then(setCases); }, []);
  if (!cases) return <Spinner />;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">My Applications</h1>
        <Link to="/apply" className="btn">New application</Link>
      </div>
      <div className="card overflow-x-auto">
        {cases.length === 0 ? <div className="card-b text-muted">You have not made any application yet.</div> : (
          <table className="w-full">
            <thead><tr><th className="th">Case number</th><th className="th">Service</th><th className="th">Status</th><th className="th">Created</th><th className="th text-right">Compensation</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="hover:bg-panel">
                  <td className="td"><Link className="text-navy underline font-medium" to={c.status === 'DRAFT' ? `/apply/${c.id}` : `/case/${c.id}`}>{c.case_number}</Link></td>
                  <td className="td">{SCHEME_LABEL[c.scheme_type]}</td>
                  <td className="td"><StatusBadge status={c.status} /></td>
                  <td className="td">{day(c.created_at)}</td>
                  <td className="td text-right tabular-nums">{c.final_total != null ? inr(c.final_total) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Application form rendered entirely from the scheme's JSON config (form_fields + required_documents). */
export function NewApplication() {
  const { id } = useParams();
  const nav = useNavigate();
  const [schemes, setSchemes] = useState(null);
  const [scheme, setScheme] = useState(null);
  const [caseId, setCaseId] = useState(id || null);
  const [form, setForm] = useState({});
  const [docs, setDocs] = useState([]);
  const [err, setErr] = useState('');
  const [missing, setMissing] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api('/schemes').then((s) => {
      setSchemes(s);
      if (id) {
        api(`/cases/${id}`).then((c) => {
          setScheme(s.find((x) => x.scheme_type === c.scheme_type)); setForm(c.form_data); setDocs(c.documents);
          if (!['DRAFT', 'INFO_REQUESTED'].includes(c.status)) nav(`/case/${id}`, { replace: true });
        });
      }
    });
  }, [id, nav]);

  if (!schemes) return <Spinner />;

  if (!scheme) {
    return (
      <div>
        <h1 className="text-xl font-semibold mb-3">Choose a service</h1>
        <div className="grid md:grid-cols-2 gap-4">
          {schemes.map((s) => (
            <div key={s.scheme_type} className={`card card-b flex flex-col ${s.status === 'live' ? '' : '!bg-slate-100 !border-dashed'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className={`font-semibold ${s.status === 'live' ? '' : 'text-slate-600'}`}>{s.name}</div>
                {s.status === 'live'
                  ? <span className="text-[11px] border border-emerald-300 bg-emerald-50 text-emerald-800 rounded px-1.5 py-0.5 whitespace-nowrap">Live service</span>
                  : <span className="text-[11px] border border-slate-300 bg-white text-slate-600 rounded px-1.5 py-0.5 whitespace-nowrap">Sample configuration</span>}
              </div>
              <div className="text-xs text-muted mb-2">{s.department}</div>
              <p className={`text-sm flex-1 ${s.status === 'live' ? '' : 'text-slate-500'}`}>{s.description}</p>
              {s.status === 'live'
                ? <button className="btn mt-3 self-start" onClick={() => setScheme(s)}>Apply</button>
                : <button className="btn mt-3 self-start" disabled title="Demonstrates the rule-set format; not open for applications">Not open for applications</button>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (f, v) => (f.type === 'number' ? (v === '' ? '' : Number(v)) : v);

  async function ensureCase() {
    if (caseId) { await api(`/cases/${caseId}`, { method: 'PATCH', body: { form_data: form } }); return caseId; }
    const c = await api('/cases', { method: 'POST', body: { scheme_type: scheme.scheme_type, form_data: form } });
    setCaseId(c.id); return c.id;
  }
  const guard = async (label, fn) => { setErr(''); setBusy(label); try { await fn(); } catch (e) { setErr(e.message); setMissing(e.data?.missing_fields ? e.data : null); } finally { setBusy(''); } };

  const saveDraft = () => guard('save', async () => { await ensureCase(); });
  const upload = (type, file) => guard('up' + type, async () => {
    const cid = await ensureCase();
    const fd = new FormData(); fd.append('doc_type', type); fd.append('file', file);
    setDocs(await api(`/cases/${cid}/documents`, { method: 'POST', form: fd }));
  });
  const submit = () => guard('submit', async () => { const cid = await ensureCase(); await api(`/cases/${cid}/submit`, { method: 'POST' }); nav(`/case/${cid}`); });

  const docFor = (t) => docs.find((d) => d.doc_type === t);

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">{scheme.name}</h1>
      <p className="text-sm text-muted mb-4">
        {scheme.notification?.title && <>Notification {scheme.notification.number}: {scheme.notification.title}. </>}Complete the form and upload the documents listed below. Documents are read automatically; unclear documents are routed to an officer, never guessed.
      </p>
      <div className="card mb-4">
        <div className="card-h">1. Application details</div>
        <div className="card-b grid sm:grid-cols-2 gap-3">
          {scheme.form_fields.map((f) => (
            <div key={f.key}>
              <label className="label">{f.label}{f.required && ' *'}</label>
              {f.type === 'select'
                ? <select className="input" value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}><option value="">Select...</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
                : <input className="input" type={f.type} placeholder={f.placeholder} value={form[f.key] ?? ''} onChange={(e) => set(f.key, num(f, e.target.value))} />}
            </div>
          ))}
        </div>
      </div>
      <div className="card mb-4">
        <div className="card-h">2. Supporting documents <span className="text-xs font-normal text-muted">PNG, JPEG or PDF, up to 10 MB each</span></div>
        <div className="divide-y">
          {scheme.required_documents.map((d) => {
            const have = docFor(d.type);
            return (
              <div key={d.type} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-medium">{d.label} *</div>
                  <div className="text-xs text-muted">{have ? `Uploaded: ${have.original_name}` : 'Not uploaded'}</div>
                </div>
                <label className="btn btn-ghost cursor-pointer">
                  {busy === 'up' + d.type ? 'Uploading...' : have ? 'Replace' : 'Choose file'}
                  <input type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={(e) => e.target.files[0] && upload(d.type, e.target.files[0])} />
                </label>
              </div>
            );
          })}
        </div>
      </div>
      <ErrorBox error={err} />
      {missing && (
        <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm mb-3">
          {missing.missing_fields.length > 0 && <div>Missing fields: {missing.missing_fields.join(', ')}</div>}
          {missing.missing_documents.length > 0 && <div>Missing documents: {missing.missing_documents.join(', ')}</div>}
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn btn-ghost" onClick={saveDraft} disabled={!!busy}>{busy === 'save' ? 'Saving...' : 'Save draft'}</button>
        <button className="btn" onClick={submit} disabled={!!busy}>{busy === 'submit' ? 'Submitting...' : 'Submit application'}</button>
      </div>
    </div>
  );
}
