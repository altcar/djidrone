/* Password-only gate for the static gallery.
   Verifies a PBKDF2-SHA256 hash in auth.json with Web Crypto. No username. */
(function () {
  'use strict';

  var SESSION_KEY = 'djidrone_gate_ok';
  var REMEMBER_KEY = 'djidrone_gate_until';
  var cfg = null, gateEl = null, input = null, errEl = null, rememberEl = null;

  function hexToBytes(h) {
    var out = new Uint8Array(h.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  function bytesToHex(b) {
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function equal(a, b) {
    if (a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }

  function remembered() {
    try { return Number(localStorage.getItem(REMEMBER_KEY) || 0) > Date.now(); }
    catch (e) { return false; }
  }
  function unlockedFlag() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; }
    catch (e) { return false; }
  }
  function grant(remember, password) {
    try {
      // Keep the password only in sessionStorage so the online proxy can
      // authenticate <video> requests (it cannot send custom headers).
      if (password) sessionStorage.setItem('djidrone_gate_password', password);
      sessionStorage.setItem(SESSION_KEY, '1');
      if (remember) localStorage.setItem(REMEMBER_KEY, String(Date.now() + 12 * 3600 * 1000));
      else localStorage.removeItem(REMEMBER_KEY);
    } catch (e) { /* private mode: still unlock for this page view */ }
  }
  function revoke() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem('djidrone_gate_password');
      localStorage.removeItem(REMEMBER_KEY);
    } catch (e) {}
  }

  function show() {
    document.body.classList.add('gate-locked');
    if (gateEl) { gateEl.style.display = 'grid'; gateEl.setAttribute('aria-hidden', 'false'); }
    if (errEl) errEl.textContent = '';
    if (input) { input.value = ''; setTimeout(function () { input.focus(); }, 30); }
  }
  function hide() {
    document.body.classList.remove('gate-locked');
    if (gateEl) { gateEl.style.display = 'none'; gateEl.setAttribute('aria-hidden', 'true'); }
  }

  function derive(password) {
    if (!window.crypto || !crypto.subtle) {
      return Promise.reject(new Error('Secure context required (use https).'));
    }
    var raw = new TextEncoder().encode(password);
    return crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return crypto.subtle.deriveBits({
          name: 'PBKDF2',
          salt: hexToBytes(cfg.salt),
          iterations: cfg.iterations,
          hash: 'SHA-256'
        }, key, 256);
      })
      .then(function (bits) { return bytesToHex(new Uint8Array(bits)); });
  }

  function check(pw) {
    if (!cfg) return Promise.reject(new Error('Password configuration not loaded yet.'));
    return derive(pw).then(function (hash) {
      if (!equal(hash.toLowerCase(), cfg.hash.toLowerCase())) {
        throw new Error('Wrong password.');
      }
    });
  }

  function init() {
    gateEl = document.getElementById('gate');
    input = document.getElementById('gate-password');
    errEl = document.getElementById('gate-error');
    rememberEl = document.getElementById('gate-remember');
    if (!gateEl) return;

    var alreadyOpen = unlockedFlag() || remembered();
    if (alreadyOpen) hide(); else show();

    // Lock button is injected so the gate works with any header layout.
    var bar = document.querySelector('.tabbar');
    if (bar) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      btn.id = 'gate-lock';
      btn.textContent = '🔒 Lock';
      btn.addEventListener('click', function () { revoke(); show(); });
      bar.insertBefore(btn, bar.querySelector('.external') || null);
    }

    var form = document.getElementById('gate-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (errEl) errEl.textContent = 'Checking…';
        check(input.value).then(function () {
          grant(rememberEl && rememberEl.checked, input.value);
          hide();
        }).catch(function (err) {
          if (errEl) errEl.textContent = err.message || 'Could not verify password.';
          input.value = '';
          input.focus();
          gateEl.classList.remove('shake');
          void gateEl.offsetWidth;
          gateEl.classList.add('shake');
        });
      });
    }

    // Fetch the hash config early, but keep the lock screen up until verified.
    fetch('./auth.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { cfg = d; })
      .catch(function (err) {
        if (errEl) errEl.textContent = 'Could not load password settings: ' + err.message;
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
