import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import InfoTip from '../../components/InfoTip';

function fmtDay(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Delta vs the previous 24h window. Sign + arrow carry the direction (never
// color alone); flat days render a muted "—".
function Delta({ now, prev }) {
  const diff = now - prev;
  if (diff === 0) return <span className="stat-tile__delta muted">— vs prev 24h</span>;
  const up = diff > 0;
  return (
    <span className={`stat-tile__delta ${up ? 'delta--up' : 'delta--down'}`}>
      {up ? '▲' : '▼'} {up ? '+' : ''}{diff} vs prev 24h
    </span>
  );
}

function StatTile({ label, value, sub, alert, to }) {
  const body = (
    <>
      <div className="stat-tile__label">{label}</div>
      <div className="stat-tile__value">{value}</div>
      {sub}
    </>
  );
  const cls = `stat-tile${alert ? ' stat-tile--alert' : ''}`;
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

// 14-day single-series mini bar chart. No library: flexbox bars anchored to the
// baseline, rounded data-end on top, 2px gaps, per-bar hover tooltip. One series
// per card, so the card title is the legend.
function MiniBars({ label, series }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...series.map((d) => d.n));
  const total = series.reduce((a, d) => a + d.n, 0);
  return (
    <div className="chart-card">
      <div className="chart-card__head">
        <span className="chart-card__title">{label}</span>
        <span className="muted">{total} in 14d</span>
      </div>
      <div className="minibars" onMouseLeave={() => setHover(null)}>
        {hover != null && (
          <div className="minibars__tip" style={{ left: `${((hover + 0.5) / series.length) * 100}%` }}>
            {fmtDay(series[hover].day)} · {series[hover].n}
          </div>
        )}
        {series.map((d, i) => (
          <div key={d.day} className="minibars__slot" onMouseEnter={() => setHover(i)}>
            <div
              className={`minibars__bar${d.n === 0 ? ' minibars__bar--zero' : ''}${hover === i ? ' minibars__bar--hover' : ''}`}
              style={{ height: d.n === 0 ? '2px' : `${Math.max(6, (d.n / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="minibars__axis">
        <span>{fmtDay(series[0].day)}</span>
        <span>{fmtDay(series[series.length - 1].day)}</span>
      </div>
    </div>
  );
}

// Growth accounting + cohort retention, computed server-side from DB truth.
function GrowthSection({ growth }) {
  if (!growth) return null;
  const a = growth.accounting;
  const funnel = [
    { label: `Signed up (last ${growth.funnel.windowWeeks} wks)`, value: growth.funnel.signedUp },
    { label: 'Activated — posted or commented in week 1', value: growth.funnel.contributedWk1 },
    { label: 'Returned in week 2', value: growth.funnel.returnedWeek2 },
  ];
  const fmax = Math.max(1, ...funnel.map((f) => f.value));
  return (
    <>
      <h3 className="admin-section-title">Growth — week of {a.weekOf}</h3>
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-tile__label">Active this week <InfoTip text="Unique users who took any action this week. The base number everything else here is measured against." /></div><div className="stat-tile__value">{a.activeThisWeek}</div><span className="stat-tile__delta muted">{a.activeLastWeek} last week</span></div>
        <div className="stat-tile"><div className="stat-tile__label">New <InfoTip text="Users who joined this week — the top of the funnel." /></div><div className="stat-tile__value">{a.new}</div></div>
        <div className="stat-tile"><div className="stat-tile__label">Retained <InfoTip text="Active last week AND this week — your durable base." /></div><div className="stat-tile__value">{a.retained}</div></div>
        <div className="stat-tile"><div className="stat-tile__label">Resurrected <InfoTip text="Joined before last week, inactive last week, back this week — proof the community is worth returning to." /></div><div className="stat-tile__value">{a.resurrected}</div></div>
        <div className="stat-tile"><div className="stat-tile__label">Churned <InfoTip text="Active last week, gone this week. Watch this rise before total activity falls." /></div><div className="stat-tile__value">{a.churned}</div></div>
        <div className="stat-tile">
          <div className="stat-tile__label">Quick ratio <InfoTip text="(New + Resurrected) ÷ Churned. Below 1 means you're losing engaged users faster than gaining them — fix retention before pushing growth." /></div>
          <div className="stat-tile__value">{a.quickRatio == null ? '—' : a.quickRatio}</div>
          <span className={`stat-tile__delta ${a.quickRatio == null ? 'muted' : a.quickRatio >= 1 ? 'delta--up' : 'delta--down'}`}>(new+resurrected) / churned</span>
        </div>
      </div>
      <p className="muted admin-footnote">Weekly activity recording started with this release — retained / resurrected / churned become fully accurate after two weeks of data.</p>

      <h3 className="admin-section-title">Cohort retention (% of each signup week active later)</h3>
      <div className="cohort-scroll">
        <table className="cohort-table">
          <thead>
            <tr><th>Cohort</th><th>Size</th>{Array.from({ length: 8 }, (_, i) => <th key={i}>W{i}</th>)}</tr>
          </thead>
          <tbody>
            {growth.cohorts.map((c) => (
              <tr key={c.week}>
                <td className="cohort-table__week">{c.week}</td>
                <td className="cohort-table__size">{c.size}</td>
                {Array.from({ length: 8 }, (_, i) => {
                  const v = c.cells[i];
                  const filled = v != null && c.size > 0;
                  return (
                    <td key={i} className="cohort-cell" title={filled ? `${v}% active` : ''}
                      style={filled ? { background: `color-mix(in srgb, var(--accent) ${12 + v * 0.6}%, transparent)` } : undefined}>
                      {filled ? `${v}%` : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="admin-section-title">Activation funnel</h3>
      <div className="funnel">
        {funnel.map((f) => (
          <div key={f.label} className="funnel__row">
            <span className="funnel__label">{f.label}</span>
            <div className="funnel__track"><div className="funnel__bar" style={{ width: `${(f.value / fmax) * 100}%` }} /></div>
            <span className="funnel__value">{f.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Overview() {
  const [stats, setStats] = useState(null);
  const [growth, setGrowth] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get('/admin/stats').then(({ data }) => setStats(data)).catch(() => setError(true));
    api.get('/admin/growth').then(({ data }) => setGrowth(data)).catch(() => {});
  }, []);

  if (error) return <p className="empty muted">Couldn't load stats. Refresh to retry.</p>;
  if (!stats) return <p className="muted">Loading…</p>;

  const { users, posts, comments, reports, series } = stats;
  return (
    <div className="admin-overview">
      <div className="stat-grid">
        <StatTile
          label="Open reports" value={reports.open} alert={reports.open > 0} to="/admin/moderation"
          sub={<span className="stat-tile__delta muted">{reports.open > 0 ? 'needs review →' : 'queue clear'}</span>}
        />
        <StatTile label="Active today" value={users.dau} sub={<span className="stat-tile__delta muted">{users.wau} this week</span>} />
        <StatTile label="New signups · 24h" value={users.last24h} sub={<Delta now={users.last24h} prev={users.prev24h} />} />
        <StatTile label="Posts · 24h" value={posts.last24h} sub={<Delta now={posts.last24h} prev={posts.prev24h} />} />
        <StatTile label="Comments · 24h" value={comments.last24h} sub={<Delta now={comments.last24h} prev={comments.prev24h} />} />
        <StatTile
          label="Total users" value={users.total}
          sub={<span className="stat-tile__delta muted">{users.banned} banned</span>}
        />
      </div>

      <div className="chart-grid">
        <MiniBars label="Signups" series={series.signups} />
        <MiniBars label="Posts" series={series.posts} />
        <MiniBars label="Comments" series={series.comments} />
      </div>

      <h3 className="admin-section-title">Moderation SLA</h3>
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-tile__label">Median time to action</div>
          <div className="stat-tile__value">{reports.medianResolveHours == null ? '—' : `${reports.medianResolveHours}h`}</div>
          <span className="stat-tile__delta muted">{reports.resolved30d} resolved · 30d</span>
        </div>
        <div className={`stat-tile${reports.oldestOpenHours > 24 ? ' stat-tile--alert' : ''}`}>
          <div className="stat-tile__label">Oldest waiting report</div>
          <div className="stat-tile__value">{reports.oldestOpenHours == null ? '—' : `${reports.oldestOpenHours}h`}</div>
          <span className="stat-tile__delta muted">{reports.oldestOpenHours == null ? 'queue empty' : 'red past 24h'}</span>
        </div>
      </div>
      {reports.throughput && <div className="chart-grid"><MiniBars label="Reports resolved" series={reports.throughput} /></div>}

      <GrowthSection growth={growth} />

      <p className="muted admin-footnote">
        Totals: {posts.total} active posts · {comments.total} active comments. Daily bars are UTC days; “24h” tiles are rolling windows.
      </p>
    </div>
  );
}
