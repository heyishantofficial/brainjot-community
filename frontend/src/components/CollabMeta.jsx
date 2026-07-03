import { Briefcase, MapPin, Clock, DollarSign } from 'lucide-react';
import { COMP_LABELS, COMMITMENT_LABELS } from '../utils';

// The structured collab block shown on collab posts — role, skills, compensation,
// commitment, location. This is the "more detailed" collab info the hirer fills in.
export default function CollabMeta({ collab }) {
  if (!collab) return null;
  return (
    <div className="collab-meta">
      <div className="collab-meta__row">
        {collab.role && (
          <span className="collab-chip collab-chip--role"><Briefcase size={13} /> {collab.role}</span>
        )}
        <span className="collab-chip">{collab.intent === 'offering' ? 'Offering help' : 'Looking for'}</span>
        {collab.status === 'closed' && <span className="collab-chip collab-chip--closed">Closed</span>}
      </div>
      <div className="collab-meta__row collab-meta__details">
        {collab.compType && (
          <span className="collab-detail"><DollarSign size={13} /> {COMP_LABELS[collab.compType]}{collab.compAmount ? ` · ${collab.compAmount}` : ''}</span>
        )}
        {collab.commitment && (
          <span className="collab-detail"><Clock size={13} /> {COMMITMENT_LABELS[collab.commitment]}</span>
        )}
        <span className="collab-detail"><MapPin size={13} /> {collab.remote ? 'Remote' : (collab.location || 'On-site')}</span>
      </div>
      {collab.skills?.length > 0 && (
        <div className="collab-skills">
          {collab.skills.map((s) => <span key={s} className="skill-tag">{s}</span>)}
        </div>
      )}
    </div>
  );
}
