import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { timeAgo } from '../../utils';
import InfoTip from '../../components/InfoTip';

function fmtDay(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function ResponseRateSection({ data }) {
  if (!data) return null;
  const max = Math.max(1, ...data.series14d.map((d) => d.total));
  return (
    <>
      <h3 className="admin-section-title">
        Response rate <InfoTip text="Share of new posts that get a first reply within 24 hours. This is the single best predictor of whether a first-time poster ever posts again — below ~60%, new posters are shouting into a void. Below that, YOU are the fix: reply to the unanswered list yourself." />
      </h3>
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-tile__label">Answered within 24h (7d)</div>
          <div className="stat-tile__value">{data.last7dPct == null ? '—' : `${data.last7dPct}%`}</div>
          <span className="stat-tile__delta muted">{data.last7dTotal} posts</span>
        </div>
      </div>
      <div className="minibars" style={{ marginTop: 10 }}>
        {data.series14d.map((d) => (
          <div key={d.day} className="minibars__slot" title={d.pct == null ? `${fmtDay(d.day)}: no posts` : `${fmtDay(d.day)}: ${d.pct}% of ${d.total}`}>
            <div className={`minibars__bar${d.pct == null ? ' minibars__bar--zero' : ''}`} style={{ height: d.pct == null ? '2px' : `${Math.max(6, (d.total / max) * 100)}%`, background: d.pct == null ? undefined : d.pct >= 60 ? 'var(--accent)' : 'var(--danger)' }} />
          </div>
        ))}
      </div>
      <div className="minibars__axis"><span>{fmtDay(data.series14d[0].day)}</span><span>{fmtDay(data.series14d.at(-1).day)}</span></div>

      {data.unansweredOpenPosts.length > 0 && (
        <>
          <h4 className="admin-subsection-title">Waiting for a first reply</h4>
          {data.unansweredOpenPosts.map((p) => (
            <div key={p.id} className="user-detail__row">
              <Link to={`/post/${p.id}`}>{p.title}</Link>
              <span className="muted">by {p.authorName} · {timeAgo(p.createdAt)}</span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function PyramidSection({ pyramid }) {
  if (!pyramid?.length) return null;
  const max = Math.max(1, ...pyramid.map((w) => w.activeTotal));
  return (
    <>
      <h3 className="admin-section-title">
        Contribution pyramid <InfoTip text="Every active user, split into lurkers (read only), voters, commenters, and posters — the layer that creates content. Healthy communities run roughly 90/9/1; what matters over time is whether the creator layer (posters) is growing, not the exact ratio." />
      </h3>
      <div className="pyramid">
        {pyramid.map((w) => (
          <div key={w.week} className="pyramid__col">
            <div className="pyramid__bar" style={{ height: '110px' }}>
              <div className="pyramid__seg pyramid__seg--posters" style={{ height: `${(w.posters / max) * 100}%` }} title={`${w.posters} posters`} />
              <div className="pyramid__seg pyramid__seg--commenters" style={{ height: `${(w.commenters / max) * 100}%` }} title={`${w.commenters} commenters`} />
              <div className="pyramid__seg pyramid__seg--voters" style={{ height: `${(w.voters / max) * 100}%` }} title={`${w.voters} voters`} />
              <div className="pyramid__seg pyramid__seg--lurkers" style={{ height: `${(w.lurkers / max) * 100}%` }} title={`${w.lurkers} lurkers`} />
            </div>
            <div className="pyramid__label muted">{w.week.slice(5)}</div>
          </div>
        ))}
      </div>
      <div className="pyramid__legend">
        <span><i className="pyramid__dot pyramid__dot--posters" /> Posters</span>
        <span><i className="pyramid__dot pyramid__dot--commenters" /> Commenters</span>
        <span><i className="pyramid__dot pyramid__dot--voters" /> Voters</span>
        <span><i className="pyramid__dot pyramid__dot--lurkers" /> Lurkers</span>
      </div>
    </>
  );
}

function ConcentrationSection({ data }) {
  if (!data) return null;
  return (
    <>
      <h3 className="admin-section-title">
        Creator concentration <InfoTip text="What share of all posts+comments (last 30 days) comes from the top 10% of contributors. A high number means the feed depends on a handful of people — worth knowing who they are so you never accidentally lose one. Not necessarily bad early on; worth watching as the community grows." />
      </h3>
      <div className="stat-grid">
        <div className={`stat-tile${data.top10SharePct >= 70 ? ' stat-tile--alert' : ''}`}>
          <div className="stat-tile__label">Top 10% share content</div>
          <div className="stat-tile__value">{data.top10SharePct == null ? '—' : `${data.top10SharePct}%`}</div>
        </div>
        <div className="stat-tile"><div className="stat-tile__label">Unique creators (30d)</div><div className="stat-tile__value">{data.uniqueCreators}</div></div>
      </div>
      {data.topCreators.length > 0 && (
        <>
          <h4 className="admin-subsection-title">Top creators (30d)</h4>
          {data.topCreators.map((c) => (
            <div key={c.authorId} className="user-detail__row">
              <span>{c.name}</span>
              <span className="muted">{c.count} posts+comments</span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function TopicHeatSection({ topics }) {
  if (!topics?.length) return null;
  const max = Math.max(1, ...topics.map((t) => t.posts));
  return (
    <>
      <h3 className="admin-section-title">
        Topic heat (30d) <InfoTip text="Posts and average engagement (votes + comments) per topic. High posts + low engagement = seed better prompts or consider retiring the topic. Low posts + high engagement = an underserved topic worth encouraging." />
      </h3>
      <div className="funnel">
        {topics.map((t) => (
          <div key={t.topic} className="funnel__row">
            <span className="funnel__label">{t.topic}</span>
            <div className="funnel__track"><div className="funnel__bar" style={{ width: `${(t.posts / max) * 100}%` }} /></div>
            <span className="funnel__value">{t.posts}<span className="muted" style={{ fontWeight: 400, fontSize: '11px' }}> · {t.avgEngagement} eng/post</span></span>
          </div>
        ))}
      </div>
    </>
  );
}

function BridgeFunnelSection({ data }) {
  if (!data) return null;
  return (
    <>
      <h3 className="admin-section-title">
        Community → app bridge <InfoTip text="How many collab requests turn into accepted collaborations. This chain is the community's real reason to exist — networking that becomes actual work together. The final step (an accepted collaborator invited into a real project) happens on the main app and isn't in this database; it's tracked going forward as an invite_sent event in PostHog." />
      </h3>
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-tile__label">Collab requests sent</div><div className="stat-tile__value">{data.collabRequestsSent}</div></div>
        <div className="stat-tile"><div className="stat-tile__label">Accepted</div><div className="stat-tile__value">{data.collabRequestsAccepted}</div></div>
        <div className="stat-tile"><div className="stat-tile__label">Acceptance rate</div><div className="stat-tile__value">{data.acceptanceRatePct == null ? '—' : `${data.acceptanceRatePct}%`}</div></div>
      </div>
    </>
  );
}

export default function CommunityHealth() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get('/admin/community-health').then(({ data: d }) => setData(d)).catch(() => setError(true));
  }, []);

  if (error) return <p className="empty muted">Couldn't load community health data.</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="admin-community-health">
      <ResponseRateSection data={data.responseRate} />
      <PyramidSection pyramid={data.pyramid} />
      <ConcentrationSection data={data.concentration} />
      <TopicHeatSection topics={data.topicHeat} />
      <BridgeFunnelSection data={data.bridgeFunnel} />
    </div>
  );
}
