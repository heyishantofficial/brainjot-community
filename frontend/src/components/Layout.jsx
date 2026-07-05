import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { PenSquare, MessageCircle, ArrowLeft, LogOut, Bell, Bookmark, Search } from 'lucide-react';
import Avatar from './Avatar';
import Composer from './Composer';
import { useAuth } from '../auth';
import { MAIN_APP_URL } from '../api';
import { profilePath } from '../utils';

export default function Layout({ children, badges = { notifications: 0, messages: 0 } }) {
  const { user, login, logout } = useAuth();
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The messenger is a full-bleed split view — no centered column, no padding.
  const isMessenger = pathname.startsWith('/messages');

  function submitSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="topbar__left">
            <a href={MAIN_APP_URL} className="backlink" title="Back to your tasks and projects">
              <ArrowLeft size={16} /> <span className="hide-sm">Back to Projects</span>
            </a>
            <Link to="/" className="brand">brainjot<span className="brand__accent">/community</span></Link>
          </div>

          <form className="topbar__search" onSubmit={submitSearch}>
            <Search size={15} className="topbar__search-icon" />
            <input className="input input--search" placeholder="Search posts…" value={query}
              onChange={(e) => setQuery(e.target.value)} />
          </form>

          <div className="topbar__right">
            {user ? (
              <>
                <button className="btn btn--primary btn--sm" onClick={() => setComposing(true)}>
                  <PenSquare size={16} /> <span className="hide-sm">Post</span>
                </button>
                <Link to="/notifications" className="icon-btn icon-btn--badge" title="Notifications">
                  <Bell size={20} />
                  {badges.notifications > 0 && <span className="badge">{badges.notifications > 9 ? '9+' : badges.notifications}</span>}
                </Link>
                <Link to="/messages" className="icon-btn icon-btn--badge" title="Messages">
                  <MessageCircle size={20} />
                  {badges.messages > 0 && <span className="badge">{badges.messages > 9 ? '9+' : badges.messages}</span>}
                </Link>
                <Link to="/saved" className="icon-btn hide-sm" title="Saved posts"><Bookmark size={19} /></Link>
                <button className="avatar-btn" onClick={() => navigate(profilePath(user) || '/')} title={user.name}>
                  <Avatar user={user} size={32} />
                </button>
                <button className="icon-btn" onClick={logout} title="Log out"><LogOut size={18} /></button>
              </>
            ) : (
              <button className="btn btn--primary btn--sm" onClick={login}>Sign in</button>
            )}
          </div>
        </div>
      </header>

      <main className={`content${isMessenger ? ' content--messenger' : ''}`}>{children}</main>

      {composing && <Composer onClose={() => setComposing(false)} onCreated={(p) => navigate(`/post/${p.id}`)} />}
    </div>
  );
}
