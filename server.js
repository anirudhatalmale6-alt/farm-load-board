/* Five Days Freight - the board itself.
 *
 * A load posted on one phone is stored here and shows up on every other phone.
 * Loads run five days and then drop off on their own. Trucks for hire stay up
 * until their owner takes them down.
 *
 * There are no accounts and no passwords. A phone quietly keeps a long random
 * token and sends it back with every request, and that token is what says "this
 * listing is mine". Losing it costs you the ability to edit your own listings,
 * nothing else, and it is the same bargain the paper board at the feed mill
 * makes: whoever pinned it up is whoever can take it down.
 */
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { query, migrate } from './db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const PORT = process.env.PORT || 3000;

// A load runs five days. That is the name of the place.
const RUN_DAYS = 5;

// The made-up listings exist so the board is not an empty room while it is
// being shown to people. Turn them off before real farmers are on here -
// nobody should ever ring a farm that does not exist.
const SHOW_SAMPLES = process.env.SHOW_SAMPLES !== '0';

// ---------- the county list, read from the same file the map uses ----------

const COUNTIES = (() => {
  const src = fs.readFileSync(path.join(PUBLIC, 'ohio.js'), 'utf8');
  const win = {};
  new Function('window', src)(win);
  return new Set(win.OHIO.counties.map((c) => c.n));
})();

// ---------- small helpers ----------

const token = () => crypto.randomBytes(24).toString('base64url');

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

// Somebody typing their number as (330) 555-0148 or 330.555.0148 means the same
// thing both times. Keep what they typed, but check there is a real number in it.
function looksLikePhone(s) {
  const digits = String(s || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function expiryFor(type) {
  if (type === 'truck') return null;                    // a truck is not a load
  return new Date(Date.now() + RUN_DAYS * 86400000);
}

// The phone number is deliberately not in this. It is handed out one at a time
// by /number, so a scraper pulling the listings gets no numbers at all.
function publicRow(r, mine) {
  return {
    id: r.public_id,
    type: r.type,
    commodity: r.commodity,
    qty: r.qty,
    price: r.price,
    county: r.county,
    town: r.town,
    desc: r.descr,
    who: r.who,
    posted: Date.parse(r.posted_at),
    expires: r.expires_at ? Date.parse(r.expires_at) : null,
    mine: !!mine,
    interest: mine ? Number(r.interest || 0) : undefined
  };
}

// ---------- the made-up listings ----------

const SAMPLES = SHOW_SAMPLES
  ? JSON.parse(fs.readFileSync(path.join(HERE, 'samples.json'), 'utf8'))
  : [];

function sampleRows() {
  const now = Date.now();
  return SAMPLES.map((s, i) => ({
    id: 'demo' + i,
    type: s.t,
    commodity: s.c,
    qty: s.qty,
    price: s.price,
    county: s.county,
    town: s.town,
    desc: s.x,
    who: s.who,
    posted: now - s.d * 86400000,
    // the made-up ones run on the same five day clock as everything else, so the
    // board demonstrates its own rule instead of just claiming it
    expires: s.t === 'truck' ? null : now + (RUN_DAYS - s.d) * 86400000,
    mine: false,
    demo: true
  }));
}

const samplePhone = (id) => {
  const i = Number(String(id).replace('demo', ''));
  return SAMPLES[i] ? SAMPLES[i].ph : null;
};

// ---------- posting limit ----------
// No accounts means no way to know who anyone is, so the only brake available is
// how fast one connection can post. Generous for a farmer, tiresome for a bot.

const recent = new Map();
const POST_WINDOW = 3600000;

function overLimit(ip) {
  const limit = Number(process.env.POST_LIMIT || 8);
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < POST_WINDOW);
  if (hits.length >= limit) {
    recent.set(ip, hits);
    return true;
  }
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) {
    for (const [k, v] of recent) if (!v.some((t) => now - t < POST_WINDOW)) recent.delete(k);
  }
  return false;
}

// ---------- app ----------

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

const who = (req) => clean(req.get('X-Board-Token'), 64);

