import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Send, UserPlus, Award } from 'lucide-react';
import Avatar from '../components/Avatar';
import { api, inviteToProjectUrl } from '../api';
import { useAuth } from '../auth';
import { profilePath } from '../utils';

// Polling-based DMs (no websockets on Vercel serverless). The open conversation
// polls for messages newer than the last one it has, every ~2.5s (slower when the
// tab is hidden). Each poll is a cheap indexed `_id > after` query that usually
// returns nothing, so this is light enough for an MVP. When you later move the
// backend to a websocket host, this is the one component to swap back to sockets.
const POLL_ACTIVE_MS = 2500;
const POLL_HIDDEN_MS = 10000;

export default function Conversation() {
  const { id } = useParams();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [other, setOther] = useState(null);
  const [text, setText] = useState('');
  const [endorsing, setEndorsing] = useState(false);
  const [endorseSkill, setEndorseSkill] = useState('');
  const [endorseText, setEndorseText] = useState('');
  const bottomRef = useRef(null);
  const lastIdRef = useRef(null); // newest message id we already have

  async function submitEndorsement(e) {
    e.preventDefault();
    try {
      await api.post(`/users/${other.id}/endorse`, { skill: endorseSkill, text: endorseText });
      setEndorsing(false); setEndorseSkill(''); setEndorseText('');
      alert(`Endorsement added to ${other.name}'s profile. Thanks!`);
    } catch (err) {
      alert(err.response?.data?.error || 'Could not endorse.');
    }
  }

  // Merge in new messages, deduping by id, and advance the poll cursor.
  const mergeMessages = useCallback((incoming) => {
    if (!incoming?.length) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = [...prev];
      for (const m of incoming) if (!seen.has(m.id)) merged.push(m);
      const last = merged[merged.length - 1];
      if (last) lastIdRef.current = last.id;
      return merged;
    });
  }, []);

  // Initial load: history + the other participant, and mark read.
  useEffect(() => {
    let alive = true;
    setMessages([]); lastIdRef.current = null;
    api.get(`/conversations/${id}/messages?limit=50`).then(({ data }) => {
      if (!alive) return;
      setMessages(data.items);
      const last = data.items[data.items.length - 1];
      lastIdRef.current = last ? last.id : null;
    }).catch(() => {});
    api.get('/conversations').then(({ data }) => {
      if (!alive) return;
      const c = data.items.find((x) => x.id === id);
      if (c) setOther(c.other);
    }).catch(() => {});
    api.post(`/conversations/${id}/read`).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // Poll loop for new messages.
  useEffect(() => {
    let timer; let cancelled = false;
    async function poll() {
      if (lastIdRef.current) {
        try {
          const { data } = await api.get(`/conversations/${id}/messages`, { params: { after: lastIdRef.current } });
          if (!cancelled) mergeMessages(data.items);
        } catch { /* transient — try again next tick */ }
      }
      if (!cancelled) timer = setTimeout(poll, document.hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS);
    }
    timer = setTimeout(poll, POLL_ACTIVE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, mergeMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = useCallback(async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    const { data } = await api.post(`/conversations/${id}/messages`, { body });
    mergeMessages([data.message]);
  }, [text, id, mergeMessages]);

  return (
    <div className="conversation">
      <div className="conversation__head">
        <Link to="/messages" className="icon-btn"><ArrowLeft size={18} /></Link>
        {other && (
          <Link to={profilePath(other) || '#'} className="conversation__peer">
            <Avatar user={other} size={36} /> <span>{other.name}</span>
          </Link>
        )}
        {/* The collab→project bridge: hand the hirer to the main app's invite flow,
            prefilled with this person's username. No DB coupling — just a deep link. */}
        {other && (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setEndorsing((v) => !v)} title="Endorse this person on their profile">
              <Award size={15} /> Endorse
            </button>
            <a className="btn btn--ghost btn--sm invite-btn" href={inviteToProjectUrl(other.username)} target="_blank" rel="noreferrer">
              <UserPlus size={15} /> Invite to project
            </a>
          </>
        )}
      </div>

      {endorsing && other && (
        <form className="endorse-form" onSubmit={submitEndorsement}>
          <span className="muted">Endorse {other.name} — shows on their profile as “worked together”.</span>
          <div className="endorse-form__row">
            <input className="input input--sm" placeholder="Skill (e.g. React)" maxLength={40}
              value={endorseSkill} onChange={(e) => setEndorseSkill(e.target.value)} />
            <input className="input input--sm endorse-form__text" placeholder="One line about working with them (optional)" maxLength={140}
              value={endorseText} onChange={(e) => setEndorseText(e.target.value)} />
            <button type="submit" className="btn btn--primary btn--sm">Endorse</button>
          </div>
        </form>
      )}

      <div className="conversation__messages">
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.senderId === user?.id ? 'bubble--me' : ''}`}>
            {m.body}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="conversation__compose" onSubmit={send}>
        <input className="input" placeholder="Type a message…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn--primary" disabled={!text.trim()}><Send size={16} /></button>
      </form>
    </div>
  );
}
