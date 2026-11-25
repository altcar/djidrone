/* DJI Drone Archive — static gallery, draggable 3D panoramas, puzzle editor */
(function () {
  'use strict';

  var HF = 'https://huggingface.co/datasets/shalevlau/djidrone';
  var HF_BASE = HF + '/resolve/main/';
  var BRIDGE = 'http://localhost:8877';

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab[data-tab]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      document.getElementById(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'pano') initPano();
    });
  });

  /* ---------- helpers ---------- */
  function fmtBytes(n) {
    if (!n) return '—';
    return n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(0) + ' MB';
  }
  function fmtTime(s) {
    if (!s) return '—';
    var m = Math.floor(s / 60), r = Math.round(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  }

  /* ---------- video gallery ---------- */
  var videos = [], currentQuery = '';
  function updateStats() {
    var days = new Set(videos.map(function (v) { return v.date; }).filter(Boolean)).size;
    var total = videos.reduce(function (a, v) { return a + v.bytes; }, 0);
    document.getElementById('stats').innerHTML =
      '<div class="stat"><b>' + videos.length + '</b><span>videos</span></div>' +
      '<div class="stat"><b>' + fmtBytes(total) + '</b><span>footage</span></div>' +
      '<div class="stat"><b>' + days + '</b><span>flight days</span></div>' +
      '<div class="stat"><b id="live-indicator" title="Local bridge status">○</b><span>live sync</span></div>';
  }
  function renderVideos(q) {
    currentQuery = q || '';
    var grid = document.getElementById('grid');
    var shown = videos.filter(function (v) {
      return !currentQuery || (v.file + ' ' + v.date).toLowerCase().indexOf(currentQuery.toLowerCase()) >= 0;
    });
    grid.innerHTML = shown.map(function (v) {
      return '<article class="card" data-file="' + v.file.replace(/"/g, '&quot;') + '">' +
        '<img loading="lazy" src="' + v.thumb + '" alt="" onerror="this.src=\'thumbs/placeholder.svg\'">' +
        '<div class="card-body"><div class="card-title" title="' + v.file + '">' + v.file + '</div>' +
        '<div class="card-meta"><span>' + (v.date ? v.date.slice(0, 4) + '-' + v.date.slice(4, 6) + '-' + v.date.slice(6, 8) : 'new') +
        '</span><span>' + fmtTime(v.duration) + ' · ' + fmtBytes(v.bytes) + '</span></div></div></article>';
    }).join('');
    document.getElementById('count').textContent = shown.length + ' / ' + videos.length + ' clips';
    document.getElementById('empty').classList.toggle('hidden', shown.length > 0);
    grid.querySelectorAll('.card').forEach(function (c) {
      c.addEventListener('click', function () {
        var f = c.dataset.file;
        openVideo(videos.filter(function (v) { return v.file === f; })[0]);
      });
    });
  }
  fetch('./manifest.json').then(function (r) { return r.json(); }).then(function (d) {
    videos = d.videos;
    updateStats();
    renderVideos('');
    refreshFromHF();
  }).catch(function (e) { console.error(e); });
  var searchTimer;
  document.getElementById('search').addEventListener('input', function (e) {
    clearTimeout(searchTimer);
    var q = e.target.value;
    searchTimer = setTimeout(function () { renderVideos(q); }, 120);
  });

  /* ---------- video modal ---------- */
  var player = document.getElementById('player');
  function openVideo(v) {
    if (!v) return;
    document.getElementById('modal-title').textContent = v.file;
    document.getElementById('modal-meta').textContent =
      fmtTime(v.duration) + ' · ' + fmtBytes(v.bytes) + ' · ' + (v.date || 'new');
    document.getElementById('modal-download').href = v.url;
    player.src = v.url;
    player.load();
    document.getElementById('modal').classList.remove('hidden');
  }
  function closeVideo() {
    player.pause(); player.removeAttribute('src'); player.load();
    document.getElementById('modal').classList.add('hidden');
  }
  document.querySelectorAll('[data-close]').forEach(function (el) {
    el.addEventListener('click', closeVideo);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !document.getElementById('modal').classList.contains('hidden')) closeVideo();
  });

  /* ---------- panorama state ---------- */
  var panoReady = false, panoData = [], current = null;
  var renderer, scene, camera, mesh, texture, frameGroup;
  var yaw = 0, pitch = 0, wantYaw = 0, wantPitch = 0;
  var limitYaw = null, limitPitch = 1.2;
  var dragging = false, lastX = 0, lastY = 0;
  var arrangements = {}, frameIndex = {}, puzzleOrder = [], puzzleCols = 5, puzzleOpen = false;

  function loadArrangements() {
    try { var a = JSON.parse(localStorage.getItem('djidrone-arrangements') || '{}'); Object.assign(arrangements, a); } catch (e) {}
    return fetch(BRIDGE + '/api/order', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .catch(function () {
        return fetch('./config.json').then(function (r) { return r.json(); }).then(function (c) {
          return fetch(c.gistRaw + '?t=' + Date.now()).then(function (r) {
            if (!r.ok) throw 0;
            document.getElementById('live-indicator') && (document.getElementById('live-indicator').textContent = '●');
            return r.json();
          });
        });
      })
      .then(function (d) { if (d) { arrangements = d; localStorage.setItem('djidrone-arrangements', JSON.stringify(d)); } })
      .catch(function () {});
  }

  function initPano() {
    if (panoReady) return;
    panoReady = true;
    var canvas = document.getElementById('pano-canvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, 1, 1, 3000);
    resize();
    window.addEventListener('resize', resize);

    canvas.addEventListener('pointerdown', function (e) {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.classList.add('dragging'); canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var k = 0.0022 * (camera.fov / 75);
      wantYaw -= (e.clientX - lastX) * k;
      wantPitch -= (e.clientY - lastY) * k;
      lastX = e.clientX; lastY = e.clientY;
    });
    function endDrag() { dragging = false; canvas.classList.remove('dragging'); }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      camera.fov = Math.max(32, Math.min(95, camera.fov + Math.sign(e.deltaY) * 4));
      camera.updateProjectionMatrix();
    }, { passive: false });
    document.addEventListener('keydown', function (e) {
      if (!document.getElementById('pano').classList.contains('active') || puzzleOpen) return;
      var s = 0.12;
      if (e.key === 'ArrowLeft') wantYaw += s;
      else if (e.key === 'ArrowRight') wantYaw -= s;
      else if (e.key === 'ArrowUp') wantPitch += s;
      else if (e.key === 'ArrowDown') wantPitch -= s;
      else return;
      e.preventDefault();
    });
    document.getElementById('reset-view').addEventListener('click', function () {
      wantYaw = 0; wantPitch = 0; camera.fov = 75; camera.updateProjectionMatrix();
    });
    document.getElementById('fullscreen').addEventListener('click', function () {
      var v = document.getElementById('viewer');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (v.requestFullscreen) v.requestFullscreen();
    });
    document.getElementById('puzzle-toggle').addEventListener('click', togglePuzzle);
    document.getElementById('puzzle-reset').addEventListener('click', resetPuzzle);
    document.getElementById('puzzle-apply').addEventListener('click', applyPuzzle);
    document.getElementById('puzzle-save').addEventListener('click', saveArrangements);
    document.getElementById('puzzle-cols').addEventListener('change', function (e) {
      puzzleCols = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 5));
      e.target.value = puzzleCols;
      renderPuzzle();
    });

    (function animate() {
      requestAnimationFrame(animate);
      if (limitYaw !== null) wantYaw = Math.max(-limitYaw, Math.min(limitYaw, wantYaw));
      wantPitch = Math.max(-limitPitch, Math.min(limitPitch, wantPitch));
      yaw += (wantYaw - yaw) * 0.18;
      pitch += (wantPitch - pitch) * 0.18;
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      if (renderer && scene) renderer.render(scene, camera);
    })();

    Promise.all([
      fetch('./pano/manifest.json').then(function (r) { return r.json(); }),
      fetch('./pano/frames/index.json').then(function (r) { return r.json(); }).catch(function () { return {}; }),
      loadArrangements()
    ]).then(function (r) {
      panoData = r[0]; frameIndex = r[1];
      panoData.forEach(function (s) { if (frameIndex[s.id]) s.frames = frameIndex[s.id]; });
      renderPanoTabs();
      if (panoData.length) loadPano(panoData[0]);
      refreshPanosFromHF();
    }).catch(function (e) {
      document.getElementById('loading').textContent = 'Could not load panorama index: ' + e;
    });
  }

  function renderPanoTabs() {
    var tabs = document.getElementById('pano-tabs');
    tabs.innerHTML = panoData.map(function (s, i) {
      var mode = s.mode === 'sphere' ? '360° sphere' : (s.mode === 'flat' ? 'wide pano' : 'frames 3D');
      return '<button class="pano-tab' + (current && current.id === s.id ? ' active' : (i === 0 ? ' active' : '')) + '" data-i="' + i + '">' +
        s.id + ' · ' + s.count + ' shots · ' + mode + '</button>';
    }).join('');
    tabs.querySelectorAll('.pano-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.querySelectorAll('.pano-tab').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        loadPano(panoData[+b.dataset.i]);
      });
    });
  }

  function resize() {
    if (!renderer) return;
    var el = document.getElementById('viewer');
    var w = el.clientWidth || 800, h = el.clientHeight || 500;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function clearScene() {
    if (texture) { texture.dispose(); texture = null; }
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
    if (frameGroup) {
      frameGroup.children.forEach(function (m) {
        m.geometry.dispose();
        if (m.material.map) m.material.map.dispose();
        m.material.dispose();
      });
      scene.remove(frameGroup); frameGroup = null;
    }
  }

  function arrangementFor(id, n) {
    var a = arrangements[id] || {};
    var cols = Math.max(1, Math.min(10, a.cols || (n >= 17 ? 5 : (n <= 9 ? 3 : 4))));
    var order = a.order;
    var ok = Array.isArray(order) && order.length === n &&
      Array.from({ length: n }, function (_, i) { return i; }).every(function (i) { return order.indexOf(i) >= 0; });
    if (!ok) order = Array.from({ length: n }, function (_, i) { return i; });
    return { cols: cols, order: order.slice(), rows: Math.ceil(n / cols) };
  }

  /* Frames are laid out as a 2D wall wrapped around a cylinder segment; the
     arrangement (column count + tile order) comes from the puzzle/gist. */
  function loadFrames(set) {
    clearScene();
    frameGroup = new THREE.Group();
    var n = set.frames.length, a = arrangementFor(set.id, n);
    var R = 500, colStep = 0.34, rowStep = 1.15;
    var w = 2 * R * Math.tan(colStep / 2) * 1.02;
    var h = w / ((set.size && set.size[0] / set.size[1]) || 1.333);
    var loader = new THREE.TextureLoader();
    for (var i = 0; i < n; i++) {
      var idx = a.order[i], col = i % a.cols, row = Math.floor(i / a.cols);
      var ang = (col - (a.cols - 1) / 2) * colStep;
      var y = ((a.rows - 1) / 2 - row) * h * rowStep;
      var mat = new THREE.MeshBasicMaterial({ color: 0x555555, side: THREE.DoubleSide });
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      plane.position.set(R * Math.sin(ang), y, -R * Math.cos(ang));
      plane.rotation.y = -ang;
      frameGroup.add(plane);
      loader.load(set.frames[idx], function (t) {
        if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true;
        if (i === 0) document.getElementById('loading').classList.add('hidden');
      });
    }
    scene.add(frameGroup);
    limitYaw = (a.cols - 1) / 2 * colStep + 0.3;
    limitPitch = Math.abs(((a.rows - 1) / 2) * h * rowStep) / R + 0.2;
    wantYaw = yaw = 0; wantPitch = pitch = 0;
    camera.fov = 75; camera.updateProjectionMatrix();
    document.getElementById('pano-label').textContent =
      set.id.replace('_', ' / ') + ' — ' + a.cols + '×' + a.rows + ' draggable frame wall (' + n + ' shots)';
    document.getElementById('pano-source').innerHTML =
      'Arrangement saved in <a href="https://gist.github.com/altcar/02bb92e7fe0043b587ee0be1f10afae4" target="_blank" rel="noopener">this gist</a> · originals: <a href="' + set.hfFolder + '" target="_blank" rel="noopener">PANORAMA/' + set.id + '/</a>';
    if (puzzleOpen) renderPuzzle();
  }

  function loadPano(set) {
    if (!set || !renderer) return;
    current = set;
    document.getElementById('loading').classList.remove('hidden');
    if (!set.frames || !set.frames.length) {
      // Fallback if only a single stitched file is known.
      set.frames = [set.file];
    }
    if (set.mode === 'frames') { loadFrames(set); return; }
    clearScene();

    var loader = new THREE.TextureLoader();
    texture = loader.load(set.file, function () {
      document.getElementById('loading').classList.add('hidden');
    }, undefined, function (e) {
      document.getElementById('loading').textContent = 'Failed to load ' + set.file;
      console.error(e);
    });
    if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    var R = 500, geo;
    if (set.mode === 'sphere') {
      geo = new THREE.SphereGeometry(R, 72, 48);
      geo.scale(-1, 1, 1);
      limitYaw = null; limitPitch = 1.25;
    } else {
      var aspect = (set.size && set.size[0] / set.size[1]) || 1.4;
      var hfov = THREE.MathUtils.degToRad(125);
      var vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
      var height = 2 * R * Math.tan(vfov / 2);
      // Camera looks down -Z, so centre the cylinder arc on -Z (theta = PI).
      geo = new THREE.CylinderGeometry(R, R, height, 96, 1, true, Math.PI - hfov / 2, hfov);
      geo.scale(-1, 1, 1);
      // The x-flip mirrors UVs; flip them back so the scene is not reversed.
      texture.wrapS = THREE.RepeatWrapping;
      texture.repeat.x = -1;
      texture.offset.x = 1;
      limitYaw = hfov / 2 - 0.04;
      limitPitch = vfov / 2 - 0.04;
    }
    mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture }));
    scene.add(mesh);
    wantYaw = yaw = 0; wantPitch = pitch = 0;
    camera.fov = 75; camera.updateProjectionMatrix();
    document.getElementById('pano-label').textContent =
      set.id.replace('_', ' / ') + ' — ' + (set.mode === 'sphere' ? '360° interactive sphere' : 'wide interactive panorama') + ' (' + set.count + ' source shots)';
    document.getElementById('pano-source').innerHTML =
      'Source shots: <a href="' + set.hfFolder + '" target="_blank" rel="noopener">PANORAMA/' + set.id + '/</a> on Hugging Face · ' +
      (set.source && set.source.indexOf('dji srt') === 0 ? 'DJI auto-stitched JPEG: ' + set.source : 'stitched from the source photos');
    if (puzzleOpen) renderPuzzle();
  }

  /* ---------- puzzle editor ---------- */
  function togglePuzzle() {
    if (!current) return;
    puzzleOpen = !puzzleOpen;
    document.getElementById('puzzle').classList.toggle('hidden', !puzzleOpen);
    document.getElementById('puzzle-toggle').textContent = puzzleOpen ? '✕ Close puzzle' : '🧩 Puzzle: reorder frames';
    if (puzzleOpen) {
      var n = current.frames ? current.frames.length : 0;
      if (!n) { document.getElementById('puzzle-status').textContent = 'This set has no individual frames yet.'; return; }
      var a = arrangementFor(current.id, n);
      puzzleOrder = a.order.slice(); puzzleCols = a.cols;
      document.getElementById('puzzle-cols').value = puzzleCols;
      renderPuzzle();
    }
  }
  function renderPuzzle() {
    if (!current || !current.frames) return;
    var grid = document.getElementById('puzzle-grid');
    grid.style.setProperty('--cols', puzzleCols);
    grid.innerHTML = puzzleOrder.map(function (idx, pos) {
      return '<div class="tile" draggable="true" data-pos="' + pos + '">' +
        '<img src="' + current.frames[idx] + '" alt="frame ' + (idx + 1) + '">' +
        '<span>' + (idx + 1) + '</span></div>';
    }).join('');
    var dragged = null;
    grid.querySelectorAll('.tile').forEach(function (tile) {
      tile.addEventListener('dragstart', function () { dragged = +tile.dataset.pos; tile.classList.add('dragging'); });
      tile.addEventListener('dragend', function () { tile.classList.remove('dragging'); });
      tile.addEventListener('dragover', function (e) { e.preventDefault(); tile.classList.add('over'); });
      tile.addEventListener('dragleave', function () { tile.classList.remove('over'); });
      tile.addEventListener('drop', function (e) {
        e.preventDefault(); tile.classList.remove('over');
        var to = +tile.dataset.pos;
        if (dragged === null || dragged === to) return;
        var tmp = puzzleOrder[dragged]; puzzleOrder[dragged] = puzzleOrder[to]; puzzleOrder[to] = tmp;
        dragged = null; renderPuzzle();
      });
    });
  }
  function resetPuzzle() {
    if (!current) return;
    var n = current.frames.length;
    puzzleOrder = Array.from({ length: n }, function (_, i) { return i; });
    puzzleCols = n >= 17 ? 5 : (n <= 9 ? 3 : 4);
    document.getElementById('puzzle-cols').value = puzzleCols;
    renderPuzzle();
  }
  function applyPuzzle() {
    if (!current) return;
    arrangements[current.id] = {
      cols: puzzleCols,
      rows: Math.ceil(puzzleOrder.length / puzzleCols),
      order: puzzleOrder.slice()
    };
    localStorage.setItem('djidrone-arrangements', JSON.stringify(arrangements));
    document.getElementById('puzzle-status').textContent = 'Applied locally. Click “Save to gist” to share it.';
    loadPano(current);
  }
  function saveArrangements() {
    var status = document.getElementById('puzzle-status');
    var body = JSON.stringify(arrangements, null, 2);
    fetch(BRIDGE + '/api/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body
    }).then(function (r) { return r.json(); }).then(function (d) {
      status.textContent = d.ok ? 'Saved to gist ✓ (gist status ' + d.gistStatus + ')' : 'Save failed: ' + (d.error || 'unknown');
    }).catch(function (e) {
      status.innerHTML = 'Local bridge is not running. Arrangement kept in this browser. ' +
        '<a href="data:application/json;base64,' + btoa(unescape(encodeURIComponent(body))) + '" download="pano-arrangements.json">Download JSON</a>';
    });
  }

  /* ---------- dynamic discovery from HF (new videos / panoramas) ---------- */
  function refreshFromHF() {
    fetch(BRIDGE + '/api/hf?path=uploaded&recursive=true', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (items) {
        var known = new Set(videos.map(function (v) { return v.file; }));
        var added = 0;
        items.filter(function (x) { return x.type === 'file' && /\.(mp4|mov|webm)$/i.test(x.path); })
          .forEach(function (x) {
            var name = x.path.split('/').pop();
            if (known.has(name)) return;
            var m = name.match(/(\d{8})/);
            videos.push({
              file: name, title: name, date: m ? m[1] : '', url: HF_BASE + x.path,
              thumb: 'thumbs/placeholder.svg', bytes: x.size || 0, duration: 0
            });
            added++;
          });
        if (added) {
          var li = document.getElementById('live-indicator'); if (li) li.textContent = '●';
          renderVideos(currentQuery); updateStats();
        }
      }).catch(function () {});
  }
  function refreshPanosFromHF() {
    fetch(BRIDGE + '/api/hf?path=PANORAMA&recursive=true', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (items) {
        var folders = {};
        items.filter(function (x) { return x.type === 'file' && /\.(jpe?g|png)$/i.test(x.path); })
          .forEach(function (x) {
            var parts = x.path.split('/');
            if (parts.length < 3) return;
            (folders[parts[1]] = folders[parts[1]] || []).push(HF_BASE + x.path);
          });
        var added = 0;
        Object.keys(folders).forEach(function (id) {
          if (panoData.some(function (s) { return s.id === id; })) return;
          var files = folders[id].sort();
          panoData.push({
            id: id, mode: 'frames', count: files.length, frames: files, file: null,
            sourceFolder: 'PANORAMA/' + id + '/',
            hfFolder: HF + '/tree/main/PANORAMA/' + id, size: [1000, 750]
          });
          added++;
        });
        if (added) { renderPanoTabs(); }
      }).catch(function () {});
  }
})();
