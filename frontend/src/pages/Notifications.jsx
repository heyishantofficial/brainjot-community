import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, AtSign, Reply, Handshake, Check } from 'lucide-react';
import Avatar from '../components/Avatar';
import { api } from '../api';
import { timeAgo } from '../utils';

const TYPE_META = {
  comment: { icon: MessageSquare, label: 'commented on your post' },
  reply: { icon: Reply, label: 'replied to your comment' },
  mention: { icon: AtSign, label: 'mentioned you' },
  collab_request: { icon: Handshake, label: 'sent you a collab request' },
  collab_accepted: { icon: Check, label: 'accepted your collab request' },
};

// Where a notification links to. Collab notifications open the DM thread;
// everything else opens the post.
function notifTarget(n) {
  if ((n.type === 'collab_request' || n.type === 'collab_accepted') && n.conversationId) {
    return `/messages/${n.conversationId}`;
  }
  return n.postId ? `/post/${n.postId}` : '#';
}

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/notifications').then(({ data }) => {
      setItems(data.items); setCursor(data.nextCursor); setHasMore(data.hasMore); setLoading(false);
      // Everything shown is now "seen" — clear the badge and tell the header.
      api.post('/notifications/read-all').then(() => window.dispatchEvent(new Event('badges:refresh'))).catch(() => {});
    }).catch(() => setLoading(false));
  }, []);

  async function loadMore() {
    const { data } = await api.get(`/notifications?cursor=${encodeURIComponent(cursor)}`);
    setItems((prev) => [...prev, ...data.items]);
    setCursor(data.nextCursor); setHasMore(data.hasMore);
  }

  return (
    <div className="notifications">
      <h1>Notifications</h1>
      {loading && <p className="muted">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="empty muted">Nothing yet. When someone comments on your posts, mentions you, or sends a collab request, it shows up here.</p>
      )}
      <div className="notif-list">
        {items.map((n) => {
          const meta = TYPE_META[n.type] || TYPE_META.comment;
          const Icon = meta.icon;
          return (
            <Link key={n.id} to={notifTarget(n)} className={`notif-row ${n.read ? '' : 'unread'}`}>
              <Avatar user={n.actor} size={36} />
              <div className="notif-row__main">
                <span><b>{n.actor?.name || 'Someone'}</b> {meta.label}</span>
                {n.snippet && <span className="muted notif-row__snippet">“{n.snippet}”</span>}
              </div>
              <span className="muted notif-row__time"><Icon size={14} /> {timeAgo(n.createdAt)}</span>
            </Link>
          );
        })}
      </div>
      {hasMore && <button className="btn btn--ghost load-more" onClick={loadMore}>Load more</button>}
    </div>
  );
}
