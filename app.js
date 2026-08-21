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

  var counties = window.OHIO.counties;
  var byName = {};
  var regions = [];
  counties.forEach(function (c) {
    byName[c.n] = c;
    if (regions.indexOf(c.r) === -1) regions.push(c.r);
  });
  regions.sort();

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
    return out;
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
    var s = '<svg viewBox="0 0 ' + window.OHIO.w + ' ' + window.OHIO.h +
            '" role="img" aria-label="Map of Ohio counties">';
    counties.forEach(function (c) {
      s += '<path class="cty" data-n="' + esc(c.n) + '" d="' + c.d + '"><title>' +
           esc(c.n) + ' County</title></path>';
    });
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

  function paintMap(list) {
    var counts = {};
    list.forEach(function (l) { counts[l.county] = (counts[l.county] || 0) + 1; });
    var max = 0;
    for (var k in counts) if (counts[k] > max) max = counts[k];

    var paths = mapHolder.querySelectorAll('.cty');
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i], n = p.getAttribute('data-n'), c = counts[n] || 0;
      var cls = '';
      if (c > 0 && max > 0) {
        var f = c / max;
        cls = f > 0.75 ? ' l4' : f > 0.5 ? ' l3' : f > 0.25 ? ' l2' : ' l1';
      }
      if (state.region !== 'all' && byName[n].r !== state.region) cls = ' dim';
      if (state.county === n) cls += ' sel';
      p.setAttribute('class', 'cty' + cls);
    }
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
    regions.map(function (r) { return '<option value="' + r + '">' + r + ' Ohio</option>'; }).join('');
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

  // ---------- listings ----------

  var list = document.getElementById('list');
  var listTitle = document.getElementById('listTitle');
  var listCount = document.getElementById('listCount');

  function card(l) {
    var cls = 'load t-' + l.type + (l.mine ? ' mine' : '');
    var where = esc(l.town ? l.town + ', ' + l.county + ' County' : l.county + ' County');
    var dist = l._d != null ? '<span class="dot">&middot;</span>' + l._d + ' miles away' : '';
    var pill = l.mine
      ? '<span class="pill mine">Yours</span>'
      : '<span class="pill t-' + l.type + '">' + TYPE_WORD[l.type] + '</span>';

    return '<div class="' + cls + '">' +
      '<div class="load-top"><h3>' + esc(l.commodity) + '</h3>' + pill + '</div>' +
      '<div class="meta"><b>' + esc(l.qty) + '</b><span class="dot">&middot;</span>' +
        where + dist + '</div>' +
      (l.desc ? '<div class="desc">' + esc(l.desc) + '</div>' : '') +
      '<div class="load-foot">' +
        '<span class="who">' + esc(l.who) + '<span class="dot">&middot;</span>' +
          'posted ' + daysAgo(l.posted) + '</span>' +
        '<span><span class="price">' + esc(l.price) + '</span>' +
        (l.phone ? ' <a class="btn btn-go btn-sm" href="' + telHref(l.phone) + '">Call ' +
          esc(l.phone) + '</a>' : '') + '</span>' +
      '</div></div>';
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
    else if (state.region !== 'all') where = ' in ' + state.region + ' Ohio';

    if (!head) head = where ? 'Everything' : 'Everything on the board';
    return head + where;
  }

  function render() {
    var v = visible();
    paintMap(v);
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
