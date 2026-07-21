import { useState } from 'react';

// "!" button — hover (or tap) to see what a metric shows and why it matters.
// Used next to metric labels across the admin dashboard.
export default function InfoTip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span className="info-tip" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button
        type="button"
        className="info-tip__btn"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShow((s) => !s); }}
      >!</button>
      {show && <span className="info-tip__bubble">{text}</span>}
    </span>
  );
}
