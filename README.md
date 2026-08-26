# Five Days Freight

An Ohio farm load board. Manure, hay, straw, grain, gravel and mulch, posted by
farmers and hauled by neighbours.

Every load runs five days and then comes off the board on its own, so nothing on
here is stale. A truck for hire is not a load and has no clock on it - it stays
up until its owner takes it down.

## Running it

    npm install
    npm start

With no `DATABASE_URL` set it runs a Postgres inside its own process and keeps
the files in `./pgdata`, so it will start on a laptop with nothing else
installed. Open http://localhost:3000.

On a server, set `DATABASE_URL` to a real Postgres and it uses that instead.
The tables are created on start-up; there is no separate migration step.

## Settings

| variable        | what it does                                          |
| --------------- | ----------------------------------------------------- |
| `DATABASE_URL`  | Postgres to use. Without it, the local one in `./pgdata`. |
| `PORT`          | Port to listen on. Default 3000.                      |
| `SHOW_SAMPLES`  | `0` hides the made-up listings. Set this before real farmers are on here. |
| `POST_LIMIT`    | Postings allowed per connection per hour. Default 8.  |

## Tests

    npm test

Drives the real server against a scratch database: two different phones, the
five day clock, who may take a listing down, and what happens when rubbish is
typed into the form.

## How it knows whose listing is whose

There are no accounts and no passwords. On the first posting the server issues a
long random token, the phone keeps it, and it comes back with every later
request. That token is what lets somebody take their own listing down.

It is the same bargain as the paper board at the feed mill: whoever pinned it up
is whoever can take it down. Clear the browser and you lose the ability to edit
your own listings - nothing else.

## Phone numbers

A number is never sent out with the listings. It is handed over one at a time,
by `POST /api/loads/:id/number`, and asking is what gets counted and reported
back to whoever posted the load. Anything scraping the board comes away with no
numbers at all.
