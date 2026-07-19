import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { PenSquare, MessageCircle, ArrowLeft, LogOut, Bell, Bookmark, Search, ShieldCheck, Home, PlusSquare, Hash, Handshake, X, User, Star } from 'lucide-react';
import Avatar from './Avatar';
import Composer from './Composer';
import { useAuth } from '../auth';
import { api, MAIN_APP_URL } from '../api';
import { profilePath } from '../utils';

export default function Layout({ children, badges = { notifications: 0, messages: 0, admin: 0 } }) {
  const { user, setUser, login, logout } = useAuth();
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [topics, setTopics] = useState([]);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  // The messenger is a full-bleed split view — no centered column, no padding.
  const isMessenger = pathname.startsWith('/messages');
  // Admin gets a wider column: dense tables + chart grids need the room.
  const isAdmin = pathname.startsWith('/admin');

  const activeTopic = pathname === '/' ? new URLSearchParams(search).get('topic') : null;
  const myProfile = user ? profilePath(user) : null;
  const followed = user?.followedTopics || [];

  useEffect(() => { setSearchOpen(false); setTopicsOpen(false); }, [pathname, search]);

  // Lazy-load the topic list the first time the sheet opens.
  useEffect(() => {
    if (topicsOpen && topics.length === 0) {
      api.get('/posts/topics').then(({ data }) => setTopics(data.topics)).catch(() => {});
    }
  }, [topicsOpen, topics.length]);

  function submitSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (q) { navigate(`/search?q=${encodeURIComponent(q)}`); setSearchOpen(false); }
  }

  // Picking a topic always lands on the feed; picking the active one clears it.
  function pickTopic(slug) {
    navigate(activeTopic === slug ? '/' : `/?topic=${encodeURIComponent(slug)}`);
  }

  async function toggleFollow(slug, e) {
    e.stopPropagation();
    const { data } = await api.patch('/users/me/topics', { topic: slug });
    setUser((u) => ({ ...u, followedTopics: data.followedTopics }));
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

          <form className="topbar__search hide-sm" onSubmit={submitSearch}>
            <Search size={15} className="topbar__search-icon" />
            <input className="input input--search" placeholder="Search posts…" value={query}
              onChange={(e) => setQuery(e.target.value)} />
          </form>

          <div className="topbar__right">
            <Link to="/collab" className="icon-btn show-sm" title="Collab board"><Handshake size={20} /></Link>
            <button className="icon-btn show-sm" onClick={() => setSearchOpen(true)} title="Search">
              <Search size={19} />
            </button>
            {user ? (
              <>
                <button className="btn btn--primary btn--sm hide-sm" onClick={() => setComposing(true)}>
                  <PenSquare size={16} /> Post
                </button>
                {user.role === 'superadmin' && (
                  <Link to="/admin" className="icon-btn icon-btn--badge hide-sm" title="Admin dashboard">
                    <ShieldCheck size={20} />
                    {badges.admin > 0 && <span className="badge">{badges.admin > 9 ? '9+' : badges.admin}</span>}
                  </Link>
                )}
                <Link to="/notifications" className="icon-btn icon-btn--badge" title="Notifications">
                  <Bell size={20} />
                  {badges.notifications > 0 && <span className="badge">{badges.notifications > 9 ? '9+' : badges.notifications}</span>}
                </Link>
                <Link to="/messages" className="icon-btn icon-btn--badge hide-sm" title="Messages">
                  <MessageCircle size={20} />
                  {badges.messages > 0 && <span className="badge">{badges.messages > 9 ? '9+' : badges.messages}</span>}
                </Link>
                <Link to="/saved" className="icon-btn hide-sm" title="Saved posts"><Bookmark size={19} /></Link>
                <button className="avatar-btn hide-sm" onClick={() => navigate(myProfile || '/')} title={user.name}>
                  <Avatar user={user} size={32} />
                </button>
                <button className="icon-btn hide-sm" onClick={logout} title="Log out"><LogOut size={18} /></button>
              </>
            ) : (
              <button className="btn btn--primary btn--sm" onClick={login}>Sign in</button>
            )}
          </div>

          {searchOpen && (
            <form className="topbar__search topbar__search--overlay" onSubmit={submitSearch}>
              <Search size={15} className="topbar__search-icon" />
              <input className="input input--search" placeholder="Search posts…" value={query}
                onChange={(e) => setQuery(e.target.value)} autoFocus />
              <button type="button" className="icon-btn" onClick={() => setSearchOpen(false)} title="Close search">
                <X size={18} />
              </button>
            </form>
          )}
        </div>
      </header>

      <main className={`content${isMessenger ? ' content--messenger' : ''}${isAdmin ? ' content--admin' : ''}`}>{children}</main>

      {/* Instagram-style bottom navigation — mobile only. */}
      <nav className="bottom-nav">
        <button className={`bottom-nav__item${topicsOpen || activeTopic ? ' active' : ''}`} onClick={() => setTopicsOpen((o) => !o)}>
          <Hash size={23} /> <span>Topics</span>
        </button>
        <Link to="/" className={`bottom-nav__item${pathname === '/' && !activeTopic ? ' active' : ''}`}>
          <Home size={23} /> <span>Feed</span>
        </Link>
        <button className="bottom-nav__item" onClick={() => (user ? setComposing(true) : login())}>
          <PlusSquare size={23} /> <span>Post</span>
        </button>
        <Link to="/messages" className={`bottom-nav__item${isMessenger ? ' active' : ''}`}>
          <MessageCircle size={23} />
          {badges.messages > 0 && <span className="bottom-nav__badge">{badges.messages > 9 ? '9+' : badges.messages}</span>}
          <span>Messages</span>
        </Link>
        {user ? (
          <Link to={myProfile || '/'} className={`bottom-nav__item${pathname === myProfile ? ' active' : ''}`}>
            <Avatar user={user} size={24} /> <span>Profile</span>
          </Link>
        ) : (
          <button className="bottom-nav__item" onClick={login}>
            <User size={23} /> <span>Profile</span>
          </button>
        )}
      </nav>

      {topicsOpen && (
        <>
          <div className="topic-dial__backdrop" onClick={() => setTopicsOpen(false)} />
          {/* Speed-dial: emoji circles + label chips fan up from the × FAB. */}
          <div className="topic-dial">
            <button className="topic-dial__close" onClick={() => setTopicsOpen(false)} title="Close">
              <X size={22} />
            </button>
            {topics.length === 0 && <span className="topic-dial__label">Loading…</span>}
            {topics.map((t, i) => (
              <div key={t.slug} className={`topic-dial__row${activeTopic === t.slug ? ' active' : ''}`}
                style={{ animationDelay: `${i * 35}ms` }}>
                <button className="topic-dial__main" onClick={() => pickTopic(t.slug)}>
                  <span className="topic-dial__circle">{t.emoji}</span>
                  <span className="topic-dial__label">{t.label}</span>
                </button>
                {user && (
                  <button className={`topic-dial__star ${followed.includes(t.slug) ? 'on' : ''}`}
                    onClick={(e) => toggleFollow(t.slug, e)}
                    title={followed.includes(t.slug) ? 'Unfollow topic' : 'Follow topic — adds it to your For you feed'}>
                    <Star size={15} fill={followed.includes(t.slug) ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {composing && <Composer onClose={() => setComposing(false)} onCreated={(p) => navigate(`/post/${p.id}`)} />}
    </div>
  );
}
