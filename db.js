/* The database.
 *
 * On the server this is a real Postgres, handed to us as DATABASE_URL.
 * With no DATABASE_URL set it falls back to a Postgres that runs inside this
 * process and keeps its files in ./pgdata, so the board can be run and tested
 * on a laptop without installing anything. Same SQL either way.
 */

let query;

const url = process.env.DATABASE_URL;

if (url) {
  const { default: pg } = await import('pg');
  // Railway's private network needs no SSL; anything reached over the open
  // internet does, and its certificate is its own, so it will not verify.
  const internal = /\.internal(:|\/|$)/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    ssl: internal ? false : { rejectUnauthorized: false },
    max: 8,
    idleTimeoutMillis: 30000
  });
  pool.on('error', (e) => console.error('database pool error:', e.message));
  query = (sql, params) => pool.query(sql, params);
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.LOCAL_DB_DIR || './pgdata';
  const local = new PGlite(dir);
  await local.waitReady;
  query = (sql, params) => local.query(sql, params);
  console.log('no DATABASE_URL - using the local database in ' + dir);
}

export { query };

export async function migrate() {
  await query(`
    create table if not exists loads (
      id            bigserial primary key,
      public_id     text        not null unique,
      owner_token   text        not null,
      type          text        not null,
      commodity     text        not null,
      qty           text        not null default '',
      price         text        not null default '',
      county        text        not null,
      town          text        not null default '',
      descr         text        not null default '',
      who           text        not null,
      phone         text        not null,
      posted_at     timestamptz not null default now(),
      expires_at    timestamptz,
      taken_down_at timestamptz
    )
  `);

  // Who asked for a number, rather than how many taps happened. One row per
  // person per listing, so a man tapping twice is still one man.
  await query(`
    create table if not exists interest (
      load_id      bigint      not null references loads(id) on delete cascade,
      viewer_token text        not null,
      asked_at     timestamptz not null default now(),
      primary key (load_id, viewer_token)
    )
  `);

  await query(`create index if not exists loads_live_idx
               on loads (taken_down_at, expires_at)`);
  await query(`create index if not exists loads_owner_idx
               on loads (owner_token)`);
}
