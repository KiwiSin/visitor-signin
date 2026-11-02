import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, fmtTime } from '../api.js';
import { IconCheck, IconPin, IconSignIn, IconSignOut, IconWarn } from '../icons.jsx';
import { apiUrl, appPath, slug } from '../tenant.js';
import { applyTheme, colorsOf, logoFor } from '../theme.js';

// One phone can hold one staff sign-in per business.
export const STAFF_KEY = `vs_staff_key${slug ? `_${slug}` : ''}`;
const getKey = () => { try { return localStorage.getItem(STAFF_KEY); } catch { return null; } };
const setKey = (v) => { try { v ? localStorage.setItem(STAFF_KEY, v) : localStorage.removeItem(STAFF_KEY); } catch { /* private mode */ } };

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// New links carry ?invite=…; links sent before 3 Nov 2026 carry #invite=…
const inviteFromUrl = () => /invite=([A-Za-z0-9_-]+)/.exec(window.location.search + window.location.hash)?.[1] || null;

/** Ask the phone where it is. Resolves to { lat, lng, accuracy } or { error }. */
function locate() {
  return new Promise((resolve) => {
    if (!window.isSecureContext || !navigator.geolocation) { resolve({ error: 'unsupported' }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => resolve({ error: e.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

const LOCATION_HELP = {
  denied: isIOS()
    ? 'Location is turned off for this app. On your iPhone go to Settings › Privacy & Security › Location Services › Safari Websites (or this app) and choose “While Using”.'
    : 'Location is blocked for this app. Tap the lock or ⓘ next to the address (or long-press the app icon › App info › Permissions) and allow Location.',
  unavailable: 'Your phone couldn’t find its location. Step outside or near a window and try again.',
  unsupported: 'This phone or browser can’t share its location with this app.',
};

function useHomeScreenDetails(invite) {
  useEffect(() => {
    document.title = 'Sign in';
    // When the invite hasn't been used yet, the home-screen icon carries it, so the app itself claims it
    // (on iPhone, home-screen apps don't share storage with Safari).
    const q = invite ? `?invite=${encodeURIComponent(invite)}` : '';
    document.querySelector('link[rel="manifest"]')?.setAttribute('href', apiUrl(`/api/public/manifest/me${q}`));
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Sign in');
  }, [invite]);
}

export default function StaffApp() {
  const [token, setToken] = useState(getKey);
  const [invite, setInvite] = useState(inviteFromUrl);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const [fatal, setFatal] = useState(null);
  const [step, setStep] = useState(null);           // welcome steps before first use
  const [busy, setBusy] = useState(false);
  const [away, setAway] = useState(null);           // { title, body, kind }
  const [lastCheck, setLastCheck] = useState(null); // distance from the most recent sign-in
  useHomeScreenDetails(token ? null : invite);

  const claim = useCallback(async (code) => {
    try {
      const r = await api('/api/me/claim', { method: 'POST', body: { invite: code } });
      setKey(r.token);
      setToken(r.token);
      setInvite(null);
      window.history.replaceState(null, '', appPath('/me')); // don't leave the link in the address bar
      setStep(isStandalone() ? 'location' : 'home');
    } catch (err) {
      if (getKey()) { setInvite(null); window.history.replaceState(null, '', appPath('/me')); return; }
      setFatal({ title: 'This link has already been used', body: err.message });
    }
  }, []);

  // First open from the email link.
  useEffect(() => {
    if (token || !invite) return;
    // On iPhone in Safari, wait: the home-screen app has its own storage, so it should claim the link itself.
    if (isIOS() && !isStandalone()) {
      // An older #invite link: reload as ?invite so the page's home-screen details carry it.
      if (!window.location.search.includes('invite=')) { window.location.replace(appPath(`/me?invite=${invite}`)); return; }
      setStep('ios-home');
      return;
    }
    claim(invite);
  }, [token, invite, claim]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api('/api/me', { headers: { 'X-Staff-Token': token } });
      setMe(data);
      applyTheme(data.branding);
      setError('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setKey(null);
        setToken(null);
        setFatal({ title: 'This phone isn’t set up any more', body: 'Your admin may have removed it, or set up a different phone for you. Ask them to send you a new link.' });
      } else setError(err.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  // Refresh when the app comes back to the front (e.g. the next morning).
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
  }, [load]);

  const change = async (state) => {
    setBusy(true);
    setAway(null);
    setError('');
    try {
      const needs = me.phone.locationCheck && (state === 'in' || !me.phone.signOutAnywhere);
      const where = needs ? await locate() : {};
      if (where.error && me.phone.noLocation !== 'allow') {
        setAway({
          kind: 'location',
          title: 'We need your location to sign you in',
          body: `${LOCATION_HELP[where.error]} Or sign in on the reception iPad.`,
        });
        return;
      }
      const r = await api('/api/me/presence', {
        method: 'POST',
        headers: { 'X-Staff-Token': token },
        body: { state, ...(where.error ? {} : where) },
      });
      setLastCheck(r.distance);
      await load();
    } catch (err) {
      if (err.code === 'too-far') setAway({ kind: 'far', title: 'You’re not on site yet', body: err.message });
      else if (err.code === 'no-location') setAway({ kind: 'location', title: 'We need your location to sign you in', body: err.message });
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------ screens
  if (fatal) {
    return (
      <Shell>
        <div className="st-msg">
          <IconWarn width="34" height="34" />
          <h1>{fatal.title}</h1>
          <p>{fatal.body}</p>
          {getKey() && <a className="st-btn" href={appPath('/me')}>Open my sign-in</a>}
        </div>
      </Shell>
    );
  }

  if (step === 'ios-home') {
    return (
      <Shell>
        <div className="st-welcome">
          <h1>Add this to your home screen</h1>
          <p>So signing in is one tap each day.</p>
          <ol className="st-steps">
            <li><span>1</span><div>Tap <strong>Share</strong> <ShareIcon /> at the bottom of Safari.</div></li>
            <li><span>2</span><div>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</div></li>
            <li><span>3</span><div>Open <strong>Sign in</strong> from your home screen. It will finish setting up.</div></li>
          </ol>
          <button type="button" className="st-link" onClick={() => claim(invite)}>Not now: use it in Safari instead</button>
          <p className="st-fine">This link works on one phone only. Using it in Safari means the home-screen icon won’t be set up.</p>
        </div>
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell>
        <div className="st-msg">
          <h1>Staff sign-in</h1>
          <p>Open the link your admin emailed you, on this phone, to set up your personal sign-in.</p>
        </div>
      </Shell>
    );
  }

  if (!me) return <Shell>{error ? <div className="st-msg"><p>{error}</p><button type="button" className="st-btn" onClick={load}>Try again</button></div> : <div className="st-loading" />}</Shell>;

  if (step === 'home' || step === 'location') {
    return (
      <Shell me={me}>
        <div className="st-welcome">
          <div className="st-tick"><IconCheck width="30" height="30" /></div>
          <h1>You’re set up, {me.name.split(' ')[0]}</h1>
          {step === 'home' && !isStandalone() && (
            <>
              <p>Add this to your home screen so it’s one tap each day.</p>
              <ol className="st-steps">
                {isIOS()
                  ? <li><span>1</span><div>Tap <strong>Share</strong> <ShareIcon />, then <strong>Add to Home Screen</strong>.</div></li>
                  : <li><span>1</span><div>Tap <strong>⋮</strong> at the top right, then <strong>Add to Home screen</strong> (or <strong>Install app</strong>).</div></li>}
              </ol>
            </>
          )}
          {me.phone.locationCheck && (
            <div className="st-note">
              <IconPin width="20" height="20" />
              <div>When you sign in, your phone is asked where it is, to check you’re on site. Choose <strong>Allow</strong>. Your location is checked, then forgotten: it isn’t saved.</div>
            </div>
          )}
          <button type="button" className="st-btn" onClick={async () => { if (me.phone.locationCheck) await locate(); setStep(null); }}>
            {me.phone.locationCheck ? 'Allow location and continue' : 'Continue'}
          </button>
        </div>
      </Shell>
    );
  }

  const inn = me.presence === 'in';
  const now = new Date();
  return (
    <Shell me={me}>
      <div className="st-body">
        <div>
          <div className="st-hello">Kia ora, {me.name.split(' ')[0]}</div>
          <div className="st-date">{now.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', timeZone: me.timezone })}</div>
        </div>

        <div className={`st-card ${inn ? 'in' : 'out'}`}>
          <div className="st-dot">{inn ? <IconCheck width="30" height="30" /> : <IconSignOut width="28" height="28" />}</div>
          <div className="st-status">{inn ? 'You’re signed in' : 'You’re signed out'}</div>
          <div className="st-since">
            {me.presenceAt
              ? `Since ${fmtTime(me.presenceAt)}${new Date(me.presenceAt).toDateString() === now.toDateString() ? '' : ` ${new Date(me.presenceAt).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}`}`
              : 'Not signed in yet'}
          </div>
          {lastCheck !== null && lastCheck !== undefined && inn && <div className="st-where"><IconPin width="14" height="14" /> On site · {lastCheck} m away</div>}
        </div>

        {away && (
          <div className={`st-away ${away.kind}`} role="alert">
            {away.kind === 'far' ? <IconPin width="22" height="22" /> : <IconWarn width="22" height="22" />}
            <div><strong>{away.title}</strong><p>{away.body}</p></div>
          </div>
        )}
        {error && <div className="st-away" role="alert"><IconWarn width="22" height="22" /><div><p>{error}</p></div></div>}

        {me.phone.enabled ? (
          <button type="button" className={`st-big ${inn ? 'dark' : ''}`} disabled={busy} onClick={() => change(inn ? 'out' : 'in')}>
            {busy ? (me.phone.locationCheck && !inn ? 'Checking location…' : 'One moment…') : <>{inn ? <IconSignOut width="26" height="26" /> : <IconSignIn width="26" height="26" />} {inn ? 'Sign Out' : 'Sign In'}</>}
          </button>
        ) : (
          <div className="st-away"><IconWarn width="22" height="22" /><div><p>Phone sign-in is turned off. Please use the reception iPad.</p></div></div>
        )}

        {me.today.length > 0 && (
          <div className="st-today">
            <div className="st-label">Today</div>
            {me.today.map((e) => (
              <div className="st-row" key={e.at}>
                <span>{e.state === 'in' ? 'Signed in' : 'Signed out'}{e.changed_by && !e.changed_by.startsWith('Phone') ? <em> · {e.changed_by.replace(/^Admin: /, 'by ')}</em> : null}</span>
                <span>{fmtTime(e.at)}</span>
              </div>
            ))}
          </div>
        )}

        {me.isWarden && (
          <a className="st-warden" href={appPath('/rollcall')}>
            <IconWarn width="22" height="22" />
            <div><strong>Emergency roll call</strong><span>Shown because you’re in the Fire warden group</span></div>
          </a>
        )}
      </div>
    </Shell>
  );
}

function Shell({ me, children }) {
  const b = me?.branding;
  const c = colorsOf(b);
  return (
    <div className="st">
      <header className="st-bar" style={{ background: c.barBg, color: c.barText }}>
        <img src={logoFor(b, c.barBg)} alt={b?.companyName || 'Visitor Sign-In'} />
        <span>Staff</span>
      </header>
      {children}
    </div>
  );
}

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share" style={{ verticalAlign: '-3px' }}>
    <path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