app.get('/api/health', async (_req, res) => {
  try {
    await query('select 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Everything currently on the board. Your own spent listings come back too, so
// you are never left wondering where your listing went - you get told, and you
// get a button to put it back up.
app.get('/api/loads', async (req, res, next) => {
  try {
    const me = who(req);
    const { rows } = await query(
      `select l.*,
              (select count(*) from interest i where i.load_id = l.id) as interest
         from loads l
        where l.taken_down_at is null
          and (l.expires_at is null or l.expires_at > now() or l.owner_token = $1)
        order by l.posted_at desc
        limit 500`,
      [me || '-']
    );
    const mine = rows.map((r) => publicRow(r, me && r.owner_token === me));
    res.json({ loads: mine.concat(sampleRows()), runDays: RUN_DAYS });
  } catch (e) { next(e); }
});

app.post('/api/loads', async (req, res, next) => {
  try {
    if (overLimit(req.ip))
      return res.status(429).json({ error: 'That is a lot of listings in one hour. Try again later.' });

    const b = req.body || {};
    const type = clean(b.type, 8);
    const commodity = clean(b.commodity, 80);
    const county = clean(b.county, 40);
    const whoName = clean(b.who, 80);
    const phone = clean(b.phone, 30);

    if (!['have', 'need', 'truck'].includes(type))
      return res.status(400).json({ error: 'Pick whether you have a load, want one, or have a truck.' });
    if (!commodity) return res.status(400).json({ error: 'Put in what you are hauling.' });
    if (!COUNTIES.has(county)) return res.status(400).json({ error: 'Pick your county.' });
    if (!whoName) return res.status(400).json({ error: 'Folks need to know who they are calling.' });
    if (!looksLikePhone(phone)) return res.status(400).json({ error: 'That phone number does not look right.' });

    const owner = who(req) || token();
    const id = token().slice(0, 16);

    const { rows } = await query(
      `insert into loads (public_id, owner_token, type, commodity, qty, price,
                          county, town, descr, who, phone, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning *, 0 as interest`,
      [id, owner, type, commodity,
       clean(b.qty, 80) || 'Call for details',
       clean(b.price, 80) || 'Call',
       county, clean(b.town, 60), clean(b.desc, 1200), whoName, phone,
       expiryFor(type)]
    );

    res.status(201).json({ load: publicRow(rows[0], true), token: owner });
  } catch (e) { next(e); }
});

// Somebody asked for a number. This is the only place a number is ever given
// out, and asking is what the poster gets told about.
app.post('/api/loads/:id/number', async (req, res, next) => {
  try {
    const id = clean(req.params.id, 32);

    if (id.startsWith('demo')) {
      const ph = samplePhone(id);
      if (!ph) return res.status(404).json({ error: 'That listing is gone.' });
      return res.json({ phone: ph, demo: true });
    }

    const { rows } = await query(
      `select id, phone, owner_token from loads
        where public_id = $1 and taken_down_at is null`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'That listing is gone.' });

    const viewer = who(req) || 'anon:' + crypto.createHash('sha256')
      .update(String(req.ip)).digest('base64url').slice(0, 20);

    // A poster asking for his own number is not interest.
    if (viewer !== rows[0].owner_token) {
      await query(
        `insert into interest (load_id, viewer_token) values ($1,$2)
         on conflict (load_id, viewer_token) do nothing`,
        [rows[0].id, viewer]);
    }
    res.json({ phone: rows[0].phone });
  } catch (e) { next(e); }
});

// Put a spent listing back up for another five days.
app.post('/api/loads/:id/repost', async (req, res, next) => {
  try {
    const me = who(req);
    if (!me) return res.status(403).json({ error: 'That is not your listing.' });
    const { rows } = await query(
      `update loads
          set posted_at = now(),
              expires_at = case when type = 'truck' then null
                                else now() + ($3 || ' days')::interval end
        where public_id = $1 and owner_token = $2 and taken_down_at is null
        returning *, (select count(*) from interest i where i.load_id = loads.id) as interest`,
      [clean(req.params.id, 32), me, String(RUN_DAYS)]);
    if (!rows.length) return res.status(403).json({ error: 'That is not your listing.' });
    res.json({ load: publicRow(rows[0], true) });
  } catch (e) { next(e); }
});

// Take it down. The row stays, so the count of who asked is not lost.
app.delete('/api/loads/:id', async (req, res, next) => {
  try {
    const me = who(req);
    if (!me) return res.status(403).json({ error: 'That is not your listing.' });
    const { rows } = await query(
      `update loads set taken_down_at = now()
        where public_id = $1 and owner_token = $2 and taken_down_at is null
        returning public_id`,
      [clean(req.params.id, 32), me]);
    if (!rows.length) return res.status(403).json({ error: 'That is not your listing.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.use(express.static(PUBLIC, { extensions: ['html'] }));

app.use((err, _req, res, _next) => {
  console.error('request failed:', err.message);
  res.status(500).json({ error: 'Something went wrong at our end. Try again in a minute.' });
});

export { app };

// Started when this file is run directly. Left alone when the tests import it,
// so they can drive the same app on their own port without a second database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => {
      app.listen(PORT, () => console.log('five days freight listening on ' + PORT));
    })
    .catch((e) => {
      console.error('could not start:', e.message);
      process.exit(1);
    });
}
