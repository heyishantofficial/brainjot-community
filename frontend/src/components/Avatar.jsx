import { initials } from '../utils';

export default function Avatar({ user, size = 32 }) {
  const style = { width: size, height: size, fontSize: size * 0.4 };
  if (user?.avatarUrl) {
    return <img className="avatar" src={user.avatarUrl} alt={user.name} style={style} />;
  }
  return <div className="avatar avatar--fallback" style={style}>{initials(user?.name)}</div>;
}
