/* DJI Drone Archive — static gallery + draggable 3D panorama viewer */
(function () {
  'use strict';

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

  /* ---------- video gallery ---------- */
  var videos = [];
  function fmtBytes(n) {
    return n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(0) + ' MB';
  }
  function fmtTime(s) {
    if (!s) return '—';
    var m = Math.floor(s / 60), r = Math.round(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  }
  function renderVideos(q) {
    q = (q || '').trim().toLowerCase();
    var grid = document.getElementById('grid');
    var shown = videos.filter(function (v) { return !q || (v.file + ' ' + v.date).toLowerCase().indexOf(q) >= 0; });
    grid.innerHTML = shown.map(function (v, i) {
      return '<article class="card" data-i="' + videos.indexOf(v) + '">' +
        '<img loading="lazy" src="' + v.thumb + '" alt="" onerror="this.style.opacity=0">' +
        '<div class="card-body"><div class="card-title" title="' + v.file + '">' + v.file + '</div>' +
        '<div class="card-meta"><span>' + v.date.slice(0, 4) + '-' + v.date.slice(4, 6) + '-' + v.date.slice(6, 8) +
        '</span><span>' + fmtTime(v.duration) + ' · ' + fmtBytes(v.bytes) + '</span></div></div></article>';
    }).join('');
    document.getElementById('count').textContent = shown.length + ' / ' + videos.length + ' clips';
    document.getElementById('empty').classList.toggle('hidden', shown.length > 0);
    grid.querySelectorAll('.card').forEach(function (c) {
      c.addEventListener('click', function () { openVideo(videos[+c.dataset.i]); });
    });
  }
  fetch('./manifest.json').then(function (r) { return r.json(); }).then(function (d) {
    videos = d.videos;
    var total = videos.reduce(function (a, v) { return a + v.bytes; }, 0);
    var days = new Set(videos.map(function (v) { return v.date; })).size;
    document.getElementById('stats').innerHTML =
      '<div class="stat"><b>' + videos.length + '</b><span>videos</span></div>' +
      '<div class="stat"><b>' + fmtBytes(total) + '</b><span>footage</span></div>' +
      '<div class="stat"><b>' + days + '</b><span>flight days</span></div>';
    renderVideos('');
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
    document.getElementById('modal-title').textContent = v.file;
    document.getElementById('modal-meta').textContent =
      fmtTime(v.duration) + ' · ' + fmtBytes(v.bytes) + ' · ' + v.date.slice(0, 4) + '-' + v.date.slice(4, 6) + '-' + v.date.slice(6, 8);
    document.getElementById('modal-download').href = v.url;
    player.src = v.url;
    player.load();
    document.getElementById('modal').classList.remove('hidden');
  }
  document.querySelectorAll('[data-close]').forEach(function (el) {
    el.addEventListener('click', function () {
      player.pause();
      player.removeAttribute('src');
      player.load();
      document.getElementById('modal').classList.add('hidden');
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !document.getElementById('modal').classList.contains('hidden')) {
      player.pause(); player.removeAttribute('src'); player.load();
      document.getElementById('modal').classList.add('hidden');
    }
  });

  /* ---------- panorama viewer ---------- */
  var panoReady = false, panoData = [], current = null;
  var renderer, scene, camera, mesh, texture, frameGroup;
  var yaw = 0, pitch = 0, wantYaw = 0, wantPitch = 0;
  var limitYaw = null, limitPitch = 1.2;
  var dragging = false, lastX = 0, lastY = 0;

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
      if (!document.getElementById('pano').classList.contains('active')) return;
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

    (function animate() {
      requestAnimationFrame(animate);
      if (limitYaw !== null) wantYaw = Math.max(-limitYaw, Math.min(limitYaw, wantYaw));
      wantPitch = Math.max(-limitPitch, Math.min(limitPitch, wantPitch));
      yaw += (wantYaw - yaw) * 0.18;
      pitch += (wantPitch - pitch) * 0.18;
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      if (renderer && scene) renderer.render(scene, camera);
    })();

    fetch('./pano/manifest.json').then(function (r) { return r.json(); }).then(function (d) {
      panoData = d;
      var tabs = document.getElementById('pano-tabs');
      tabs.innerHTML = d.map(function (s, i) {
        var mode = s.mode === 'sphere' ? '360° sphere' : (s.mode === 'frames' ? 'frames 3D' : 'wide pano');
        return '<button class="pano-tab' + (i === 0 ? ' active' : '') + '" data-i="' + i + '">' +
          s.id + ' · ' + s.count + ' shots · ' + mode + '</button>';
      }).join('');
      tabs.querySelectorAll('.pano-tab').forEach(function (b) {
        b.addEventListener('click', function () {
          tabs.querySelectorAll('.pano-tab').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          loadPano(panoData[+b.dataset.i]);
        });
      });
      if (d.length) loadPano(d[0]);
    }).catch(function (e) {
      document.getElementById('loading').textContent = 'Could not load panorama index: ' + e;
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
      frameGroup.children.forEach(function (m) { m.geometry.dispose(); m.material.map && m.material.map.dispose(); m.material.dispose(); });
      scene.remove(frameGroup); frameGroup = null;
    }
  }

  /* Partial capture: show the source frames as a draggable 3D ring instead of a
     broken stitched sphere (these sets were not shot as a full 360 sphere). */
  function loadFrames(set) {
    clearScene();
    frameGroup = new THREE.Group();
    var R = 450, n = set.frames.length, step = Math.PI * 2 / n;
    var w = 2 * R * Math.tan(step / 2) * 1.04, h = w / ((set.size && set.size[0] / set.size[1]) || 1.333);
    var loader = new THREE.TextureLoader();
    set.frames.forEach(function (url, i) {
      var geo = new THREE.PlaneGeometry(w, h);
      var mat = new THREE.MeshBasicMaterial({ color: 0x555555, side: THREE.DoubleSide });
      var plane = new THREE.Mesh(geo, mat);
      var a = i * step;
      plane.position.set(R * Math.sin(a), 0, -R * Math.cos(a));
      plane.rotation.y = -a;
      frameGroup.add(plane);
      loader.load(url, function (tex) {
        if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
        if (i === 0) document.getElementById('loading').classList.add('hidden');
      });
    });
    scene.add(frameGroup);
    limitYaw = null; limitPitch = 0.65;
    wantYaw = yaw = 0; wantPitch = pitch = 0;
    camera.fov = 75; camera.updateProjectionMatrix();
    document.getElementById('pano-label').textContent =
      set.id.replace('_', ' / ') + ' — partial capture: ' + n + ' source frames in a draggable 3D ring';
    document.getElementById('pano-source').innerHTML =
      'These ' + n + ' frames were not captured as a full 360° sphere (DJI sphere sets normally have 25 shots), ' +
      'so they are shown individually in 3D. Originals: <a href="' + set.hfFolder + '" target="_blank" rel="noopener">PANORAMA/' + set.id + '/</a>';
  }

  function loadPano(set) {
    if (!set || !renderer) return;
    current = set;
    document.getElementById('loading').classList.remove('hidden');
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
      geo = new THREE.CylinderGeometry(R, R, height, 96, 1, true, -hfov / 2, hfov);
      geo.scale(-1, 1, 1);
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
      (set.source && set.source.indexOf('dji srt') === 0 ? 'DJI auto-stitched JPEG: ' + set.source : 'Stitched from the source photos for this site');
  }
})();
