// Google Calendar in sola lettura tramite Google Identity Services (token OAuth nel browser, nessun server).
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
let token = null, tokenExp = 0, client = null;

function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = res; s.onerror = () => rej(new Error('Impossibile caricare Google (sei offline?)'));
    document.head.appendChild(s);
  });
}

export async function getToken(clientId, interactive = true) {
  if (token && Date.now() < tokenExp - 60000) return token;
  if (!clientId) throw new Error('Inserisci il Client ID Google in Impostazioni.');
  await loadGis();
  return new Promise((res, rej) => {
    client = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: (r) => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000; res(token);
      },
      error_callback: (e) => rej(new Error(e.message || e.type || 'Accesso Google annullato')),
    });
    client.requestAccessToken({ prompt: interactive && !token ? '' : 'none' });
  });
}

async function api(path, params = {}) {
  const url = new URL('https://www.googleapis.com/calendar/v3/' + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) { token = null; throw new Error('Sessione Google scaduta, riprova.'); }
  if (!r.ok) throw new Error('Google Calendar: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

export async function listCalendars(clientId) {
  await getToken(clientId);
  const d = await api('users/me/calendarList', { maxResults: 250 });
  return d.items.map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary }));
}

/** Eventi tra from e to su più calendari, già filtrati per parole chiave */
export async function fetchEvents(settings, from, to, typeFromText) {
  await getToken(settings.googleClientId);
  const out = [];
  for (const cal of settings.calendarIds.length ? settings.calendarIds : ['primary']) {
    let pageToken = '';
    do {
      const p = { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: 250 };
      if (pageToken) p.pageToken = pageToken;
      const d = await api('calendars/' + encodeURIComponent(cal) + '/events', p);
      for (const ev of d.items || []) {
        if (ev.status === 'cancelled' || !ev.start) continue;
        const title = ev.summary || '';
        const type = typeFromText(title, settings.keywords);
        const matched = Object.values(settings.keywords).flat().some((w) => w && title.toLowerCase().includes(w.toLowerCase()));
        if (!matched) continue;
        const allDay = !ev.start.dateTime;
        const start = new Date(ev.start.dateTime || ev.start.date + 'T18:00:00');
        const end = new Date(ev.end.dateTime || ev.start.date + 'T19:00:00');
        out.push({
          source: 'calendar', extId: 'gcal:' + ev.id, title, type, start: start.toISOString(), end: end.toISOString(),
          durationMin: Math.round((end - start) / 60000), allDay,
        });
      }
      pageToken = d.nextPageToken || '';
    } while (pageToken);
  }
  return out;
}
