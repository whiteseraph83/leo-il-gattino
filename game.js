// ─────────────────────────────────────────────
//  ORIENTATION GUARD
// ─────────────────────────────────────────────
const portraitWall = document.getElementById('portrait-wall');
const canvas = document.getElementById('gameCanvas');

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
         (navigator.maxTouchPoints > 1 && window.screen.width < 1024);
}

function checkOrientation() {
  if (isMobileDevice() && window.innerHeight > window.innerWidth) {
    portraitWall.classList.add('show');
    return false;
  }
  portraitWall.classList.remove('show');
  return true;
}

window.addEventListener('resize', () => { checkOrientation(); resizeCanvas(); });
window.addEventListener('orientationchange', () => { setTimeout(() => { checkOrientation(); resizeCanvas(); }, 100); });

// ─────────────────────────────────────────────
//  CANVAS SETUP
// ─────────────────────────────────────────────
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const GRAVITY        = 0.55;
const JUMP_FORCE     = -15;
const SHOOT_MS       = 650;  // normal interval (slow)
const SHOOT_MS_FAST  = 130;  // fish power-up interval (5× faster)
const POWERUP_MS     = 10000;
const CAT_SCREEN_X   = 140;
const GROUND_RATIO   = 0.76;
const LEVEL_TARGETS  = [0, 10, 20, 30, 40, 50]; // index = level

// ─────────────────────────────────────────────
//  AUDIO ENGINE  (Web Audio API — no external files)
// ─────────────────────────────────────────────
let AC = null;
let sfxBus = null, musicBus = null;
let musicLoopTimer = null;

// Note frequencies (Hz)
const N = {
  C3:130.81, D3:146.83, E3:164.81, F3:174.61, G3:196.00, A3:220.00, B3:246.94,
  C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392.00, A4:440.00, Bb4:466.16, B4:493.88,
  C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99, A5:880.00, C6:1046.50
};

function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  const master = AC.createGain(); master.gain.value = 0.80; master.connect(AC.destination);
  sfxBus   = AC.createGain(); sfxBus.gain.value   = 0.70; sfxBus.connect(master);
  musicBus = AC.createGain(); musicBus.gain.value  = 0.22; musicBus.connect(master);
  scheduleMusicLoop();
}

// ── Background music sequencer ─────────────────
const BGM_BPM  = 158;
const BGM_BEAT = 60 / BGM_BPM;

// "Leo's Adventure" — original chiptune composition in C major (16 beats loop ~6s)
const BGM_MEL = [
  // Bar 1 — ascending leap
  [N.C5,0.5],[N.E5,0.5],[N.G5,0.5],[N.C6,0.5],
  // Bar 2 — descending answer
  [N.B4,0.5],[N.G4,0.5],[N.E5,0.5],[N.D5,0.5],
  // Bar 3 — melodic run up
  [N.C5,0.5],[N.E5,0.5],[N.G5,0.5],[N.A5,0.5],
  // Bar 4 — resolution
  [N.G5,0.5],[N.E5,0.5],[N.C5,1.0],
  // Bar 5 — F section
  [N.F5,0.5],[N.A5,0.5],[N.G5,0.5],[N.E5,0.5],
  // Bar 6 — passing tones
  [N.D5,0.5],[N.C5,0.5],[N.D5,0.5],[N.E5,0.5],
  // Bar 7 — bridge
  [N.C5,0.5],[N.G4,0.5],[N.A4,0.5],[N.B4,0.5],
  // Bar 8 — finale hold
  [N.C5,1.5],[null,0.5],
];
const BGM_BASS = [
  [N.C3,1],[N.G3,1],[N.C3,1],[N.G3,1],
  [N.C3,1],[N.G3,1],[N.A3,1],[N.E3,1],
  [N.F3,1],[N.C3,1],[N.F3,1],[N.G3,1],
  [N.C3,1],[N.G3,1],[N.C3,1],[N.C3,1],
];

function playNote(freq, t0, dur, wave, bus, vol) {
  if (!freq || !AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = wave; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.92);
  o.connect(g); g.connect(bus);
  o.start(t0); o.stop(t0 + dur);
}

function scheduleMusicLoop() {
  if (!AC) return;
  const t0 = AC.currentTime + 0.04;
  let mt = t0, bt = t0;
  BGM_MEL.forEach(([f,d])  => { playNote(f, mt, d*BGM_BEAT*0.88, 'square',   musicBus, 0.38); mt += d*BGM_BEAT; });
  BGM_BASS.forEach(([f,d]) => { playNote(f, bt, d*BGM_BEAT*0.82, 'square',   musicBus, 0.16); bt += d*BGM_BEAT; });
  const loopMs = BGM_MEL.reduce((s,[,d]) => s + d, 0) * BGM_BEAT * 1000 - 60;
  musicLoopTimer = setTimeout(scheduleMusicLoop, loopMs);
}

// ── Sound effects ──────────────────────────────
function sfxShoot(powered) {
  if (!AC) return;
  const t = AC.currentTime;
  if (powered) {
    // energetic sawtooth "BZZT"
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(500, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.13);
    g.gain.setValueAtTime(0.42, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.14);
    // high crackle layer
    const o2 = AC.createOscillator(), g2 = AC.createGain();
    o2.type = 'square';
    o2.frequency.setValueAtTime(900, t);
    o2.frequency.exponentialRampToValueAtTime(250, t + 0.09);
    g2.gain.setValueAtTime(0.20, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    o2.connect(g2); g2.connect(sfxBus); o2.start(t); o2.stop(t + 0.10);
  } else {
    // quiet low "pew"
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.07);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.08);
  }
}

function sfxHitEnemy(killed) {
  if (!AC) return;
  const t = AC.currentTime;
  if (killed) {
    // boom + noise burst
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.28);
    g.gain.setValueAtTime(0.65, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.30);
    // white noise
    const bufSz = Math.ceil(AC.sampleRate * 0.22);
    const buf = AC.createBuffer(1, bufSz, AC.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSz; i++) data[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource(), ng = AC.createGain();
    const flt = AC.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 700;
    ng.gain.setValueAtTime(0.38, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.buffer = buf;
    src.connect(flt); flt.connect(ng); ng.connect(sfxBus); src.start(t);
  } else {
    // thud hit
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
    g.gain.setValueAtTime(0.30, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.10);
  }
}

function sfxHitCat() {
  if (!AC) return;
  const t = AC.currentTime;
  // sad descending wobble "auooo"
  const o = AC.createOscillator(), g = AC.createGain();
  const lfo = AC.createOscillator(), lg = AC.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(460, t);
  o.frequency.exponentialRampToValueAtTime(160, t + 0.38);
  lfo.frequency.value = 14; lg.gain.value = 18;
  lfo.connect(lg); lg.connect(o.frequency);
  lfo.start(t); lfo.stop(t + 0.40);
  g.gain.setValueAtTime(0.52, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.40);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.40);
}

