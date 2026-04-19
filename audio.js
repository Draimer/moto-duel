const GameAudio = (() => {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let engineBus = null;
  let enabled = true;
  let bgm = null;
  let engine = null;
  let bgmVolume = 0.10;
  let bgmDuckTimer = null;

  function _ensure() {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    sfxBus = ctx.createGain();
    engineBus = ctx.createGain();
    master.gain.value = enabled ? 0.24 : 0.0;
    sfxBus.gain.value = 1.0;
    engineBus.gain.value = 0.8;
    sfxBus.connect(master);
    engineBus.connect(master);
    master.connect(ctx.destination);
    return ctx;
  }

  function _ensureBgm() {
    if (bgm) return bgm;
    bgm = new Audio('music.mp3');
    bgm.loop = true;
    bgm.preload = 'auto';
    bgm.volume = enabled ? bgmVolume : 0.0;
    return bgm;
  }

  function _ensureEngine() {
    const audio = _ensure();
    if (!audio) return null;
    if (engine) return engine;

    const oscA = audio.createOscillator();
    const oscB = audio.createOscillator();
    const lowpass = audio.createBiquadFilter();
    const gain = audio.createGain();

    oscA.type = 'sawtooth';
    oscB.type = 'triangle';
    oscA.frequency.value = 90;
    oscB.frequency.value = 135;
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 700;
    gain.gain.value = 0.0001;

    oscA.connect(lowpass);
    oscB.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(engineBus);

    oscA.start();
    oscB.start();

    engine = { oscA, oscB, lowpass, gain };
    return engine;
  }

  function resume() {
    const audio = _ensure();
    if (audio && audio.state === 'suspended') {
      audio.resume().catch(() => {});
    }
    if (enabled) {
      const music = _ensureBgm();
      music.play().catch(() => {});
    }
    _ensureEngine();
  }

  function setEnabled(value) {
    enabled = !!value;
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(enabled ? 0.22 : 0.0, ctx.currentTime);
    }
    const music = _ensureBgm();
    music.volume = enabled ? bgmVolume : 0.0;
    if (enabled) {
      music.play().catch(() => {});
    } else {
      music.pause();
    }
    if (!enabled) {
      setEngineMix(0, 0);
    }
  }

  function setBgmVolume(value) {
    if (!Number.isFinite(value)) return;
    bgmVolume = Math.max(0, Math.min(1, value));
    const music = _ensureBgm();
    music.volume = enabled ? bgmVolume : 0.0;
  }

  function _setBgmPlaybackVolume(value) {
    const music = _ensureBgm();
    music.volume = enabled ? Math.max(0, Math.min(1, value)) : 0.0;
  }

  function _duckBgm(duration = 220, factor = 0.28) {
    if (!enabled) return;
    if (bgmDuckTimer) {
      clearTimeout(bgmDuckTimer);
      bgmDuckTimer = null;
    }
    _setBgmPlaybackVolume(bgmVolume * factor);
    bgmDuckTimer = setTimeout(() => {
      _setBgmPlaybackVolume(bgmVolume);
      bgmDuckTimer = null;
    }, duration);
  }

  function setEngineMix(throttle = 0, speed = 0) {
    const rig = _ensureEngine();
    if (!rig || !ctx) return;

    const now = ctx.currentTime;
    const drive = Math.max(0, Math.min(1, throttle));
    const velocity = Math.max(0, Math.min(1, speed));
    const intensity = enabled ? Math.max(drive * 0.9, velocity * 0.75) : 0;
    const baseFreq = 82 + velocity * 120 + drive * 55;
    const layerFreq = baseFreq * (1.45 + drive * 0.2);
    const cutoff = 520 + intensity * 1600;
    const volume = 0.0001 + intensity * 0.085;

    rig.oscA.frequency.cancelScheduledValues(now);
    rig.oscB.frequency.cancelScheduledValues(now);
    rig.lowpass.frequency.cancelScheduledValues(now);
    rig.gain.gain.cancelScheduledValues(now);

    rig.oscA.frequency.setTargetAtTime(baseFreq, now, 0.05);
    rig.oscB.frequency.setTargetAtTime(layerFreq, now, 0.05);
    rig.lowpass.frequency.setTargetAtTime(cutoff, now, 0.08);
    rig.gain.gain.setTargetAtTime(volume, now, 0.06);
  }

  function _tone({
    type = 'sine',
    freq = 440,
    duration = 0.12,
    volume = 0.18,
    attack = 0.005,
    release = 0.08,
    detune = 0,
    when = 0,
    endFreq = null,
  }) {
    const audio = _ensure();
    if (!audio || !enabled) return;

    const startAt = audio.currentTime + when;
    const stopAt = startAt + duration;
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    osc.detune.setValueAtTime(detune, startAt);
    if (endFreq !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), stopAt);
    }

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt + release);

    osc.connect(gain);
    gain.connect(sfxBus);
    osc.start(startAt);
    osc.stop(stopAt + release);
  }

  function _noise({
    duration = 0.12,
    volume = 0.1,
    when = 0,
    highpass,
    lowpass,
    attack = 0.005,
  }) {
    const audio = _ensure();
    if (!audio || !enabled) return;

    const startAt = audio.currentTime + when;
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }

    const src = audio.createBufferSource();
    const gain = audio.createGain();

    src.buffer = buffer;

    // Allow callers to pick either a highpass or lowpass shape (or omit both).
    let filter = null;
    if (typeof lowpass === 'number') {
      filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass;
    } else if (typeof highpass === 'number') {
      filter = audio.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = highpass;
    }

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    if (filter) {
      src.connect(filter);
      filter.connect(gain);
    } else {
      src.connect(gain);
    }
    gain.connect(sfxBus);
    src.start(startAt);
    src.stop(startAt + duration);
  }

  function playCountdown(step) {
    if (step === 'GO!') {
      _tone({ type: 'square', freq: 520, endFreq: 920, duration: 0.22, volume: 0.18, release: 0.12 });
      _tone({ type: 'triangle', freq: 780, endFreq: 1180, duration: 0.18, volume: 0.1, when: 0.04 });
      return;
    }
    _tone({ type: 'square', freq: 360, endFreq: 420, duration: 0.12, volume: 0.11, release: 0.08 });
  }

  function playShift() {}

  // Global cooldown so tight scraping / rapid multi-hits don't stack up
  // and sound like machine-gun fire. Callers can still request a hit
  // every frame — this gate will silently drop them.
  const COLLISION_SFX_COOLDOWN_MS = 180;
  let _lastCollisionAt = 0;

  function playCollision(intensity = 1.0) {
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    if (now - _lastCollisionAt < COLLISION_SFX_COOLDOWN_MS) return;
    _lastCollisionAt = now;

    // Clamp intensity so wall scrapes can be quieter than hard hits
    // without disappearing entirely.
    const i = Math.max(0.25, Math.min(1.5, Number(intensity) || 1.0));

    _duckBgm(200, 0.32);

    // ── Core "碰" body: a fast low-sine pitch drop. This is what a
    // solid thud is physically — a short, low-frequency transient.
    _tone({
      type: 'sine',
      freq: 90,
      endFreq: 42,
      duration: 0.22,
      volume: 0.38 * i,
      attack: 0.001,
      release: 0.10,
    });

    // ── Mid-body knock: triangle wave an octave up gives the "wood
    // knock" character so it doesn't feel like a pure sub-bass hit.
    _tone({
      type: 'triangle',
      freq: 180,
      endFreq: 80,
      duration: 0.14,
      volume: 0.14 * i,
      attack: 0.001,
      release: 0.07,
    });

    // ── Impact transient: a very short low-passed noise burst adds
    // the "crack" of contact without the electrical-buzz highs that
    // the previous highpass-noise was producing.
    _noise({
      duration: 0.05,
      volume: 0.22 * i,
      lowpass: 900,
      attack: 0.001,
    });
  }

  function playLap(isBest = false) {
    _tone({ type: 'triangle', freq: 540, duration: 0.12, volume: 0.14, release: 0.08 });
    _tone({ type: 'triangle', freq: isBest ? 860 : 760, duration: 0.16, volume: 0.15, when: 0.09, release: 0.1 });
    if (isBest) {
      _tone({ type: 'sine', freq: 1180, duration: 0.18, volume: 0.09, when: 0.18, release: 0.14 });
    } else {
      _tone({ type: 'sine', freq: 980, duration: 0.1, volume: 0.05, when: 0.18, release: 0.1 });
    }
  }

  function playWinner() {
    _tone({ type: 'triangle', freq: 392, duration: 0.18, volume: 0.15, release: 0.08 });
    _tone({ type: 'triangle', freq: 523, duration: 0.18, volume: 0.15, when: 0.14, release: 0.08 });
    _tone({ type: 'triangle', freq: 659, duration: 0.24, volume: 0.16, when: 0.28, release: 0.12 });
    _tone({ type: 'sine', freq: 784, duration: 0.34, volume: 0.08, when: 0.42, release: 0.18 });
  }

  return {
    resume,
    setEnabled,
    setBgmVolume,
    setEngineMix,
    playCountdown,
    playShift,
    playCollision,
    playLap,
    playWinner,
  };
})();
