import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import Avatar from '../../components/Avatar';
import { api } from '../../api';
import { timeAgo } from '../../utils';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'banned', label: 'Banned' },
  { key: 'admins', label: 'Admins' },
];

// Expanded dossier under a row: counts, recent content, audit trail, ban/unban.
function UserDetail({ user, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [confirmBan, setConfirmBan] = useState(false);
  const [purge, setPurge] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null); setConfirmBan(false); setPurge(false);
    api.get(`/admin/users/${user.id}`).then(({ data }) => alive && setDetail(data)).catch(() => {});
    return () => { alive = false; };
  }, [user.id]);

  async function setBanned(banned) {
    setBusy(true);
    try {
      const { data } = await api.patch(`/admin/users/${user.id}`, { banned, purgeContent: banned && purge });
      onChanged(data.user);
      setConfirmBan(false);
      // Re-pull the dossier so purge results show immediately.
      const { data: fresh } = await api.get(`/admin/users/${user.id}`);
      setDetail(fresh);
      window.dispatchEvent(new Event('badges:refresh'));
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <div className="user-detail"><p className="muted">Loading…</p></div>;
  const { counts, recentPosts, recentComments, audit } = detail;

  return (
    <div className="user-detail">
      <div className="user-detail__counts">
        <span><b>{counts.posts}</b> posts{counts.postsRemoved > 0 && <i className="muted"> ({counts.postsRemoved} removed)</i>}</span>
        <span><b>{counts.comments}</b> comments{counts.commentsRemoved > 0 && <i className="muted"> ({counts.commentsRemoved} removed)</i>}</span>
        <span><b>{counts.contentReports}</b> reports on their posts</span>
        <span><b>{counts.reportsAgainst}</b> reports against them</span>
        <span><b>{counts.reportsFiled}</b> reports filed by them</span>
      </div>

      {recentPosts.length > 0 && (
        <div className="user-detail__section">
          <h4>Recent posts</h4>
          {recentPosts.map((p) => (
            <div key={p.id} className="user-detail__row">
              <Link to={`/post/${p.id}`}>{p.title}</Link>
              <span className="muted">
                {p.status === 'removed' && <span className="chip chip--danger">removed</span>}{' '}
                score {p.score} · {p.commentCount} comments · {timeAgo(p.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {recentComments.length > 0 && (
        <div className="user-detail__section">
          <h4>Recent comments</h4>
          {recentComments.map((c) => (
            <div key={c.id} className="user-detail__row">
              <Link to={`/post/${c.postId}`}>{c.snippet || <em className="muted">(removed)</em>}</Link>
              <span className="muted">
                {c.status === 'removed' && <span className="chip chip--danger">removed</span>}{' '}
                {timeAgo(c.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {audit.length > 0 && (
        <div className="user-detail__section">
          <h4>Audit trail</h4>
          {audit.map((a, i) => (
            <div key={i} className="user-detail__row">
              <span>{a.action.replace(/_/g, ' ')}{a.meta?.posts != null && ` (${a.meta.posts} posts, ${a.meta.comments} comments)`}</span>
              <span className="muted">by {a.actorName} · {timeAgo(a.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      {user.role !== 'superadmin' && (
        <div className="user-detail__actions">
          {user.banned ? (
            <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setBanned(false)}>Unban user</button>
          ) : confirmBan ? (
            <div className="ban-confirm">
              <label className="ban-confirm__purge">
                <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
                Also remove all their posts and comments
              </label>
              <button className="btn btn--sm btn--danger" disabled={busy} onClick={() => setBanned(true)}>
                {busy ? 'Banning…' : `Confirm ban${purge ? ' + purge' : ''}`}
              </button>
              <button className="link-btn" onClick={() => setConfirmBan(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn--ghost btn--sm btn--danger-ghost" onClick={() => setConfirmBan(true)}>Ban user…</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Users() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  // Debounced reload on search/filter change; page > 0 appends.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/admin/users', { params: { q, filter, page } }).then(({ data }) => {
        if (!alive) return;
        setItems((prev) => (page === 0 ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
        setLoading(false);
      }).catch(() => alive && setLoading(false));
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, filter, page]);

  function patchRow(updated) {
    setItems((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
  }

  return (
    <div className="admin-users">
      <div className="admin__filters">
        <div className="admin-users__search">
          <Search size={15} className="topbar__search-icon" />
          <input
            className="input input--search" placeholder="Search name, username, email…"
            value={q} onChange={(e) => { setQ(e.target.value); setPage(0); setOpenId(null); }}
          />
        </div>
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip${filter === f.key ? ' active' : ''}`}
            onClick={() => { setFilter(f.key); setPage(0); setOpenId(null); }}>
            {f.label}
          </button>
        ))}
        <span className="muted admin-users__total">{total} users</span>
      </div>

      {items.map((u) => (
        <div key={u.id} className={`user-row-wrap${openId === u.id ? ' open' : ''}`}>
          <button className="user-row" onClick={() => setOpenId(openId === u.id ? null : u.id)}>
            <Avatar user={u} size={34} />
            <div className="user-row__main">
              <span className="user-row__name">
                {u.name}
                {u.role === 'superadmin' && <span className="chip chip--accent">admin</span>}
                {u.banned && <span className="chip chip--danger">banned</span>}
              </span>
              <span className="muted user-row__sub">{u.username ? `@${u.username} · ` : ''}{u.email}</span>
            </div>
            <div className="user-row__stats muted">
              <span>{u.karma} karma</span>
              <span>{u.postCount} posts</span>
              <span className="hide-sm">joined {timeAgo(u.createdAt)}</span>
              <span className="hide-sm">seen {u.lastSeenAt ? timeAgo(u.lastSeenAt) : 'never'}</span>
            </div>
          </button>
          {openId === u.id && <UserDetail user={u} onChanged={patchRow} />}
        </div>
      ))}

      {loading && <p className="muted">Loading…</p>}
      {!loading && items.length === 0 && <p className="empty muted">No users match.</p>}
      {!loading && items.length < total && (
        <button className="btn btn--ghost load-more" onClick={() => setPage(page + 1)}>Load more</button>
      )}
    </div>
  );
}
