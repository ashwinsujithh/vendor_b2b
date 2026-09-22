/*
 * DNS fallback for flaky local networks: try the OS resolver first; only if it
 * fails for DB_HOST, retry with the answer from Google DNS-over-HTTPS. Healthy
 * systems (including Vercel) are completely untouched.
 *
 * Node's net module calls dns.lookup(host, { hints, all: true }, cb) — with
 * `all: true` the callback must receive an ARRAY of { address, family }.
 * Returning a bare string there surfaces as "Invalid IP address: undefined".
 *
 * Side-effect module: require('./dns-fix') from db.js. Disable with
 * DB_DNS_FIX=0.
 */
const dns = require('dns');

const DB_HOST = process.env.DB_HOST;

if (DB_HOST && !/^\d+(\.\d+){3}$/.test(DB_HOST) && process.env.DB_DNS_FIX !== '0') {
  let pinnedIp = null;
  let pinnedError = null;
  let pending = []; // callbacks waiting for the DoH answer

  const flush = () => {
    const list = pending;
    pending = [];
    for (const fn of list) process.nextTick(fn); // never call cb synchronously
  };

  fetch(`https://dns.google/resolve?name=${encodeURIComponent(DB_HOST)}&type=A`)
    .then((r) => r.json())
    .then((json) => {
      const answer = (json.Answer || []).find((a) => a.type === 1);
      if (answer) pinnedIp = answer.data;
      else pinnedError = new Error(`dns-fix: no A record for ${DB_HOST}`);
    })
    .catch(() => {
      pinnedError = new Error('dns-fix: DoH lookup failed');
    })
    .finally(flush);

  // Don't let a stuck DoH request hang lookups forever.
  setTimeout(() => {
    if (!pinnedIp && !pinnedError) {
      pinnedError = new Error('dns-fix: DoH lookup timed out');
      flush();
    }
  }, 5000).unref();

  const osLookup = dns.lookup.bind(dns);
  dns.lookup = (host, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (host !== DB_HOST) return osLookup(host, opts, cb);

    osLookup(host, opts, (err, ...args) => {
      if (!err) return cb(null, ...args); // OS resolver works — pass through

      // OS failed → answer with the DoH record (or surface the OS error).
      const answer = () => {
        if (pinnedIp) {
          console.warn(`dns-fix: OS lookup failed for ${host} — using DoH address ${pinnedIp}`);
          if (opts && opts.all) cb(null, [{ address: pinnedIp, family: 4 }]);
          else cb(null, pinnedIp, 4);
        } else {
          cb(pinnedError || err);
        }
      };
      if (pinnedIp || pinnedError) process.nextTick(answer);
      else pending.push(answer);
    });
  };
}
