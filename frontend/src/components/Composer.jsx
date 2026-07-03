import { useState, useEffect, useRef } from 'react';
import { X, ImagePlus } from 'lucide-react';
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
  const [images, setImages] = useState([]); // [{url, uploading}]
  const fileRef = useRef(null);

  useEffect(() => { getConfig().then((c) => setUploadsEnabled(!!c.uploads)); }, []);

  async function pickImages(e) {
    const files = [...(e.target.files || [])].slice(0, 4 - images.length);
    e.target.value = '';
    for (const file of files) {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { setError('Only JPEG, PNG, WebP or GIF images.'); continue; }
      if (file.size > 5 * 1024 * 1024) { setError('Images must be under 5MB.'); continue; }
      const placeholder = { url: URL.createObjectURL(file), uploading: true };
      setImages((prev) => [...prev, placeholder]);
      try {
        const { data } = await api.post('/uploads/sign', { type: file.type, size: file.size });
        // Raw axios (no cookies) — the presigned URL is the credential.
        await axios.put(data.uploadUrl, file, { headers: { 'Content-Type': file.type } });
        setImages((prev) => prev.map((im) => (im === placeholder ? { url: data.publicUrl, uploading: false } : im)));
      } catch {
        setImages((prev) => prev.filter((im) => im !== placeholder));
        setError('Image upload failed. Try again.');
      }
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return setError('A title is required.');
    setSubmitting(true);
    setError('');
    try {
      if (images.some((im) => im.uploading)) { setSubmitting(false); return setError('Wait for images to finish uploading.'); }
      const payload = {
        type,
        title: title.trim(),
        // Minimal rich text: wrap newlines as paragraphs. (A full editor is a fast-follow.)
        body: body.trim() ? body.trim().split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('') : '',
        topics: topics.split(',').map((t) => t.trim()).filter(Boolean),
        media: images.filter((im) => !im.uploading).map((im) => ({ url: im.url, type: 'image' })),
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

          <input className="input" placeholder="Title" value={title} maxLength={300}
            onChange={(e) => setTitle(e.target.value)} autoFocus />

          <textarea className="input textarea" placeholder="Say something… (optional)" rows={5}
            value={body} maxLength={BODY_MAX} onChange={(e) => setBody(e.target.value)} />
          {body.length > BODY_MAX - 100 && (
            <span className="muted char-count">{BODY_MAX - body.length} characters left</span>
          )}

          {uploadsEnabled && (
            <div className="composer__images">
              {images.map((im, i) => (
                <div key={i} className={`img-thumb ${im.uploading ? 'img-thumb--busy' : ''}`}>
                  <img src={im.url} alt="" />
                  <button type="button" className="img-thumb__remove" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}><X size={12} /></button>
                </div>
              ))}
              {images.length < 4 && (
                <button type="button" className="img-add" onClick={() => fileRef.current?.click()} title="Add images">
                  <ImagePlus size={18} />
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={pickImages} />
            </div>
          )}

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

          <input className="input" placeholder="Topics, comma separated (e.g. design, hiring)"
            value={topics} onChange={(e) => setTopics(e.target.value)} />

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
