import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api.js';
import { Toggle } from './AdminApp.jsx';

const pinIcon = L.divIcon({ className: 'a-pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] });
const NZ = [-41.0, 174.0];

/** Settings › Staff phone app: on/off, site location on a map, radius and the rules. */
export default function PhoneSettings({ settings, save, setFlash }) {
  const [p, setP] = useState(settings.phone);
  const [staff, setStaff] = useState(null);
  const [search, setSearch] = useState(settings.phone.address || '');
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [sending, setSending] = useState(false);
  const mapEl = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const circle = useRef(null);
  const latest = useRef(p);
  latest.current = p;

  const loadStaff = () => api('/api/admin/staff').then(setStaff).catch(() => {});
  useEffect(() => { loadStaff(); }, []);

  // Map: drag the pin (or click the map) to set the site; the shaded circle is the sign-in area.
  useEffect(() => {
    const has = p.lat !== null && p.lng !== null;
    const m = L.map(mapEl.current, { scrollWheelZoom: false }).setView(has ? [p.lat, p.lng] : NZ, has ? 16 : 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      referrerPolicy: 'strict-origin-when-cross-origin', // OpenStreetMap refuses tiles without it
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    map.current = m;
    const place = (lat, lng) => setP((x) => ({ ...x, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }));
    m.on('click', (e) => place(e.latlng.lat, e.latlng.lng));
    marker.current = L.marker(has ? [p.lat, p.lng] : NZ, { draggable: true, icon: pinIcon, keyboard: true, title: 'Site location' })
      .on('dragend', (e) => { const ll = e.target.getLatLng(); place(ll.lat, ll.lng); });
    circle.current = L.circle(has ? [p.lat, p.lng] : NZ, { radius: p.radius, color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0F766E', weight: 2, fillOpacity: 0.15 });
    if (has) { marker.current.addTo(m); circle.current.addTo(m); }
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || p.lat === null || p.lng === null) return;
    const ll = [p.lat, p.lng];
    marker.current.setLatLng(ll);
    circle.current.setLatLng(ll).setRadius(p.radius);
    if (!m.hasLayer(marker.current)) { marker.current.addTo(m); circle.current.addTo(m); m.setView(ll, 16); }
  }, [p.lat, p.lng, p.radius]);

  const fly = (lat, lng) => map.current?.setView([lat, lng], 17);

  const findAddress = async (e) => {
    e.preventDefault();
    if (!search.trim()) return;
    setSearching(true);
    try {
      // OpenStreetMap's free address search.
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(search)}`, { headers: { Accept: 'application/json' } });
      const [hit] = await r.json();
      if (!hit) { setFlash('Couldn’t find that address. Try adding the city, or drag the pin on the map.', 'warn'); return; }
      const lat = Number(hit.lat); const lng = Number(hit.lon);
      setP((x) => ({ ...x, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, address: search.trim() }));
      fly(lat, lng);
    } catch {
      setFlash('The address search isn’t reachable from here. Drag the pin, or use this device’s location.', 'warn');
    } finally {
      setSearching(false);
    }
  };

  const useHere = () => {
    if (!window.isSecureContext || !navigator.geolocation) { setFlash('This browser can only share its location over https.', 'warn'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocating(false);
      const { latitude: lat, longitude: lng } = pos.coords;
      setP((x) => ({ ...x, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }));
      fly(lat, lng);
      if (pos.coords.accuracy > 100) setFlash(`Location found, but only to about ${Math.round(pos.coords.accuracy)} m. Check the pin is on your building.`, 'warn');
    }, (err) => {
      setLocating(false);
      setFlash(err.code === 1 ? 'Location is blocked for this browser. Allow it, or drag the pin.' : 'Couldn’t get this device’s location. Drag the pin instead.', 'warn');
    }, { enableHighAccuracy: true, timeout: 15000 });
  };

  const sendAll = async () => {
    const n = waiting.length;
    if (!window.confirm(`Email a personal phone sign-in link to ${n} ${n === 1 ? 'person' : 'people'}?`)) return;
    setSending(true);
    try {
      const r = await api('/api/admin/staff/phone-links', { method: 'POST', body: {} });
      setFlash(`${r.sent} link${r.sent === 1 ? '' : 's'} emailed.${r.failed.length ? ` ${r.failed.length} failed: ${r.failed.slice(0, 2).join('; ')}` : ''}`, r.failed.length ? 'warn' : 'ok');
      loadStaff();
    } catch (e) {
      setFlash(e.message, 'bad');
    } finally {
      setSending(false);
    }
  };

  const set = (patch) => setP({ ...p, ...patch });
  const linked = staff ? staff.filter((s) => s.phone_linked).length : 0;
  const waiting = staff ? staff.filter((s) => s.email && !s.phone_linked && !s.phone_invited) : [];
  const noEmail = staff ? staff.filter((s) => !s.email).length : 0;
  const hasPin = p.lat !== null && p.lng !== null;

  return (
    <>
      <section className="a-card">
        <div className="a-toggle-row" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2>Staff phone sign-in</h2>
            <p className="sub" style={{ margin: '4px 0 0' }}>Each person gets a personal link by email. It works on one phone and signs them in or out with one tap. Fire wardens also get the emergency roll call.</p>
          </div>
          <Toggle on={p.enabled} label="Staff phone sign-in" onChange={(v) => set({ enabled: v })} />
        </div>
        {staff && (
          <div className="a-row" style={{ justifyContent: 'space-between', background: 'var(--ground)', borderRadius: 10, padding: '12px 14px' }}>
            <span><strong>{linked} of {staff.length}</strong> staff have phone sign-in{noEmail ? ` · ${noEmail} have no email address` : ''}</span>
            {waiting.length > 0 && <button type="button" className="a-btn primary" disabled={sending} onClick={sendAll}>{sending ? 'Sending…' : `Email links to ${waiting.length} staff without one`}</button>}
          </div>
        )}
      </section>

      <section className="a-card">
        <div className="a-toggle-row" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2>Location check</h2>
            <p className="sub" style={{ margin: '4px 0 0' }}>Only allow signing in when the phone is near your site. Works on any network, so it doesn’t matter if staff phones use a different Wi-Fi or mobile data.</p>
          </div>
          <Toggle on={p.locationCheck} label="Location check" onChange={(v) => set({ locationCheck: v })} />
        </div>
        <div className="a-phone-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <form onSubmit={findAddress} className="a-field">Site address
              <div className="a-row" style={{ flexWrap: 'nowrap' }}>
                <input className="a-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. 12 Wharf Road, Auckland" />
                <button type="submit" className="a-btn" disabled={searching}>{searching ? 'Finding…' : 'Find'}</button>
              </div>
            </form>
            <button type="button" className="a-btn" onClick={useHere} disabled={locating}>{locating ? 'Finding this device…' : 'Use this device’s location (stand at reception)'}</button>
            <label className="a-field">Distance allowed: <strong>{p.radius} m</strong>
              <input type="range" min="50" max="1000" step="25" value={p.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
              <span className="hint">200 m suits most sites. Phones indoors can be 50–100 m out, which is allowed for.</span>
            </label>
            <div className="a-toggle-row"><span>Allow signing out from anywhere (for people who forget and leave)</span><Toggle on={p.signOutAnywhere} label="Sign out anywhere" onChange={(v) => set({ signOutAnywhere: v })} /></div>
            <fieldset className="a-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ marginBottom: 6 }}>If the phone won’t share its location</legend>
              <label className="a-radio"><input type="radio" name="noloc" checked={p.noLocation === 'block'} onChange={() => set({ noLocation: 'block' })} /> Don’t allow sign-in (use the reception iPad)</label>
              <label className="a-radio"><input type="radio" name="noloc" checked={p.noLocation === 'allow'} onChange={() => set({ noLocation: 'allow' })} /> Allow it, and mark it “no location” in the log</label>
            </fieldset>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div ref={mapEl} className="a-map" aria-label="Map of the site. Drag the pin or click the map to move it." />
            <span className="hint">{hasPin ? `Drag the pin to move the site (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}). Shaded area = where staff can sign in.` : 'Find your address, or click the map to drop the pin on your building.'}</span>
          </div>
        </div>
        <div className="a-msg" style={{ background: 'var(--ground)' }}>
          <strong>Privacy:</strong> the phone checks its location only when the person taps Sign In. The distance is checked and then thrown away; locations are never stored or tracked.
        </div>
        {!window.location.protocol.startsWith('https') && (
          <div className="a-msg warn">Phones only share their location with sites on <strong>https</strong>. This page is on plain http, so put the app behind https (see docs/install.md) before turning the location check on.</div>
        )}
      </section>
      <div><button type="button" className="a-btn primary" onClick={() => save('phone', { ...latest.current, address: search.trim() }, 'Staff phone app settings saved.')}>Save phone settings</button></div>
    </>
  );
}
