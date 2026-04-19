// ═══════════════════════════════════════════════════════════════
//  hud.js  —  HUD rendering & minimap
// ═══════════════════════════════════════════════════════════════

const HUD = (() => {

  let minimapCtx  = null;
  let trackCurve  = null;
  let trackLength = 1;

  const TOTAL_LAPS = 5;

  // Lap notification timers
  const lapNotifTimers = { p1: null, p2: null };
  let systemMsgTimer = null;

  function init(curve) {
    trackCurve  = curve;
    trackLength = curve ? curve.getLength() : 1500;
    const canvas = document.getElementById('minimap-canvas');
    if (canvas) minimapCtx = canvas.getContext('2d');
  }

  // ── FORMAT TIME ───────────────────────────────────────────────
  function _fmt(ms) {
    if (!ms || ms === Infinity) return '--:--.---';
    const m  = Math.floor(ms / 60000);
    const s  = Math.floor((ms % 60000) / 1000);
    const ms2 = ms % 1000;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(Math.floor(ms2)).padStart(3,'0')}`;
  }

  // ── UPDATE (call every frame) ─────────────────────────────────
  function update(b1, b2, now) {
    _updatePlayer('p1', b1, now);
    _updatePlayer('p2', b2, now);
    _updateMinimap(b1, b2);
    _updateRaceProgress(b1, b2);
  }

  function _updatePlayer(id, bike, now) {
    // Speed
    const speedKmh = Math.round(bike.speed * 3.6);
    _set(`${id}-speed`, speedKmh);

    // Speed colour
    const speedEl = document.getElementById(`${id}-speed`);
    if (speedEl) {
      speedEl.style.color = speedKmh > 250 ? '#FF4444'
        : speedKmh > 180 ? '#FFD700'
        : id === 'p1' ? 'var(--p1-color)' : 'var(--p2-color)';
    }

    // Gear
    _set(`${id}-gear`, bike.gear);

    // RPM bar
    const rpmEl = document.getElementById(`${id}-rpm`);
    if (rpmEl) {
      rpmEl.style.width = (bike.rpm * 100).toFixed(1) + '%';
      // Flash red near redline
      rpmEl.style.filter = bike.rpm > 0.88
        ? 'brightness(1.6) saturate(2)'
        : 'none';
    }

    // Lap
    const lapDisplay = Math.min(bike.lap, TOTAL_LAPS);
    _set(`${id}-lap`, `LAP ${lapDisplay} / ${TOTAL_LAPS}`);

    // Time
    const elapsed = bike.passedStart ? now - bike.lapStartTime : 0;
    _set(`${id}-time`, _fmt(elapsed));

    // Best lap
    _set(`${id}-best`, `BEST: ${_fmt(bike.bestLap)}`);

    // Position (calculated in _updateRaceProgress)


    // Tilt cursor
    const tilt   = Feedback.getTilt(id);
    const cursor = document.getElementById(`${id}-tilt-cursor`);
    if (cursor) {
      const pct = (tilt * 0.5 + 0.5) * 100;
      cursor.style.left = pct.toFixed(1) + '%';
    }

    // Feedback pills
    const pills = Feedback.getPillStates(id);
    _pill(`${id}-pill-tiltl`,  pills.tiltLeft);
    _pill(`${id}-pill-tiltr`,  pills.tiltRight);
    _pill(`${id}-pill-rumble`, pills.rumble);
    _pill(`${id}-pill-bump`,   pills.bump);

    // Wrong-way warning
    const wrongWayEl = document.getElementById(`${id}-wrongway`);
    if (wrongWayEl) {
      const wrongMs = Math.max(0, Math.floor(bike.wrongWayTime || 0));
      const warn = wrongMs > 700;
      wrongWayEl.style.opacity = warn ? '1' : '0';
      wrongWayEl.textContent = warn ? `WRONG WAY ${Math.ceil(wrongMs / 1000)}s` : 'WRONG WAY';
    }
  }

  // ── RACE PROGRESS + GAP INDICATOR ────────────────────────────
  function _updateRaceProgress(b1, b2) {
    // 總賽程進度 (0~1)
    const prog1 = Math.min(1, (b1.lap - 1 + Math.min(b1.trackT || 0, 0.999)) / TOTAL_LAPS);
    const prog2 = Math.min(1, (b2.lap - 1 + Math.min(b2.trackT || 0, 0.999)) / TOTAL_LAPS);

    // 進度條
    const fill1 = document.getElementById('race-prog-p1');
    const fill2 = document.getElementById('race-prog-p2');
    if (fill1) fill1.style.width = (prog1 * 100).toFixed(2) + '%';
    if (fill2) fill2.style.width = (prog2 * 100).toFixed(2) + '%';

    // 名次 (1ST / 2ND)
    const p1Leading = prog1 >= prog2;
    const p1PosEl = document.getElementById('p1-pos');
    const p2PosEl = document.getElementById('p2-pos');
    if (p1PosEl) {
      p1PosEl.textContent = p1Leading ? '1ST' : '2ND';
      p1PosEl.style.color = p1Leading ? '#FFD700' : '#aaa';
    }
    if (p2PosEl) {
      p2PosEl.textContent = p1Leading ? '2ND' : '1ST';
      p2PosEl.style.color = p1Leading ? '#aaa' : '#FFD700';
    }

    // 間距計時器
    const gapEl   = document.getElementById('gap-indicator');
    const labelEl = document.getElementById('gap-label');
    const deltaEl = document.getElementById('gap-delta');
    if (!gapEl || !labelEl || !deltaEl) return;

    const raceStarted = b1.passedStart || b2.passedStart;
    if (!raceStarted) { gapEl.classList.remove('visible'); return; }

    gapEl.classList.add('visible');
    const diff    = prog1 - prog2;
    const absDiff = Math.abs(diff);

    if (absDiff < 0.0005) {
      labelEl.textContent = '⬤ EQUAL';
      labelEl.style.color = '#888';
      deltaEl.textContent = '0.0s';
      deltaEl.style.color = '#888';
    } else {
      const avgSpeed = Math.max((b1.speed + b2.speed) / 2, 10);
      const gapSecs  = (absDiff * trackLength * TOTAL_LAPS / avgSpeed).toFixed(1);
      if (diff > 0) {
        labelEl.textContent = '▲ P1 LEADS';
        labelEl.style.color = '#00CFFF';
      } else {
        labelEl.textContent = '▲ P2 LEADS';
        labelEl.style.color = '#FF4444';
      }
      deltaEl.textContent = `+${gapSecs}s`;
      deltaEl.style.color = '#FFD700';
    }
  }

  // ── LAP NOTIFICATION ──────────────────────────────────────────
  function showLapNotif(id, lapNum, lapTimeMs, isBest) {
    const notif  = document.getElementById(`lap-notif-${id}`);
    const text   = document.getElementById(`lap-notif-${id}-text`);
    const time   = document.getElementById(`lap-notif-${id}-time`);
    if (!notif) return;

    text.textContent = lapNum >= TOTAL_LAPS ? 'FINAL LAP!' : `LAP ${lapNum} COMPLETE`;
    time.textContent = _fmt(lapTimeMs) + (isBest ? '  ★ BEST' : '');
    time.style.color = isBest ? '#00E676' : '#888';

    // Animate
    notif.style.transition = 'none';
    notif.style.opacity = '0';
    notif.style.transform = 'translateY(20px)';
    void notif.offsetWidth;
    notif.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    notif.style.opacity = '1';
    notif.style.transform = 'translateY(0)';

    clearTimeout(lapNotifTimers[id]);
    lapNotifTimers[id] = setTimeout(() => {
      notif.style.opacity = '0';
      notif.style.transform = 'translateY(-20px)';
    }, 2800);
  }

  // ── MINIMAP ───────────────────────────────────────────────────
  function _updateMinimap(b1, b2) {
    if (!minimapCtx || !trackCurve) return;

    const ctx = minimapCtx;
    const W = 200, H = 200;
    ctx.clearRect(0, 0, W, H);

    // Track outline
    const pts = trackCurve.getSpacedPoints(120);
    const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const rangeX = maxX - minX || 1, rangeZ = maxZ - minZ || 1;
    const scale = Math.min((W - 20) / rangeX, (H - 20) / rangeZ);
    const offX = (W - rangeX * scale) / 2;
    const offZ = (H - rangeZ * scale) / 2;

    const toMap = p => ({
      x: (p.x - minX) * scale + offX,
      y: (p.z - minZ) * scale + offZ,
    });

    const first = toMap(pts[0]);

    // Draw lower segments first, then elevated bridge segments on top.
    const segs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      segs.push({
        a: toMap(a),
        b: toMap(b),
        y: (a.y + b.y) * 0.5,
      });
    }
    segs.sort((lhs, rhs) => lhs.y - rhs.y);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    segs.forEach(seg => {
      const lift = Math.max(0, seg.y);
      const glow = Math.min(0.28, lift * 0.025);

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 8;
      ctx.moveTo(seg.a.x, seg.a.y);
      ctx.lineTo(seg.b.x, seg.b.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,255,255,${0.18 + glow})`;
      ctx.lineWidth = lift > 1 ? 4 : 5;
      ctx.moveTo(seg.a.x, seg.a.y);
      ctx.lineTo(seg.b.x, seg.b.y);
      ctx.stroke();

      if (lift > 2.5) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(120,220,255,${Math.min(0.32, 0.10 + glow)})`;
        ctx.lineWidth = 2;
        ctx.moveTo(seg.a.x, seg.a.y);
        ctx.lineTo(seg.b.x, seg.b.y);
        ctx.stroke();
      }
    });

    // Start line marker
    ctx.beginPath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.moveTo(first.x - 4, first.y);
    ctx.lineTo(first.x + 4, first.y);
    ctx.stroke();

    // Bike dots
    [[b1, '#00CFFF'], [b2, '#FF4444']].forEach(([bike, col]) => {
      const mp = toMap(bike.position);
      ctx.beginPath();
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 6;
      ctx.arc(mp.x, mp.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  // ── SHOW WINNER SCREEN ─────────────────────────────────────────
  function showWinner(winnerId, b1, b2) {
    const overlay = document.getElementById('overlay');
    const start   = document.getElementById('screen-start');
    const win     = document.getElementById('screen-win');
    const name    = document.getElementById('win-name');
    const times   = document.getElementById('win-times');

    start.style.display = 'none';
    win.style.display   = 'flex';
    win.style.flexDirection = 'column';
    win.style.alignItems = 'center';
    win.style.gap = '16px';

    name.textContent  = winnerId === 'p1' ? 'P1 WINS' : 'P2 WINS';
    name.style.color  = winnerId === 'p1' ? '#00CFFF' : '#FF4444';

    // Lap time table
    const rows = [];
    const maxLaps = Math.max(b1.lapTimes.length, b2.lapTimes.length);
    for (let i = 0; i < maxLaps; i++) {
      const t1 = b1.lapTimes[i] !== undefined ? _fmt(b1.lapTimes[i]) : '---';
      const t2 = b2.lapTimes[i] !== undefined ? _fmt(b2.lapTimes[i]) : '---';
      rows.push(`LAP ${i + 1}<span>P1: ${t1}</span><span>P2: ${t2}</span>`);
    }
    times.innerHTML = rows.join('<br>');

    overlay.style.display = 'flex';
  }

  function showSystemMessage(text) {
    const el = document.getElementById('system-msg');
    if (!el) return;
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(systemMsgTimer);
    systemMsgTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, 1500);
  }

  // ── COUNTDOWN ─────────────────────────────────────────────────
  function showCountdown(onComplete) {
    const el  = document.getElementById('countdown');
    const num = document.getElementById('countdown-num');
    const steps = ['3', '2', '1', 'GO!'];
    let i = 0;

    el.style.opacity = '1';
    el.style.display = 'flex';
    num.style.color = '#ffffff';

    const tick = () => {
      if (i >= steps.length) return;
      num.textContent = steps[i];
      num.style.transform = 'scale(1.3)';
      num.style.opacity = '1';

      if (steps[i] === 'GO!') {
        num.style.color = '#00E676';
      }

      setTimeout(() => {
        num.style.transition = 'transform 0.6s ease-out, opacity 0.6s ease-out';
        num.style.transform = 'scale(0.7)';
        num.style.opacity = '0.2';
      }, 200);

      i++;

      if (i < steps.length) {
        setTimeout(tick, 850);
      } else {
        // GO! shown — start the game
        setTimeout(() => {
          el.style.display = 'none';
          onComplete && onComplete();
        }, 900);
      }
    };

    tick();
  }

  // ── UTILS ──────────────────────────────────────────────────────
  function _set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _pill(id, active) {
    const el = document.getElementById(id);
    if (!el) return;
    if (active) el.classList.add('active');
    else        el.classList.remove('active');
  }

  return { init, update, showLapNotif, showWinner, showCountdown, showSystemMessage, _fmt };
})();
