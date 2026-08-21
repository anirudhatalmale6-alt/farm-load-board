(function () {
  'use strict';

  var STORE = 'flb.loads.v1';

  var TYPES = [
    { k: 'all',   label: 'Everything' },
    { k: 'have',  label: 'Loads available' },
    { k: 'need',  label: 'Wanted' },
    { k: 'truck', label: 'Trucks for hire' }
  ];

  var CATS = [
    { k: 'all',    label: 'All' },
    { k: 'manure', label: 'Manure & litter' },
    { k: 'hay',    label: 'Hay, straw & forage' },
    { k: 'grain',  label: 'Grain & feed' },
    { k: 'stone',  label: 'Gravel, stone & sand' },
    { k: 'mulch',  label: 'Mulch, bedding & soil' }
  ];

  var TYPE_WORD = { have: 'Load available', need: 'Wanted', truck: 'Truck for hire' };
  var TYPE_PLURAL = { have: 'Loads available', need: 'Wanted listings', truck: 'Trucks for hire' };

  // Ohio's five physiographic regions, off the state's own rest-area map.
  // Farmers do not say "glaciated plateau", so every one carries a plain name too.
  var REGIONS = [
    { k: 'lake',        name: 'Lake Plains',        plain: 'the northwest flats' },
    { k: 'till',        name: 'Till Plains',        plain: 'west and central farmland' },
    { k: 'glaciated',   name: 'Glaciated Plateau',  plain: 'the northeast' },
    { k: 'unglaciated', name: 'Unglaciated Plateau', plain: 'the southeast hills' },
    { k: 'bluegrass',   name: 'Bluegrass',          plain: 'the south corner' }
  ];
  var REGION_NAME = {};
  REGIONS.forEach(function (r) { REGION_NAME[r.k] = r.name; });

  var counties = window.OHIO.counties;
  var byName = {};
  counties.forEach(function (c) { byName[c.n] = c; });

  // ---------- helpers ----------

  function categorize(text, type) {
    if (type === 'truck') return 'truck';
    var s = (text || '').toLowerCase();
    if (/manure|litter|slurry|lagoon/.test(s)) return 'manure';
    if (/hay|straw|silage|haylage|bale|forage/.test(s)) return 'hay';
    if (/oat|corn|wheat|bean|grain|feed|barley|rye/.test(s)) return 'grain';
    if (/gravel|stone|sand|limestone|slag|fill|rock/.test(s)) return 'stone';
    if (/mulch|sawdust|shaving|compost|topsoil|bark|dirt|soil/.test(s)) return 'mulch';
    return 'other';
  }

  function miles(a, b) {
    if (!a || !b) return null;
    var R = 3958.8, p = Math.PI / 180;
    var dLat = (b.lat - a.lat) * p, dLon = (b.lon - a.lon) * p;
    var la1 = a.lat * p, la2 = b.lat * p;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }

  // A load runs five days and then comes off on its own. That is the whole point
  // of the name, and it is what keeps the board from filling up with loads that
  // went last month and never got taken down.
  var RUN_DAYS = 5;

  // A truck is not a load. A load has a clock on it - the pit gets pumped, the
  // bales go. A man with a tanker is telling you what he does for a living, and
  // making him re-post that twice a week is how you lose the only people on here
  // who own a truck. So the clock runs on loads, and trucks stay up until pulled.
  function expires(l) {
    return l.type !== 'truck';
  }

  function daysLeft(ms) {
    return RUN_DAYS - Math.floor((Date.now() - ms) / 86400000);
  }

  function spent(l) {
    return expires(l) && daysLeft(l.posted) <= 0;
  }

  function runBit(l) {
    if (!expires(l)) return '<span class="run stand">Stays up until taken down</span>';
    var n = daysLeft(l.posted);
    if (n <= 0) return '<span class="run out">Ran its five days</span>';
    if (n === 1) return '<span class="run last">Last day</span>';
    return '<span class="run">' + n + ' days left</span>';
  }

  function daysAgo(ms) {
    var d = Math.round((Date.now() - ms) / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 14) return d + ' days ago';
    return Math.round(d / 7) + ' weeks ago';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function telHref(ph) {
    return 'tel:' + String(ph || '').replace(/[^0-9+]/g, '');
  }

  // ---------- data ----------

  function loadAll() {
    var out = window.SAMPLES.map(function (s, i) {
      return {
        id: 's' + i,
        type: s.t,
        commodity: s.c,
        cat: categorize(s.c, s.t),
        qty: s.qty,
        county: s.county,
        town: s.town,
        price: s.price,
        desc: s.x,
        who: s.who,
        phone: s.ph,
        posted: Date.now() - s.d * 86400000,
        mine: false
      };
    });

    var mine = [];
    try { mine = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { mine = []; }
    mine.forEach(function (m) {
      m.mine = true;
      m.cat = categorize(m.commodity, m.type);
      out.push(m);
    });
    // Expired loads leave the board. Your own stay, so you are not left wondering
    // where your listing went - you get told, and you get a button to put it back.
    return out.filter(function (l) { return l.mine || !spent(l); });
  }

  var LOADS = loadAll();

  // ---------- state ----------

  var state = { type: 'all', cat: 'all', region: 'all', county: 'all', radius: 50, sort: 'new' };

  function matches(l) {
    if (state.type !== 'all' && l.type !== state.type) return false;
    if (state.cat !== 'all') {
      if (state.cat === 'truck') { if (l.type !== 'truck') return false; }
      else if (l.cat !== state.cat) return false;
    }
    var home = state.county !== 'all' ? byName[state.county] : null;
    if (home) {
      var lc = byName[l.county];
      if (!lc) return false;
      if (state.radius === 0) { if (l.county !== state.county) return false; }
      else if (miles(home, lc) > state.radius) return false;
    } else if (state.region !== 'all') {
      var rc = byName[l.county];
      if (!rc || rc.r !== state.region) return false;
    }
    return true;
  }

  function visible() {
    var home = state.county !== 'all' ? byName[state.county] : null;
    var out = LOADS.filter(matches).map(function (l) {
      l._d = home ? miles(home, byName[l.county]) : null;
      return l;
    });
    out.sort(function (a, b) {
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      if (state.sort === 'near' && a._d != null && b._d != null && a._d !== b._d) return a._d - b._d;
      return b.posted - a.posted;
    });
    return out;
  }

  // ---------- map ----------

  var mapHolder = document.getElementById('mapHolder');
  var hovName = document.getElementById('hovName');

  (function buildMap() {
    var W = window.OHIO.w, H = window.OHIO.h, MPU = window.OHIO.mpu;
    // a margin of paper around the state, so the frame does not run along the
    // county lines on the west and south edges
    var PAD = 34;
    var s = '<svg viewBox="' + (-PAD) + ' ' + (-PAD) + ' ' + (W + PAD * 2) + ' ' + (H + PAD * 2) +
            '" role="img" aria-label="Map of Ohio counties by region">';

    // paper under everything, so the map reads as a printed plate
    s += '<rect class="paper" x="' + (-PAD + 2) + '" y="' + (-PAD + 2) +
         '" width="' + (W + PAD * 2 - 4) + '" height="' + (H + PAD * 2 - 4) + '" rx="4"/>';

    // counties first, tinted by region - the colour blocks are the regions,
    // exactly the way the state's own map does it
    counties.forEach(function (c) {
      s += '<path class="cty" data-n="' + esc(c.n) + '" data-r="' + esc(c.r) +
           '" d="' + c.d + '"><title>' + esc(c.n) + ' County</title></path>';
    });

    // the state edge, drawn heavy over the county lines
    s += '<path class="edge" d="' + window.OHIO.outline + '"/>';

    // interstates on top, white casing under a dark line so they read over any colour
    s += '<g class="roads">';
    window.OHIO.roads.forEach(function (r) {
      s += '<path class="road-case" d="' + r.d + '"/>';
    });
    window.OHIO.roads.forEach(function (r) {
      s += '<path class="road" d="' + r.d + '"/>';
    });
    window.OHIO.roads.forEach(function (r) {
      var w = r.n.length > 2 ? 76 : 50;
      s += '<rect class="shield" x="' + (r.lx - w / 2) + '" y="' + (r.ly - 20) +
           '" width="' + w + '" height="40" rx="7"/>' +
           '<text class="shieldtx" x="' + r.lx + '" y="' + (r.ly + 11) + '">' +
           esc(r.n) + '</text>';
    });
    s += '</g>';

    s += '<g class="dots"></g>';

    // scale bar and compass, in the empty corners of the bounding box
    var bar = 50 / MPU;                       // 50 miles, in map units
    var by = H - 34, bx = 24;
    s += '<g class="deco">' +
      '<rect class="barbg" x="' + (bx - 8) + '" y="' + (by - 24) + '" width="' + (bar + 16) +
        '" height="46" rx="6"/>' +
      '<line class="bar" x1="' + bx + '" y1="' + by + '" x2="' + (bx + bar) + '" y2="' + by + '"/>' +
      '<line class="bar" x1="' + bx + '" y1="' + (by - 9) + '" x2="' + bx + '" y2="' + (by + 9) + '"/>' +
      '<line class="bar" x1="' + (bx + bar) + '" y1="' + (by - 9) + '" x2="' + (bx + bar) +
        '" y2="' + (by + 9) + '"/>' +
      '<text class="barlb" x="' + (bx + bar / 2) + '" y="' + (by - 11) + '">50 miles</text>' +
      '<g class="rose" transform="translate(' + (W - 62) + ',' + (H - 82) + ')">' +
        '<path d="M0,-40 L11,10 L0,2 L-11,10 Z"/>' +
        '<text x="0" y="42">N</text>' +
      '</g></g>';

    s += '</svg>';
    mapHolder.innerHTML = s;

    mapHolder.addEventListener('click', function (e) {
      var p = e.target.closest ? e.target.closest('.cty') : null;
      if (!p) return;
      var n = p.getAttribute('data-n');
      state.county = (state.county === n) ? 'all' : n;
      if (state.county !== 'all') state.region = 'all';
      syncControls();
      render();
      if (state.county !== 'all' && window.innerWidth <= 860) {
        document.querySelector('.listhead').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    mapHolder.addEventListener('mouseover', function (e) {
      var p = e.target.closest ? e.target.closest('.cty') : null;
      if (p) hovName.textContent = p.getAttribute('data-n') + ' County';
    });
    mapHolder.addEventListener('mouseout', function () { hovName.textContent = ''; });
  })();

  // The map is shaded by what is out there, ignoring the county/distance filter -
  // otherwise picking a county empties the map and you cannot see where to go next.
  function paintMap() {
    var counts = {};
    LOADS.forEach(function (l) {
      if (state.type !== 'all' && l.type !== state.type) return;
      if (state.cat !== 'all') {
        if (state.cat === 'truck') { if (l.type !== 'truck') return; }
        else if (l.cat !== state.cat) return;
      }
      counts[l.county] = (counts[l.county] || 0) + 1;
    });
    var paths = mapHolder.querySelectorAll('.cty');
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i], n = p.getAttribute('data-n');
      // colour is the region, always - that is what makes it read as a map
      var cls = 'cty r-' + byName[n].r;
      if (state.region !== 'all' && byName[n].r !== state.region) cls = 'cty dim';
      if (state.county === n) cls += ' sel';
      p.setAttribute('class', cls);
    }

    // a dot on every county that has something on it, sized by how much
    var dots = '';
    counties.forEach(function (c) {
      var n = counts[c.n] || 0;
      if (!n) return;
      if (state.region !== 'all' && c.r !== state.region) return;
      var r = 17 + 7 * Math.sqrt(n - 1);
      dots += '<circle class="ldot' + (state.county === c.n ? ' on' : '') + '" cx="' + c.x +
              '" cy="' + c.y + '" r="' + r.toFixed(1) + '"><title>' + esc(c.n) +
              ' County: ' + n + (n === 1 ? ' listing' : ' listings') + '</title></circle>';
    });
    mapHolder.querySelector('.dots').innerHTML = dots;
  }

  // ---------- controls ----------

  var typeChips = document.getElementById('typeChips');
  var catChips = document.getElementById('catChips');
  var regionSel = document.getElementById('regionSel');
  var countySel = document.getElementById('countySel');
  var radiusSel = document.getElementById('radiusSel');
  var sortSel = document.getElementById('sortSel');

  TYPES.forEach(function (t) {
    var b = document.createElement('button');
    b.className = 'chip';
    b.textContent = t.label;
    b.setAttribute('data-k', t.k);
    b.addEventListener('click', function () { state.type = t.k; syncControls(); render(); });
    typeChips.appendChild(b);
  });

  CATS.forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'chip';
    b.textContent = c.label;
    b.setAttribute('data-k', c.k);
    b.addEventListener('click', function () { state.cat = c.k; syncControls(); render(); });
    catChips.appendChild(b);
  });

  regionSel.innerHTML = '<option value="all">Anywhere in Ohio</option>' +
    REGIONS.map(function (r) {
      return '<option value="' + r.k + '">' + r.name + ' &mdash; ' + r.plain + '</option>';
    }).join('');
  countySel.innerHTML = '<option value="all">Any county</option>' +
    counties.map(function (c) { return '<option value="' + c.n + '">' + c.n + '</option>'; }).join('');

  regionSel.addEventListener('change', function () {
    state.region = regionSel.value;
    if (state.region !== 'all') state.county = 'all';
    syncControls(); render();
  });
  countySel.addEventListener('change', function () {
    state.county = countySel.value;
    if (state.county !== 'all') state.region = 'all';
    syncControls(); render();
  });
  radiusSel.addEventListener('change', function () { state.radius = +radiusSel.value; render(); });
  sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
  document.getElementById('clearBtn').addEventListener('click', function () {
    state = { type: 'all', cat: 'all', region: 'all', county: 'all', radius: 50, sort: 'new' };
    syncControls(); render();
  });

  function syncControls() {
    var i, c;
    var tc = typeChips.children;
    for (i = 0; i < tc.length; i++)
      tc[i].className = 'chip' + (tc[i].getAttribute('data-k') === state.type ? ' on' : '');
    var cc = catChips.children;
    for (i = 0; i < cc.length; i++)
      cc[i].className = 'chip' + (cc[i].getAttribute('data-k') === state.cat ? ' on' : '');
    regionSel.value = state.region;
    countySel.value = state.county;
    radiusSel.value = String(state.radius);
    sortSel.value = state.sort;
    var on = state.county !== 'all';
    radiusSel.disabled = !on;
    document.getElementById('radiusLabel').style.opacity = on ? '1' : '.45';
    radiusSel.style.opacity = on ? '1' : '.5';
  }

  // ---------- interest ----------
  // The number is not in the page until somebody asks for it: scrapers get nothing,
  // and the count of who asked is what tells a poster the board is alive.
  // Prototype: counts live on this device. Real version counts on the server.

  var VIEWS = 'flb.views.v1';
  var SHOWN = {};                       // revealed this visit only

  function views() {
    try { return JSON.parse(localStorage.getItem(VIEWS) || '{}'); } catch (e) { return {}; }
  }
  function bumpView(id) {
    var v = views();
    v[id] = (v[id] || 0) + 1;
    try { localStorage.setItem(VIEWS, JSON.stringify(v)); } catch (e) {}
    return v[id];
  }

  // ---------- listings ----------

  var list = document.getElementById('list');
  var listTitle = document.getElementById('listTitle');
  var listCount = document.getElementById('listCount');

  function phoneBit(l) {
    if (!l.phone) return '';
    if (SHOWN[l.id])
      return ' <a class="btn btn-go btn-sm" href="' + telHref(l.phone) + '">Call ' +
             esc(l.phone) + '</a>';
    return ' <button class="btn btn-go btn-sm" data-show="' + esc(l.id) + '">Show number</button>';
  }

  // Only the poster sees who has been asking - that is what brings him back.
  function interestBit(l) {
    if (!l.mine) return '';
    var n = views()[l.id] || 0;
    if (!n) return '<div class="interest">Nobody has asked for your number yet.</div>';
    return '<div class="interest on">' + n +
      (n === 1 ? ' person has' : ' people have') + ' asked for your number.</div>';
  }

  function card(l) {
    var dead = spent(l);
    var cls = 'load t-' + l.type + (l.mine ? ' mine' : '') + (dead ? ' spent' : '');
    var where = esc(l.town ? l.town + ', ' + l.county + ' County' : l.county + ' County');
    var dist = '';
    if (l._d != null)
      dist = '<span class="dot">&middot;</span>' + (l._d === 0 ? 'same county' : l._d + ' miles away');
    var pill = l.mine
      ? '<span class="pill mine">Yours</span>'
      : '<span class="pill t-' + l.type + '">' + TYPE_WORD[l.type] + '</span>';

    return '<div class="' + cls + '">' +
      '<div class="load-top"><h3>' + esc(l.commodity) + '</h3>' + pill + '</div>' +
      '<div class="runline">' + runBit(l) + '</div>' +
      '<div class="meta"><b>' + esc(l.qty) + '</b><span class="dot">&middot;</span>' +
        where + dist + '</div>' +
      (l.desc ? '<div class="desc">' + esc(l.desc) + '</div>' : '') +
      '<div class="load-foot">' +
        '<span class="who">' + esc(l.who) + '<span class="dot">&middot;</span>' +
          'posted ' + daysAgo(l.posted) +
          (l.mine && dead ? ' <button class="clearlink" data-again="' + esc(l.id) +
            '">Put it back up</button>' : '') +
          (l.mine ? ' <button class="clearlink" data-drop="' + esc(l.id) +
            '">Take it down</button>' : '') + '</span>' +
        '<span><span class="price">' + esc(l.price) + '</span>' + phoneBit(l) + '</span>' +
      '</div>' + interestBit(l) + '</div>';
  }

  function titleFor() {
    var cat = '';
    if (state.cat !== 'all')
      cat = CATS.filter(function (c) { return c.k === state.cat; })[0].label;

    var type = TYPE_PLURAL[state.type] || '';
    var head;
    if (cat && type) head = cat + ' &mdash; ' + type.toLowerCase();
    else if (cat) head = cat;
    else if (type) head = type;
    else head = '';

    var where = '';
    if (state.county !== 'all')
      where = state.radius === 0
        ? ' in ' + state.county + ' County'
        : ' within ' + state.radius + ' miles of ' + state.county + ' County';
    else if (state.region !== 'all') where = ' in the ' + REGION_NAME[state.region];

    if (!head) head = where ? 'Everything' : 'Everything on the board';
    return head + where;
  }

  function render() {
    var v = visible();
    paintMap();

    var hint = document.querySelector('.maphead .hint');
    if (state.county !== 'all') hint.textContent = 'Showing ' + state.county + ' County. Tap it again to clear.';
    else if (state.region !== 'all') hint.textContent = 'Showing the ' + REGION_NAME[state.region] + '. Tap any county to narrow it.';
    else hint.textContent = 'Tap a county to see what is moving there';

    listTitle.innerHTML = titleFor();
    listCount.textContent = v.length + (v.length === 1 ? ' listing' : ' listings');

    if (!v.length) {
      list.innerHTML = '<div class="empty"><b>Nothing here yet</b>' +
        'No listings match that. Try a wider distance, or a different commodity.<br><br>' +
        '<a class="btn btn-go btn-sm" href="post.html">Post one yourself</a></div>';
      return;
    }
    list.innerHTML = v.map(card).join('');
  }

  // reveal a number on request
  list.addEventListener('click', function (e) {
    var ask = e.target.closest ? e.target.closest('[data-show]') : null;
    if (!ask) return;
    var id = ask.getAttribute('data-show');
    SHOWN[id] = true;
    bumpView(id);
    render();
  });

  // your own postings: take one down when the load is gone
  list.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-drop]') : null;
    if (!btn) return;
    var id = btn.getAttribute('data-drop');
    var kept = [];
    try {
      kept = JSON.parse(localStorage.getItem(STORE) || '[]')
        .filter(function (m) { return m.id !== id; });
      localStorage.setItem(STORE, JSON.stringify(kept));
    } catch (err) {}
    LOADS = LOADS.filter(function (l) { return l.id !== id; });
    render();
  });

  // a spent listing of your own, put back up for another five days
  list.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-again]') : null;
    if (!btn) return;
    var id = btn.getAttribute('data-again');
    var now = Date.now();
    try {
      var kept = JSON.parse(localStorage.getItem(STORE) || '[]').map(function (m) {
        if (m.id === id) m.posted = now;
        return m;
      });
      localStorage.setItem(STORE, JSON.stringify(kept));
    } catch (err) {}
    LOADS.forEach(function (l) { if (l.id === id) l.posted = now; });
    render();
  });

  // deep link from the post page: ?mine=1
  if (/[?&]mine=1/.test(location.search)) {
    var banner = document.createElement('div');
    banner.className = 'saved';
    banner.style.margin = '0 16px 6px';
    banner.textContent = 'Your listing is up. It is at the top of the board, marked "Yours".';
    document.querySelector('.wrap').insertBefore(banner, document.querySelector('.cols'));
  }

  syncControls();
  render();
})();
