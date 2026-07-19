import { useEffect, useState } from 'react';
import { api } from '../../api';
import { timeAgo } from '../../utils';

// Immutable trail of every admin action — bans, purges, unlocks, report
// resolutions, new-device logins. Read-only by design.
export default function Audit() {
  const [data, setData] = useState(null);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/admin/audit', { params: { page, ...(action ? { action } : {}) } })
      .then(({ data: d }) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [action, page]);

  if (error) return <p className="empty muted">Couldn't load the audit log.</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const dangerous = (a) => a.includes('ban') || a.includes('fail') || a.includes('purge') || a.includes('new_device');

  return (
    <div className="admin-audit">
      <div className="admin__filters">
        <select className="input admin-audit__filter" value={action}
          onChange={(e) => { setAction(e.target.value); setPage(0); }}>
          <option value="">All actions</option>
          {data.actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
        <span className="muted admin-users__total">{data.total} entries</span>
      </div>

      {data.items.map((i, idx) => (
        <div key={idx} className="audit-row">
          <span className={`audit-row__action${dangerous(i.action) ? ' audit-row__action--danger' : ''}`}>
            {i.action.replace(/_/g, ' ')}
          </span>
          <span className="muted">by {i.actorName}</span>
          <span className="muted">→ {i.targetType} {i.targetId}</span>
          {Object.keys(i.meta).length > 0 && (
            <span className="audit-row__meta muted">{JSON.stringify(i.meta)}</span>
          )}
          <span className="audit-row__time muted">{timeAgo(i.createdAt)}</span>
        </div>
      ))}
      {data.items.length === 0 && <p className="empty muted">No entries yet.</p>}

      <div className="admin__filters">
        {page > 0 && <button className="btn btn--ghost btn--sm" onClick={() => setPage(page - 1)}>← Newer</button>}
        {(page + 1) * 50 < data.total && <button className="btn btn--ghost btn--sm" onClick={() => setPage(page + 1)}>Older →</button>}
      </div>
    </div>
  );
}
