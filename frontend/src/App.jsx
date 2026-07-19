import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Feed from './pages/Feed';
import PostDetail from './pages/PostDetail';
import CollabBoard from './pages/CollabBoard';
import Profile from './pages/Profile';
import Messenger from './pages/Messenger';
import Notifications from './pages/Notifications';
import Search from './pages/Search';
import Saved from './pages/Saved';
import Admin from './pages/admin/Admin';
import Overview from './pages/admin/Overview';
import Moderation from './pages/admin/Moderation';
import Users from './pages/admin/Users';
import { AuthProvider, useAuth } from './auth';
import { api } from './api';
import { syncPushIfGranted } from './push';

function Shell() {
  const { user, loading } = useAuth();
  const [badges, setBadges] = useState({ notifications: 0, messages: 0, admin: 0 });

  // Re-attach this browser's web-push subscription on login. Silent — only
  // runs when notification permission was already granted (the prompt lives
  // behind the enable button on the Notifications page).
  useEffect(() => {
    if (user) syncPushIfGranted();
  }, [user]);

  // One combined badge poll (unread DMs + unread notifications) every 30s while
  // visible, slower when hidden, refreshed on tab focus and whenever a page
  // dispatches 'badges:refresh' (e.g. after marking notifications read).
  useEffect(() => {
    if (!user) { setBadges({ notifications: 0, messages: 0, admin: 0 }); return; }
    let timer; let cancelled = false;
    async function refresh() {
      try {
        const { data } = await api.get('/notifications/badges');
        // Superadmins also poll the open-report count for the shield badge.
        let admin = 0;
        if (user.role === 'superadmin') {
          try { admin = (await api.get('/admin/reports/count')).data.open; } catch { /* ignore */ }
        }
        if (!cancelled) setBadges({ notifications: data.notifications, messages: data.messages, admin });
      } catch { /* ignore transient errors */ }
      if (!cancelled) timer = setTimeout(refresh, document.hidden ? 90000 : 30000);
    }
    refresh();
    const onFocus = () => refresh();
    const onManual = () => refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('badges:refresh', onManual);
    return () => {
      cancelled = true; clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('badges:refresh', onManual);
    };
  }, [user]);

  if (loading) {
    return <div className="boot"><div className="brand">brainjot<span className="brand__accent">/community</span></div><p className="muted">Loading…</p></div>;
  }

  return (
    <Layout badges={badges}>
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/collab" element={<CollabBoard />} />
        <Route path="/post/:id" element={<PostDetail />} />
        <Route path="/u/:username" element={<Profile />} />
        <Route path="/messages" element={<Messenger />} />
        <Route path="/messages/:id" element={<Messenger />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/search" element={<Search />} />
        <Route path="/saved" element={<Saved />} />
        <Route path="/admin" element={<Admin />}>
          <Route index element={<Overview />} />
          <Route path="moderation" element={<Moderation />} />
          <Route path="users" element={<Users />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  );
}
