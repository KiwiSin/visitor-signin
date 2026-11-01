import { useEffect, useMemo, useState } from 'react';
import RollCall from './RollCall.jsx';

const KEY = 'vs_warden_key';

/** /rollcall — the wardens' phone app. Opened from a personal link (#key=…) or by a signed-in admin. */
export default function RollCallPage() {
  const [key] = useState(() => {
    const m = /key=([A-Za-z0-9_-]+)/.exec(window.location.hash);
    if (m) {
      localStorage.setItem(KEY, m[1]);
      window.history.replaceState(null, '', '/rollcall'); // don't leave the key in the address bar
      return m[1];
    }
    return localStorage.getItem(KEY);
  });

  // Make "Add to Home Screen" install the roll call (not the reception kiosk).
  useEffect(() => {
    document.title = 'Roll call';
    document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/manifest-rollcall.webmanifest');
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Roll call');
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', '/icons/rollcall-touch-icon.png');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#B91C1C');
  }, []);

  const headers = useMemo(() => (key ? { 'X-Warden-Token': key } : {}), [key]);
  return <RollCall headers={headers} storageKey="vs_rc" />;
}
