import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { Send, Award, Ban, VolumeX, X, Pencil, Globe, Link as LinkIcon, Briefcase, GraduationCap, Menu, Bookmark, ShieldCheck, ArrowLeft, LogOut } from 'lucide-react';
import Avatar from '../components/Avatar';
import PostCard from '../components/PostCard';
import ProfileEditModal from '../components/ProfileEditModal';
import { api, MAIN_APP_URL } from '../api';
import { useAuth } from '../auth';

const POST_FILTERS = [
  { key: '', label: 'All' },
  { key: 'showcase', label: 'Showcase' },
  { key: 'collab', label: 'Collabs' },
  { key: 'discussion', label: 'Discussions' },
  { key: 'question', label: 'Questions' },
];

const OPEN_TO_LABELS = { collabs: 'Open to collabs', hire: 'Available for hire' };
const LINK_LABELS = { website: 'Website', github: 'GitHub', twitter: 'X / Twitter', linkedin: 'LinkedIn' };

// Portfolio-style profile: identity + trust signals (member since, points,
// endorsements) up top, then the person's work filtered by post type.
export default function Profile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user, setUser, login, logout } = useAuth();
  const [profile, setProfile] = useState(null);
  const [endorsements, setEndorsements] = useState([]);
  const [posts, setPosts] = useState([]);
  const [filter, setFilter] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const [newMuted, setNewMuted] = useState('');
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api.get(`/users/${username}`)
      .then(({ data }) => {
        setProfile(data.profile);
        setEndorsements(data.endorsements || []);
        setPosts(data.posts);
        setBlocked(!!data.profile.isBlocked);
      })
      .catch(() => setError('User not found'));
  }, [username]);

  async function message() {
    if (!user) return login();
    try {
      const { data } = await api.post('/conversations', { userId: profile.id });
      navigate(`/messages/${data.conversation.id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Could not start the conversation.');
    }
  }

  async function toggleBlock() {
    if (!user) return login();
    if (!blocked && !confirm(`Block ${profile.name}? They won't be able to message you.`)) return;
    const { data } = await api.post(`/users/${profile.id}/block`);
    setBlocked(data.blocked);
  }

  // Persist the full muted list, then sync the auth user so the feed filter
  // applies on the very next fetch (the backend reads it from the session user).
  async function saveMuted(next) {
    const { data } = await api.patch('/users/me/profile', { mutedKeywords: next });
    setUser({ ...user, mutedKeywords: data.profile.mutedKeywords });
  }

  function addMuted(e) {
    e.preventDefault();
    const word = newMuted.trim().toLowerCase();
    setNewMuted('');
    if (!word || (user.mutedKeywords || []).includes(word)) return;
    saveMuted([...(user.mutedKeywords || []), word]).catch(() => alert('Could not save.'));
  }

  function removeMuted(word) {
    saveMuted((user.mutedKeywords || []).filter((w) => w !== word)).catch(() => alert('Could not save.'));
  }

  if (error) return <div className="center-msg">{error}</div>;
  if (!profile) return <div className="center-msg">Loading…</div>;
  const isMe = user?.id === profile.id;
  const memberSince = new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const shownPosts = filter ? posts.filter((p) => p.type === filter) : posts;
  const links = Object.entries(profile.links || {}).filter(([key, url]) => LINK_LABELS[key] && url);

  return (
    <div className="profile">
      <div className="profile__header">
        <Avatar user={profile} size={72} />
        <div className="profile__info">
          <h1>{profile.name}</h1>
          {profile.headline && <p className="profile__headline">{profile.headline}</p>}
          <span className="muted">{profile.username ? `@${profile.username}` : ''} · joined {memberSince}</span>
          {profile.openTo?.length > 0 && (
            <div className="profile__open-to">
              {profile.openTo.map((v) => OPEN_TO_LABELS[v] && (
                <span key={v} className="open-to-badge">{OPEN_TO_LABELS[v]}</span>
              ))}
            </div>
          )}
          <div className="profile__stats">
            <span><b>{profile.karma}</b> points</span>
            <span><b>{profile.postCount}</b> posts</span>
            <span><b>{profile.endorsementCount || 0}</b> endorsements</span>
          </div>
          {profile.skills?.length > 0 && (
            <div className="collab-skills">{profile.skills.map((s) => <span key={s} className="skill-tag">{s}</span>)}</div>
          )}
          {links.length > 0 && (
            <div className="profile__links">
              {links.map(([key, url]) => (
                <a key={key} className="profile__link" href={url} target="_blank" rel="noopener noreferrer nofollow">
                  {key === 'website' ? <Globe size={13} /> : <LinkIcon size={13} />} {LINK_LABELS[key]}
                </a>
              ))}
            </div>
          )}
        </div>
        {isMe ? (
          <div className="profile__actions profile__actions--me">
            {/* Mobile-only menu holding the actions that left the top bar. */}
            <button className="icon-btn show-sm" onClick={() => setMenuOpen((o) => !o)} title="Menu"><Menu size={20} /></button>
            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit profile</button>
            {menuOpen && (
              <>
                <div className="mobile-menu__backdrop" onClick={() => setMenuOpen(false)} />
                <nav className="mobile-menu">
                  <button className="mobile-menu__item" onClick={() => { setMenuOpen(false); navigate('/saved'); }}>
                    <Bookmark size={17} /> Saved posts
                  </button>
                  {user.role === 'superadmin' && (
                    <button className="mobile-menu__item" onClick={() => { setMenuOpen(false); navigate('/admin'); }}>
                      <ShieldCheck size={17} /> Admin dashboard
                    </button>
                  )}
                  <a href={MAIN_APP_URL} className="mobile-menu__item">
                    <ArrowLeft size={17} /> Back to Projects
                  </a>
                  <div className="mobile-menu__sep" />
                  <button className="mobile-menu__item" onClick={() => { setMenuOpen(false); logout(); }}>
                    <LogOut size={17} /> Log out
                  </button>
                </nav>
              </>
            )}
          </div>
        ) : (
          <div className="profile__actions">
            <button className="btn btn--primary" onClick={message}><Send size={16} /> Message</button>
            <button className={`btn btn--ghost btn--sm ${blocked ? 'danger' : ''}`} onClick={toggleBlock} title={blocked ? 'Unblock' : 'Block'}>
              <Ban size={14} /> {blocked ? 'Unblock' : 'Block'}
            </button>
          </div>
        )}
      </div>

      {profile.bio && (
        <section className="profile__about">
          <h3 className="profile__section">About</h3>
          <p className="profile__bio">{profile.bio}</p>
        </section>
      )}

      {profile.experience?.length > 0 && (
        <section className="profile__timeline">
          <h3 className="profile__section"><Briefcase size={16} /> Experience</h3>
          {profile.experience.map((e, i) => (
            <div key={i} className="timeline-entry">
              <div className="timeline-entry__head">
                <b>{e.title}</b>{e.org && <span className="muted"> · {e.org}</span>}
                {(e.start || e.end) && <span className="timeline-entry__dates">{e.start || '?'} — {e.end || 'present'}</span>}
              </div>
              {e.description && <p className="muted timeline-entry__desc">{e.description}</p>}
            </div>
          ))}
        </section>
      )}

      {profile.education?.length > 0 && (
        <section className="profile__timeline">
          <h3 className="profile__section"><GraduationCap size={16} /> Education</h3>
          {profile.education.map((e, i) => (
            <div key={i} className="timeline-entry">
              <div className="timeline-entry__head">
                <b>{e.school}</b>{e.degree && <span className="muted"> · {e.degree}</span>}
                {(e.start || e.end) && <span className="timeline-entry__dates">{e.start || '?'} — {e.end || 'present'}</span>}
              </div>
              {e.description && <p className="muted timeline-entry__desc">{e.description}</p>}
            </div>
          ))}
        </section>
      )}

      {isMe && (
        <section className="profile__muted-words">
          <h3 className="profile__section"><VolumeX size={16} /> Muted words</h3>
          <p className="muted">Posts containing these words won't appear in your feed.</p>
          {(user.mutedKeywords || []).length > 0 && (
            <div className="collab-skills">
              {user.mutedKeywords.map((w) => (
                <span key={w} className="skill-tag">
                  {w}
                  <button type="button" className="skill-tag__x" onClick={() => removeMuted(w)} title="Unmute"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <form className="field-row" onSubmit={addMuted}>
            <input
              className="input input--sm"
              placeholder="Mute a word or phrase…"
              value={newMuted}
              maxLength={40}
              onChange={(e) => setNewMuted(e.target.value)}
            />
            <button className="btn btn--ghost btn--sm" type="submit" disabled={!newMuted.trim()}>Mute</button>
          </form>
        </section>
      )}

      {endorsements.length > 0 && (
        <section className="profile__endorsements">
          <h3 className="profile__section"><Award size={16} /> Endorsements</h3>
          <div className="endorse-list">
            {endorsements.map((e) => (
              <div key={e.id} className="endorse-card">
                <Avatar user={e.from} size={28} />
                <div>
                  <b>{e.from.name}</b>{e.skill && <span className="skill-tag skill-tag--sm">{e.skill}</span>}
                  {e.text && <p className="muted">“{e.text}”</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="profile__posts-head">
        <h3 className="profile__section">Posts</h3>
        <div className="post-filters">
          {POST_FILTERS.map((f) => (
            <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>
      {shownPosts.map((p) => <PostCard key={p.id} post={p} />)}
      {shownPosts.length === 0 && <p className="empty muted">Nothing here yet.</p>}

      {editing && (
        <ProfileEditModal
          profile={profile}
          onClose={() => setEditing(false)}
          onSaved={(saved) => setProfile((prev) => ({ ...prev, ...saved }))}
        />
      )}
    </div>
  );
}