function sfxPowerUp() {
  if (!AC) return;
  const t = AC.currentTime;
  // rising sweep
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(1400, t + 0.48);
  g.gain.setValueAtTime(0.40, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.52);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.52);
  // sparkle arpeggio
  [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => {
    const t0 = t + 0.28 + i * 0.09;
    const o2 = AC.createOscillator(), g2 = AC.createGain();
    o2.type = 'square'; o2.frequency.value = f;
    g2.gain.setValueAtTime(0.28, t0);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    o2.connect(g2); g2.connect(sfxBus); o2.start(t0); o2.stop(t0 + 0.14);
  });
}

function sfxLevelUp() {
  if (!AC) return;
  const t = AC.currentTime;
  // ascending arpeggio
  [N.C5, N.E5, N.G5, N.C6, N.E5, N.G5, N.C6].forEach((f, i) => {
    const t0 = t + i * 0.095;
    const dur = i === 6 ? 0.55 : 0.11;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(0.36, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(sfxBus); o.start(t0); o.stop(t0 + dur);
  });
  // final chord
  [N.C5, N.E5, N.G5].forEach(f => {
    const t0 = t + 0.72;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.28, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);
    o.connect(g); g.connect(sfxBus); o.start(t0); o.stop(t0 + 0.65);
  });
}

function sfxJump() {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(280, t);
  o.frequency.exponentialRampToValueAtTime(560, t + 0.12);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.14);
}

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let STATE = 'start'; // start | playing | levelup | gameover | win | paused
let lives, score, level, targetScore;
let powerupEnd, invincEnd, lastShot, doubleShootEnd, pausedState;
let scrollX, spawnAcc, nextSpawnGap;
let bullets, pickups, dinos, obstacles, particles, clouds;
let catVY, catY, catOnGround, catWalkT, catWalkFrame;
let lastTS = 0;

// ── Mobile performance flag ──
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
const MAX_PARTICLES = IS_MOBILE ? 28 : 90;
const SHADOW_ON = !IS_MOBILE; // disable expensive shadows on mobile

// Pause button area (top-right)
const PAUSE_BTN = { x: 0, y: 5, w: 46, h: 28 }; // x set dynamically

function getGY() { return Math.floor(canvas.height * GROUND_RATIO); }

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
function initGame() {
  lives = 9; score = 0; level = 1;
  targetScore = LEVEL_TARGETS[1];
  initLevel();
  STATE = 'playing';
}

function initLevel() {
  bullets      = [];
  pickups      = [];
  dinos        = [];
  obstacles    = [];
  particles    = [];
  clouds       = [];
  scrollX      = 0;
  spawnAcc     = 0;
  nextSpawnGap = 180;
  lastShot     = 0;
  powerupEnd   = 0;
  doubleShootEnd = 0;
  invincEnd    = 0;
  catVY        = 0;
  catOnGround  = true;
  catWalkT     = 0;
  catWalkFrame = 0;
  catY = getGY() - 54;

  // seed clouds — fewer on mobile
  for (let i = 0; i < (IS_MOBILE ? 3 : 6); i++) {
    clouds.push({
      x: Math.random() * canvas.width,
      y: 20 + Math.random() * canvas.height * 0.28,
      w: 90 + Math.random() * 110,
      spd: 0.25 + Math.random() * 0.35,
      layer: Math.random() < 0.5 ? 1 : 2
    });
  }
}

