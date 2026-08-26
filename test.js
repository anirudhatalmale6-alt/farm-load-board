/* Proves the board actually does what it says.
 *
 * Runs the real server against a scratch database, then drives it the way two
 * different phones would. Run it with: npm test
 */
process.env.LOCAL_DB_DIR = process.env.LOCAL_DB_DIR || './pgdata-test';
process.env.SHOW_SAMPLES = '1';
process.env.POST_LIMIT = '500';        // the limit has its own test, below

import fs from 'node:fs';

// Imported after the settings above are in place. A plain `import` at the top of
// the file would be hoisted and run first, and the server would come up pointed
// at the real database instead of the scratch one.
const { app } = await import('./server.js');
const { query, migrate } = await import('./db.js');

let pass = 0, fail = 0;

function ok(what, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.log('  FAIL ' + what + (detail ? '  <- ' + detail : '')); }
}

await migrate();
const server = app.listen(0);
const port = server.address().port;
const base = 'http://127.0.0.1:' + port;

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers['X-Board-Token'] = token;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

const LOAD = {
  type: 'have', commodity: 'Dairy manure', qty: '40 loads', price: 'Free, you haul',
  county: 'Wayne', town: 'Kidron', desc: 'Pit needs pumped before wheat goes in.',
  who: 'Test Dairy', phone: '330-555-0148'
};

console.log('\nposting');
const posted = await call('POST', '/api/loads', { body: LOAD });
ok('a load can be posted', posted.status === 201, 'status ' + posted.status);
const mineToken = posted.body.token;
const id = posted.body.load && posted.body.load.id;
ok('the poster is handed a token', !!mineToken);
ok('the listing comes back with an id', !!id);
ok('a load gets a five day clock',
   posted.body.load && posted.body.load.expires != null &&
   Math.round((posted.body.load.expires - Date.now()) / 86400000) === 5);

console.log('\nthe whole point: another phone sees it');
const otherToken = 'other-phone-' + Date.now();
const theirs = await call('GET', '/api/loads', { token: otherToken });
const seen = theirs.body.loads.find((l) => l.id === id);
ok('a second phone sees the load', !!seen);
ok('it is not marked as theirs', seen && seen.mine === false);
ok('the poster sees it as his own',
   (await call('GET', '/api/loads', { token: mineToken })).body.loads
     .find((l) => l.id === id).mine === true);

console.log('\nphone numbers');
ok('no phone number is in the listing payload',
   seen && seen.phone === undefined,
   seen && JSON.stringify(seen).slice(0, 120));
ok('no phone number anywhere in the whole board payload',
   !JSON.stringify(theirs.body.loads.filter((l) => !l.demo)).includes('555-0148'));

const asked = await call('POST', '/api/loads/' + id + '/number', { token: otherToken });
ok('asking hands over the number', asked.body.phone === LOAD.phone, JSON.stringify(asked.body));

console.log('\ncounting who asked');
let mineNow = (await call('GET', '/api/loads', { token: mineToken }))
  .body.loads.find((l) => l.id === id);
ok('the poster is told one person asked', mineNow.interest === 1, 'got ' + mineNow.interest);

await call('POST', '/api/loads/' + id + '/number', { token: otherToken });
await call('POST', '/api/loads/' + id + '/number', { token: otherToken });
mineNow = (await call('GET', '/api/loads', { token: mineToken }))
  .body.loads.find((l) => l.id === id);
ok('the same man asking three times is still one man', mineNow.interest === 1,
   'got ' + mineNow.interest);

const third = 'third-phone-' + Date.now();
await call('POST', '/api/loads/' + id + '/number', { token: third });
mineNow = (await call('GET', '/api/loads', { token: mineToken }))
  .body.loads.find((l) => l.id === id);
ok('a second man asking makes it two', mineNow.interest === 2, 'got ' + mineNow.interest);

await call('POST', '/api/loads/' + id + '/number', { token: mineToken });
mineNow = (await call('GET', '/api/loads', { token: mineToken }))
  .body.loads.find((l) => l.id === id);
ok('the poster checking his own listing is not counted', mineNow.interest === 2,
   'got ' + mineNow.interest);

console.log('\nwho may touch a listing');
ok('a stranger cannot take it down',
   (await call('DELETE', '/api/loads/' + id, { token: otherToken })).status === 403);
ok('nobody with no token at all can take it down',
   (await call('DELETE', '/api/loads/' + id)).status === 403);
ok('a stranger cannot put it back up',
   (await call('POST', '/api/loads/' + id + '/repost', { token: otherToken })).status === 403);

