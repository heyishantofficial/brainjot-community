import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Send, UserPlus, Award, ChevronDown, ExternalLink, Check, CheckCheck, X, Handshake } from 'lucide-react';
import Avatar from './Avatar';
import { api, inviteToProjectUrl, fetchMyMainProjects, sendProjectInvite } from '../api';
import { useAuth } from '../auth';
import { profilePath } from '../utils';

// Short clock time for a message's meta line (e.g. "3:45 PM").
function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}

// Polling-based DMs (no websockets on Vercel serverless). The open conversation
// polls for messages newer than the last one it has, every ~2.5s (slower when the
// tab is hidden). Each poll is a cheap indexed `_id > after` query that usually
// returns nothing, so this is light enough for an MVP. When you later move the
// backend to a websocket host, this is the one component to swap back to sockets.
const POLL_ACTIVE_MS = 2500;
const POLL_HIDDEN_MS = 10000;

// One open thread inside the Messenger split view. Renders the classic chat
// (header / bubbles / composer) plus the collab-request layer: a pending
// request shows Accept/Decline to the recipient, while the requester is held
// to their single intro message until the other side responds.
// Mount with key={convo.id} so all state resets when switching threads.
export default function ChatThread({ convo, onConvoUpdate, onMessageSent }) {
  const id = convo.id;
  const other = convo.other;
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [peerLastReadAt, setPeerLastReadAt] = useState(null); // drives sent/read ticks
  const [text, setText] = useState('');
  const [responding, setResponding] = useState(false);
  const [endorsing, setEndorsing] = useState(false);
  const [endorseSkill, setEndorseSkill] = useState('');
  const [endorseText, setEndorseText] = useState('');
  // "Invite to project" dropdown state. projects: null = not fetched yet.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [projects, setProjects] = useState(null);
  const [projectsError, setProjectsError] = useState('');
  const [invitingId, setInvitingId] = useState('');
  const [invitedIds, setInvitedIds] = useState(new Set()); // projects we sent an invite for this session
  const bottomRef = useRef(null);
  const lastIdRef = useRef(null); // newest message id we already have

  // Request-gate state. `status === 'declined'` is only ever seen by the
  // recipient (the API masks it as 'pending' for the requester).
  const isCollab = convo.kind === 'collab';
  const pending = isCollab && convo.status === 'pending';
  const declined = isCollab && convo.status === 'declined';
  const iAmRequester = !!convo.isRequester;
  const sentIntro = messages.some((m) => m.senderId === user?.id);
  const composerLocked = pending && iAmRequester && sentIntro;

  // Open the dropdown; lazily fetch the hirer's projects from the MAIN app on
  // first open. A 401 means this browser has no main-app session — we show the
  // deep-link fallback instead of the list.
  async function toggleInviteMenu() {
    const opening = !inviteOpen;
    setInviteOpen(opening);
    if (opening && projects === null) {
      try {
        setProjects(await fetchMyMainProjects());
        setProjectsError('');
      } catch {
        setProjects([]);
        setProjectsError('Couldn’t load your projects — use the invite page instead.');
      }
    }
  }

  async function inviteToProject(p) {
    if (invitingId || invitedIds.has(p.id)) return;
    setInvitingId(p.id);
    try {
      await sendProjectInvite({ username: other.username, projectId: p.id });
      setInvitedIds((prev) => new Set(prev).add(p.id));
    } catch (err) {
      alert(err.response?.data?.error || 'Could not send the invite.');
    } finally {
      setInvitingId('');
    }
  }

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

  // Accept or decline the pending collab request (recipient only). The parent
  // owns the convo object and the inbox lists, so the updated state lifts up.
  async function respond(action) {
    if (responding) return;
    setResponding(true);
    try {
      const { data } = await api.post(`/conversations/${id}/request`, { action });
      onConvoUpdate?.(data.conversation, action);
    } catch (err) {
      alert(err.response?.data?.error || 'Could not update the request.');
    } finally {
      setResponding(false);
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

  // Initial load: history, and mark read (then refresh the header badge).
  useEffect(() => {
    let alive = true;
    setMessages([]); lastIdRef.current = null; setPeerLastReadAt(null);
    api.get(`/conversations/${id}/messages?limit=50`).then(({ data }) => {
      if (!alive) return;
      setMessages(data.items);
      setPeerLastReadAt(data.peerLastReadAt || null);
      const last = data.items[data.items.length - 1];
      lastIdRef.current = last ? last.id : null;
    }).catch(() => {});
    api.post(`/conversations/${id}/read`)
      .then(() => window.dispatchEvent(new Event('badges:refresh')))
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // Poll loop for new messages.
  useEffect(() => {
    let timer; let cancelled = false;
    async function poll() {
      if (lastIdRef.current) {
        try {
          const { data } = await api.get(`/conversations/${id}/messages`, { params: { after: lastIdRef.current } });
          if (!cancelled) {
            mergeMessages(data.items);
            setPeerLastReadAt(data.peerLastReadAt || null);
            // New messages from the peer arrived while I have the thread open →
            // advance my read cursor so THEY see their messages turn "read", and
            // clear my own unread badge.
            if (data.items?.some((m) => m.senderId !== user?.id)) {
              api.post(`/conversations/${id}/read`).then(() => window.dispatchEvent(new Event('badges:refresh'))).catch(() => {});
            }
          }
        } catch { /* transient — try again next tick */ }
      }
      if (!cancelled) timer = setTimeout(poll, document.hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS);
    }
    timer = setTimeout(poll, POLL_ACTIVE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, mergeMessages, user?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = useCallback(async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      const { data } = await api.post(`/conversations/${id}/messages`, { body });
      mergeMessages([data.message]);
      onMessageSent?.(id, body);
      // The recipient replying to a pending (or declined) request accepts it
      // server-side — mirror that locally so the banner clears immediately.
      if (isCollab && convo.status !== 'active' && !iAmRequester) {
        onConvoUpdate?.({ ...convo, status: 'active' }, 'accept');
      }
    } catch (err) {
      setText(body); // don't eat the draft on failure
      alert(err.response?.data?.error || 'Could not send the message.');
    }
  }, [text, id, mergeMessages, convo, isCollab, iAmRequester, onConvoUpdate, onMessageSent]);

  const originPost = convo.originPost;

  return (
    <div className="conversation conversation--pane">
      <div className="conversation__head">
        <Link to="/messages" className="icon-btn msgr-back"><ArrowLeft size={18} /></Link>
        {other && (
          <Link to={profilePath(other) || '#'} className="conversation__peer">
            <Avatar user={other} size={36} /> <span>{other.name}</span>
          </Link>
        )}
        {isCollab && <span className="req-chip req-chip--muted"><Handshake size={12} /> Collab</span>}
        {/* The collab→project bridge: pick one of YOUR projects from the dropdown
            and the invite goes straight to this person (main app resolves their
            handle, emails them, and drops an in-app invite notification). The
            deep link into the main app's invite UI remains as the fallback. */}
        {other && (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setEndorsing((v) => !v)} title="Endorse this person on their profile">
              <Award size={15} /> Endorse
            </button>
            <div className="invite-dd">
              <button className="btn btn--ghost btn--sm" onClick={toggleInviteMenu} title="Invite this person to one of your projects">
                <UserPlus size={15} /> Invite to project <ChevronDown size={13} />
              </button>
              {inviteOpen && (
                <>
                  <div className="invite-dd__backdrop" onClick={() => setInviteOpen(false)} />
                  <div className="invite-dd__menu">
                    {projects === null && <div className="invite-dd__note muted">Loading your projects…</div>}
                    {projectsError && <div className="invite-dd__note muted">{projectsError}</div>}
                    {projects !== null && !projectsError && projects.length === 0 && (
                      <div className="invite-dd__note muted">You don’t own any projects yet.</div>
                    )}
                    {(projects || []).map((p) => (
                      <button key={p.id} className="invite-dd__item" disabled={invitingId === p.id || invitedIds.has(p.id)}
                        onClick={() => inviteToProject(p)}>
                        <span className="invite-dd__icon">{p.icon || '📁'}</span>
                        <span className="invite-dd__title">{p.title}</span>
                        {invitedIds.has(p.id)
                          ? <span className="invite-dd__state invite-dd__state--sent"><Check size={13} /> Sent</span>
                          : <span className="invite-dd__state">{invitingId === p.id ? 'Sending…' : 'Invite'}</span>}
                      </button>
                    ))}
                    <a className="invite-dd__item invite-dd__item--link" href={inviteToProjectUrl(other.username)} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} /> Open invite page in main app
                    </a>
                  </div>
                </>
              )}
            </div>
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
        {messages.map((m, i) => {
          const mine = m.senderId === user?.id;
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const startOfRun = !prev || prev.senderId !== m.senderId;
          const endOfRun = !next || next.senderId !== m.senderId;
          // "Read" once the peer's read cursor has passed this message's time.
          const read = mine && peerLastReadAt && new Date(m.createdAt) <= new Date(peerLastReadAt);
          return (
            <div
              key={m.id}
              className={`bubble-row${mine ? ' bubble-row--me' : ''}${startOfRun ? ' bubble-row--start' : ''}${endOfRun ? ' bubble-row--tail' : ''}`}
            >
              <div className={`bubble${mine ? ' bubble--me' : ''}`}>
                <span className="bubble__text">{m.body}</span>
                <span className="bubble__meta">
                  <span className="bubble__time">{formatTime(m.createdAt)}</span>
                  {mine && (read
                    ? <CheckCheck size={15} className="bubble__tick bubble__tick--read" aria-label="Read" />
                    : <Check size={15} className="bubble__tick" aria-label="Sent" />)}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Collab-request layer, right above the composer (Instagram-style). */}
      {pending && !iAmRequester && (
        <div className="req-banner">
          <Handshake size={16} />
          <span>
            <strong>{other?.name}</strong> wants to collaborate
            {originPost && <> on <Link to={`/post/${originPost.id}`} className="req-banner__post">“{originPost.title}”</Link></>}.
            {' '}Accept to open the chat — replying also accepts.
          </span>
          <div className="req-banner__actions">
            <button className="btn btn--primary btn--sm" disabled={responding} onClick={() => respond('accept')}>
              <Check size={14} /> Accept
            </button>
            <button className="btn btn--ghost btn--sm" disabled={responding} onClick={() => respond('decline')}>
              <X size={14} /> Decline
            </button>
          </div>
        </div>
      )}
      {pending && iAmRequester && (
        <div className="req-banner req-banner--muted">
          <Handshake size={16} />
          <span>
            Collab request sent{originPost && <> for <Link to={`/post/${originPost.id}`} className="req-banner__post">“{originPost.title}”</Link></>} —
            waiting for {other?.name || 'them'} to accept.
          </span>
        </div>
      )}
      {declined && !iAmRequester && (
        <div className="req-banner req-banner--muted">
          <span>You declined this request. Replying (or accepting) will reopen the chat.</span>
          <div className="req-banner__actions">
            <button className="btn btn--ghost btn--sm" disabled={responding} onClick={() => respond('accept')}>
              <Check size={14} /> Accept instead
            </button>
          </div>
        </div>
      )}

      <form className="conversation__compose" onSubmit={send}>
        <input
          className="input"
          disabled={composerLocked}
          placeholder={
            composerLocked
              ? `You can send more once ${other?.name || 'they'} responds`
              : pending && !iAmRequester ? 'Reply to accept…' : 'Type a message…'
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={composerLocked || !text.trim()}><Send size={16} /></button>
      </form>
    </div>
  );
}
