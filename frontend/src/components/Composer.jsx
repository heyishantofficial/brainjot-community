import { useState, useEffect, useRef } from 'react';
import { X, Paperclip, FileText } from 'lucide-react';
import axios from 'axios';
import { api } from '../api';
import { BODY_MAX } from '../utils';

// Feature flags fetched once per session (uploads are off unless R2 is configured).
let configCache = null;
async function getConfig() {
  if (!configCache) {
    configCache = api.get('/config').then(({ data }) => data).catch(() => ({ uploads: false }));
  }
  return configCache;
}

const TYPES = [
  { value: 'discussion', label: '💬 Discussion' },
  { value: 'showcase', label: '🚀 Showcase' },
  { value: 'question', label: '❓ Question' },
  { value: 'collab', label: '🤝 Collab / Hiring' },
];

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';
const MAX_ATTACHMENTS = 4;

// Create-post modal. When type === 'collab' the structured collab fields appear
// (role, skills, compensation, commitment) — the "detailed" collab post.
export default function Composer({ onClose, onCreated }) {
  const [type, setType] = useState('discussion');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [topics, setTopics] = useState('');
  const [collab, setCollab] = useState({
    role: '', intent: 'looking_for', skills: '', commitment: 'flexible',
    remote: true, location: '', compType: 'negotiable', compAmount: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [uploadsEnabled, setUploadsEnabled] = useState(false);
  const [storageLimit, setStorageLimit] = useState(false);
  const [proSoon, setProSoon] = useState(false);
  // [{ url, uploading, kind: 'image'|'file', name }]
  const [attachments, setAttachments] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => { getConfig().then((c) => setUploadsEnabled(!!c.uploads)); }, []);

  async function pickFiles(e) {
    const files = [...(e.target.files || [])].slice(0, MAX_ATTACHMENTS - attachments.length);
    e.target.value = '';
    for (const file of files) {
      const isImage = /^image\/(jpeg|png|webp|gif)$/.test(file.type);
      const isPdf = file.type === 'application/pdf';
      if (!isImage && !isPdf) { setError('Only JPEG, PNG, WebP, GIF images or PDF documents are allowed.'); continue; }
      const maxBytes = isPdf ? 15 * 1024 * 1024 : 5 * 1024 * 1024;
      if (file.size > maxBytes) { setError(`File is too large (max ${isPdf ? '15MB' : '5MB'}).`); continue; }

      const kind = isImage ? 'image' : 'file';
      const placeholder = { url: isImage ? URL.createObjectURL(file) : '', uploading: true, kind, name: file.name };
      setAttachments((prev) => [...prev, placeholder]);
      try {
        const { data } = await api.post('/uploads/sign', { type: file.type, size: file.size });
        // Raw axios (no cookies) — the presigned URL is the credential.
        await axios.put(data.uploadUrl, file, { headers: { 'Content-Type': file.type } });
        setAttachments((prev) => prev.map((a) => (a === placeholder ? { ...a, url: data.publicUrl, uploading: false } : a)));
      } catch (err) {
        setAttachments((prev) => prev.filter((a) => a !== placeholder));
        if (err.response?.data?.code === 'storage_limit') setStorageLimit(true);
        else setError('Upload failed. Try again.');
      }
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return setError('A title is required.');
    setSubmitting(true);
    setError('');
    try {
      if (attachments.some((a) => a.uploading)) { setSubmitting(false); return setError('Wait for attachments to finish uploading.'); }
      const payload = {
        type,
        title: title.trim(),
        // Minimal rich text: wrap newlines as paragraphs. (A full editor is a fast-follow.)
        body: body.trim() ? body.trim().split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('') : '',
        topics: topics.split(',').map((t) => t.trim()).filter(Boolean),
        media: attachments.filter((a) => !a.uploading).map((a) => ({ url: a.url, type: a.kind, name: a.name })),
      };
      if (type === 'collab') {
        payload.collab = { ...collab, skills: collab.skills.split(',').map((s) => s.trim()).filter(Boolean) };
      }
      const { data } = await api.post('/posts', payload);
      onCreated?.(data.post);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not publish. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal composer" onClick={(e) => e.stopPropagation()}>
        <div className="composer__head">
          <h2>Create a post</h2>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="composer__form">
          <div className="type-picker">
            {TYPES.map((t) => (
              <button type="button" key={t.value}
                className={`type-option ${type === t.value ? 'active' : ''}`}
                onClick={() => setType(t.value)}>{t.label}</button>
            ))}
          </div>

          {/* Title, body, and topics live in one unified box instead of three
              separately-bordered fields — reads as a single composer, not a form. */}
          <div className="composer__unified">
            <input className="composer__field composer__field--title" placeholder="Title" value={title}
              maxLength={300} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <div className="composer__divider" />
            <textarea className="composer__field composer__field--body" placeholder="Say something… (optional)"
              rows={4} value={body} maxLength={BODY_MAX} onChange={(e) => setBody(e.target.value)} />
            {body.length > BODY_MAX - 100 && (
              <span className="muted char-count composer__char-count">{BODY_MAX - body.length} characters left</span>
            )}

            {uploadsEnabled && attachments.length > 0 && (
              <div className="composer__attachments">
                {attachments.map((a, i) => (
                  <div key={i} className={`attach-chip ${a.uploading ? 'attach-chip--busy' : ''}`}>
                    {a.kind === 'image' ? (
                      <img src={a.url} alt="" />
                    ) : (
                      <div className="attach-chip__file"><FileText size={20} /><span>{a.name}</span></div>
                    )}
                    <button type="button" className="attach-chip__remove" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="composer__divider" />
            <input className="composer__field composer__field--topics" placeholder="Topics, comma separated (e.g. design, hiring)"
              value={topics} onChange={(e) => setTopics(e.target.value)} />

            {uploadsEnabled && (
              <div className="composer__attach-row">
                <button type="button" className="composer__attach-btn" onClick={() => fileRef.current?.click()}
                  disabled={attachments.length >= MAX_ATTACHMENTS} title="Add photos or a PDF">
                  <Paperclip size={16} /> Photo / PDF
                </button>
                <input ref={fileRef} type="file" accept={ACCEPTED_TYPES} multiple hidden onChange={pickFiles} />
              </div>
            )}
          </div>

          {type === 'collab' && (
            <div className="collab-fields">
              <div className="field-row">
                <input className="input" placeholder="Role (e.g. Frontend Developer, Co-founder)"
                  value={collab.role} onChange={(e) => setCollab({ ...collab, role: e.target.value })} />
                <select className="input" value={collab.intent} onChange={(e) => setCollab({ ...collab, intent: e.target.value })}>
                  <option value="looking_for">I'm looking for</option>
                  <option value="offering">I'm offering</option>
                </select>
              </div>
              <input className="input" placeholder="Skills, comma separated (e.g. React, Figma, Node)"
                value={collab.skills} onChange={(e) => setCollab({ ...collab, skills: e.target.value })} />
              <div className="field-row">
                <select className="input" value={collab.compType} onChange={(e) => setCollab({ ...collab, compType: e.target.value })}>
                  <option value="paid">Paid</option>
                  <option value="equity">Equity</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="negotiable">Negotiable</option>
                </select>
                <input className="input" placeholder="Amount (e.g. $2k/mo, 5%)"
                  value={collab.compAmount} onChange={(e) => setCollab({ ...collab, compAmount: e.target.value })} />
              </div>
              <div className="field-row">
                <select className="input" value={collab.commitment} onChange={(e) => setCollab({ ...collab, commitment: e.target.value })}>
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="one_off">One-off</option>
                  <option value="flexible">Flexible</option>
                </select>
                <label className="checkbox">
                  <input type="checkbox" checked={collab.remote} onChange={(e) => setCollab({ ...collab, remote: e.target.checked })} /> Remote
                </label>
              </div>
              {!collab.remote && (
                <input className="input" placeholder="Location"
                  value={collab.location} onChange={(e) => setCollab({ ...collab, location: e.target.value })} />
              )}
            </div>
          )}

          {storageLimit && (
            <div className="storage-limit-notice">
              <strong>You've reached your free upload limit.</strong>
              <p>This app is built by a small independent team. To keep free accounts available for everyone, storage is currently limited to 200 MB per user.</p>
              <p>If you enjoy using the app, upgrading to Pro gives you more storage and exclusive features—and directly supports future development.</p>
              <button type="button" className="btn btn--primary" onClick={() => setProSoon(true)}>
                {proSoon ? 'Coming soon ✨' : 'Upgrade to Pro'}
              </button>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}

          <div className="composer__foot">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
