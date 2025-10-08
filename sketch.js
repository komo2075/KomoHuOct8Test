// =====================================================
// Multi-pack GIF system (IN -> INTER -> OUT -> next pack)
// - IN:   blank -> theme intro (one-shot, non-interactive)
// - INTER: long-press forward, release backward (interactive)
// - OUT:  last frame reached -> explode to blank (one-shot)
// After OUT, pick next pack, play its IN, then INTER.
// =====================================================

// ----------- Manifest: define your theme packs here -----------
const packs = [
  {
    name: 'star',
    base: 'assets/star/',
    in:    { dir: 'in/',    prefix: 'in_',    pad: 4, count: 20 },
    inter: { dir: 'inter/', prefix: 'inter_', pad: 4, count: 20 },
    out:   { dir: 'out/',   prefix: 'out_',   pad: 4, count: 20 }
  },
  {
    name: 'flower',
    base: 'assets/flower/',
    in:    { dir: 'in/',    prefix: 'in_',    pad: 4, count: 20 },
    inter: { dir: 'inter/', prefix: 'inter_', pad: 4, count: 20 },
    out:   { dir: 'out/',   prefix: 'out_',   pad: 4, count: 20 }
  },
  {
    name: 'diamond',
    base: 'assets/diamond/',
    in:    { dir: 'in/',    prefix: 'in_',    pad: 4, count: 20 },
    inter: { dir: 'inter/', prefix: 'inter_', pad: 4, count: 20 },
    out:   { dir: 'out/',   prefix: 'out_',   pad: 4, count: 20 }
  }
];

// ----------- Playback config -----------
const FWD_SPEED = 0.8;   // 正放速度（每帧增量）
const BWD_SPEED = 1;   // 倒放速度
const SHOW_HUD  = true;  // 屏幕底部提示
const RANDOM_ORDER = true; // true=随机换主题；false=顺序循环

// ----------- Runtime state -----------
let state = 'HOLD_IN_INIT'; // HOLD_IN_INIT | IN | INTER | OUT | HOLD_IN_SWITCH
let curPackIndex = 0;
let nextPackIndex = 1;
let framesCache = [];          // [packIndex] -> {in:[], inter:[], out:[]}
let frameIndex = 0;            // float for smoother speed
let isTouching = false;
let expectedCount = 0;         // for "loading..." UI
let loadedCount = 0;

// ----------- Preload initial segments -----------
function preload() {
  framesCache = packs.map(() => ({ in:null, inter:null, out:null }));
  curPackIndex = 0;
  nextPackIndex = pickNextIndex(curPackIndex);

  // ✅ 初始就把 A(当前) 与 B(下一个) 的三段全载
  ensurePackAll(curPackIndex);     // A
  ensurePackAll(nextPackIndex);    // B
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  if (typeof lockGestures === 'function') lockGestures();
  imageMode(CENTER);
  textAlign(CENTER, CENTER);
  frameRate(60);
}

function draw() {
  background(255); // 纯白

  switch (state) {
    // ① 初次进入：等 A 与 B 都 ready，再开播 A 的 IN
    case 'HOLD_IN_INIT': {
      const img = firstFrame(curPackIndex, 'in');
      if (img) drawImageFit(img); else drawLoading(); // 有首帧就占位
      if (isPackReady(curPackIndex) && isPackReady(nextPackIndex)) {
        state = 'IN';
        frameIndex = 0;
      }
      if (SHOW_HUD) drawHUD();
      return;
    }

    // ② IN 段：一镜到底
    case 'IN': {
      if (!isSegmentReady(curPackIndex, 'in')) { drawLoading(); if (SHOW_HUD) drawHUD(); return; }
      runOneShot(curPackIndex, 'in', () => {
        state = 'INTER';
        frameIndex = 0;
      });
      if (SHOW_HUD) drawHUD();
      return;
    }

    // ③ INTER 段：交互推进；临近末尾预取 OUT（已在 ensurePackAll 里加载过，这里可留作保险）
    case 'INTER': {
      const frames = framesCache[curPackIndex].inter;
      if (!frames) { drawLoading(); if (SHOW_HUD) drawHUD(); return; }

      // 末段保险预取
      if (isTouching && frameIndex >= frames.length - 6) ensureLoaded(curPackIndex, 'out');

      runInteractive(curPackIndex);
      if (SHOW_HUD) drawHUD();
      return;
    }

    // ④ OUT 播完 → 准备切 B，但要等 C 全好
    case 'OUT': {
      if (!isSegmentReady(curPackIndex, 'out')) { 
        // OUT 未就绪就用 INTER 末帧占位
        const inter = framesCache[curPackIndex].inter;
        if (inter && inter[inter.length - 1]) drawImageFit(inter[inter.length - 1]); else drawLoading();
        if (SHOW_HUD) drawHUD();
        return;
      }

      runOneShot(curPackIndex, 'out', () => {
        // 切到 B，并开始预载 C
        curPackIndex = nextPackIndex;
        nextPackIndex = pickNextIndex(curPackIndex);
        ensurePackAll(curPackIndex);   // B（通常已好）
        ensurePackAll(nextPackIndex);  // 预载 C
        state = 'HOLD_IN_SWITCH';      // 先用 B 的 IN 第1帧占位，等到 C 全好
        frameIndex = 0;
      });
      if (SHOW_HUD) drawHUD();
      return;
    }

    // ⑤ 切到新的主题 B：用 B 的 IN 第一帧占位，等 C 全好后再开播 B 的 IN
    case 'HOLD_IN_SWITCH': {
      const img = firstFrame(curPackIndex, 'in');
      if (img) drawImageFit(img); else drawLoading();
      if (isPackReady(curPackIndex) && isPackReady(nextPackIndex)) {
        state = 'IN';
        frameIndex = 0;
      }
      if (SHOW_HUD) drawHUD();
      return;
    }
  }
}

