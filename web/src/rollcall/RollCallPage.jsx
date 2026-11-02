import { apiUrl } from '../tenant.js';
import { useEffect, useMemo, useState } from 'react';
import RollCall from './RollCall.jsx';
import { STAFF_KEY } from '../staff/StaffApp.jsx';

/** /rollcall — opened from a fire warden's staff phone app, or by a signed-in admin. */
export default function RollCallPage() {
  const [key] = useState(() => { try { return localStorage.getItem(STAFF_KEY); } catch { return null; } });

  // Make "Add to Home Screen" install the roll call (not the reception kiosk).
  useEffect(() => {
    document.title = 'Roll call';
    document.querySelector('link[rel="manifest"]')?.setAttribute('href', apiUrl('/api/public/manifest/rollcall'));
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Roll call');
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', '/icons/rollcall-touch-icon.png');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#B91C1C');
  }, []);

  const headers = useMemo(() => (key ? { 'X-Staff-Token': key } : {}), [key]);
  return <RollCall headers={headers} storageKey="vs_rc" />;
}
