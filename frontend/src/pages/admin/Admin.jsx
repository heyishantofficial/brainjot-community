import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { LayoutDashboard, Flag, Users, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../auth';

// Superadmin shell: header + tab nav, child pages render in the Outlet.
// The redirect here is UX only — every /api/admin route re-checks the role.
export default function Admin() {
  const { user } = useAuth();
  if (!user || user.role !== 'superadmin') return <Navigate to="/" replace />;

  const tab = ({ isActive }) => `tab${isActive ? ' active' : ''}`;
  return (
    <div className="admin">
      <div className="admin__head">
        <h1 className="admin__title"><ShieldCheck size={20} /> Admin</h1>
        <nav className="admin__tabs">
          <NavLink end to="/admin" className={tab}><LayoutDashboard size={15} /> Overview</NavLink>
          <NavLink to="/admin/moderation" className={tab}><Flag size={15} /> Moderation</NavLink>
          <NavLink to="/admin/users" className={tab}><Users size={15} /> Users</NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
