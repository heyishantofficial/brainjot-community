import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { PenSquare, MessageCircle, ArrowLeft, LogOut, Bell, Bookmark, Search, ShieldCheck, Menu, X } from 'lucide-react';
import Avatar from './Avatar';
import Composer from './Composer';
import { useAuth } from '../auth';
import { MAIN_APP_URL } from '../api';
import { profilePath } from '../utils';

export default function Layout({ children, badges = { notifications: 0, messages: 0, admin: 0 } }) {
  const { user, login, logout } = useAuth();
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The messenger is a full-bleed split view — no centered column, no padding.
  const isMessenger = pathname.startsWith('/messages');
  // Admin gets a wider column: dense tables + chart grids need the room.
  const isAdmin = pathname.startsWith('/admin');

  useEffect(() => { setMenuOpen(false); setSearchOpen(false); }, [pathname]);

  function submitSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (q) { navigate(`/search?q=${encodeURIComponent(q)}`); setSearchOpen(false); }
  }

  // Unread signal for items tucked inside the hamburger (bell keeps its own badge).
  const menuBadge = badges.messages + (user?.role === 'superadmin' ? badges.admin : 0);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="topbar__left">
            <a href={MAIN_APP_URL} className="backlink hide-sm" title="Back to your tasks and projects">
              <ArrowLeft size={16} /> Back to Projects
            </a>
            <Link to="/" className="brand">brainjot<span className="brand__accent">/community</span></Link>
          </div>

          <form className="topbar__search hide-sm" onSubmit={submitSearch}>
            <Search size={15} className="topbar__search-icon" />
            <input className="input input--search" placeholder="Search posts…" value={query}
              onChange={(e) => setQuery(e.target.value)} />
          </form>

          <div className="topbar__right">
            <button className="icon-btn show-sm" onClick={() => setSearchOpen(true)} title="Search">
              <Search size={19} />
            </button>
            {user ? (
              <>
                <button className="btn btn--primary btn--sm" onClick={() => setComposing(true)}>
                  <PenSquare size={16} /> <span className="hide-sm">Post</span>
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
                <button className="avatar-btn" onClick={() => navigate(profilePath(user) || '/')} title={user.name}>
                  <Avatar user={user} size={32} />
                </button>
                <button className="icon-btn hide-sm" onClick={logout} title="Log out"><LogOut size={18} /></button>
              </>
            ) : (
              <button className="btn btn--primary btn--sm" onClick={login}>Sign in</button>
            )}
            <button className="icon-btn show-sm" onClick={() => setMenuOpen((o) => !o)} title="Menu">
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
              {!menuOpen && menuBadge > 0 && <span className="menu-dot" />}
            </button>
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

        {menuOpen && (
          <>
            <div className="mobile-menu__backdrop" onClick={() => setMenuOpen(false)} />
            <nav className="mobile-menu">
              <a href={MAIN_APP_URL} className="mobile-menu__item">
                <ArrowLeft size={17} /> Back to Projects
              </a>
              {user && (
                <>
                  <Link to="/messages" className="mobile-menu__item">
                    <MessageCircle size={17} /> Messages
                    {badges.messages > 0 && <span className="mobile-menu__badge">{badges.messages > 9 ? '9+' : badges.messages}</span>}
                  </Link>
                  <Link to="/saved" className="mobile-menu__item"><Bookmark size={17} /> Saved</Link>
                  {user.role === 'superadmin' && (
                    <Link to="/admin" className="mobile-menu__item">
                      <ShieldCheck size={17} /> Admin
                      {badges.admin > 0 && <span className="mobile-menu__badge">{badges.admin > 9 ? '9+' : badges.admin}</span>}
                    </Link>
                  )}
                  <div className="mobile-menu__sep" />
                  <button className="mobile-menu__item" onClick={() => { setMenuOpen(false); logout(); }}>
                    <LogOut size={17} /> Log out
                  </button>
                </>
              )}
            </nav>
          </>
        )}
      </header>

      <main className={`content${isMessenger ? ' content--messenger' : ''}${isAdmin ? ' content--admin' : ''}`}>{children}</main>

      {composing && <Composer onClose={() => setComposing(false)} onCreated={(p) => navigate(`/post/${p.id}`)} />}
    </div>
  );
}
