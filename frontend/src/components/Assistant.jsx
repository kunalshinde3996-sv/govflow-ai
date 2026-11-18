import { useEffect, useRef, useState } from 'react';
import { useMatch } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const LANGS = [['en', 'English'], ['hi', 'Hindi'], ['mr', 'Marathi'], ['kok', 'Konkani']];
const CITIZEN_CHIPS = ['Where is my case?', 'Why is it flagged?', 'Explain my compensation', 'What documents are missing?'];
const STAFF_CHIPS = ['How many cases are in manual review?', 'Which stage is the bottleneck?', 'How many cases await officer review?'];
const STAFF_CASE_CHIPS = ['Why is this case flagged?', 'Explain the compensation', 'What documents are missing?'];

/** Floating "GovFlow Assist" chat. Scoped to the open case automatically; the server enforces access. */
export default function Assistant() {
  const { user } = useAuth();
  const match = useMatch('/case/:id');
  const caseId = match?.params.id || null;
  const staff = user.role !== 'citizen';
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [lang, setLang] = useState('en');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);
  const end = useRef(null);

  useEffect(() => { api('/assistant/status').then((s) => setMode(s.mode)).catch(() => {}); }, []);
  useEffect(() => { setMsgs([]); }, [caseId]); // a new case page starts a fresh, correctly scoped conversation
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, open]);

  const chips = staff ? (caseId ? STAFF_CASE_CHIPS : STAFF_CHIPS) : CITIZEN_CHIPS;

  async function send(text) {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput('');
    const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const r = await api('/assistant/chat', { method: 'POST', body: { message, caseId, language: lang, history } });
      setMode(r.mode);
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, mode: r.mode, note: r.note }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: e.message, error: true }]);
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 btn shadow-lg !rounded-full !px-5 !py-3" aria-label="Open GovFlow Assist">
        Ask GovFlow Assist
      </button>
    );
  }
  return (
    <aside className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[400px] bg-white border-l border-line shadow-2xl flex flex-col" aria-label="GovFlow Assist">
      <div className="bg-navy text-white px-4 py-3 flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">GovFlow Assist</div>
          <div className="text-xs text-blue-200">{caseId ? 'Scoped to the case you are viewing' : staff ? 'Queue and analytics questions' : 'Ask about your applications'}</div>
        </div>
        <button className="text-blue-100 hover:text-white text-sm underline" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div className="px-4 py-2 border-b border-line flex items-center justify-between gap-2 text-xs bg-panel">
        <label className="flex items-center gap-1.5">Language
          <select className="border border-line rounded px-1.5 py-1 bg-white" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {mode === 'basic' && <span className="border border-slate-300 bg-white text-slate-600 rounded px-1.5 py-0.5" title="AI service not available; answering from case records with templates">Basic mode</span>}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {msgs.length === 0 && (
          <div className="text-muted">
            <p>Answers come only from this platform&rsquo;s records. The assistant cannot approve, reject or change anything.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {chips.map((c) => <button key={c} className="text-xs border border-line rounded-full px-3 py-1.5 hover:bg-panel text-ink" onClick={() => send(c)}>{c}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[88%] rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-navy text-white' : m.error ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-panel border border-line'}`}>
              {m.content}
              {m.note && <div className="text-xs text-muted mt-1">{m.note}</div>}
              {m.role === 'assistant' && !m.error && <div className="text-[11px] text-muted mt-1">{m.mode === 'basic' ? 'Basic mode' : 'AI answer, from platform records'}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="text-muted text-xs">Looking through the case records...</div>}
        <div ref={end} />
      </div>
      <form className="border-t border-line p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className="input" placeholder="Type your question" value={input} maxLength={1000} onChange={(e) => setInput(e.target.value)} />
        <button className="btn" disabled={busy || !input.trim()}>Send</button>
      </form>
    </aside>
  );
}