// ─────────────────────────────────────────────
//  INPUT
// ─────────────────────────────────────────────
function getEvtCoords(e) {
  if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function handleInput(e) {
  if (e.cancelable) e.preventDefault();
  initAudio();
  const { x: cx, y: cy } = getEvtCoords(e);
  const bx = PAUSE_BTN.x;

  // Pause button hit?
  if ((STATE === 'playing' || STATE === 'paused') &&
      cx >= bx && cx <= bx + PAUSE_BTN.w &&
      cy >= PAUSE_BTN.y && cy <= PAUSE_BTN.y + PAUSE_BTN.h) {
    if (STATE === 'playing') { pausedState = STATE; STATE = 'paused'; }
    else STATE = pausedState || 'playing';
    return;
  }

  switch (STATE) {
    case 'start':    initGame(); break;
    case 'paused':   STATE = pausedState || 'playing'; break;
    case 'levelup':  nextLevel(); break;
    case 'gameover': initGame(); break;
    case 'win':      initGame(); break;
    case 'playing':
      if (catOnGround) {
        catVY = JUMP_FORCE;
        catOnGround = false;
        spawnDust(CAT_SCREEN_X + 26, catY + 54);
        sfxJump();
      }
      break;
  }
}

function nextLevel() {
  level++;
  targetScore = LEVEL_TARGETS[Math.min(level, 5)];
  sfxLevelUp();
  initLevel();
  STATE = 'playing';
}

canvas.addEventListener('click', handleInput);
canvas.addEventListener('touchstart', handleInput, { passive: false });

// ─────────────────────────────────────────────
//  SPAWN
// ─────────────────────────────────────────────
function spawnPickup(type, x, y) {
  const heights = [getGY() - 85, getGY() - 145, getGY() - 210];
  pickups.push({
    x, y: y ?? heights[Math.floor(Math.random() * heights.length)],
    w: 36, h: 36,
    ft: Math.random() * Math.PI * 2,
    type, // 'fish' | 'paw' | 'heart'
    done: false
  });
}

function spawnEntity(now) {
  const gY = getGY();
  const sx = canvas.width + 80;
  const r  = Math.random();
  const spd = 1.2 + level * 0.4 + Math.random() * 0.6;

  // 2HP chance scales with level: L1=0% L2=10% L3=30% L4=55% L5=75%
  const twoHpChance = [0, 0, 0.10, 0.30, 0.55, 0.75][Math.min(level, 5)];
  const hp = Math.random() < twoHpChance ? 2 : 1;

  if (r < 0.18) {
    spawnPickup('fish', sx);
  } else if (r < 0.25) {
    spawnPickup('paw', sx);
  } else if (r < 0.30) {
    spawnPickup('heart', sx);
  } else if (r < 0.56) {
    dinos.push({ x: sx, y: gY - 70, w: 58, h: 70, spd, hp, maxHp: hp, at: 0, dead: false });
  } else if (r < 0.72) {
    obstacles.push({ x: sx, y: gY - 50, w: 50, h: 50, type: 'rock', dead: false });
  } else if (r < 0.88) {
    obstacles.push({ x: sx, y: gY - 45, w: 55, h: 45, type: 'bush', dead: false });
  } else {
    // combo: obstacle + pickup above
    const t = Math.random() < 0.5 ? 'rock' : 'bush';
    const oh = t === 'rock' ? 50 : 45;
    obstacles.push({ x: sx, y: gY - oh, w: t === 'rock' ? 50 : 55, h: oh, type: t, dead: false });
    spawnPickup(Math.random() < 0.6 ? 'fish' : 'paw', sx + 20, gY - 185);
  }

  // level 1 is already denser (more enemies), higher levels push spawn gap down
  nextSpawnGap = 110 + Math.random() * 200 - level * 12;
  nextSpawnGap = Math.max(nextSpawnGap, 65);
}

// ─────────────────────────────────────────────
//  SHOOTING
// ─────────────────────────────────────────────
function tryShoot(now) {
  const interval = (now < powerupEnd) ? SHOOT_MS_FAST : SHOOT_MS;
  if (now - lastShot < interval) return;
  lastShot = now;
  const powered = now < powerupEnd;
  const dbl     = now < doubleShootEnd;
  sfxShoot(powered);
  const bR = powered ? 10 : 6;
  bullets.push({ x: CAT_SCREEN_X + 58, y: catY + 22, vx: 11, r: bR, powered, dead: false });
  if (dbl) {
    // second bullet slightly offset vertically
    bullets.push({ x: CAT_SCREEN_X + 52, y: catY + 36, vx: 11, r: bR, powered, dead: false });
  }
}

// ─────────────────────────────────────────────
//  COLLISION HELPERS
// ─────────────────────────────────────────────
function circRect(cx, cy, cr, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < cr * cr;
}

function rectRect(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ─────────────────────────────────────────────
//  PARTICLES
// ─────────────────────────────────────────────
function spawnDust(x, y) {
  for (let i = 0; i < 6; i++) {
    particles.push({
      x, y, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3,
      life: 0.5, ml: 0.5, r: 3, color: '#a0724a', text: null
    });
  }
}

function spawnExplosion(x, y, color, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const spd = 2 + Math.random() * 5;
    particles.push({
      x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      life: 0.9, ml: 0.9, r: 3 + Math.random() * 4, color, text: null
    });
  }
}

function spawnText(x, y, text, color) {
  particles.push({
    x, y, vx: 0, vy: -1.8,
    life: 1.6, ml: 1.6, r: 0, color, text
  });
}

// ─────────────────────────────────────────────
//  HIT CAT
// ─────────────────────────────────────────────
function hitCat(now) {
  if (now < invincEnd) return;
  lives--;
  invincEnd = now + 2000;
  sfxHitCat();
  spawnExplosion(CAT_SCREEN_X + 26, catY + 27, '#ff3333', 10);
  if (lives <= 0) { STATE = 'gameover'; }
}

// ─────────────────────────────────────────────
//  UPDATE
// ─────────────────────────────────────────────
function update(now, dt) {
  if (STATE !== 'playing') return;

  const gY   = getGY();
  const spd  = (2.8 + (level - 1) * 0.6);
  const powered = now < powerupEnd;

  // cat physics
  catVY += GRAVITY;
  catY  += catVY;
  if (catY >= gY - 54) {
    catY = gY - 54;
    catVY = 0;
    catOnGround = true;
  } else {
    catOnGround = false;
  }

  // walk anim
  catWalkT += dt;
  if (catWalkT > 140) { catWalkT = 0; catWalkFrame = (catWalkFrame + 1) % 4; }

  // scroll tracking
  scrollX += spd;

  // spawn
  spawnAcc += spd;
  if (spawnAcc >= nextSpawnGap) {
    spawnEntity(now);
    spawnAcc = 0;
  }

  // shoot
  tryShoot(now);

  // move clouds
  clouds.forEach(c => {
    c.x -= c.spd * (c.layer === 1 ? 0.4 : 0.7);
    if (c.x + c.w < 0) { c.x = canvas.width + 20; c.y = 20 + Math.random() * canvas.height * 0.27; }
  });

  // move pickups
  pickups.forEach(f => { if (!f.done) { f.x -= spd; f.ft += 0.055; } });

  // move dinos
  dinos.forEach(d => {
    if (!d.dead) { d.x -= spd + d.spd * 0.45; d.at += dt; }
  });

  // move obstacles
  obstacles.forEach(o => { if (!o.dead) o.x -= spd; });

  // move bullets
  bullets.forEach(b => { if (!b.dead) { b.x += b.vx; if (b.x > canvas.width + 60) b.dead = true; } });

  // particles
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= dt / 1000;
  });
  particles = particles.filter(p => p.life > 0);
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);

  // ── COLLISIONS ──────────────────────────────
  const catInvinc = now < invincEnd;

  // bullet vs dino
  bullets.forEach(b => {
    if (b.dead) return;
    dinos.forEach(d => {
      if (d.dead) return;
      if (circRect(b.x, b.y, b.r, d.x, d.y, d.w, d.h)) {
        b.dead = true;
        spawnExplosion(b.x, b.y, '#ff9900', 8);
        d.hp--;
        if (d.hp <= 0) {
          d.dead = true;
          score++;
          sfxHitEnemy(true);
          spawnExplosion(d.x + d.w / 2, d.y + d.h / 2, '#ffd700', 20);
          spawnText(d.x + d.w / 2, d.y - 10, '+1', '#ffd700');
        } else {
          sfxHitEnemy(false);
        }
      }
    });
  });

  // powered bullet vs obstacles
  if (powered) {
    bullets.forEach(b => {
      if (b.dead || !b.powered) return;
      obstacles.forEach(o => {
        if (o.dead) return;
        if (circRect(b.x, b.y, b.r, o.x, o.y, o.w, o.h)) {
          o.dead = true;
          b.dead = true;
          const c = o.type === 'rock' ? '#aaa' : '#3a9a3a';
          spawnExplosion(o.x + o.w / 2, o.y + o.h / 2, c, 16);
          spawnText(o.x + o.w / 2, o.y - 5, '💥', '#fff');
        }
      });
    });
  }

  // cat vs pickups
  pickups.forEach(f => {
    if (f.done) return;
    const fy = f.y + Math.sin(f.ft) * 8;
    if (rectRect(CAT_SCREEN_X + 4, catY + 4, 48, 46, f.x, fy, f.w, f.h)) {
      f.done = true;
      sfxPowerUp();
      if (f.type === 'fish') {
        powerupEnd = now + POWERUP_MS;
        spawnExplosion(f.x + f.w/2, fy + f.h/2, '#00cfff', IS_MOBILE ? 8 : 18);
        spawnText(CAT_SCREEN_X + 26, catY - 20, '🔥 POWER UP!', '#ff6600');
      } else if (f.type === 'paw') {
        doubleShootEnd = now + POWERUP_MS;
        spawnExplosion(f.x + f.w/2, fy + f.h/2, '#ff9900', IS_MOBILE ? 8 : 18);
        spawnText(CAT_SCREEN_X + 26, catY - 20, '🐾 DOPPIO SPARO!', '#ff9900');
      } else if (f.type === 'heart') {
        lives = Math.min(9, lives + 1);
        spawnExplosion(f.x + f.w/2, fy + f.h/2, '#ff2244', IS_MOBILE ? 8 : 14);
        spawnText(CAT_SCREEN_X + 26, catY - 20, '❤️ VITA!', '#ff2244');
      }
    }
  });

  // cat vs dinos
  if (!catInvinc) {
    dinos.forEach(d => {
      if (d.dead) return;
      if (rectRect(CAT_SCREEN_X + 8, catY + 8, 40, 40, d.x + 5, d.y + 5, d.w - 10, d.h - 10))
        hitCat(now);
    });
  }

  // cat vs obstacles
  if (!catInvinc) {
    obstacles.forEach(o => {
      if (o.dead) return;
      if (rectRect(CAT_SCREEN_X + 10, catY + 10, 36, 38, o.x + 6, o.y, o.w - 12, o.h))
        hitCat(now);
    });
  }

  // cleanup
  pickups = pickups.filter(f => !f.done && f.x > -80);
  dinos      = dinos.filter(d => d.x > -150);
  obstacles  = obstacles.filter(o => !o.dead && o.x > -100);
  bullets    = bullets.filter(b => !b.dead);

  // win condition
  if (score >= targetScore) {
    if (level >= 5) STATE = 'win';
    else STATE = 'levelup';
  }
}

