import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { api } from '../api';
import { timeAgo } from '../utils';

export default function Inbox() {
  const [convos, setConvos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/conversations').then(({ data }) => { setConvos(data.items); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="inbox">
      <h1>Messages</h1>
      {loading && <p className="muted">Loading…</p>}
      {!loading && convos.length === 0 && (
        <p className="empty muted">No conversations yet. Message someone from a collab post or their profile to start talking.</p>
      )}
      <div className="convo-list">
        {convos.map((c) => (
          <Link key={c.id} to={`/messages/${c.id}`} className={`convo-row ${c.unread ? 'unread' : ''}`}>
            <Avatar user={c.other} size={44} />
            <div className="convo-row__main">
              <div className="convo-row__top">
                <span className="convo-row__name">{c.other?.name || 'Unknown'}</span>
                {c.lastMessage?.createdAt && <span className="muted">{timeAgo(c.lastMessage.createdAt)}</span>}
              </div>
              <span className="convo-row__preview muted">{c.lastMessage?.text || 'Say hi 👋'}</span>
            </div>
            {c.unread && <span className="unread-dot" />}
          </Link>
        ))}
      </div>
    </div>
  );
}
