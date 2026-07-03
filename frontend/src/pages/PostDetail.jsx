import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Flag, Trash2 } from 'lucide-react';
import PostCard from '../components/PostCard';
import CommentTree from '../components/CommentTree';
import { api } from '../api';
import { useAuth } from '../auth';
import { BODY_MAX } from '../utils';

export default function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentCursor, setCommentCursor] = useState(null);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [text, setText] = useState('');
  const [sort, setSort] = useState('new');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/posts/${id}`).then(({ data }) => setPost(data.post)).catch(() => setError('Post not found'));
  }, [id]);

  useEffect(() => {
    api.get(`/comments?postId=${id}&sort=${sort}&limit=50`).then(({ data }) => {
      setComments(data.items);
      setCommentCursor(data.nextCursor);
      setHasMoreComments(data.hasMore);
    }).catch(() => {});
  }, [id, sort]);

  async function loadMoreComments() {
    const { data } = await api.get(`/comments?postId=${id}&sort=${sort}&limit=50&cursor=${encodeURIComponent(commentCursor)}`);
    setComments((prev) => [...prev, ...data.items]);
    setCommentCursor(data.nextCursor);
    setHasMoreComments(data.hasMore);
  }

  async function addComment(e) {
    e.preventDefault();
    if (!user) return login();
    if (!text.trim()) return;
    const { data } = await api.post('/comments', { postId: id, body: `<p>${escapeHtml(text.trim())}</p>` });
    setComments((prev) => [data.comment, ...prev]);
    setPost((p) => ({ ...p, commentCount: p.commentCount + 1 }));
    setText('');
  }

  async function report() {
    await api.post('/reports', { targetType: 'post', targetId: id, reason: 'spam' }).catch(() => {});
    alert('Reported. Thanks — our team will review it.');
  }

  async function remove() {
    if (!confirm('Delete this post?')) return;
    await api.delete(`/posts/${id}`);
    navigate('/');
  }

  // Owner of a collab post: toggle open ↔ filled (closed). Sends the whole
  // collab object back because PATCH replaces it as a unit.
  async function toggleFilled() {
    const next = post.collab.status === 'closed' ? 'open' : 'closed';
    const { data } = await api.patch(`/posts/${id}`, { collab: { ...post.collab, status: next } });
    setPost((p) => ({ ...p, collab: data.post.collab }));
  }

  if (error) return <div className="center-msg">{error} · <Link to="/">Back to feed</Link></div>;
  if (!post) return <div className="center-msg">Loading…</div>;

  return (
    <div className="detail">
      <button className="link-btn back" onClick={() => navigate(-1)}><ArrowLeft size={16} /> Back</button>
      <PostCard post={post} compact={false} />

      <div className="detail__toolbar">
        {user?.id === post.author.id ? (
          <>
            {post.type === 'collab' && post.collab && (
              <button className="link-btn" onClick={toggleFilled}>
                {post.collab.status === 'closed' ? '↺ Reopen role' : '✓ Mark as filled'}
              </button>
            )}
            <button className="link-btn danger" onClick={remove}><Trash2 size={14} /> Delete</button>
          </>
        ) : (
          <button className="link-btn" onClick={report}><Flag size={14} /> Report</button>
        )}
      </div>

      <section className="comments-section">
        <div className="comments-head">
          <h3>{post.commentCount} Comments</h3>
          <div className="sort-toggle">
            <button className={sort === 'new' ? 'active' : ''} onClick={() => setSort('new')}>New</button>
            <button className={sort === 'top' ? 'active' : ''} onClick={() => setSort('top')}>Top</button>
          </div>
        </div>

        <form className="comment-box" onSubmit={addComment}>
          <textarea className="input textarea" rows={3} placeholder={user ? 'Add a comment…' : 'Sign in to comment'}
            value={text} maxLength={BODY_MAX} onChange={(e) => setText(e.target.value)} onFocus={() => { if (!user) login(); }} />
          <div className="comment-box__foot">
            {text.length > BODY_MAX - 100 && <span className="muted char-count">{BODY_MAX - text.length}</span>}
            <button type="submit" className="btn btn--primary" disabled={!text.trim()}>Comment</button>
          </div>
        </form>

        <CommentTree comments={comments} postId={id} onReply={(c) => setComments((prev) => [...prev, c])} />
        {hasMoreComments && (
          <button className="btn btn--ghost load-more" onClick={loadMoreComments}>Load more comments</button>
        )}
      </section>
    </div>
  );
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
