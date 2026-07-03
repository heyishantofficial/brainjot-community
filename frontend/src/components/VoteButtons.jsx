import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';

// Optimistic voting: we update the UI instantly and reconcile with the server's
// authoritative score in the response. The backend dedupes via a unique index,
// so rapid clicks can't corrupt the count.
export default function VoteButtons({ targetType, targetId, score: initialScore, myVote: initialVote, layout = 'vertical' }) {
  const { user, login } = useAuth();
  const [score, setScore] = useState(initialScore || 0);
  const [myVote, setMyVote] = useState(initialVote || 0);
  const [busy, setBusy] = useState(false);

  async function vote(value) {
    if (!user) return login();
    if (busy) return;
    setBusy(true);
    const prevScore = score, prevVote = myVote;
    // optimistic
    const nextVote = myVote === value ? 0 : value;
    setMyVote(nextVote);
    setScore(score - prevVote + nextVote);
    try {
      const { data } = await api.post(`/${targetType}s/${targetId}/vote`, { value });
      setScore(data.score);
      setMyVote(data.value);
    } catch {
      setScore(prevScore); setMyVote(prevVote); // rollback
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`votes votes--${layout}`}>
      <button className={`vote-btn ${myVote === 1 ? 'vote-btn--up' : ''}`} onClick={() => vote(1)} aria-label="Upvote">
        <ChevronUp size={18} />
      </button>
      <span className={`vote-score ${myVote === 1 ? 'up' : myVote === -1 ? 'down' : ''}`}>{score}</span>
      <button className={`vote-btn ${myVote === -1 ? 'vote-btn--down' : ''}`} onClick={() => vote(-1)} aria-label="Downvote">
        <ChevronDown size={18} />
      </button>
    </div>
  );
}