// ─────────────────────────────────────────────
//  DRAW HELPERS
// ─────────────────────────────────────────────
function drawRoundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawHeart(x, y, size, filled) {
  ctx.save();
  ctx.fillStyle = filled ? '#ff2244' : '#444';
  if (filled) { ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 6; }
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.3);
  ctx.bezierCurveTo(x, y, x - size * 0.6, y, x - size * 0.6, y + size * 0.3);
  ctx.bezierCurveTo(x - size * 0.6, y + size * 0.65, x, y + size * 0.9, x, y + size * 1.1);
  ctx.bezierCurveTo(x, y + size * 0.9, x + size * 0.6, y + size * 0.65, x + size * 0.6, y + size * 0.3);
  ctx.bezierCurveTo(x + size * 0.6, y, x, y, x, y + size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ─────────────────────────────────────────────
//  BACKGROUND CACHE  (offscreen canvas — rebuilt only on resize)
// ─────────────────────────────────────────────
let _bgCache = null, _bgCacheW = 0, _bgCacheH = 0;

function getBgCache() {
  const W = canvas.width, H = canvas.height, gY = getGY();
  if (_bgCache && _bgCacheW === W && _bgCacheH === H) return _bgCache;
  _bgCacheW = W; _bgCacheH = H;
  _bgCache = document.createElement('canvas');
  _bgCache.width = W; _bgCache.height = H;
  const bc = _bgCache.getContext('2d');
  // sky gradient
  const sky = bc.createLinearGradient(0, 0, 0, gY);
  sky.addColorStop(0, '#1a6fa8'); sky.addColorStop(0.5, '#5ab4e0'); sky.addColorStop(1, '#a8d8f0');
  bc.fillStyle = sky; bc.fillRect(0, 0, W, gY);
  // ground gradient
  const gnd = bc.createLinearGradient(0, gY, 0, H);
  gnd.addColorStop(0, '#4a8c2a'); gnd.addColorStop(0.08, '#6abf3a');
  gnd.addColorStop(0.12, '#5c3a1e'); gnd.addColorStop(1, '#3d2410');
  bc.fillStyle = gnd; bc.fillRect(0, gY, W, H - gY);
  // grass stripe
  bc.fillStyle = '#78d63e'; bc.fillRect(0, gY, W, 7);
  return _bgCache;
}
// Invalidate cache on resize
window.addEventListener('resize', () => { _bgCache = null; });

// ─────────────────────────────────────────────
//  DRAW BACKGROUND
// ─────────────────────────────────────────────
function drawBackground() {
  const gY = getGY();
  const W = canvas.width, H = canvas.height;

  // Draw cached sky+ground (no gradient creation per frame)
  ctx.drawImage(getBgCache(), 0, 0);

  // Mountains (skip on mobile — not worth the path cost)
  if (!IS_MOBILE) {
    ctx.fillStyle = 'rgba(100,160,200,0.35)';
    const mOff = (scrollX * 0.08) % W;
    for (let i = -1; i < 3; i++) {
      const mx = i * (W / 2) - mOff;
      ctx.beginPath();
      ctx.moveTo(mx, gY);
      ctx.lineTo(mx + W * 0.12, gY - 140);
      ctx.lineTo(mx + W * 0.22, gY - 80);
      ctx.lineTo(mx + W * 0.30, gY - 160);
      ctx.lineTo(mx + W * 0.42, gY - 60);
      ctx.lineTo(mx + W * 0.50, gY);
      ctx.fill();
    }
  }

  // Clouds
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  clouds.forEach(c => drawCloud(c.x, c.y, c.w, c.layer));

  // Grass tufts — fewer on mobile
  const TUFT_COUNTS = IS_MOBILE ? [10, 14] : [25, 35];
  for (let layer = 0; layer < 2; layer++) {
    const p = layer === 0 ? 0.4 : 1.0;
    const count = TUFT_COUNTS[layer];
    ctx.fillStyle = layer === 0 ? 'rgba(80,180,40,0.5)' : '#50b828';
    for (let i = 0; i < count; i++) {
      const bx = ((i * 97 + layer * 43 - scrollX * p) % (W + 60) + W + 60) % (W + 60) - 30;
      const bh = 8 + (i % 3) * 4;
      ctx.beginPath();
      ctx.moveTo(bx, gY + 2);
      ctx.lineTo(bx + 5, gY - bh);
      ctx.lineTo(bx + 10, gY + 2);
      ctx.fill();
    }
  }
}

function drawCloud(x, y, w, layer) {
  const h = w * 0.38;
  const alpha = layer === 1 ? 0.65 : 0.9;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (IS_MOBILE) {
    // single ellipse on mobile (3× fewer path ops)
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, y + h * 0.45, w * 0.48, h * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, y + h * 0.55, w * 0.5, h * 0.38, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.28, y + h * 0.35, w * 0.28, h * 0.42, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.72, y + h * 0.3, w * 0.26, h * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ─────────────────────────────────────────────
//  DRAW CAT
// ─────────────────────────────────────────────
function drawCat(now) {
  const x = CAT_SCREEN_X, y = catY;
  const powered = now < powerupEnd;
  const invinc  = now < invincEnd;
  if (invinc && Math.floor(now / 80) % 2 === 0) return;

  ctx.save();
  if (powered && SHADOW_ON) { ctx.shadowColor = '#ff4500'; ctx.shadowBlur = 18; }

  // TAIL
  ctx.save();
  ctx.strokeStyle = '#e07020';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  const tailWag = Math.sin(catWalkFrame * 1.6) * 12;
  ctx.beginPath();
  ctx.moveTo(x + 14, y + 42);
  ctx.quadraticCurveTo(x - 12, y + 28 + tailWag, x + 4, y + 8 + tailWag);
  ctx.stroke();
  // tail tip
  ctx.strokeStyle = '#fff8e0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 8 + tailWag);
  ctx.lineTo(x + 2, y + tailWag);
  ctx.stroke();
  ctx.restore();

  // BODY
  ctx.fillStyle = '#f0922b';
  ctx.beginPath();
  ctx.ellipse(x + 36, y + 38, 22, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  // body stripes
  ctx.strokeStyle = '#c06010';
  ctx.lineWidth = 1.5;
  [x+26, x+33, x+40].forEach(sx => {
    ctx.beginPath(); ctx.moveTo(sx, y+24); ctx.lineTo(sx, y+50); ctx.stroke();
  });

  // BACK LEGS
  ctx.fillStyle = '#e07820';
  const legB = catOnGround ? Math.sin(catWalkFrame * 1.6) * 6 : 0;
  // back-left leg
  ctx.fillRect(x + 16, y + 46, 9, 14 + legB);
  // back-right is behind, skip

  // HEAD
  ctx.fillStyle = '#f5a030';
  ctx.beginPath();
  ctx.arc(x + 42, y + 22, 20, 0, Math.PI * 2);
  ctx.fill();

  // EARS
  ctx.fillStyle = '#f5a030';
  // left ear
  ctx.beginPath();
  ctx.moveTo(x + 26, y + 12);
  ctx.lineTo(x + 21, y - 5);
  ctx.lineTo(x + 36, y + 8);
  ctx.closePath();
  ctx.fill();
  // right ear
  ctx.beginPath();
  ctx.moveTo(x + 50, y + 10);
  ctx.lineTo(x + 58, y - 6);
  ctx.lineTo(x + 60, y + 10);
  ctx.closePath();
  ctx.fill();
  // inner ears
  ctx.fillStyle = '#ffb6c1';
  ctx.beginPath();
  ctx.moveTo(x + 28, y + 10); ctx.lineTo(x + 24, y - 2); ctx.lineTo(x + 35, y + 9); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 51, y + 9); ctx.lineTo(x + 57, y - 3); ctx.lineTo(x + 58, y + 9); ctx.closePath(); ctx.fill();

  // EYES
  const eyeY = y + 17;
  const pupilColor = powered ? '#ff0000' : '#1a1a1a';
  [[x+35, eyeY], [x+50, eyeY]].forEach(([ex, ey]) => {
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.ellipse(ex, ey, 6, 7, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = pupilColor;
    ctx.beginPath(); ctx.ellipse(ex, ey, 3, 5.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(ex + 1.5, ey - 2, 1.5, 0, Math.PI*2); ctx.fill();
  });

  // NOSE
  ctx.fillStyle = '#ff88aa';
  ctx.beginPath();
  ctx.moveTo(x + 42, y + 24);
  ctx.lineTo(x + 38, y + 29);
  ctx.lineTo(x + 46, y + 29);
  ctx.closePath();
  ctx.fill();

  // MOUTH
  ctx.strokeStyle = '#c05010';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x+42,y+29); ctx.quadraticCurveTo(x+37,y+34,x+33,y+32); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+42,y+29); ctx.quadraticCurveTo(x+47,y+34,x+52,y+32); ctx.stroke();

  // WHISKERS
  ctx.strokeStyle = 'rgba(255,255,240,0.9)';
  ctx.lineWidth = 1;
  [[x+38,y+26,x+16,y+22],[x+38,y+29,x+16,y+29],
   [x+46,y+26,x+64,y+22],[x+46,y+29,x+64,y+29]].forEach(([x1,y1,x2,y2]) => {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  });

  // FRONT LEGS (animated)
  ctx.fillStyle = '#f0922b';
  const legF = catOnGround ? Math.sin(catWalkFrame * 1.6) * 7 : 0;
  ctx.fillRect(x + 34, y + 50, 9, 12 + legF);
  ctx.fillRect(x + 46, y + 50, 9, 12 - legF);

  // paws
  ctx.fillStyle = '#ffd0a0';
  ctx.beginPath(); ctx.ellipse(x+38, y+63+legF, 5, 3, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x+51, y+63-legF, 5, 3, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x+20, y+61+legB, 5, 3, 0, 0, Math.PI*2); ctx.fill();

  ctx.restore();
}

// ─────────────────────────────────────────────
//  DRAW PICKUPS  (fish / paw / heart)
// ─────────────────────────────────────────────
function drawPickup(f) {
  if (f.done) return;
  if (f.type === 'paw')   { drawPawPickup(f);   return; }
  if (f.type === 'heart') { drawHeartPickup(f); return; }
  drawFishPickup(f);
}

function drawPawPickup(f) {
  const floatY = Math.sin(f.ft) * 8;
  const cx = f.x + f.w/2, cy = f.y + f.h/2 + floatY;
  ctx.save();
  if (SHADOW_ON) { ctx.shadowColor = '#ff9900'; ctx.shadowBlur = 14; }
  // glow ring
  ctx.strokeStyle = 'rgba(255,160,0,0.4)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, f.w*0.58, 0, Math.PI*2); ctx.stroke();
  // palm pad
  ctx.fillStyle = '#ff9900';
  ctx.beginPath(); ctx.arc(cx, cy + 3, f.w*0.28, 0, Math.PI*2); ctx.fill();
  // 4 toe pads
  const toePositions = [[-9,-10],[0,-13],[9,-10],[14,-2]];
  ctx.fillStyle = '#ffb84d';
  toePositions.forEach(([tx, ty]) => {
    ctx.beginPath(); ctx.arc(cx+tx, cy+ty, 5, 0, Math.PI*2); ctx.fill();
  });
  // center shine
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath(); ctx.arc(cx - 3, cy + 1, 4, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawHeartPickup(f) {
  const floatY = Math.sin(f.ft) * 8;
  const cx = f.x + f.w/2, cy = f.y + f.h/2 + floatY;
  const pulse = 1 + 0.1 * Math.sin(f.ft * 3);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pulse, pulse);
  if (SHADOW_ON) { ctx.shadowColor = '#ff2244'; ctx.shadowBlur = 16; }
  // glow ring
  ctx.strokeStyle = 'rgba(255,50,80,0.35)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, f.w*0.55, 0, Math.PI*2); ctx.stroke();
  // heart shape
  const s = 11;
  ctx.fillStyle = '#ff2244';
  ctx.beginPath();
  ctx.moveTo(0, s*0.3);
  ctx.bezierCurveTo(0,-s*0.1, -s*0.6,-s*0.1, -s*0.6, s*0.3);
  ctx.bezierCurveTo(-s*0.6, s*0.65, 0, s*0.9, 0, s*1.1);
  ctx.bezierCurveTo(0, s*0.9, s*0.6, s*0.65, s*0.6, s*0.3);
  ctx.bezierCurveTo(s*0.6,-s*0.1, 0,-s*0.1, 0, s*0.3);
  ctx.closePath(); ctx.fill();
  // shine
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath(); ctx.ellipse(-3, 2, 3, 5, -0.5, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawFishPickup(f) {
  if (f.done) return;
  const floatY = Math.sin(f.ft) * 10;
  const x = f.x, y = f.y + floatY;
  const w = f.w, h = f.h;

  ctx.save();
  if (SHADOW_ON) { ctx.shadowColor = '#00cfff'; ctx.shadowBlur = 14; }

  // tail
  ctx.fillStyle = '#29b6f6';
  ctx.beginPath();
  ctx.moveTo(x + 4, y + h * 0.5);
  ctx.lineTo(x - 12, y + h * 0.1);
  ctx.lineTo(x - 12, y + h * 0.9);
  ctx.closePath();
  ctx.fill();

  // body
  ctx.fillStyle = '#4dd0e1';
  ctx.beginPath();
  ctx.ellipse(x + w * 0.55, y + h * 0.5, w * 0.46, h * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // belly
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(x + w * 0.52, y + h * 0.58, w * 0.28, h * 0.18, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // scales
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  [[x + w*0.55, y + h*0.42],[x + w*0.68, y + h*0.44]].forEach(([sx,sy]) => {
    ctx.beginPath(); ctx.arc(sx, sy, h * 0.18, 0.1, Math.PI - 0.1); ctx.stroke();
  });

  // fin
  ctx.fillStyle = '#00acc1';
  ctx.beginPath();
  ctx.moveTo(x + w*0.5, y + h*0.2);
  ctx.lineTo(x + w*0.4, y - h*0.1);
  ctx.lineTo(x + w*0.7, y + h*0.2);
  ctx.closePath();
  ctx.fill();

  // eye
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(x + w*0.78, y + h*0.36, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(x + w*0.79, y + h*0.36, 2, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(x + w*0.80, y + h*0.34, 0.8, 0, Math.PI*2); ctx.fill();

  // shimmer
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.ellipse(x + w*0.6, y + h*0.32, 5, 2.5, -0.4, 0, Math.PI*2); ctx.fill();

  ctx.restore();
}

// ─────────────────────────────────────────────
//  DRAW DINOSAUR
// ─────────────────────────────────────────────
function drawDino(d) {
  if (d.dead) return;
  const sc = d.maxHp > 1 ? 1.35 : 1.0;  // 2HP dinos are 35% bigger
  const x = d.x, y = d.y, w = d.w, h = d.h;
  const bob = Math.sin(d.at / 190) * 3;

  ctx.save();
  if (sc !== 1.0) {
    const cx = x + w / 2, cy = y + h / 2;
    ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
  }

  // tail
  ctx.strokeStyle = '#43a047';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + w*0.85, y + h*0.55 + bob);
  ctx.quadraticCurveTo(x + w*1.15, y + h*0.38 + bob, x + w*1.05, y + h*0.18 + bob);
  ctx.stroke();

  // body
  ctx.fillStyle = '#4caf50';
  ctx.beginPath();
  ctx.ellipse(x + w*0.5, y + h*0.56 + bob, w*0.38, h*0.3, 0, 0, Math.PI*2);
  ctx.fill();

  // back spikes
  ctx.fillStyle = '#2e7d32';
  for (let i = 0; i < 5; i++) {
    const sx = x + w*(0.28 + i*0.1);
    const sy = y + h*0.28 + bob;
    ctx.beginPath();
    ctx.moveTo(sx - 5, sy);
    ctx.lineTo(sx, sy - 16 - i%2*6);
    ctx.lineTo(sx + 5, sy);
    ctx.closePath();
    ctx.fill();
  }

  // neck
  ctx.fillStyle = '#43a047';
  ctx.beginPath();
  ctx.moveTo(x + w*0.25, y + h*0.3 + bob);
  ctx.lineTo(x + w*0.15, y + h*0.15 + bob);
  ctx.lineTo(x + w*0.3, y + h*0.18 + bob);
  ctx.lineTo(x + w*0.38, y + h*0.3 + bob);
  ctx.closePath();
  ctx.fill();

  // head
  ctx.fillStyle = '#4caf50';
  ctx.beginPath();
  ctx.ellipse(x + w*0.18, y + h*0.22 + bob, w*0.24, h*0.2, 0.2, 0, Math.PI*2);
  ctx.fill();

  // snout
  ctx.fillStyle = '#66bb6a';
  ctx.beginPath();
  ctx.ellipse(x + w*0.04, y + h*0.26 + bob, w*0.13, h*0.1, 0, 0, Math.PI*2);
  ctx.fill();

  // teeth
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 3; i++) {
    const tx = x + w*(0.02 + i*0.05);
    const ty = y + h*0.32 + bob;
    ctx.beginPath();
    ctx.moveTo(tx, ty); ctx.lineTo(tx+4,ty); ctx.lineTo(tx+2,ty+8); ctx.closePath(); ctx.fill();
  }

  // eye
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x+w*0.16, y+h*0.17+bob, 5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#d50000'; ctx.beginPath(); ctx.arc(x+w*0.16, y+h*0.17+bob, 3, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x+w*0.17, y+h*0.16+bob, 1, 0, Math.PI*2); ctx.fill();

  // legs
  ctx.fillStyle = '#388e3c';
  const lg = Math.sin(d.at / 190) * 8;
  [[x+w*0.38, y+h*0.78+bob, lg],[x+w*0.54, y+h*0.78+bob, -lg],[x+w*0.64, y+h*0.76+bob, lg*0.7]].forEach(([lx,ly,off]) => {
    ctx.fillRect(lx, ly, 10, 18 + off);
  });

  // HP bar
  if (d.maxHp > 1) {
    ctx.fillStyle = '#b71c1c';
    ctx.fillRect(x, y - 12, w, 6);
    ctx.fillStyle = '#76ff03';
    ctx.fillRect(x, y - 12, w * (d.hp / d.maxHp), 6);
  }

  ctx.restore();
}

// ─────────────────────────────────────────────
//  DRAW OBSTACLE
// ─────────────────────────────────────────────
function drawObstacle(o) {
  if (o.dead) return;
  const x = o.x, y = o.y, w = o.w, h = o.h;
  ctx.save();

  if (o.type === 'rock') {
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(x+w*0.5, y+h+4, w*0.45, 6, 0, 0, Math.PI*2); ctx.fill();
    // main shape
    ctx.fillStyle = '#9e9e9e';
    ctx.beginPath();
    ctx.moveTo(x+w*0.08, y+h);
    ctx.lineTo(x, y+h*0.6);
    ctx.lineTo(x+w*0.18, y+h*0.15);
    ctx.lineTo(x+w*0.48, y);
    ctx.lineTo(x+w*0.78, y+h*0.12);
    ctx.lineTo(x+w, y+h*0.55);
    ctx.lineTo(x+w*0.88, y+h);
    ctx.closePath();
    ctx.fill();
    // highlight
    ctx.fillStyle = '#bdbdbd';
    ctx.beginPath();
    ctx.moveTo(x+w*0.2, y+h*0.18); ctx.lineTo(x+w*0.48, y+h*0.05);
    ctx.lineTo(x+w*0.7, y+h*0.22); ctx.lineTo(x+w*0.38, y+h*0.38);
    ctx.closePath(); ctx.fill();
    // dark shadow face
    ctx.fillStyle = '#757575';
    ctx.beginPath();
    ctx.moveTo(x, y+h*0.6); ctx.lineTo(x+w*0.08, y+h); ctx.lineTo(x+w*0.38, y+h*0.55);
    ctx.closePath(); ctx.fill();

  } else {
    // BUSH
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(x+w*0.5, y+h+4, w*0.46, 6, 0, 0, Math.PI*2); ctx.fill();

    // bumps
    ctx.fillStyle = '#2e7d32';
    [[x+w*0.25, y+h*0.65, w*0.26],[x+w*0.52, y+h*0.58, w*0.3],[x+w*0.75, y+h*0.65, w*0.22],
     [x+w*0.42, y+h*0.38, w*0.24]].forEach(([cx,cy,r]) => {
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    });
    ctx.fillStyle = '#388e3c';
    [[x+w*0.38, y+h*0.55, w*0.18],[x+w*0.6, y+h*0.48, w*0.16]].forEach(([cx,cy,r]) => {
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    });

    // spikes — on mobile skip per-spike save/rotate (9× state change) and draw simple diamonds
    ctx.fillStyle = '#e53935';
    const spikePos = [
      [0.05,0.45],[0.2,0.15],[0.42,0.0],[0.65,0.1],[0.88,0.3],[0.92,0.65],
      [0.75,0.85],[0.15,0.82],[0.5,0.88]
    ];
    if (IS_MOBILE) {
      spikePos.forEach(([px, py]) => {
        const sx = x + w*px, sy = y + h*py;
        ctx.beginPath(); ctx.moveTo(sx,sy-9); ctx.lineTo(sx+3,sy); ctx.lineTo(sx,sy+3); ctx.lineTo(sx-3,sy); ctx.closePath(); ctx.fill();
      });
    } else {
      spikePos.forEach(([px, py]) => {
        const sx = x + w*px, sy = y + h*py;
        const ang = Math.atan2(py - 0.52, px - 0.5);
        ctx.save();
        ctx.translate(sx, sy); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(-3,0); ctx.lineTo(3,0); ctx.lineTo(0,-11); ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    }
  }

  ctx.restore();
}

// ─────────────────────────────────────────────
//  DRAW BULLETS
// ─────────────────────────────────────────────
function drawBullets(now) {
  bullets.forEach(b => {
    if (b.dead) return;
    ctx.save();
    if (b.powered) {
      if (SHADOW_ON) { ctx.shadowColor = '#ff4500'; ctx.shadowBlur = 20; }
      ctx.fillStyle = '#ff2200';
      if (!IS_MOBILE) {
        // fire trail gradient (skip on mobile — gradient create per bullet is costly)
        const trailGrad = ctx.createLinearGradient(b.x - b.r*3, b.y, b.x, b.y);
        trailGrad.addColorStop(0, 'rgba(255,100,0,0)');
        trailGrad.addColorStop(1, 'rgba(255,50,0,0.55)');
        ctx.fillStyle = trailGrad;
        ctx.beginPath(); ctx.ellipse(b.x - b.r*2, b.y, b.r*2.5, b.r*0.6, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#ff2200';
      }
    } else {
      if (SHADOW_ON) { ctx.shadowColor = '#ffe066'; ctx.shadowBlur = 12; }
      ctx.fillStyle = '#ffd700';
      if (!IS_MOBILE) {
        // normal trail
        ctx.fillStyle = 'rgba(255,200,0,0.3)';
        ctx.beginPath(); ctx.ellipse(b.x - b.r*2, b.y, b.r*2, b.r*0.5, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#ffd700';
      }
    }
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill();
    if (!IS_MOBILE) {
      // core shine (skip on mobile)
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(b.x - b.r*0.3, b.y - b.r*0.3, b.r*0.35, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  });
}

// ─────────────────────────────────────────────
//  DRAW PARTICLES
// ─────────────────────────────────────────────
function drawParticles() {
  particles.forEach(p => {
    const a = Math.max(0, p.life / p.ml);
    ctx.save();
    ctx.globalAlpha = a;
    if (p.text) {
      ctx.font = 'bold 18px "Fredoka One", cursive';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      if (SHADOW_ON) { ctx.shadowColor = p.color; ctx.shadowBlur = 8; }
      ctx.fillText(p.text, p.x, p.y);
    } else {
      ctx.fillStyle = p.color;
      if (SHADOW_ON) { ctx.shadowColor = p.color; ctx.shadowBlur = 4; }
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.r * a), 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  });
}

// ─────────────────────────────────────────────
//  DRAW HUD
// ─────────────────────────────────────────────
function drawPauseBtn(now) {
  const W = canvas.width;
  PAUSE_BTN.x = W - PAUSE_BTN.w - 8;
  const bx = PAUSE_BTN.x, by = PAUSE_BTN.y, bw = PAUSE_BTN.w, bh = PAUSE_BTN.h;
  const isPaused = STATE === 'paused';
  ctx.save();
  // bg pill
  ctx.fillStyle = isPaused ? 'rgba(255,215,0,0.85)' : 'rgba(0,0,0,0.45)';
  drawRoundRect(bx, by, bw, bh, 8); ctx.fill();
  // icon
  ctx.fillStyle = isPaused ? '#000' : '#fff';
  ctx.font = 'bold 15px "Nunito", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isPaused ? '▶' : '⏸', bx + bw/2, by + bh/2 + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawHUD(now) {
  const W = canvas.width;
  const powered = now < powerupEnd;
  const dbl     = now < doubleShootEnd;

  // hearts
  for (let i = 0; i < 9; i++) {
    drawHeart(14 + i * 26, 10, 10, i < lives);
  }

  // score
  ctx.save();
  ctx.font = 'bold 22px "Fredoka One", cursive';
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 4;
  ctx.strokeText(`Punti: ${score} / ${targetScore}`, W / 2, 32);
  ctx.fillStyle = '#fff'; ctx.fillText(`Punti: ${score} / ${targetScore}`, W / 2, 32);

  // level (leave room for pause btn on right)
  ctx.textAlign = 'right';
  const lvlTxt = `Livello ${level}`;
  ctx.strokeText(lvlTxt, W - 68, 32);
  ctx.fillStyle = '#ffd700'; ctx.fillText(lvlTxt, W - 68, 32);
  ctx.restore();

  drawPauseBtn(now);

  // power-up bars
  let barY = 50;
  function drawBar(rem, col1, col2, label) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    drawRoundRect(10, barY, 165, 16, 8); ctx.fill();
    const grad = ctx.createLinearGradient(10, 0, 175, 0);
    grad.addColorStop(0, col1); grad.addColorStop(1, col2);
    ctx.fillStyle = grad;
    if (SHADOW_ON) { ctx.shadowColor = col1; ctx.shadowBlur = 8; }
    drawRoundRect(10, barY, Math.max(4, 165 * rem), 16, 8); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = 'bold 11px "Nunito", sans-serif';
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    ctx.fillText(label, 14, barY + 12);
    ctx.restore();
    barY += 22;
  }

  if (powered) drawBar((powerupEnd - now) / POWERUP_MS, '#ff4500', '#ffd700', '🔥 POWER UP!');
  if (dbl)     drawBar((doubleShootEnd - now) / POWERUP_MS, '#ff9900', '#ffe066', '🐾 DOPPIO SPARO!');
}

// ─────────────────────────────────────────────
//  DRAW OVERLAY SCREENS
// ─────────────────────────────────────────────
function drawOverlay(title, lines, hint, overlay) {
  const W = canvas.width, H = canvas.height;

  // Dim
  ctx.fillStyle = overlay || 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, H);

  // Panel
  const pw = Math.min(520, W - 40), ph = 260;
  const px = (W - pw) / 2, py = (H - ph) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 30;
  ctx.fillStyle = 'rgba(10,10,30,0.92)';
  drawRoundRect(px, py, pw, ph, 20); ctx.fill();
  ctx.restore();

  // Border glow
  ctx.save();
  ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
  ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 14;
  drawRoundRect(px+1, py+1, pw-2, ph-2, 20); ctx.stroke();
  ctx.restore();

  // Title
  ctx.save();
  ctx.font = 'bold 42px "Fredoka One", cursive';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd700';
  ctx.shadowColor = '#ff8c00'; ctx.shadowBlur = 18;
  ctx.fillText(title, W/2, py + 66);
  ctx.restore();

  // Lines
  ctx.save();
  ctx.font = '20px "Nunito", sans-serif';
  ctx.textAlign = 'center'; ctx.fillStyle = '#ddd'; ctx.shadowBlur = 0;
  lines.forEach((l, i) => ctx.fillText(l, W/2, py + 108 + i*28));
  ctx.restore();

  // Hint (pulsing)
  const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 400);
  ctx.save();
  ctx.font = 'bold 16px "Nunito", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(255,255,255,${pulse})`;
  ctx.fillText(hint, W/2, py + ph - 22);
  ctx.restore();
}

function drawStartScreen() {
  const W = canvas.width, H = canvas.height;
  // animated gradient bg
  const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.8);
  bg.addColorStop(0, '#1a2a4a');
  bg.addColorStop(1, '#0a0a18');
  ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
  // stars
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i=0; i<60; i++) {
    const sx = ((i*137+Date.now()*0.01) % W + W) % W;
    const sy = ((i*97) % H + H) % H;
    const sr = 0.5 + (i % 3) * 0.5;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI*2); ctx.fill();
  }

  drawOverlay(
    '🐱 Leo il Gattino 🐱',
    [
      'Il gatto spara automaticamente!',
      'Clicca / tocca  →  SALTA',
      'Mangia i 🐟 per il POWER UP!'
    ],
    '✨ Clicca ovunque per iniziare ✨'
  );
}

// ─────────────────────────────────────────────
//  GAME LOOP
// ─────────────────────────────────────────────
function loop(ts) {
  const dt = Math.min(ts - lastTS, 50);
  lastTS = ts;

  if (!checkOrientation()) {
    requestAnimationFrame(loop);
    return;
  }

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (STATE === 'start') {
    drawStartScreen();

  } else if (STATE === 'playing' || STATE === 'paused') {
    if (STATE === 'playing') update(ts, dt);
    drawBackground();
    pickups.forEach(drawPickup);
    obstacles.forEach(drawObstacle);
    dinos.forEach(drawDino);
    drawBullets(ts);
    drawCat(ts);
    drawParticles();
    drawHUD(ts);
    if (STATE === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.font = 'bold 56px "Fredoka One", cursive';
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffd700';
      ctx.shadowColor = '#ff8c00'; ctx.shadowBlur = 20;
      ctx.fillText('⏸ PAUSA', W/2, H/2 - 10);
      ctx.shadowBlur = 0;
      ctx.font = '22px "Nunito", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('Clicca ovunque per continuare', W/2, H/2 + 38);
      ctx.restore();
    }

  } else if (STATE === 'levelup') {
    drawBackground();
    pickups.forEach(drawPickup);
    obstacles.forEach(drawObstacle);
    dinos.forEach(drawDino);
    drawCat(ts);
    drawHUD(ts);
    drawOverlay(
      `⭐ Livello ${level} Superato! ⭐`,
      [`Ottimo lavoro! Punti: ${score}`,`Prossimo obiettivo: ${LEVEL_TARGETS[Math.min(level+1,5)]} punti`],
      '✨ Clicca per continuare ✨'
    );

  } else if (STATE === 'gameover') {
    drawBackground();
    drawOverlay(
      '💀 Game Over 💀',
      [`Hai totalizzato ${score} punti`, `al Livello ${level}`],
      '🔄 Clicca per riprovare',
      'rgba(60,0,0,0.7)'
    );

  } else if (STATE === 'win') {
    const W2 = canvas.width, H2 = canvas.height;
    const bg = ctx.createRadialGradient(W2/2,H2/2,0,W2/2,H2/2,Math.max(W2,H2));
    bg.addColorStop(0,'#1a3a1a'); bg.addColorStop(1,'#0a0a0a');
    ctx.fillStyle=bg; ctx.fillRect(0,0,W2,H2);
    // confetti
    for (let i=0;i<80;i++) {
      const cx = ((i*173 + ts*0.05) % W2+W2)%W2;
      const cy = ((i*89 + ts*0.03) % H2+H2)%H2;
      ctx.fillStyle = `hsl(${(i*47+ts*0.1)%360},80%,60%)`;
      ctx.fillRect(cx, cy, 6, 4);
    }
    drawOverlay(
      '🏆 HAI VINTO! 🏆',
      ['Leo ha sconfitto tutti i dinosauri!',`Punteggio finale: ${score} punti`,'Sei un campione! 🎉'],
      '🔄 Clicca per ricominciare'
    );
  }

  requestAnimationFrame(loop);
}

// ─────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────
checkOrientation();
initLevel(); // pre-init so canvas is ready
requestAnimationFrame(loop);