import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare, Send, Bookmark, FileText, Hand } from 'lucide-react';
import Avatar from './Avatar';
import VoteButtons from './VoteButtons';
import CollabMeta from './CollabMeta';
import { cleanHtml, timeAgo, typeMeta, profilePath } from '../utils';
import { api } from '../api';
import { useAuth } from '../auth';

export default function PostCard({ post, compact = true }) {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(!!post.mySaved);
  const [interested, setInterested] = useState(!!post.myInterested);
  const [sendingInterest, setSendingInterest] = useState(false);
  const tm = typeMeta(post.type);
  const isCollab = post.type === 'collab';
  const images = post.media?.filter((m) => m.type !== 'file') || [];
  const files = post.media?.filter((m) => m.type === 'file') || [];

  async function toggleSave(e) {
    e.preventDefault();
    if (!user) return login();
    setSaved((v) => !v); // optimistic
    try {
      const { data } = await api.post(`/posts/${post.id}/save`);
      setSaved(data.saved);
    } catch {
      setSaved((v) => !v); // rollback
    }
  }

  // "I'm interested" on a collab post → one click auto-sends an intro DM to the
  // poster ("Hi, I'm interested in this project…") and opens the thread. The
  // backend dedupes, so a repeat click just reopens the existing conversation.
  async function expressInterest(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return login();
    if (post.author.id === user.id || sendingInterest) return;
    setSendingInterest(true);
    try {
      const { data } = await api.post(`/posts/${post.id}/interest`);
      setInterested(true);
      navigate(`/messages/${data.conversationId}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Could not send your interest. Try again.');
    } finally {
      setSendingInterest(false);
    }
  }

  // "Message" on a collab post → find-or-create a DM with the poster, then open it.
  async function messagePoster(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return login();
    if (post.author.id === user.id) return;
    const { data } = await api.post('/conversations', { userId: post.author.id, originPostId: post.id });
    navigate(`/messages/${data.conversation.id}`);
  }

  return (
    <article className="post-card">
      <VoteButtons targetType="post" targetId={post.id} score={post.score} myVote={post.myVote} layout="vertical" />
      <div className="post-card__body">
        <div className="post-card__meta">
          <span className="type-pill" style={{ '--pill': tm.color }}>{tm.label}</span>
          <Link to={profilePath(post.author) || '#'} className="post-card__author">
            <Avatar user={post.author} size={20} /> {post.author.name}
          </Link>
          <span className="dot">·</span>
          <span className="muted">{timeAgo(post.createdAt)}</span>
        </div>

        <Link to={`/post/${post.id}`} className="post-card__title">{post.title}</Link>

        {isCollab && <CollabMeta collab={post.collab} />}

        {!compact && post.body && (
          <div className="post-card__content" dangerouslySetInnerHTML={{ __html: cleanHtml(post.body) }} />
        )}

        {images.length > 0 && (
          <div className={`post-card__media media-count-${Math.min(images.length, 4)}`}>
            {images.slice(0, 4).map((m, i) => (
              <img key={i} src={m.url} alt="" loading="lazy" className="post-card__img" />
            ))}
          </div>
        )}

        {files.length > 0 && (
          <div className="post-card__files">
            {files.map((m, i) => (
              <a key={i} href={m.url} target="_blank" rel="noreferrer" className="post-card__file" onClick={(e) => e.stopPropagation()}>
                <FileText size={15} /> {m.name || 'Document.pdf'}
              </a>
            ))}
          </div>
        )}

        {post.topics?.length > 0 && (
          <div className="post-card__topics">
            {post.topics.map((t) => <Link key={t} to={`/?topic=${t}`} className="topic-tag">#{t}</Link>)}
          </div>
        )}

        <div className="post-card__actions">
          <Link to={`/post/${post.id}`} className="action-btn"><MessageSquare size={15} /> {post.commentCount} comments</Link>
          <button className={`action-btn ${saved ? 'action-btn--active' : ''}`} onClick={toggleSave} title={saved ? 'Remove from saved' : 'Save'}>
            <Bookmark size={15} fill={saved ? 'currentColor' : 'none'} /> {saved ? 'Saved' : 'Save'}
          </button>
          {isCollab && post.author.id !== user?.id && (
            <>
              {post.collab?.status !== 'closed' && (
                <button
                  className={`action-btn action-btn--interest ${interested ? 'action-btn--active' : ''}`}
                  onClick={expressInterest}
                  disabled={sendingInterest}
                  title={interested ? 'Open the conversation' : 'Send the poster a DM saying you’re interested'}
                >
                  <Hand size={15} /> {interested ? 'Interested ✓' : (sendingInterest ? 'Sending…' : "I'm interested")}
                </button>
              )}
              <button className="action-btn action-btn--primary" onClick={messagePoster}><Send size={15} /> Message</button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
