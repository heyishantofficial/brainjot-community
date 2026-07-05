import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageCircle, Handshake, Search } from 'lucide-react';
import Avatar from '../components/Avatar';
import ChatThread from '../components/ChatThread';
import { api } from '../api';
import { timeAgo } from '../utils';

// The messenger: a WhatsApp-style split view. Left pane lists conversations
// under two tabs — Chats (normal DMs) and Collab Requests (threads started
// from a collab post) — so pitches never bury real conversations. Right pane
// is the open thread. On mobile the panes swap based on whether a thread is
// open (the classic list → chat drill-down).
const TABS = [
  { key: 'dms', label: 'Chats', icon: MessageCircle },
  { key: 'collab', label: 'Collab Requests', icon: Handshake },
];

export default function Messenger() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('dms');
  const [lists, setLists] = useState({ dms: null, collab: null }); // null = not loaded yet
  const [requestCount, setRequestCount] = useState(0); // pending requests waiting on me
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const listsRef = useRef(lists);
  listsRef.current = lists;

  const loadTab = useCallback(async (t) => {
    try {
      const { data } = await api.get('/conversations', { params: { tab: t } });
      setLists((prev) => ({ ...prev, [t]: data.items }));
      setRequestCount(data.requestCount ?? 0);
      return data.items;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => { if (listsRef.current[tab] === null) loadTab(tab); }, [tab, loadTab]);

  // Resolve the open thread from the route. Prefer what's already in a loaded
  // list; a deep link (e.g. arriving from a collab post) fetches the single
  // conversation and jumps to whichever tab it lives in.
  useEffect(() => {
    if (!id) { setSelected(null); return; }
    const { dms, collab } = listsRef.current;
    const known = [...(dms || []), ...(collab || [])].find((c) => c.id === id);
    if (known) {
      setSelected(known);
      setTab(known.kind === 'collab' ? 'collab' : 'dms');
      return;
    }
    let alive = true;
    api.get(`/conversations/${id}`).then(({ data }) => {
      if (!alive) return;
      setSelected(data.conversation);
      setTab(data.conversation.kind === 'collab' ? 'collab' : 'dms');
    }).catch(() => { if (alive) navigate('/messages', { replace: true }); });
    return () => { alive = false; };
  }, [id, navigate]);

  function openConvo(c) {
    // Optimistically clear the unread highlight; the thread marks it read.
    setLists((prev) => ({
      ...prev,
      [tab]: (prev[tab] || []).map((x) => (x.id === c.id ? { ...x, unread: false } : x)),
    }));
    setSelected({ ...c, unread: false });
    navigate(`/messages/${c.id}`);
  }

  // A thread action changed the conversation (accept / decline / reply-accept).
  const handleConvoUpdate = useCallback((updated, action) => {
    const wasPendingOnMe = selected && selected.status === 'pending' && !selected.isRequester;
    const merged = selected && selected.id === updated.id
      ? { ...selected, ...updated, originPost: updated.originPost || selected.originPost }
      : updated;

    if (action === 'decline') {
      setLists((prev) => ({ ...prev, collab: prev.collab ? prev.collab.filter((c) => c.id !== updated.id) : prev.collab }));
      if (wasPendingOnMe) setRequestCount((n) => Math.max(0, n - 1));
      navigate('/messages');
      return;
    }
    setSelected(merged);
    setLists((prev) => ({
      ...prev,
      collab: prev.collab ? prev.collab.map((c) => (c.id === merged.id ? { ...c, ...merged } : c)) : prev.collab,
    }));
    if (wasPendingOnMe) setRequestCount((n) => Math.max(0, n - 1));
  }, [selected, navigate]);

  // Keep the list previews live as messages go out.
  const handleMessageSent = useCallback((convoId, text) => {
    const bump = (arr) => arr && arr.map((c) => (
      c.id === convoId
        ? { ...c, lastMessage: { ...(c.lastMessage || {}), text, createdAt: new Date().toISOString() } }
        : c
    ));
    setLists((prev) => ({ dms: bump(prev.dms), collab: bump(prev.collab) }));
  }, []);

  const rows = lists[tab];
  const q = query.trim().toLowerCase();
  const visible = (rows || []).filter((c) => !q
    || (c.other?.name || '').toLowerCase().includes(q)
    || (c.other?.username || '').toLowerCase().includes(q));

  return (
    <div className={`messenger${id ? ' messenger--open' : ''}`}>
      <aside className="messenger__list">
        <div className="messenger__head"><h1>Messages</h1></div>

        <div className="msgr-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              <t.icon size={15} /> {t.label}
              {t.key === 'collab' && requestCount > 0 && <span className="tab__count">{requestCount > 9 ? '9+' : requestCount}</span>}
            </button>
          ))}
        </div>

        <div className="messenger__search">
          <Search size={15} className="messenger__search-icon" />
          <input className="input input--search" placeholder="Search conversations…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="messenger__rows">
          {rows === null && <p className="muted messenger__note">Loading…</p>}
          {rows !== null && visible.length === 0 && (
            <p className="muted messenger__note">
              {q ? 'No matches.' : tab === 'collab'
                ? 'No collab requests. When someone messages you from a collab post, it lands here — your DMs stay clean.'
                : 'No conversations yet. Message someone from their profile to start talking.'}
            </p>
          )}
          {visible.map((c) => {
            const newRequest = c.kind === 'collab' && c.status === 'pending' && !c.isRequester;
            const sentRequest = c.kind === 'collab' && c.status === 'pending' && c.isRequester;
            return (
              <button key={c.id}
                className={`convo-row${c.unread ? ' unread' : ''}${c.id === id ? ' convo-row--active' : ''}`}
                onClick={() => openConvo(c)}>
                <Avatar user={c.other} size={44} />
                <div className="convo-row__main">
                  <div className="convo-row__top">
                    <span className="convo-row__name">{c.other?.name || 'Unknown'}</span>
                    {c.lastMessage?.createdAt && <span className="muted">{timeAgo(c.lastMessage.createdAt)}</span>}
                  </div>
                  <span className="convo-row__preview muted">
                    {c.lastMessage?.text || (c.originPost ? `re: ${c.originPost.title}` : 'Say hi 👋')}
                  </span>
                </div>
                {newRequest && <span className="req-chip">New</span>}
                {sentRequest && <span className="req-chip req-chip--muted">Pending</span>}
                {!newRequest && !sentRequest && c.unread && <span className="unread-dot" />}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="messenger__thread">
        {selected
          ? <ChatThread key={selected.id} convo={selected} onConvoUpdate={handleConvoUpdate} onMessageSent={handleMessageSent} />
          : (
            <div className="thread-empty">
              <MessageCircle size={40} strokeWidth={1.2} />
              <p>Select a conversation</p>
              <span className="muted">Collab requests stay in their own tab, so your DMs never get buried.</span>
            </div>
          )}
      </section>
    </div>
  );
}
