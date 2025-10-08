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
const FWD_SPEED = 0.5;   // 正放速度（每帧增量）
const BWD_SPEED = 0.8;   // 倒放速度
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
// ----------- Audio -----------
// 建议放到 /assets/sfx/ 里
let sfxIn, sfxOut, sfxPressLoop;
let audioReady = false;   // 是否已由用户手势解锁
// 记录当前是否在按压（用于音效）
let lastState = null;          // 记录上帧的状态


// ----------- Preload initial segments -----------
function preload() {
  framesCache = packs.map(() => ({ in:null, inter:null, out:null }));
  curPackIndex = 0;
  nextPackIndex = pickNextIndex(curPackIndex);

  // ✅ 初始就把 A(当前) 与 B(下一个) 的三段全载
  ensurePackAll(curPackIndex);     // A
  ensurePackAll(nextPackIndex);    // B
    // 预载音效
  if (typeof soundFormats === 'function') soundFormats('mp3','wav','ogg');

  if (typeof loadSound === 'function') {
    sfxIn        = loadSound('assets/sfx/in.mp3',        ()=>console.log('in loaded'),        e=>console.warn('in err',e));
    sfxOut       = loadSound('assets/sfx/explode.mp3',   ()=>console.log('explode loaded'),   e=>console.warn('explode err',e));
    sfxPressLoop = loadSound('assets/sfx/press_loop.mp3',()=>console.log('loop loaded'),      e=>console.warn('loop err',e));
  }
}

function onSfxLoaded(snd){ console.log('SFX loaded:', snd && snd.buffer ? snd.buffer.duration : '?'); }
function onSfxErr(err){ console.warn('SFX load error:', err); }

function setup() {
  createCanvas(windowWidth, windowHeight);
  if (typeof lockGestures === 'function') lockGestures();
  imageMode(CENTER);
  textAlign(CENTER, CENTER);
  frameRate(60);

   // 可选：设置初始音量
  if (sfxIn)  sfxIn.setVolume(0.6);
  if (sfxOut) sfxOut.setVolume(0.7);
  if (sfxPressLoop) sfxPressLoop.setVolume(0.35);
}

// 统一解锁函数
function unlockAudio(){
  if (typeof getAudioContext === 'function') {
    const ctx = getAudioContext();
    if (ctx && ctx.state !== 'running') {
      ctx.resume().then(()=>{ audioReady = true; console.log('Audio unlocked'); });
    } else { audioReady = true; }
  } else {
    // 没有 p5.sound 也不报错
    audioReady = true;
  }
}

//在现有输入事件中调用 unlockAudio()，并在 INTER 才启动/停止循环音：
function touchStarted(){ 
  unlockAudio(); 
  isTouching = true;  
  handlePressAudio();
  return false; 
}

function touchEnded(){   
  isTouching = false; 
  handleReleaseAudio();
  return false; 
}
function mousePressed(){ 
  unlockAudio(); 
  isTouching = true; 
  handlePressAudio();
}
function mouseReleased(){ 
  isTouching = false; 
  handleReleaseAudio();
}

function playInOnce() {
  if (sfxIn && audioReady) {
    // 避免短时间重复触发
    if (!sfxIn.isPlaying()) sfxIn.play();
  }
}

function playOutOnce() {
  if (sfxOut && audioReady) {
    sfxOut.stop(); // 防止上一次没播完
    sfxOut.play();
  }
}

function startPressLoop() {
  if (sfxPressLoop && audioReady) {
    if (!sfxPressLoop.isPlaying()) sfxPressLoop.loop(); // 循环
  }
}

function stopPressLoop() {
  if (sfxPressLoop) sfxPressLoop.stop();
}

// 只在 INTER 且按住时才有音乐
function handlePressAudio() {
  if (state === 'INTER') startPressLoop();
}
function handleReleaseAudio() {
  stopPressLoop();
}

// 切状态时的收尾
function stopAllOneShotIfNeeded() {
  // 一般不需要，这里保留接口
}

function draw() {
  background(255); // 纯白

  switch (state) {
    // ① 初次进入：等 A 与 B 都 ready，再开播 A 的 IN
    case 'HOLD_IN_INIT': {
      const img = firstFrame(curPackIndex, 'in');
      if (img) drawImageFit(img); else drawLoading(); // 有首帧就占位
        // 只有“音频已解锁 + A/B 两个主题都就绪”才进入 IN
      if (audioReady && isPackReady(curPackIndex) && isPackReady(nextPackIndex)) {
        playInOnce();     // ← 播放出现音效
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
      
      if (audioReady && isPackReady(curPackIndex) && isPackReady(nextPackIndex)) {
        playInOnce();     // ← 播放出现音效
        state = 'IN';
        frameIndex = 0;
      }
      // ---- state change hook: 统一处理进入某状态时该做的事 ----
      if (state !== lastState) {
        if (state === 'IN' && sfxIn?.isLoaded() && audioReady && !sfxIn.isPlaying()) {
          sfxIn.setVolume(0.6); sfxIn.play();
        }
        if (state === 'OUT' && sfxOut?.isLoaded() && audioReady) {
           handleReleaseAudio();           // 停掉按压循环
           sfxOut.stop(); sfxOut.setVolume(0.7); sfxOut.play();
        }
        lastState = state;
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
  if (isTouching && frameIndex >= frames.length - 15) {
    ensureLoaded(packIdx, 'out');
  }

  const img = frames[Math.round(frameIndex)];
  drawImageFit(img);

  // ✅ 到达末帧时：只有 OUT 已就绪才切换；否则停留在末帧
  if (Math.round(frameIndex) >= frames.length - 1) {
    // 到末帧：停止按压循环，播放爆炸
    stopPressLoop();
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

// ------------------ Input (safe version with audio) ------------------
function touchStarted(){
  // 解锁音频（若存在）
  if (typeof unlockAudio === 'function') { unlockAudio(); }
  isTouching = true;
  // 按压开始的音频（若存在）
  if (typeof handlePressAudio === 'function') { handlePressAudio(); }
  return false; // 阻止页面滚动
}

function touchEnded(){
  isTouching = false;
  // 按压结束的音频（若存在）
  if (typeof handleReleaseAudio === 'function') { handleReleaseAudio(); }
  return false;
}

function mousePressed(){
  if (typeof unlockAudio === 'function') { unlockAudio(); }
  isTouching = true;
  if (typeof handlePressAudio === 'function') { handlePressAudio(); }
}

function mouseReleased(){
  isTouching = false;
  if (typeof handleReleaseAudio === 'function') { handleReleaseAudio(); }
}

function windowResized(){ resizeCanvas(windowWidth, windowHeight); }


function handlePressAudio(){ if (state === 'INTER' && sfxPressLoop?.isLoaded() && audioReady && !sfxPressLoop.isPlaying()) { sfxPressLoop.setVolume(0.35); sfxPressLoop.loop(); } }
function handleReleaseAudio(){ if (sfxPressLoop?.isPlaying()) sfxPressLoop.stop(); }

function touchStarted(){ unlockAudio(); isTouching = true;  handlePressAudio(); return false; }
function touchEnded(){   isTouching = false; handleReleaseAudio(); return false; }
function mousePressed(){ unlockAudio(); isTouching = true;  handlePressAudio(); }
function mouseReleased(){ isTouching = false; handleReleaseAudio(); }
function windowResized(){ resizeCanvas(windowWidth, windowHeight); }