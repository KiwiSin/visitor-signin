import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import './styles.css';
import Kiosk from './kiosk/Kiosk.jsx';
import AdminApp from './admin/AdminApp.jsx';
import RollCallPage from './rollcall/RollCallPage.jsx';
import StaffApp from './staff/StaffApp.jsx';
import HostApp from './host/HostApp.jsx';
import BusinessSetup from './setup/BusinessSetup.jsx';
import { basename, slug } from './tenant.js';

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={basename}>
    <Routes>
      <Route path="/kiosk/*" element={<Kiosk />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="/me" element={<StaffApp />} />
      <Route path="/rollcall" element={<RollCallPage />} />
      <Route path="/setup" element={<BusinessSetup />} />
      {!slug && <Route path="/host/*" element={<HostApp />} />}
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  </BrowserRouter>,
);
