import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';

const HEADLINE_MAX = 100;
const ABOUT_MAX = 1000;
const MAX_ENTRIES = 10;

const BLANK_EXPERIENCE = { title: '', org: '', start: '', end: '', description: '' };
const BLANK_EDUCATION = { school: '', degree: '', start: '', end: '', description: '' };

// LinkedIn-style profile editor. Everything saves in ONE PATCH — no per-section
// save buttons, no partially-saved profiles.
export default function ProfileEditModal({ profile, onClose, onSaved }) {
  const [headline, setHeadline] = useState(profile.headline || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [skills, setSkills] = useState((profile.skills || []).join(', '));
  const [links, setLinks] = useState({
    website: profile.links?.website || '',
    github: profile.links?.github || '',
    twitter: profile.links?.twitter || '',
    linkedin: profile.links?.linkedin || '',
  });
  const [openTo, setOpenTo] = useState(profile.openTo || []);
  const [experience, setExperience] = useState(profile.experience?.length ? profile.experience : []);
  const [education, setEducation] = useState(profile.education?.length ? profile.education : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleOpenTo(value) {
    setOpenTo((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function updateEntry(setter, index, key, value) {
    setter((prev) => prev.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));
  }

  function removeEntry(setter, index) {
    setter((prev) => prev.filter((_, i) => i !== index));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/users/me/profile', {
        headline,
        bio,
        skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
        links,
        openTo,
        // Blank rows (no title/school) are dropped by the server; sending them is fine.
        experience,
        education,
      });
      onSaved?.(data.profile);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save. Try again.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal profile-edit" onClick={(e) => e.stopPropagation()}>
        <div className="composer__head">
          <h2>Edit profile</h2>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <form onSubmit={save} className="profile-edit__form">
          <label className="profile-edit__label">Headline</label>
          <input className="input" placeholder="e.g. Full-stack developer · building brainjot"
            value={headline} maxLength={HEADLINE_MAX} onChange={(e) => setHeadline(e.target.value)} autoFocus />

          <label className="profile-edit__label">About</label>
          <textarea className="input profile-edit__about" rows={5}
            placeholder="Tell people what you do, what you're working on, and what you care about…"
            value={bio} maxLength={ABOUT_MAX} onChange={(e) => setBio(e.target.value)} />
          {bio.length > ABOUT_MAX - 150 && (
            <span className="muted char-count">{ABOUT_MAX - bio.length} characters left</span>
          )}

          <label className="profile-edit__label">Skills</label>
          <input className="input" placeholder="Comma separated (e.g. React, Figma, Node) — up to 15"
            value={skills} onChange={(e) => setSkills(e.target.value)} />

          <label className="profile-edit__label">Open to</label>
          <div className="field-row">
            <label className="checkbox">
              <input type="checkbox" checked={openTo.includes('collabs')} onChange={() => toggleOpenTo('collabs')} /> Open to collabs
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={openTo.includes('hire')} onChange={() => toggleOpenTo('hire')} /> Available for hire
            </label>
          </div>

          <label className="profile-edit__label">Links</label>
          <div className="profile-edit__links">
            <input className="input" placeholder="Website" value={links.website}
              onChange={(e) => setLinks({ ...links, website: e.target.value })} />
            <input className="input" placeholder="GitHub" value={links.github}
              onChange={(e) => setLinks({ ...links, github: e.target.value })} />
            <input className="input" placeholder="X / Twitter" value={links.twitter}
              onChange={(e) => setLinks({ ...links, twitter: e.target.value })} />
            <input className="input" placeholder="LinkedIn" value={links.linkedin}
              onChange={(e) => setLinks({ ...links, linkedin: e.target.value })} />
          </div>

          <div className="profile-edit__section-head">
            <label className="profile-edit__label">Experience</label>
            <button type="button" className="link-btn" disabled={experience.length >= MAX_ENTRIES}
              onClick={() => setExperience((prev) => [...prev, { ...BLANK_EXPERIENCE }])}>
              <Plus size={14} /> Add
            </button>
          </div>
          {experience.map((entry, i) => (
            <div key={i} className="profile-edit__entry">
              <div className="field-row">
                <input className="input" placeholder="Title (e.g. Frontend Developer)" value={entry.title}
                  maxLength={80} onChange={(e) => updateEntry(setExperience, i, 'title', e.target.value)} />
                <input className="input" placeholder="Company / project" value={entry.org}
                  maxLength={80} onChange={(e) => updateEntry(setExperience, i, 'org', e.target.value)} />
              </div>
              <div className="field-row">
                <input className="input" placeholder="Start (e.g. 2022)" value={entry.start}
                  maxLength={20} onChange={(e) => updateEntry(setExperience, i, 'start', e.target.value)} />
                <input className="input" placeholder="End (blank = present)" value={entry.end}
                  maxLength={20} onChange={(e) => updateEntry(setExperience, i, 'end', e.target.value)} />
                <button type="button" className="icon-btn" title="Remove"
                  onClick={() => removeEntry(setExperience, i)}><Trash2 size={16} /></button>
              </div>
              <input className="input" placeholder="What did you do? (optional)" value={entry.description}
                maxLength={300} onChange={(e) => updateEntry(setExperience, i, 'description', e.target.value)} />
            </div>
          ))}

          <div className="profile-edit__section-head">
            <label className="profile-edit__label">Education</label>
            <button type="button" className="link-btn" disabled={education.length >= MAX_ENTRIES}
              onClick={() => setEducation((prev) => [...prev, { ...BLANK_EDUCATION }])}>
              <Plus size={14} /> Add
            </button>
          </div>
          {education.map((entry, i) => (
            <div key={i} className="profile-edit__entry">
              <div className="field-row">
                <input className="input" placeholder="School" value={entry.school}
                  maxLength={80} onChange={(e) => updateEntry(setEducation, i, 'school', e.target.value)} />
                <input className="input" placeholder="Degree / field" value={entry.degree}
                  maxLength={80} onChange={(e) => updateEntry(setEducation, i, 'degree', e.target.value)} />
              </div>
              <div className="field-row">
                <input className="input" placeholder="Start (e.g. 2019)" value={entry.start}
                  maxLength={20} onChange={(e) => updateEntry(setEducation, i, 'start', e.target.value)} />
                <input className="input" placeholder="End (blank = present)" value={entry.end}
                  maxLength={20} onChange={(e) => updateEntry(setEducation, i, 'end', e.target.value)} />
                <button type="button" className="icon-btn" title="Remove"
                  onClick={() => removeEntry(setEducation, i)}><Trash2 size={16} /></button>
              </div>
              <input className="input" placeholder="Notes (optional)" value={entry.description}
                maxLength={300} onChange={(e) => updateEntry(setEducation, i, 'description', e.target.value)} />
            </div>
          ))}

          {error && <p className="error-text">{error}</p>}

          <div className="composer__foot">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
