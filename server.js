const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';        // Railway volume mount path
const FILE = path.join(DATA_DIR, 'fixture-log.json');
const PASSCODE = (process.env.PASSCODE || '').trim();    // optional; blank = open access

const app = express();
app.use(express.json({ limit: '2mb' }));

// The whole app is one file, served at the root. Nothing else in this
// directory is exposed, so server.js and package.json stay private.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------- state ----------
let state = { fixtures: [], entries: [] };
let writing = Promise.resolve();

function loadFromDisk() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const p = JSON.parse(raw);
    state = {
      fixtures: Array.isArray(p.fixtures) ? p.fixtures : [],
      entries: Array.isArray(p.entries) ? p.entries : []
    };
    console.log(`Loaded ${state.fixtures.length} fixtures, ${state.entries.length} entries from ${FILE}`);
  } catch (e) {
    if (e.code === 'ENOENT') console.log(`No log file yet at ${FILE} — starting empty.`);
    else console.error('Could not read log file:', e.message);
  }
}

// Write to a temp file then rename, so a crash mid-write can't leave a half-written log.
function persist() {
  writing = writing.then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fsp.rename(tmp, FILE);
    // keep one rolling backup
    await fsp.copyFile(FILE, FILE + '.bak').catch(() => {});
  }).catch(err => console.error('Write failed:', err.message));
  return writing;
}

// ---------- auth ----------
app.use('/api', (req, res, next) => {
  if (!PASSCODE) return next();
  if ((req.get('x-passcode') || '').trim() === PASSCODE) return next();
  res.status(401).json({ error: 'Passcode required' });
});

// ---------- api ----------
const str = (v, max = 500) => String(v == null ? '' : v).slice(0, max);

app.get('/api/state', (req, res) => res.json(state));

app.post('/api/mutate', async (req, res) => {
  const m = req.body || {};
  try {
    switch (m.type) {
      case 'addFixtures': {
        const incoming = Array.isArray(m.fixtures) ? m.fixtures : [];
        if (!incoming.length) throw new Error('No fixtures sent');
        if (state.fixtures.length + incoming.length > 2000) throw new Error('Fixture limit reached');
        const clash = incoming.find(f =>
          state.fixtures.some(x => x.code.toLowerCase() === str(f.code).trim().toLowerCase()));
        if (clash) throw new Error('ID already used: ' + str(clash.code, 40));
        incoming.forEach(f => {
          const code = str(f.code, 40).trim();
          if (!code) throw new Error('A fixture is missing its ID');
          state.fixtures.push({
            id: str(f.id, 40) || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            code,
            brand: str(f.brand, 80).trim(),
            model: str(f.model, 120).trim(),
            location: str(f.location, 120).trim(),
            created: Date.now()
          });
        });
        break;
      }
      case 'deleteFixtures': {
        const ids = Array.isArray(m.ids) ? m.ids.map(String) : [];
        state.fixtures = state.fixtures.filter(f => !ids.includes(f.id));
        state.entries = state.entries.filter(e => !ids.includes(e.fixtureId));
        break;
      }
      case 'addEntry': {
        const e = m.entry || {};
        if (!state.fixtures.some(f => f.id === e.fixtureId)) throw new Error('That fixture no longer exists');
        const severity = ['pass', 'minor', 'major', 'critical'].includes(e.severity) ? e.severity : 'minor';
        state.entries.push({
          id: str(e.id, 40) || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          fixtureId: str(e.fixtureId, 40),
          date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : new Date().toISOString().slice(0, 10),
          severity,
          problem: str(e.problem, 4000),
          by: str(e.by, 60).trim(),
          status: severity === 'pass' ? 'closed' : (e.status === 'closed' ? 'closed' : 'open'),
          created: Date.now()
        });
        break;
      }
      case 'toggleEntry': {
        const e = state.entries.find(x => x.id === str(m.id, 40));
        if (e) e.status = e.status === 'open' ? 'closed' : 'open';
        break;
      }
      case 'deleteEntry': {
        state.entries = state.entries.filter(x => x.id !== str(m.id, 40));
        break;
      }
      default:
        throw new Error('Unknown action');
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  await persist();
  res.json(state);
});

// Plain-text backup you can hit from a browser or cron
app.get('/api/backup', (req, res) => {
  res.set('Content-Disposition', 'attachment; filename="fixture-log-backup.json"');
  res.json(state);
});

loadFromDisk();
app.listen(PORT, () => console.log(`Fixture Fault Log on :${PORT} — data dir ${DATA_DIR}`));
