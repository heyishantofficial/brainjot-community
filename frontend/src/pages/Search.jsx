import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PostCard from '../components/PostCard';
import { api } from '../api';

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q) { setItems([]); return; }
    setLoading(true);
    api.get(`/posts/search?q=${encodeURIComponent(q)}`)
      .then(({ data }) => setItems(data.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [q]);

  return (
    <div className="search-page">
      <h1>Search</h1>
      {q && <p className="muted">Results for “{q}”</p>}
      {loading && <p className="muted">Searching…</p>}
      {!loading && q && items.length === 0 && (
        <p className="empty muted">No posts match “{q}”. Try different words or fewer of them.</p>
      )}
      {items.map((p) => <PostCard key={p.id} post={p} />)}
    </div>
  );
}
