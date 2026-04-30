// app.js — Renderer-side application logic.
//
// STAGE 2: uses an in-memory mock store. State is not persisted; refresh and
// you're back to defaults. Stage 3 will replace MOCK_API with real
// window.gta.* IPC calls.

(function () {
  'use strict';

  // ─── MOCK API (Stage 2 only) ─────────────────────────────────────
  // Mirrors the shape of what the Stage 3 IPC bridge will return.

  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  let mockState = {
    isFirstRun: true, // flip after wizard finishes
    settings: {
      enabled: true,
      signInTime: '09:30',
      signOutTime: '18:30',
      days: [false, true, true, true, true, true, false],
      jitterMinutes: 4,
      timezone: 'Asia/Kolkata',
      skipIfDone: true,
      retryAttempts: 2,
      notifyOnSuccess: false,
      notifyOnFailure: true,
      launchOnLogin: true,
      closeToTray: true
    },
    hasCredentials: false,
    credentialsUsername: null,
    holidays: [
      { date: '2026-05-01', label: 'May Day' },
      { date: '2026-08-15', label: 'Independence Day' }
    ],
    history: [
      { id: '1', firedAt: '2026-04-28T09:32:00', action: 'signin', status: 'success', durationMs: 18342 },
      { id: '2', firedAt: '2026-04-27T18:28:00', action: 'signout', status: 'success', durationMs: 16210 },
      { id: '3', firedAt: '2026-04-27T09:31:00', action: 'signin', status: 'success', durationMs: 17905 },
      { id: '4', firedAt: '2026-04-26T09:33:00', action: 'signin', status: 'no_op', alreadyDone: true },
      { id: '5', firedAt: '2026-04-25T18:30:00', action: 'signout', status: 'failure',
        error: 'Attendance widget not found within 25s' }
    ],
    pause: { pauseUntil: null, pauseToday: null },
    sessionBypass: false,
    today: new Date().toISOString().slice(0, 10),
    nextSignIn: nextRunStr('09:30', 4, true),
    nextSignOut: nextRunStr('18:30', 4, false),
    todayRuns: [],
    missed: []
  };

  function nextRunStr(timeStr, jitter, _isMorning) {
    const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
    const now = new Date();
    const c = new Date(now);
    c.setHours(hh, mm, 0, 0);
    if (c <= now) c.setDate(c.getDate() + 1);
    return c.toISOString();
  }

  const MOCK_API = {
    getState: () => Promise.resolve(JSON.parse(JSON.stringify(mockState))),
    saveSettings: (patch) => {
      Object.assign(mockState.settings, patch);
      mockState.nextSignIn  = nextRunStr(mockState.settings.signInTime, mockState.settings.jitterMinutes, true);
      mockState.nextSignOut = nextRunStr(mockState.settings.signOutTime, mockState.settings.jitterMinutes, false);
      return Promise.resolve({ ok: true });
    },
    toggleAutomation: (on) => {
      mockState.settings.enabled = !!on;
      return Promise.resolve({ ok: true });
    },
    setCredentials: (username, _password) => {
      mockState.hasCredentials = true;
      mockState.credentialsUsername = username;
      return Promise.resolve({ ok: true });
    },
    clearCredentials: () => {
      mockState.hasCredentials = false;
      mockState.credentialsUsername = null;
      return Promise.resolve({ ok: true });
    },
    runNow: (action) => {
      console.log('[mock] runNow', action);
      return Promise.resolve({ ok: true, runId: 'mock-' + Date.now() });
    },
    testLogin: () => {
      return new Promise(resolve => {
        setTimeout(() => resolve({ ok: true, message: 'Login test passed.' }), 1200);
      });
    },
    addHoliday: (date, label) => {
      mockState.holidays.push({ date, label });
      mockState.holidays.sort((a, b) => a.date.localeCompare(b.date));
      return Promise.resolve({ ok: true });
    },
    removeHoliday: (date) => {
      mockState.holidays = mockState.holidays.filter(h => h.date !== date);
      return Promise.resolve({ ok: true });
    },
    pauseToday: () => {
      mockState.pause.pauseToday = mockState.today;
      return Promise.resolve({ ok: true });
    },
    pauseSession: () => {
      mockState.sessionBypass = true;
      return Promise.resolve({ ok: true });
    },
    pauseUntil: (date) => {
      mockState.pause.pauseUntil = date;
      return Promise.resolve({ ok: true });
    },
    clearPause: () => {
      mockState.pause = { pauseUntil: null, pauseToday: null };
      mockState.sessionBypass = false;
      return Promise.resolve({ ok: true });
    },
    completeWizard: () => {
      mockState.isFirstRun = false;
      return Promise.resolve({ ok: true });
    },
    resetAll: () => {
      mockState.isFirstRun = true;
      mockState.hasCredentials = false;
      mockState.credentialsUsername = null;
      mockState.history = [];
      mockState.holidays = [];
      return Promise.resolve({ ok: true });
    }
  };

  const API = (typeof window !== 'undefined' && window.gta && window.gta.getState)
    ? window.gta
    : MOCK_API; // fallback for browser-side preview (Stage 2 mock).

  // ─── DOM helpers ─────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function buildDayRow(container, days, onChange) {
    container.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const span = document.createElement('span');
      span.className = 'day' + (days[i] ? ' day-on' : '');
      span.textContent = DAY_LABELS[i];
      span.addEventListener('click', () => {
        days[i] = !days[i];
        span.classList.toggle('day-on', days[i]);
        onChange && onChange(days);
      });
      container.appendChild(span);
    }
  }

  function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString();
  }
  function fmtRelative(iso) {
    if (!iso) return '';
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'now';
    const m = Math.round(ms / 60000);
    if (m < 60) return `in ${m} min`;
    const h = Math.floor(m / 60);
    const mins = m % 60;
    if (h < 24) return mins ? `in ${h}h ${mins}m` : `in ${h}h`;
    const d = Math.floor(h / 24);
    return `in ${d}d ${h % 24}h`;
  }

  function pillFor(status) {
    switch (status) {
      case 'success': return { cls: 'pill-success', text: 'Done' };
      case 'failure': return { cls: 'pill-failure', text: 'Failed' };
      case 'skipped': return { cls: 'pill-skipped', text: 'Skipped' };
      case 'no_op':   return { cls: 'pill-noop',    text: 'Already done' };
      default:        return { cls: 'pill-pending', text: 'Pending' };
    }
  }
  function dotFor(status) {
    if (status === 'success' || status === 'no_op') return 'success';
    if (status === 'failure') return 'failure';
    return '';
  }

  // ─── State ───────────────────────────────────────────────────────

  let state = null;
  let pendingDays = null;
  let dirty = false;

  async function load() {
    state = await API.getState();
    // Wizard removed in favor of an in-place welcome banner on the dashboard.
    // Mark first-run complete the first time a user lands here so the flag
    // is correct in storage even though we never showed a wizard.
    if (state.isFirstRun) {
      try { await API.completeWizard(); } catch (_) {}
      state.isFirstRun = false;
    }
    $('wizard-shell').hidden = true;
    $('main-shell').hidden = false;
    bootMain();
  }

  // ─── Wizard ──────────────────────────────────────────────────────

  function bootWizard() {
    let step = 1;
    const wizDays = mockState.settings.days.slice();

    buildDayRow($('wiz-days'), wizDays, updateSummary);

    function show(s) {
      step = s;
      document.querySelectorAll('.wiz-step').forEach(el => {
        el.hidden = parseInt(el.dataset.step, 10) !== s;
      });
      document.querySelectorAll('.wiz-dots .dot').forEach(d => {
        d.classList.toggle('dot-on', parseInt(d.dataset.step, 10) <= s);
      });
      $('wiz-back').style.visibility = s === 1 ? 'hidden' : 'visible';
      $('wiz-next').textContent = s === 4 ? 'Finish setup' : 'Next';
    }

    function updateSummary() {
      const enabledDays = wizDays.map((d, i) => d ? DAY_LABELS[i] : null).filter(Boolean).join(', ');
      const txt = enabledDays
        ? `Sign In at ${$('wiz-signin').value}, Sign Out at ${$('wiz-signout').value}, on ${enabledDays}.`
        : 'No days selected — pick at least one day.';
      $('wiz-summary').textContent = txt;
    }
    $('wiz-signin').addEventListener('input', updateSummary);
    $('wiz-signout').addEventListener('input', updateSummary);

    $('wiz-test').addEventListener('click', async () => {
      const u = $('wiz-username').value.trim();
      const p = $('wiz-password').value;
      if (!u || !p) {
        $('wiz-test-result').textContent = 'Enter both username and password first.';
        $('wiz-test-result').style.color = 'var(--danger-text)';
        return;
      }
      $('wiz-test-result').textContent = 'Testing…';
      $('wiz-test-result').style.color = 'var(--text-secondary)';
      const r = await API.testLogin();
      if (r.ok) {
        await API.setCredentials(u, p);
        $('wiz-test-result').textContent = '✓ Login successful, credentials saved.';
        $('wiz-test-result').style.color = 'var(--success-text)';
      } else {
        $('wiz-test-result').textContent = 'Failed: ' + (r.error || 'unknown');
        $('wiz-test-result').style.color = 'var(--danger-text)';
      }
    });

    $('wiz-skip').addEventListener('click', async () => {
      await API.completeWizard();
      load();
    });

    $('wiz-back').addEventListener('click', () => {
      if (step > 1) show(step - 1);
    });

    $('wiz-next').addEventListener('click', async () => {
      if (step === 1) { show(2); return; }
      if (step === 2) {
        const u = $('wiz-username').value.trim();
        const p = $('wiz-password').value;
        if (u && p && !mockState.hasCredentials) {
          await API.setCredentials(u, p);
        }
        if (!u && !p && !mockState.hasCredentials) {
          if (!confirm("You haven't entered credentials. Continue without saving them? You'll need to add them in settings later.")) return;
        }
        show(3);
        updateSummary();
        return;
      }
      if (step === 3) {
        if (!wizDays.some(Boolean)) {
          alert('Pick at least one day before continuing.');
          return;
        }
        show(4);
        return;
      }
      if (step === 4) {
        await API.saveSettings({
          enabled: true,
          signInTime: $('wiz-signin').value,
          signOutTime: $('wiz-signout').value,
          days: wizDays.slice(),
          launchOnLogin: $('wiz-launch-on-login').checked,
          closeToTray: $('wiz-close-to-tray').checked
        });
        await API.completeWizard();
        load();
      }
    });

    show(1);
    updateSummary();
  }

  // ─── Main shell ──────────────────────────────────────────────────

  async function bootMain() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('nav-active'));
        btn.classList.add('nav-active');
        showView(btn.dataset.view);
      });
    });

    pendingDays = state.settings.days.slice();
    renderAll();
    wireDashboard();
    wireSchedule();
    wireHolidays();
    wireBehavior();
    wireHistory();
    wireCredentials();
    wireDanger();
    wireSaveBar();

    // Subscribe to live updates from the main process so the UI reflects
    // run state changes without manual refresh.
    if (window.gta && window.gta.onStateChange) {
      window.gta.onStateChange(async () => {
        state = await API.getState();
        renderAll();
      });
    }
    if (window.gta && window.gta.onAgentLog) {
      window.gta.onAgentLog((entry) => {
        // Could surface in UI later; for now console only.
        console.log('[agent]', entry.text);
      });
    }
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(v => {
      v.hidden = v.dataset.view !== name;
    });
  }

  function renderAll() {
    renderWelcome();
    renderToggle();
    renderStats();
    renderTodayRuns();
    renderMissed();
    renderSchedule();
    renderHolidays();
    renderBehavior();
    renderHistory();
    renderCredentials();
  }

  function renderWelcome() {
    // Show only when credentials are missing — i.e. the user is brand new.
    $('welcome-card').hidden = !!state.hasCredentials;
  }

  function renderToggle() {
    $('main-toggle').checked = !!state.settings.enabled;
    if (state.sessionBypass) {
      $('auto-state-h').textContent = 'Paused for this session';
      $('auto-state-sub').textContent = 'Resumes when you restart the app';
      return;
    }
    if (state.pause.pauseToday === state.today) {
      $('auto-state-h').textContent = 'Paused for today';
      $('auto-state-sub').textContent = 'Resumes tomorrow';
      return;
    }
    if (state.pause.pauseUntil && state.today <= state.pause.pauseUntil) {
      $('auto-state-h').textContent = 'Paused';
      $('auto-state-sub').textContent = 'Resumes on ' + state.pause.pauseUntil;
      return;
    }
    if (!state.settings.enabled) {
      $('auto-state-h').textContent = 'Automation is off';
      $('auto-state-sub').textContent = 'Toggle on to schedule runs';
      return;
    }
    const next = pickNext();
    $('auto-state-h').textContent = 'Automation is on';
    $('auto-state-sub').textContent = next
      ? `Next: ${next.label} ${fmtRelative(next.at)} (${fmtTime(next.at)})`
      : 'No upcoming runs scheduled';
  }

  function pickNext() {
    const c = [
      state.nextSignIn  ? { label: 'Sign In',  at: state.nextSignIn  } : null,
      state.nextSignOut ? { label: 'Sign Out', at: state.nextSignOut } : null
    ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at));
    return c[0] || null;
  }

  function renderStats() {
    const today = state.today;
    const todayRuns = state.history.filter(h => (h.firedAt || '').startsWith(today));
    const todaySuccess = todayRuns.filter(h => ['success', 'no_op'].includes(h.status)).length;

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const weekRuns = state.history.filter(h => new Date(h.firedAt) > weekStart);
    const weekSuccess = weekRuns.filter(h => ['success', 'no_op'].includes(h.status)).length;
    const weekTotal = weekRuns.length;
    const weekPct = weekTotal ? Math.round((weekSuccess / weekTotal) * 100) : 100;

    let streak = 0;
    for (const h of state.history) {
      if (['success', 'no_op'].includes(h.status)) streak++;
      else break;
    }

    $('stat-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Today</div>
        <div class="stat-value">${todaySuccess}/2</div>
        <div class="stat-sub">runs successful</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Last 7 days</div>
        <div class="stat-value">${weekSuccess}/${weekTotal || 0}</div>
        <div class="stat-sub">${weekPct}% success</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Streak</div>
        <div class="stat-value">${streak}</div>
        <div class="stat-sub">runs without failure</div>
      </div>
    `;
  }

  function renderTodayRuns() {
    const container = $('today-runs');
    container.innerHTML = '';

    const todayDate = new Date(state.today + 'T00:00:00');
    $('today-h').textContent =
      'Today, ' + todayDate.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

    const expected = [
      { action: 'signin',  label: 'Sign In',  time: state.settings.signInTime },
      { action: 'signout', label: 'Sign Out', time: state.settings.signOutTime }
    ];
    const todayRuns = state.history.filter(h => (h.firedAt || '').startsWith(state.today));

    for (const exp of expected) {
      const hit = todayRuns.find(r => r.action === exp.action);
      const pill = hit ? pillFor(hit.status) : { cls: 'pill-pending', text: 'Pending' };
      const dot = hit ? dotFor(hit.status) : '';
      const row = document.createElement('div');
      row.className = 'run-row';
      row.innerHTML = `
        <div class="run-left">
          <span class="dot-status ${dot}"></span>
          <span>${exp.label} at ${exp.time}</span>
        </div>
        <span class="pill ${pill.cls}">${pill.text}</span>
      `;
      container.appendChild(row);
    }
  }

  function renderMissed() {
    if (!state.missed || state.missed.length === 0) {
      $('missed-card').hidden = true;
      return;
    }
    $('missed-card').hidden = false;
    const m = state.missed[0];
    const label = m.action === 'signin' ? 'Sign In' : 'Sign Out';
    $('missed-text').textContent = `${label} didn't run on ${m.date}`;
  }

  function renderSchedule() {
    $('set-signin').value = state.settings.signInTime;
    $('set-signout').value = state.settings.signOutTime;
    $('set-tz').textContent = state.settings.timezone;
    buildDayRow($('set-days'), pendingDays, () => markDirty());
    $('set-jitter').value = state.settings.jitterMinutes;
    $('set-jitter-out').textContent =
      state.settings.jitterMinutes === 0 ? 'off' : `±${state.settings.jitterMinutes} min`;
  }

  function renderHolidays() {
    const box = $('hol-list');
    if (!state.holidays.length) {
      box.innerHTML = '<div class="muted">No holidays added.</div>';
      return;
    }
    box.innerHTML = '';
    for (const h of state.holidays) {
      const row = document.createElement('div');
      row.className = 'holiday-row';
      row.innerHTML = `
        <span class="muted">${h.date}</span>
        <span>${escapeHtml(h.label)}</span>
        <button class="link" style="color: var(--danger-text); justify-self: end;" data-rm="${h.date}">Remove</button>
      `;
      box.appendChild(row);
    }
    box.querySelectorAll('[data-rm]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await API.removeHoliday(btn.dataset.rm);
        state = await API.getState();
        renderHolidays();
      });
    });
  }

  function renderBehavior() {
    $('b-skip').checked = state.settings.skipIfDone;
    $('b-retry').value = state.settings.retryAttempts;
    $('b-notify-success').checked = state.settings.notifyOnSuccess;
    $('b-notify-failure').checked = state.settings.notifyOnFailure;
    $('b-launch').checked = state.settings.launchOnLogin;
    $('b-tray').checked = state.settings.closeToTray;
    $('b-minimized').checked = state.settings.openMinimized !== false; // default true
  }

  function renderHistory() {
    const box = $('hist-list');
    if (!state.history.length) {
      box.innerHTML = '<div class="muted">No runs yet.</div>';
      return;
    }
    box.innerHTML = '';
    for (const h of state.history.slice(0, 30)) {
      const pill = pillFor(h.status);
      const row = document.createElement('div');
      row.className = 'history-row';
      const action = h.action === 'signin' ? 'Sign In'
                   : h.action === 'signout' ? 'Sign Out'
                   : h.action;
      const detail = h.error ? `<div class="muted" style="font-size: 12px;">${escapeHtml(h.error)}</div>` : '';
      row.innerHTML = `
        <span class="muted">${fmtDateTime(h.firedAt)}</span>
        <span>${action}${detail}</span>
        <span class="pill ${pill.cls}" style="justify-self: end;">${pill.text}</span>
      `;
      box.appendChild(row);
    }
  }

  function renderCredentials() {
    if (state.hasCredentials) {
      $('cred-summary').innerHTML =
        `<strong>${escapeHtml(state.credentialsUsername || '')}</strong> — saved in keychain.`;
      $('cred-username').value = state.credentialsUsername || '';
    } else {
      $('cred-summary').textContent = 'No credentials saved. Scheduled runs will fail until you add them.';
      $('cred-username').value = '';
    }
    $('cred-password').value = '';
  }

  // ─── Wiring ──────────────────────────────────────────────────────

  function wireDashboard() {
    // Welcome banner navigation links.
    const wcCreds = document.getElementById('welcome-go-creds');
    const wcSched = document.getElementById('welcome-go-schedule');
    if (wcCreds) wcCreds.addEventListener('click', () => {
      const navBtn = document.querySelector('[data-view="credentials"].nav-item');
      if (navBtn) navBtn.click();
    });
    if (wcSched) wcSched.addEventListener('click', () => {
      const navBtn = document.querySelector('[data-view="schedule"].nav-item');
      if (navBtn) navBtn.click();
    });

    $('main-toggle').addEventListener('change', async (e) => {
      await API.toggleAutomation(e.target.checked);
      state = await API.getState();
      renderToggle();
    });

    $('manual-in').addEventListener('click', async () => {
      await API.runNow('signin');
      alert('Sign In started in a new browser window. Watch its progress in History.');
    });
    $('manual-out').addEventListener('click', async () => {
      await API.runNow('signout');
      alert('Sign Out started in a new browser window. Watch its progress in History.');
    });

    $('open-history').addEventListener('click', () => {
      document.querySelector('[data-view="history"].nav-item').click();
    });

    $('pause-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('pause-menu').hidden = !$('pause-menu').hidden;
    });
    document.addEventListener('click', () => { $('pause-menu').hidden = true; });

    document.querySelectorAll('[data-pause]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const which = btn.dataset.pause;
        if (which === 'today') await API.pauseToday();
        else if (which === 'session') await API.pauseSession();
        else if (which === 'date') {
          const d = prompt('Pause until which date? (YYYY-MM-DD)');
          if (!d) return;
          await API.pauseUntil(d);
        }
        state = await API.getState();
        renderToggle();
      });
    });

    $('missed-why').addEventListener('click', () => {
      $('diag-modal').hidden = false;
      $('diag-title').textContent = 'Why didn\'t the last scheduled run fire?';
      $('diag-recommendation').textContent =
        'The most common reason is that this app was not running at the scheduled time. ' +
        'Make sure "Launch automatically on login" is enabled in Behavior settings.';
      $('diag-events').innerHTML = '';
    });
    $('diag-close').addEventListener('click', () => { $('diag-modal').hidden = true; });
  }

  function wireSchedule() {
    $('set-signin').addEventListener('change', markDirty);
    $('set-signout').addEventListener('change', markDirty);
    $('set-jitter').addEventListener('input', () => {
      const v = parseInt($('set-jitter').value, 10);
      $('set-jitter-out').textContent = v === 0 ? 'off' : `±${v} min`;
      markDirty();
    });
  }

  function wireHolidays() {
    $('hol-add').addEventListener('click', async () => {
      const d = $('hol-date').value;
      const l = $('hol-label').value.trim();
      if (!d || !l) { alert('Please enter both a date and a label.'); return; }
      await API.addHoliday(d, l);
      $('hol-date').value = '';
      $('hol-label').value = '';
      state = await API.getState();
      renderHolidays();
    });
  }

  function wireBehavior() {
    ['b-skip', 'b-retry', 'b-notify-success', 'b-notify-failure', 'b-launch', 'b-tray', 'b-minimized']
      .forEach(id => $(id).addEventListener('change', markDirty));
  }

  function wireHistory() {
    $('hist-copy').addEventListener('click', () => {
      const diag = {
        version: '0.2.0',
        generatedAt: new Date().toISOString(),
        settings: state.settings,
        hasCredentials: state.hasCredentials,
        history: state.history,
        nextSignIn: state.nextSignIn,
        nextSignOut: state.nextSignOut
      };
      navigator.clipboard.writeText(JSON.stringify(diag, null, 2)).then(
        () => alert('Diagnostic info copied to clipboard.'),
        (e) => alert('Could not copy: ' + e.message)
      );
    });
    $('hist-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state.history, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'greythr-history.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function wireCredentials() {
    $('cred-save').addEventListener('click', async () => {
      const u = $('cred-username').value.trim();
      const p = $('cred-password').value;
      if (!u || !p) { alert('Enter both username and password.'); return; }
      await API.setCredentials(u, p);
      $('cred-result').textContent = 'Saved.';
      $('cred-result').style.color = 'var(--success-text)';
      state = await API.getState();
      renderCredentials();
    });
    $('cred-test').addEventListener('click', async () => {
      $('cred-result').textContent = 'Testing…';
      $('cred-result').style.color = 'var(--text-secondary)';
      const r = await API.testLogin();
      $('cred-result').textContent = r.ok ? '✓ ' + r.message : '✗ ' + (r.error || 'failed');
      $('cred-result').style.color = r.ok ? 'var(--success-text)' : 'var(--danger-text)';
    });
  }

  function wireDanger() {
    $('dz-clear-creds').addEventListener('click', async () => {
      if (!confirm('Remove saved credentials? Scheduled runs will fail until you add them again.')) return;
      await API.clearCredentials();
      state = await API.getState();
      renderCredentials();
    });
    $('dz-reset').addEventListener('click', async () => {
      if (!confirm('This deletes credentials, settings, and history. Continue?')) return;
      await API.resetAll();
      load();
    });
  }

  function wireSaveBar() {
    $('save-discard').addEventListener('click', async () => {
      pendingDays = state.settings.days.slice();
      renderAll();
      clearDirty();
    });
    $('save-commit').addEventListener('click', async () => {
      const updated = {
        signInTime: $('set-signin').value,
        signOutTime: $('set-signout').value,
        days: pendingDays.slice(),
        jitterMinutes: parseInt($('set-jitter').value, 10),
        skipIfDone: $('b-skip').checked,
        retryAttempts: parseInt($('b-retry').value, 10),
        notifyOnSuccess: $('b-notify-success').checked,
        notifyOnFailure: $('b-notify-failure').checked,
        launchOnLogin: $('b-launch').checked,
        closeToTray: $('b-tray').checked,
        openMinimized: $('b-minimized').checked
      };
      await API.saveSettings(updated);
      state = await API.getState();
      renderAll();
      clearDirty();
    });
  }

  function markDirty() { dirty = true; $('save-bar').hidden = false; }
  function clearDirty() { dirty = false; $('save-bar').hidden = true; }

  // ─── Boot ────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', load);
})();
