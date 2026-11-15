// Iconos del calendario: los del shell (ui/shell/icons.jsx) más unos pocos
// propios. Mismo trazo 24×24, decorativos (aria-hidden).
import { Icon, ICON_NAMES } from '../shell/icons.jsx';

const EXTRA = {
  repeat: <><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  mapPin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  text: <path d="M4 6h16M4 12h16M4 18h10" />,
  chevLeft: <path d="m15 6-6 6 6 6" />,
  chevRight: <path d="m9 6 6 6-6 6" />,
  grid: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></>,
  task: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  palette2: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" /></>,
};

export function CIcon({ name, size = 16, stroke = 1.7, style, className }) {
  if (ICON_NAMES.includes(name) && !EXTRA[name]) return <Icon name={name} size={size} stroke={stroke} style={style} className={className} />;
  const body = EXTRA[name];
  if (!body) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className={className} style={style}>
      {body}
    </svg>
  );
}
