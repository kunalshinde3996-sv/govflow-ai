import { useState } from 'react';
import { api, fileUrl } from '../api.js';
import { Confidence, ErrorBox } from '../ui.jsx';

/** Side-by-side: uploaded document on the left, OCR-extracted fields (with confidence) on the right.
 *  Officers can correct a field; a reason is mandatory and the before/after is audited. */
export default function DocReview({ c, canEdit, onChanged }) {
  const docs = c.documents;
  const label = Object.fromEntries(c.scheme.required_documents.map((d) => [d.type, d.label]));
  const [sel, setSel] = useState(docs[0]?.id);
  const [edit, setEdit] = useState(null); // {field, value, reason}
  const [err, setErr] = useState('');
  const doc = docs.find((d) => d.id === sel) || docs[0];
  if (!doc) return <div className="card-b text-muted">No documents uploaded.</div>;

  async function save() {
    setErr('');
    try {
      await api(`/documents/${doc.id}/fields`, { method: 'PATCH', body: edit });
      setEdit(null); onChanged();
    } catch (e) { setErr(e.message); }
  }
  const src = fileUrl(`/cases/${c.id}/documents/${doc.id}/file`);
  const fields = Object.entries(doc.extracted || {});

  return (
    <div>
      <div className="flex flex-wrap gap-1 px-4 pt-3">
        {docs.map((d) => (
          <button key={d.id} onClick={() => { setSel(d.id); setEdit(null); }}
            className={`text-xs px-2.5 py-1.5 rounded border ${d.id === doc.id ? 'bg-navy text-white border-navy' : 'bg-white border-line hover:bg-panel'}`}>
            {label[d.doc_type] || d.doc_type}{d.needs_review && !d.verified_at ? ' (flagged)' : ''}
          </button>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4 p-4">
        <div className="border border-line rounded bg-panel min-h-48 flex items-center justify-center overflow-hidden">
          {doc.mime === 'application/pdf'
            ? <iframe title="document" src={src} className="w-full h-96" />
            : <img src={src} alt={label[doc.doc_type]} className="max-w-full max-h-96 object-contain" onError={(e) => { e.currentTarget.alt = 'Image unavailable'; }} />}
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold">Extracted fields</div>
            <div className="text-xs text-muted flex items-center gap-1.5">Overall <Confidence value={doc.overall_confidence} /></div>
          </div>
          {doc.ocr_status === 'pending' && <div className="text-sm text-muted">Awaiting automated reading...</div>}
          {doc.ocr_status === 'skipped' && <div className="text-sm text-muted">No fields to extract from this document type.</div>}
          {doc.needs_review && !doc.verified_at && (
            <div className="border border-amber-300 bg-amber-50 rounded p-2 text-xs mb-2">
              <div className="font-semibold text-amber-900">Automatic reading was not reliable</div>
              <ul className="list-disc ml-4">{(doc.review_reasons || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
          {doc.verified_at && <div className="text-xs text-emerald-800 border border-emerald-200 bg-emerald-50 rounded p-2 mb-2">Verified manually by an officer.</div>}
          <table className="w-full text-sm">
            <tbody>
              {fields.map(([k, f]) => (
                <tr key={k} className="border-b border-slate-100">
                  <td className="py-2 pr-2 align-top text-muted w-32">{k.replace(/_/g, ' ')}</td>
                  <td className="py-2 align-top">
                    {edit?.field === k ? (
                      <div className="space-y-1.5">
                        <input className="input" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} />
                        <input className="input" placeholder="Reason for correction (mandatory)" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
                        <div className="flex gap-2"><button className="btn" onClick={save}>Save correction</button><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className={f.value == null ? 'text-red-700 italic' : 'font-medium'}>{f.value == null ? 'not found' : String(f.value)}</div>
                          {f.source === 'officer' && <div className="text-xs text-muted">Corrected by officer (OCR read: {String(f.ocr_value ?? 'nothing')}, {f.ocr_confidence}%)</div>}
                        </div>
                        <div className="flex flex-col items-end gap-1"><Confidence value={f.confidence} />
                          {canEdit && <button className="text-xs underline text-navy" onClick={() => setEdit({ field: k, value: f.value ?? '', reason: '' })}>Edit</button>}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ErrorBox error={err} />
        </div>
      </div>
    </div>
  );
}