console.log('\nthe five day clock');
// A load posted six days ago should be off the board for everyone but its owner.
const old = await call('POST', '/api/loads', {
  body: { ...LOAD, commodity: 'Old hay', who: 'Old Farm' }
});
const oldId = old.body.load.id;
const oldToken = old.body.token;
await query(`update loads set posted_at = now() - interval '6 days',
                              expires_at = now() - interval '1 day'
              where public_id = $1`, [oldId]);

const strangerSees = (await call('GET', '/api/loads', { token: otherToken }))
  .body.loads.some((l) => l.id === oldId);
ok('a load past its five days is gone for everyone else', !strangerSees);

const ownerSees = (await call('GET', '/api/loads', { token: oldToken }))
  .body.loads.find((l) => l.id === oldId);
ok('but its owner still sees it, so he can put it back', !!ownerSees);
ok('and it is marked as spent', ownerSees && ownerSees.expires < Date.now());

const back = await call('POST', '/api/loads/' + oldId + '/repost', { token: oldToken });
ok('putting it back up works', back.status === 200);
ok('it runs another five days',
   Math.round((back.body.load.expires - Date.now()) / 86400000) === 5);
ok('and everyone can see it again',
   (await call('GET', '/api/loads', { token: otherToken }))
     .body.loads.some((l) => l.id === oldId));

console.log('\ntrucks do not expire');
const truck = await call('POST', '/api/loads', {
  body: { ...LOAD, type: 'truck', commodity: 'Spreader truck', who: 'B&J Hauling' }
});
ok('a truck is posted with no clock on it', truck.body.load.expires === null);

console.log('\ntaking one down');
ok('the owner can take it down',
   (await call('DELETE', '/api/loads/' + id, { token: mineToken })).status === 200);
ok('it is gone for everyone',
   !(await call('GET', '/api/loads', { token: otherToken }))
     .body.loads.some((l) => l.id === id));
ok('it is gone for the owner too',
   !(await call('GET', '/api/loads', { token: mineToken }))
     .body.loads.some((l) => l.id === id));
ok('the record of who asked is kept',
   Number((await query('select count(*) as n from interest')).rows[0].n) >= 2);

console.log('\nrubbish in');
const bad = async (patch, why) => {
  const r = await call('POST', '/api/loads', { body: { ...LOAD, ...patch } });
  ok(why, r.status === 400, 'status ' + r.status);
};
await bad({ county: 'Yorkshire' }, 'a county that is not in Ohio is refused');
await bad({ county: '' }, 'no county is refused');
await bad({ phone: 'ring me' }, 'a phone number with no digits is refused');
await bad({ phone: '12345' }, 'a phone number too short is refused');
await bad({ commodity: '' }, 'an empty commodity is refused');
await bad({ who: '' }, 'no name is refused');
await bad({ type: 'lorry' }, 'a made up listing type is refused');

console.log('\nthe made-up listings');
const all = (await call('GET', '/api/loads', { token: otherToken })).body.loads;
const demos = all.filter((l) => l.demo);
ok('the samples are on the board', demos.length === 26, 'got ' + demos.length);
ok('every one of them is flagged as a sample', demos.every((l) => l.demo === true));
ok('none of them carries a phone number in the listing',
   demos.every((l) => l.phone === undefined));
ok('a sample number can still be asked for',
   (await call('POST', '/api/loads/' + demos[0].id + '/number', { token: otherToken }))
     .body.phone != null);

console.log('\nodds and ends');
ok('the board answers a health check',
   (await call('GET', '/api/health')).body.ok === true);
ok('a listing that does not exist says so',
   (await call('POST', '/api/loads/nosuchthing/number', { token: otherToken })).status === 404);

const longDesc = 'x'.repeat(5000);
const trimmed = await call('POST', '/api/loads', { body: { ...LOAD, desc: longDesc } });
ok('an enormous description is cut down rather than stored whole',
   trimmed.body.load && trimmed.body.load.desc.length === 1200,
   'got ' + JSON.stringify(trimmed.body).slice(0, 90));

console.log('\nthe brake on posting');
// Nobody has an account, so how fast one connection can post is the only brake
// there is. Generous for a farmer, tiresome for anything posting in bulk.
process.env.POST_LIMIT = '3';
const burst = [];
for (let i = 0; i < 6; i++) {
  burst.push((await call('POST', '/api/loads',
    { body: { ...LOAD, commodity: 'Burst ' + i } })).status);
}
ok('a burst of postings is eventually turned away', burst.includes(429),
   burst.join(','));
process.env.POST_LIMIT = '500';

server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
try { fs.rmSync(process.env.LOCAL_DB_DIR, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
