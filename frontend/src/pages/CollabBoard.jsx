import { useEffect, useState, useCallback } from 'react';
import PostCard from '../components/PostCard';
import { api } from '../api';

// The collab board: the feed filtered to collab posts, with structured filters.
// Backed by the {type, collab.status, _id} index, so it stays fast at scale.
export default function CollabBoard() {
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ intent: '', commitment: '', skill: '', collabStatus: 'open' });
  // The skill text field is debounced: typing updates skillInput instantly, but
  // the API-triggering filter only updates 400ms after the user stops typing —
  // otherwise every keystroke fires a request.
  const [skillInput, setSkillInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.skill === skillInput ? f : { ...f, skill: skillInput })), 400);
    return () => clearTimeout(t);
  }, [skillInput]);

  const load = useCallback(async (reset) => {
    setLoading(true);
    const q = new URLSearchParams({ type: 'collab', sort: 'new', collabStatus: filters.collabStatus });
    if (filters.intent) q.set('intent', filters.intent);
    if (filters.commitment) q.set('commitment', filters.commitment);
    if (filters.skill) q.set('skill', filters.skill);
    if (!reset && cursor) q.set('cursor', cursor);
    const { data } = await api.get(`/posts?${q.toString()}`);
    setPosts((prev) => (reset ? data.items : [...prev, ...data.items]));
    setCursor(data.nextCursor);
    setHasMore(data.hasMore);
    setLoading(false);
  }, [filters, cursor]);

  useEffect(() => { setPosts([]); setCursor(null); load(true); /* eslint-disable-next-line */ }, [filters]);

  return (
    <div className="collab-board">
      <div className="board-head">
        <h1>🤝 Collab Board</h1>
        <p className="muted">Find people to build with. Message them, talk it through, then invite them into your project.</p>
      </div>

      <div className="board-filters">
        <select className="input input--sm" value={filters.intent} onChange={(e) => setFilters({ ...filters, intent: e.target.value })}>
          <option value="">All</option>
          <option value="looking_for">Looking for help</option>
          <option value="offering">Offering help</option>
        </select>
        <select className="input input--sm" value={filters.commitment} onChange={(e) => setFilters({ ...filters, commitment: e.target.value })}>
          <option value="">Any commitment</option>
          <option value="full_time">Full-time</option>
          <option value="part_time">Part-time</option>
          <option value="one_off">One-off</option>
          <option value="flexible">Flexible</option>
        </select>
        <input className="input input--sm" placeholder="Skill (e.g. react)" value={skillInput}
          onChange={(e) => setSkillInput(e.target.value)} />
        <select className="input input--sm" value={filters.collabStatus} onChange={(e) => setFilters({ ...filters, collabStatus: e.target.value })}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {posts.map((p) => <PostCard key={p.id} post={p} />)}
      {!loading && posts.length === 0 && <p className="empty muted">No collab posts match. Try widening your filters.</p>}
      {hasMore && <button className="btn btn--ghost load-more" onClick={() => load(false)} disabled={loading}>Load more</button>}
    </div>
  );
}
