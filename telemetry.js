/* Flight-path map + multi-line telemetry chart for the video modal.
   Self-contained: injects its own CSS and lazily loads Leaflet + Chart.js. */
(function () {
  'use strict';

  var CDN = {
    leafletCss: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    leafletJs: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    chartJs: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
  };

  var css = document.createElement('style');
  css.textContent = [
    '.modal-box{max-height:94vh;overflow:auto}',
    '#tel-panel{border-top:1px solid #26303c;padding:14px 16px 18px;background:#0e141b}',
    '.tel-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:10px}',
    '.tel-head strong{font-size:14px}',
    '.tel-stats{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#8d9bab}',
    '.tel-stats b{color:#e8edf3;font-weight:600}',
    '.tel-body{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '@media(max-width:900px){.tel-body{grid-template-columns:1fr}}',
    '#tel-map{height:330px;border-radius:9px;overflow:hidden;background:#000;border:1px solid #26303c}',
    '.tel-chart-wrap{position:relative;height:330px;border:1px solid #26303c;border-radius:9px;padding:8px 6px 2px;background:#0b0f14}',
    '.tel-legend{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;color:#8d9bab}',
    '.tel-grad{height:8px;width:160px;border-radius:5px;background:linear-gradient(90deg,#2c7bb6,#abd9e9,#ffffbf,#fdae61,#d7191c)}',
    '.tel-msg{padding:18px;text-align:center;color:#8d9bab;font-size:13px}',
    '.leaflet-container{font:inherit}',
    '.tel-leaflet-tip{background:#0b0f14;color:#e8edf3;border:1px solid #26303c;font-size:11px}'
  ].join('\n');
  document.head.appendChild(css);

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    return new Promise(function (resolve) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href; l.onload = resolve; l.onerror = resolve;
      document.head.appendChild(l);
    });
  }
  var libsReady = null;
  function ensureLibs() {
    if (!libsReady) {
      libsReady = Promise.all([loadCss(CDN.leafletCss), loadScript(CDN.leafletJs)])
        .then(function () { return loadScript(CDN.chartJs); });
    }
    return libsReady;
  }

  function normFile(name) {
    return name.replace(/\.(mp4|mov)$/i, '').replace(/\s*\(\d+\)$/, '').trim().toLowerCase();
  }

  var panel, map, chart, hoverMarker, mapLayers = [], lastKey = '';

  function buildPanel() {
    if (panel) return panel;
    var box = document.querySelector('.modal-box');
    if (!box) return null;
    panel = document.createElement('div');
    panel.id = 'tel-panel';
    panel.innerHTML =
      '<div class="tel-head"><strong>🛰️ Flight path &amp; telemetry</strong>' +
      '<span class="tel-stats" id="tel-stats"></span></div>' +
      '<div class="tel-body">' +
      '  <div id="tel-map"></div>' +
      '  <div class="tel-chart-wrap"><canvas id="tel-chart"></canvas></div>' +
      '</div>' +
      '<div class="tel-legend"><span class="tel-grad"></span>' +
      '<span>route colour: start → end</span></div>' +
      '<div class="tel-msg" id="tel-msg" style="display:none"></div>';
    var player = document.getElementById('player');
    if (player) player.insertAdjacentElement('afterend', panel);
    else box.appendChild(panel);
    return panel;
  }

  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m'; }
  function fmtDur(s) {
    s = Math.round(s); var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  }

  // RdYlBu reversed: blue (start) -> red (end)
  var STOPS = [[44,123,182],[171,217,233],[255,255,191],[253,174,97],[215,25,28]];
  function gradient(t) {
    t = Math.max(0, Math.min(1, t));
    var x = t * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(x)), f = x - i;
    var a = STOPS[i], b = STOPS[i + 1];
    return 'rgb(' + [0,1,2].map(function (k) { return Math.round(a[k] + (b[k] - a[k]) * f); }).join(',') + ')';
  }

  function clearView() {
    if (chart) { chart.destroy(); chart = null; }
    if (map) { map.remove(); map = null; }
    hoverMarker = null; mapLayers = [];
    var stats = document.getElementById('tel-stats');
    if (stats) stats.innerHTML = '';
    var msg = document.getElementById('tel-msg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  }

  function showMsg(text) {
    var msg = document.getElementById('tel-msg');
    if (msg) { msg.textContent = text; msg.style.display = 'block'; }
    var m = document.getElementById('tel-map');
    if (m) m.style.display = 'none';
  }

  function drawMap(data) {
    var el = document.getElementById('tel-map');
    if (!el) return;
    el.style.display = 'block';
    map = L.map(el, { scrollWheelZoom: true, zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    var pts = data.points, latlngs = pts.map(function (p) { return [p[1], p[2]]; });
    L.polyline(latlngs, { color: '#ffffff', weight: 9, opacity: 0.35 }).addTo(map);

    // Split into ~160 equal-count segments and colour each by progress.
    var segs = Math.min(160, Math.max(1, Math.floor(latlngs.length / 2)));
    var per = Math.max(1, Math.ceil((latlngs.length - 1) / segs));
    for (var i = 0; i < latlngs.length - 1; i += per) {
      var chunk = latlngs.slice(i, Math.min(latlngs.length, i + per + 1));
      if (chunk.length < 2) continue;
      L.polyline(chunk, {
        color: gradient(i / (latlngs.length - 1)),
        weight: 6, opacity: 0.95, lineCap: 'round'
      }).addTo(map);
    }

    function dot(latlng, color, label) {
      return L.circleMarker(latlng, {
        radius: 7, color: '#0b0f14', weight: 2, fillColor: color, fillOpacity: 1
      }).addTo(map).bindTooltip(label, { permanent: true, direction: 'top', className: 'tel-leaflet-tip' });
    }
    dot(latlngs[0], '#2c7bb6', 'Start');
    dot(latlngs[latlngs.length - 1], '#d7191c', 'End');

    hoverMarker = L.circleMarker(latlngs[0], {
      radius: 6, color: '#fff', weight: 2, fillColor: '#ffd166', fillOpacity: 1
    }).addTo(map);
    hoverMarker.setStyle({ opacity: 0, fillOpacity: 0 });

    map.fitBounds(L.latLngBounds(latlngs), { padding: [26, 26] });
    mapLayers = [map];
  }

  function drawChart(data) {
    var canvas = document.getElementById('tel-chart');
    if (!canvas || !window.Chart) return;
    var pts = data.points;
    var labels = pts.map(function (p) { return p[0]; });
    var rel = pts.map(function (p) { return p[3]; });
    var abs = pts.map(function (p) { return p[4]; });
    var spd = pts.map(function (p) { return p[5]; });
    var vs = pts.map(function (p) { return p[6]; });

    chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Relative altitude (m)', data: rel, borderColor: '#4cc2ff', backgroundColor: '#4cc2ff22', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true },
          { label: 'Absolute altitude (m)', data: abs, borderColor: '#7ee787', backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.25, hidden: true },
          { label: 'Speed (km/h)', data: spd, borderColor: '#ffb454', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.25, yAxisID: 'y1' },
          { label: 'Vertical speed (m/s)', data: vs, borderColor: '#d2a8ff', backgroundColor: 'transparent', borderWidth: 1, borderDash: [4, 3], pointRadius: 0, tension: 0.25, hidden: true }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#c7d2de', boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: function (items) { return 't = ' + Number(items[0].label).toFixed(1) + ' s'; }
            }
          }
        },
        scales: {
          x: { type: 'linear', title: { display: true, text: 'Time (s)', color: '#8d9bab' }, ticks: { color: '#8d9bab', maxTicksLimit: 8 }, grid: { color: '#1c2632' } },
          y: { title: { display: true, text: 'Altitude (m)', color: '#8d9bab' }, ticks: { color: '#8d9bab' }, grid: { color: '#1c2632' } },
          y1: { position: 'right', title: { display: true, text: 'Speed (km/h)', color: '#8d9bab' }, ticks: { color: '#8d9bab' }, grid: { drawOnChartArea: false } }
        },
        onHover: function (evt, els) {
          if (!hoverMarker || !els || !els.length) return;
          var p = pts[els[0].index];
          if (!p) return;
          hoverMarker.setLatLng([p[1], p[2]]);
          hoverMarker.setStyle({ opacity: 1, fillOpacity: 1 });
          hoverMarker.bindTooltip('t=' + p[0].toFixed(1) + 's · ' + p[3].toFixed(1) + ' m · ' + p[5].toFixed(1) + ' km/h',
            { className: 'tel-leaflet-tip' }).openTooltip();
        }
      }
    });
  }

  function render(data) {
    clearView();
    buildPanel();
    var stats = document.getElementById('tel-stats');
    if (stats) {
      stats.innerHTML =
        '<span><b>' + fmtDur(data.duration) + '</b> duration</span>' +
        '<span><b>' + fmtDist(data.distance) + '</b> route</span>' +
        '<span><b>' + data.max_alt + ' m</b> max alt</span>' +
        '<span><b>' + data.max_speed + ' km/h</b> max speed</span>' +
        '<span><b>' + data.points.length + '</b> samples</span>' +
        '<span><a href="https://huggingface.co/datasets/shalevlau/djidrone/resolve/main/dji%20srt/' +
        encodeURIComponent(data.file.replace(/\.MP4$/i, '.SRT')) + '" target="_blank" rel="noopener">SRT ↗</a></span>';
    }
    drawMap(data);
    drawChart(data);
  }

  function showFor(name) {
    var key = normFile(name || '');
    if (!key || key === lastKey) return;
    lastKey = key;
    var modal = document.getElementById('modal');
    if (!modal || modal.classList.contains('hidden')) return;
    buildPanel();
    clearView();

    fetch('./telemetry/' + encodeURIComponent(key) + '.json', { cache: 'force-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 404 ? 'no telemetry' : 'HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        ensureLibs().then(function () { render(data); }).catch(function (e) {
          showMsg('Could not load map libraries: ' + e);
        });
      })
      .catch(function () {
        showMsg('No GPS telemetry found for this clip.');
      });
  }

  function currentTitle() {
    var t = document.getElementById('modal-title');
    return t ? t.textContent.trim() : '';
  }

  document.addEventListener('click', function (e) {
    var card = e.target.closest && e.target.closest('.card');
    if (!card) return;
    var t = card.querySelector('.card-title');
    var name = (t && t.textContent.trim()) || card.getAttribute('data-file') || '';
    if (name) setTimeout(function () { showFor(name); }, 90);
  }, true);

  // Fallback: react whenever the modal title changes (covers keyboard/UI paths).
  function watchTitle() {
    var t = document.getElementById('modal-title');
    if (!t) { setTimeout(watchTitle, 500); return; }
    new MutationObserver(function () {
      var modal = document.getElementById('modal');
      if (modal && !modal.classList.contains('hidden')) {
        lastKey = '';
        showFor(currentTitle());
      }
    }).observe(t, { childList: true, characterData: true, subtree: true });
  }
  watchTitle();
})();
