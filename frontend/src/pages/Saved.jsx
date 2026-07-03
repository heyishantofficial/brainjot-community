import { useEffect, useState } from 'react';
import PostCard from '../components/PostCard';
import { api } from '../api';

export default function Saved() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/posts/saved').then(({ data }) => {
      setItems(data.items); setCursor(data.nextCursor); setHasMore(data.hasMore); setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function loadMore() {
    const { data } = await api.get(`/posts/saved?cursor=${encodeURIComponent(cursor)}`);
    setItems((prev) => [...prev, ...data.items]);
    setCursor(data.nextCursor); setHasMore(data.hasMore);
  }

  return (
    <div className="saved-page">
      <h1>Saved posts</h1>
      {loading && <p className="muted">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="empty muted">Nothing saved yet. Tap the bookmark on any post to keep it here.</p>
      )}
      {items.map((p) => <PostCard key={p.id} post={p} />)}
      {hasMore && <button className="btn btn--ghost load-more" onClick={loadMore}>Load more</button>}
    </div>
  );
}
