import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Flame, Clock, Sparkles, Star } from 'lucide-react';
import PostCard from '../components/PostCard';
import { api } from '../api';
import { useAuth } from '../auth';

export default function Feed() {
  const { user, setUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const sort = params.get('sort') || 'hot';
  const feed = params.get('feed') || '';
  const topic = params.get('topic') || '';

  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [topics, setTopics] = useState([]);

  const followed = user?.followedTopics || [];

  useEffect(() => { api.get('/posts/topics').then(({ data }) => setTopics(data.topics)).catch(() => {}); }, []);

  const load = useCallback(async (reset) => {
    setLoading(true);
    const q = new URLSearchParams({ sort });
    if (feed) q.set('feed', feed);
    if (topic) q.set('topic', topic);
    if (!reset && cursor) q.set('cursor', cursor);
    const { data } = await api.get(`/posts?${q.toString()}`);
    setPosts((prev) => (reset ? data.items : [...prev, ...data.items]));
    setCursor(data.nextCursor);
    setHasMore(data.hasMore);
    setLoading(false);
  }, [sort, feed, topic, cursor]);

  // Reload from scratch when sort/feed/topic change.
  useEffect(() => { setPosts([]); setCursor(null); load(true); /* eslint-disable-next-line */ }, [sort, feed, topic]);

  function setTab({ nextSort, nextFeed }) {
    const p = new URLSearchParams(params);
    p.set('sort', nextSort || 'hot');
    if (nextFeed) p.set('feed', nextFeed); else p.delete('feed');
    setParams(p);
  }

  // Follow/unfollow a topic (star on the chip); keeps the auth context's copy in
  // sync so the "For you" tab appears/disappears immediately.
  async function toggleFollow(slug, e) {
    e.stopPropagation();
    const { data } = await api.patch('/users/me/topics', { topic: slug });
    setUser((u) => ({ ...u, followedTopics: data.followedTopics }));
  }

  return (
    <div className="feed-layout">
      <div className="feed-main">
        <div className="feed-tabs">
          <button className={`tab ${sort === 'hot' && !feed ? 'active' : ''}`} onClick={() => setTab({ nextSort: 'hot' })}><Flame size={16} /> Trending</button>
          <button className={`tab ${sort === 'new' && !feed ? 'active' : ''}`} onClick={() => setTab({ nextSort: 'new' })}><Clock size={16} /> Latest</button>
          {user && followed.length > 0 && (
            <button className={`tab ${feed === 'foryou' ? 'active' : ''}`} onClick={() => setTab({ nextSort: 'hot', nextFeed: 'foryou' })}><Sparkles size={16} /> For you</button>
          )}
          {topic && <span className="active-topic">#{topic} <button onClick={() => { const p = new URLSearchParams(params); p.delete('topic'); setParams(p); }}>×</button></span>}
        </div>

        {posts.map((p) => <PostCard key={p.id} post={p} />)}
        {loading && posts.length === 0 && <div className="skeleton-list">{[...Array(4)].map((_, i) => <div key={i} className="skeleton-card" />)}</div>}
        {!loading && posts.length === 0 && (
          <p className="empty muted">{feed === 'foryou' ? 'No recent posts in your followed topics.' : 'No posts yet — be the first to post.'}</p>
        )}
        {hasMore && <button className="btn btn--ghost load-more" onClick={() => load(false)} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>}
      </div>

      <aside className="feed-side">
        <div className="side-card">
          <h3>Topics</h3>
          <div className="topic-list">
            {topics.map((t) => (
              <div key={t.slug} className={`topic-pill ${topic === t.slug ? 'active' : ''}`}>
                <button className="topic-pill__main" onClick={() => { const p = new URLSearchParams(params); p.set('topic', t.slug); setParams(p); }}>
                  <span>{t.emoji}</span> {t.label}
                </button>
                {user && (
                  <button className={`topic-pill__star ${followed.includes(t.slug) ? 'on' : ''}`}
                    onClick={(e) => toggleFollow(t.slug, e)}
                    title={followed.includes(t.slug) ? 'Unfollow topic' : 'Follow topic — adds it to your For you feed'}>
                    <Star size={13} fill={followed.includes(t.slug) ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="side-card side-card--cta">
          <h3>🤝 Looking to collaborate?</h3>
          <p className="muted">Post a collab, find people, and bring them into your brainjot projects.</p>
          <a href="/collab" className="btn btn--ghost btn--block">Browse collab board</a>
        </div>
      </aside>
    </div>
  );
}
