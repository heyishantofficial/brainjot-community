import { useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from './Avatar';
import VoteButtons from './VoteButtons';
import { cleanHtml, timeAgo, profilePath, BODY_MAX } from '../utils';
import { api } from '../api';
import { useAuth } from '../auth';

// Build a tree from the flat, path-ordered comment list the API returns.
export function buildTree(flat) {
  const byId = new Map();
  flat.forEach((c) => byId.set(c.id, { ...c, children: [] }));
  const roots = [];
  byId.forEach((c) => {
    if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId).children.push(c);
    else roots.push(c);
  });
  return roots;
}

function CommentNode({ node, postId, onReply }) {
  const { user, login } = useAuth();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');

  async function submitReply(e) {
    e.preventDefault();
    if (!user) return login();
    if (!text.trim()) return;
    const { data } = await api.post('/comments', {
      postId, parentId: node.id, body: `<p>${escapeHtml(text.trim())}</p>`,
    });
    onReply(data.comment);
    setText(''); setReplying(false);
  }

  if (node.status === 'removed') {
    return (
      <div className="comment comment--removed">
        <span className="muted">[removed]</span>
        {node.children?.length > 0 && (
          <div className="comment__children">
            {node.children.map((c) => <CommentNode key={c.id} node={c} postId={postId} onReply={onReply} />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="comment">
      <div className="comment__main">
        <VoteButtons targetType="comment" targetId={node.id} score={node.score} myVote={node.myVote} layout="vertical" />
        <div className="comment__content">
          <div className="comment__meta">
            <Link to={profilePath(node.author) || '#'} className="comment__author">
              <Avatar user={node.author} size={18} /> {node.author.name}
            </Link>
            <span className="muted">· {timeAgo(node.createdAt)}</span>
          </div>
          <div className="comment__body" dangerouslySetInnerHTML={{ __html: cleanHtml(node.body) }} />
          <button className="link-btn" onClick={() => setReplying((v) => !v)}>Reply</button>
          {replying && (
            <form className="reply-form" onSubmit={submitReply}>
              <textarea className="input textarea" rows={2} placeholder="Write a reply…" value={text}
                maxLength={BODY_MAX} onChange={(e) => setText(e.target.value)} autoFocus />
              <div className="reply-form__actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setReplying(false)}>Cancel</button>
                <button type="submit" className="btn btn--primary btn--sm">Reply</button>
              </div>
            </form>
          )}
        </div>
      </div>
      {node.children?.length > 0 && (
        <div className="comment__children">
          {node.children.map((c) => <CommentNode key={c.id} node={c} postId={postId} onReply={onReply} />)}
        </div>
      )}
    </div>
  );
}

export default function CommentTree({ comments, postId, onReply }) {
  const tree = buildTree(comments);
  if (tree.length === 0) return <p className="muted empty">No comments yet. Start the conversation.</p>;
  return (
    <div className="comment-tree">
      {tree.map((node) => <CommentNode key={node.id} node={node} postId={postId} onReply={onReply} />)}
    </div>
  );
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
