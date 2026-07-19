import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { timeAgo } from '../../utils';

const STATUSES = [
  { key: 'open', label: 'Open' },
  { key: 'actioned', label: 'Actioned' },
  { key: 'dismissed', label: 'Dismissed' },
];

const REASON_LABELS = { spam: 'Spam', harassment: 'Harassment', nsfw: 'NSFW', scam: 'Scam', other: 'Other' };

function TargetBlock({ report }) {
  const t = report.target;
  if (!t) return <p className="muted report__gone">Content no longer exists.</p>;

  const author = t.authorUsername || t.authorId
    ? <Link to={`/u/${t.authorUsername || t.authorId}`} className="report__author">{t.authorName || t.authorUsername || t.authorId}</Link>
    : null;

  if (report.targetType === 'post') {
    return (
      <div className="report__target">
        <div className="report__target-type muted">Post by {author} {t.status === 'removed' && <span className="chip chip--danger">removed</span>}</div>
        <Link to={`/post/${report.targetId}`} className="report__target-title">{t.title}</Link>
        {t.snippet && <p className="report__snippet">{t.snippet}</p>}
        <div className="muted report__meta">score {t.score} · {t.commentCount} comments · {t.reportCount} reports</div>
      </div>
    );
  }
  if (report.targetType === 'comment') {
    return (
      <div className="report__target">
        <div className="report__target-type muted">Comment by {author} {t.status === 'removed' && <span className="chip chip--danger">removed</span>}</div>
        <p className="report__snippet">{t.snippet || <em className="muted">(empty)</em>}</p>
        <Link to={`/post/${t.postId}`} className="link-btn">View thread →</Link>
      </div>
    );
  }
  if (report.targetType === 'user') {
    return (
      <div className="report__target">
        <div className="report__target-type muted">User {t.banned && <span className="chip chip--danger">banned</span>}</div>
        <div>{author} <span className="muted">· karma {t.karma}</span></div>
      </div>
    );
  }
  return (
    <div className="report__target">
      <div className="report__target-type muted">Direct message from {author}</div>
      <p className="report__snippet">{t.snippet}</p>
    </div>
  );
}

export default function Moderation() {
  const [status, setStatus] = useState('open');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get('/admin/reports', { params: { status } }).then(({ data }) => {
      if (alive) { setItems(data.items); setLoading(false); }
    }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [status]);

  // One handler for every resolution. banAuthor runs first so a failed ban
  // never leaves the report silently closed.
  async function act(report, { newStatus, removeContent = false, banAuthor = false }) {
    setBusy(report.id);
    try {
      if (banAuthor && report.target?.authorId) {
        await api.patch(`/admin/users/${report.target.authorId}`, { banned: true });
      }
      await api.patch(`/reports/${report.id}`, { status: newStatus, removeContent });
      setItems((prev) => prev.filter((r) => r.id !== report.id));
      window.dispatchEvent(new Event('badges:refresh'));
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-moderation">
      <div className="admin__filters">
        {STATUSES.map((s) => (
          <button key={s.key} className={`chip${status === s.key ? ' active' : ''}`} onClick={() => setStatus(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="empty muted">{status === 'open' ? 'Queue clear — nothing to review. 🎉' : `No ${status} reports.`}</p>
      )}

      {items.map((r) => {
        const removable = r.target && (r.targetType === 'post' || r.targetType === 'comment') && r.target.status !== 'removed';
        const bannable = r.target?.authorId && !r.target?.banned;
        return (
          <div key={r.id} className="report-card">
            <div className="report__head">
              <span className={`chip ${r.reason === 'other' ? '' : 'chip--danger'}`}>{REASON_LABELS[r.reason] || r.reason}</span>
              <span className="muted">
                reported {timeAgo(r.createdAt)} by {r.reporter
                  ? <Link to={`/u/${r.reporter.username || r.reporter.id}`} className="report__author">{r.reporter.name}</Link>
                  : 'unknown'}
              </span>
            </div>
            {r.detail && <p className="report__detail">“{r.detail}”</p>}
            <TargetBlock report={r} />
            {status === 'open' && (
              <div className="report__actions">
                <button className="btn btn--ghost btn--sm" disabled={busy === r.id}
                  onClick={() => act(r, { newStatus: 'dismissed' })}>Dismiss</button>
                {removable && (
                  <button className="btn btn--ghost btn--sm btn--danger-ghost" disabled={busy === r.id}
                    onClick={() => act(r, { newStatus: 'actioned', removeContent: true })}>Remove content</button>
                )}
                {removable && bannable && (
                  <button className="btn btn--sm btn--danger" disabled={busy === r.id}
                    onClick={() => act(r, { newStatus: 'actioned', removeContent: true, banAuthor: true })}>Remove + ban author</button>
                )}
                {!removable && bannable && (
                  <button className="btn btn--sm btn--danger" disabled={busy === r.id}
                    onClick={() => act(r, { newStatus: 'actioned', banAuthor: true })}>Ban {r.targetType === 'user' ? 'user' : 'author'}</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