// ------------------ Segment runners ------------------
function runInteractive(packIdx) {
  const frames = framesCache[packIdx].inter;

  // 推进/回退
  frameIndex = isTouching
    ? Math.min(frameIndex + FWD_SPEED, frames.length - 1)
    : Math.max(frameIndex - BWD_SPEED, 0);

  // ✅ 靠近末尾就预取 OUT（比如还剩 5 帧时）
  if (isTouching && frameIndex >= frames.length - 6) {
    ensureLoaded(packIdx, 'out');
  }

  const img = frames[Math.round(frameIndex)];
  drawImageFit(img);

  // ✅ 到达末帧时：只有 OUT 已就绪才切换；否则停留在末帧
  if (Math.round(frameIndex) >= frames.length - 1) {
    if (isSegmentReady(packIdx, 'out')) {
      state = 'OUT';
      frameIndex = 0;
    }
    // 否则什么也不做，保持显示最后一帧，避免黑屏
  }
}

function runOneShot(packIdx, segName, onDone) {
  const frames = framesCache[packIdx][segName];
  frameIndex = Math.min(frameIndex + 1.0, frames.length - 1);
  const img = frames[Math.round(frameIndex)];
  drawImageFit(img);
  if (Math.round(frameIndex) >= frames.length - 1) onDone && onDone();
}

// ------------------ Loading helpers ------------------

function drawLoading() {
  fill(255);
  textSize(16);
  const pct = expectedCount ? Math.floor(100 * loadedCount / expectedCount) : 0;
  text(`Loading… ${loadedCount}/${expectedCount} (${pct}%)`, width/2, height/2);
}

// ------------------ Utilities ------------------
function drawImageFit(img) {
  const s = Math.min((width*0.92)/img.width, (height*0.92)/img.height);
  image(img, width/2, height/2, img.width*s, img.height*s);
}

function drawHUD() {
  push();
  noStroke();
  fill(0,0,0,120);
  rect(0, height-64, width, 64);
  fill(255);
  textSize(14);
  const pack = packs[curPackIndex].name;
  text(`${pack} • ${state} • frame ~${Math.round(frameIndex)}`, width/2, height-32);
  pop();
}

function pickNextIndex(exclude) {
  if (!RANDOM_ORDER) return (exclude + 1) % packs.length;
  if (packs.length <= 1) return 0;
  let idx;
  do { idx = Math.floor(Math.random()*packs.length); }
  while (idx === exclude);
  return idx;
}

// 载入某主题的某段
function ensureLoaded(packIdx, segName) {
  if (framesCache[packIdx][segName]) return;
  const pack = packs[packIdx];
  const seg  = pack[segName];
  const arr = new Array(seg.count);
  framesCache[packIdx][segName] = arr;

  expectedCount += seg.count;
  for (let i = 1; i <= seg.count; i++) {
    const id = String(i).padStart(seg.pad, '0');
    const path = `${pack.base}${seg.dir}${seg.prefix}${id}.png`;
    loadImage(
      path,
      img => { arr[i - 1] = img; loadedCount++; },
      err => { console.warn('Fail load:', path, err); loadedCount++; arr[i - 1] = null; }
    );
  }
}

// 载入某主题的三段
function ensurePackAll(packIdx) {
  ensureLoaded(packIdx, 'in');
  ensureLoaded(packIdx, 'inter');
  ensureLoaded(packIdx, 'out');
}

// 判断某段是否就绪（允许个别失败帧，用计数）
function isSegmentReady(packIdx, segName) {
  const arr = framesCache[packIdx][segName];
  if (!arr) return false;
  const ok = arr.filter(Boolean).length;
  const need = packs[packIdx][segName].count;
  return ok === need;
}

// 判断主题三段是否都就绪
function isPackReady(packIdx) {
  return ['in','inter','out'].every(seg => isSegmentReady(packIdx, seg));
}

// 取第一帧（存在就返回）
function firstFrame(packIdx, segName) {
  const arr = framesCache[packIdx][segName];
  if (!arr) return null;
  return arr.find(Boolean) || null;
}

// ------------------ Input ------------------
function touchStarted(){ isTouching = true;  return false; }
function touchEnded(){   isTouching = false; return false; }
function mousePressed(){ isTouching = true; }
function mouseReleased(){ isTouching = false; }
function windowResized(){ resizeCanvas(windowWidth, windowHeight); }
