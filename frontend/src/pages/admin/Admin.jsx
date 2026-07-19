import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { LayoutDashboard, Flag, Users, ShieldCheck, Lock, ScrollText } from 'lucide-react';
import { useAuth } from '../../auth';
import { api } from '../../api';

// Sudo lock screen: the dashboard needs ADMIN_DASH_PASSWORD on top of the
// superadmin session, so a hijacked brainjot login alone can't reach it.
function AdminLock({ configured, onUnlocked }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true); setError('');
    try {
      await api.post('/admin/unlock', { password });
      onUnlocked();
    } catch (err) {
      setError(err.response?.data?.error || 'Unlock failed');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-lock">
      <Lock size={28} />
      <h2>Admin is locked</h2>
      {configured ? (
        <>
          <p className="muted">Enter the admin password to continue. Unlocks this session for 30 minutes.</p>
          <form className="admin-lock__form" onSubmit={submit}>
            <input
              className="input" type="password" placeholder="Admin password" autoFocus
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn btn--primary" disabled={!password || busy}>{busy ? 'Checking…' : 'Unlock'}</button>
          </form>
          {error && <p className="admin-lock__error">{error}</p>}
        </>
      ) : (
        <p className="muted">
          ADMIN_DASH_PASSWORD is not set on the server. Add it to the community backend's
          environment (Dokploy) and restart — until then the dashboard stays locked for everyone.
        </p>
      )}
    </div>
  );
}

// Superadmin shell: header + tab nav, child pages render in the Outlet.
// The redirect here is UX only — every /api/admin route re-checks the role,
// and everything except the badge count also requires the sudo unlock.
export default function Admin() {
  const { user } = useAuth();
  // null = checking, else { configured, unlocked }
  const [lock, setLock] = useState(null);

  const isSuperadmin = !!user && user.role === 'superadmin';

  useEffect(() => {
    if (!isSuperadmin) return undefined;
    let alive = true;
    api.get('/admin/unlock-status')
      .then(({ data }) => alive && setLock(data))
      .catch(() => alive && setLock({ configured: true, unlocked: false }));

    // The 30-min elevation can lapse mid-use — when any admin call comes back
    // ADMIN_LOCKED, drop back to the lock screen instead of failing silently.
    const relock = api.interceptors.response.use(
      (r) => r,
      (err) => {
        if (err.response?.data?.code === 'ADMIN_LOCKED') {
          setLock((l) => (l ? { ...l, unlocked: false } : l));
        }
        return Promise.reject(err);
      },
    );
    return () => { alive = false; api.interceptors.response.eject(relock); };
  }, [isSuperadmin]);

  if (!isSuperadmin) return <Navigate to="/" replace />;
  if (!lock) return <p className="muted">Loading…</p>;
  if (!lock.unlocked) {
    return <AdminLock configured={lock.configured} onUnlocked={() => setLock({ configured: true, unlocked: true })} />;
  }

  const tab = ({ isActive }) => `tab${isActive ? ' active' : ''}`;
  return (
    <div className="admin">
      <div className="admin__head">
        <h1 className="admin__title"><ShieldCheck size={20} /> Admin</h1>
        <nav className="admin__tabs">
          <NavLink end to="/admin" className={tab}><LayoutDashboard size={15} /> Overview</NavLink>
          <NavLink to="/admin/moderation" className={tab}><Flag size={15} /> Moderation</NavLink>
          <NavLink to="/admin/users" className={tab}><Users size={15} /> Users</NavLink>
          <NavLink to="/admin/audit" className={tab}><ScrollText size={15} /> Audit</NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
