import { DEFAULT_WORDS } from './words.js';
import {
  initSupabase, cloudRegister, cloudLogin, cloudLogout, cloudCheckSession,
  cloudSyncDebounced, cloudSyncNow, isLoggedIn, getUserEmail, isCloudReady, getCloudError
} from './supabase.js';

// ==================== State ====================
let WORDS = [];
let wordStates = {};
let wrongWords = new Set();
let starredWords = new Set();
let game = {
  xp: 0, streak: 0, lastStudyDate: null, hearts: 5, level: 1,
  todayXP: 0, todayDate: null, achievements: {}
};

// Session state
let fcS = { index: 0, list: [], knownCount: 0, total: 0, shuffle: false, starredOnly: false, wrongOnly: false };
let qzS = { index: 0, total: 10, score: 0, questions: [], current: null };
let wrS = { index: 0, total: 10, score: 0, words: [] };
let mtS = { pairs: [], matched: 0, total: 6, startTime: 0, timerInt: null, firstSel: null, locked: false };

let fcSelectedUnit = 0;
let fcSessionSize = 15;
let qzSelectedUnit = 0;
let mtSelectedUnit = 0;
let wrSelectedUnit = 0;
let wwSelectedUnit = 0;
let wlFilter = 'all';
let authMode = 'login';

// Expose state for supabase module (avoids circular dependency)
window.__getAppState = () => ({ wordStates, wrongWords, starredWords, game, WORDS });
window.__saveLocal = saveLocal;

// ==================== Storage ====================
const WORDS_VERSION = 'v5_2452_etymology';

function saveLocal() {
  localStorage.setItem('pvm_words', JSON.stringify(WORDS));
  localStorage.setItem('pvm_states', JSON.stringify(wordStates));
  localStorage.setItem('pvm_wrong', JSON.stringify([...wrongWords]));
  localStorage.setItem('pvm_starred', JSON.stringify([...starredWords]));
  localStorage.setItem('pvm_game', JSON.stringify(game));
}

function save() {
  saveLocal();
  cloudSyncDebounced();
}

function loadLocal() {
  try {
    const cachedVersion = localStorage.getItem('pvm_words_ver') || '';
    const cachedWords = localStorage.getItem('pvm_words');
    if (cachedVersion !== WORDS_VERSION || !cachedWords) {
      WORDS = JSON.parse(JSON.stringify(DEFAULT_WORDS));
      localStorage.setItem('pvm_words', JSON.stringify(WORDS));
      localStorage.setItem('pvm_words_ver', WORDS_VERSION);
      wordStates = {};
      wrongWords = new Set();
      starredWords = new Set();
      localStorage.setItem('pvm_states', '{}');
      localStorage.setItem('pvm_wrong', '[]');
      localStorage.setItem('pvm_starred', '[]');
    } else {
      WORDS = JSON.parse(cachedWords);
      wordStates = JSON.parse(localStorage.getItem('pvm_states') || '{}');
      wrongWords = new Set(JSON.parse(localStorage.getItem('pvm_wrong') || '[]'));
      starredWords = new Set(JSON.parse(localStorage.getItem('pvm_starred') || '[]'));
    }
    const g = JSON.parse(localStorage.getItem('pvm_game') || 'null');
    if (g) game = g;
  } catch (e) {
    WORDS = JSON.parse(JSON.stringify(DEFAULT_WORDS));
  }
}

// ==================== Sound Effects ====================
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone(freq, duration, type = 'sine', vol = 0.15) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* ignore audio errors */ }
}
function sfxCorrect() { playTone(523, 0.1); setTimeout(() => playTone(659, 0.1), 80); setTimeout(() => playTone(784, 0.15), 160); }
function sfxWrong() { playTone(200, 0.15, 'sawtooth', 0.1); }
function sfxFlip() { playTone(400, 0.05, 'sine', 0.08); }
function sfxMatch() { playTone(659, 0.08); setTimeout(() => playTone(880, 0.12), 60); }
function sfxLevelUp() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.15), i * 100)); }
function sfxAchievement() { [659, 784, 988, 1319].forEach((f, i) => setTimeout(() => playTone(f, 0.12, 'triangle', 0.12), i * 80)); }

// ==================== Confetti ====================
function launchConfetti(count = 80) {
  const canvas = document.getElementById('confetti-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#58CC02', '#1CB0F6', '#FFC800', '#FF4B4B', '#8B5CF6', '#FF9600'];
  const particles = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: Math.random() * -15 - 5,
      g: 0.4,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360,
      vr: (Math.random() - 0.5) * 10,
      life: 1
    });
  }
  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(p => {
      if (p.life <= 0) return;
      alive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.g;
      p.rot += p.vr;
      p.life -= 0.008;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    frame++;
    if (alive && frame < 300) requestAnimationFrame(animate);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  animate();
}

// ==================== Gamification ====================
function todayStr() { return new Date().toISOString().slice(0, 10); }

function addXP(amount) {
  const oldLevel = game.level;
  game.xp += amount;
  const today = todayStr();
  if (game.todayDate !== today) { game.todayXP = 0; game.todayDate = today; }
  game.todayXP += amount;
  game.level = Math.floor(game.xp / 100) + 1;
  if (game.lastStudyDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    game.streak = game.lastStudyDate === yesterday ? game.streak + 1 : 1;
    game.lastStudyDate = today;
  }
  save();
  if (amount > 0) {
    const el = document.createElement('div');
    el.className = 'xp-float';
    el.textContent = '+' + amount + ' XP';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }
  if (game.level > oldLevel) {
    sfxLevelUp();
    launchConfetti(120);
    document.getElementById('levelup-text').textContent = '恭喜达到等级 ' + game.level + '！';
    document.getElementById('levelup-modal').classList.remove('hidden');
  }
  updateNav();
  checkAchievements();
}

function getLevelProg() {
  const cur = game.xp - (game.level - 1) * 100;
  return { cur, next: 100, pct: Math.min(100, cur) };
}

// ==================== Achievements ====================
const ACHIEVEMENTS = [
  { id: 'first10', icon: '🌱', name: '初出茅庐', desc: '掌握10个单词', check: () => countState('known') >= 10, prog: () => Math.min(1, countState('known') / 10) },
  { id: 'first50', icon: '🌿', name: '小有所成', desc: '掌握50个单词', check: () => countState('known') >= 50, prog: () => Math.min(1, countState('known') / 50) },
  { id: 'first100', icon: '🌳', name: '词汇大师', desc: '掌握100个单词', check: () => countState('known') >= 100, prog: () => Math.min(1, countState('known') / 100) },
  { id: 'streak7', icon: '🔥', name: '坚持一周', desc: '连续打卡7天', check: () => game.streak >= 7, prog: () => Math.min(1, game.streak / 7) },
  { id: 'streak30', icon: '💎', name: '月度达人', desc: '连续打卡30天', check: () => game.streak >= 30, prog: () => Math.min(1, game.streak / 30) },
  { id: 'quiz10', icon: '🎯', name: '满分通关', desc: '测验10题全对', check: () => game.achievements.quiz10, prog: () => game.achievements.quiz10 ? 1 : 0 },
  { id: 'match30', icon: '⚡', name: '闪电配对', desc: '30秒内完成配对', check: () => game.achievements.match30, prog: () => game.achievements.match30 ? 1 : 0 },
  { id: 'dailyGoal', icon: '⭐', name: '每日目标', desc: '单日获得50XP', check: () => game.todayXP >= 50, prog: () => Math.min(1, game.todayXP / 50) },
  { id: 'allKnown', icon: '👑', name: '全部掌握', desc: '掌握所有单词', check: () => countState('known') >= WORDS.length, prog: () => Math.min(1, countState('known') / Math.max(1, WORDS.length)) },
  { id: 'level5', icon: '🏆', name: '等级5', desc: '达到等级5', check: () => game.level >= 5, prog: () => Math.min(1, game.level / 5) },
];

function checkAchievements() {
  ACHIEVEMENTS.forEach(a => {
    if (!game.achievements[a.id] && a.check()) {
      game.achievements[a.id] = true;
      save();
      sfxAchievement();
      showToast('🏆 解锁成就：' + a.name + '！');
      launchConfetti(60);
    }
  });
}

function countState(state) { return WORDS.filter(w => wordStates[w.w] === state).length; }

// ==================== Navigation ====================
const TAB_MAP = { home: '首页', flashcard: '闪卡', quiz: '测验', match: '配对', write: '拼写', wrong: '错词', words: '词表', achievements: '成就' };

function goPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const target = document.getElementById('page-' + name);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('.nt').forEach(t => {
    t.classList.toggle('active', t.textContent.includes(TAB_MAP[name]));
  });
  window.scrollTo(0, 0);
  if (name === 'home') updateHome();
  if (name === 'flashcard') resetFlashcard();
  if (name === 'quiz') resetQuiz();
  if (name === 'match') resetMatch();
  if (name === 'write') resetWrite();
  if (name === 'wrong') renderWrongWords();
  if (name === 'words') resetWordList();
  if (name === 'achievements') renderAchievements();
}

// Expose goPage globally for onclick handlers
window.goPage = goPage;

// ==================== TTS ====================
function speak(word) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'en-US';
  u.rate = 0.8;
  speechSynthesis.speak(u);
}

// ==================== Toast ====================
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ==================== Home ====================
function updateNav() {
  document.getElementById('nav-streak').textContent = game.streak;
  document.getElementById('nav-xp').textContent = game.xp;
  document.getElementById('nav-hearts').textContent = game.hearts;
}

function updateHome() {
  const total = WORDS.length;
  const known = countState('known');
  const learning = countState('learning');
  document.getElementById('s-total').textContent = total;
  document.getElementById('s-known').textContent = known;
  document.getElementById('s-learning').textContent = learning;
  document.getElementById('s-wrong').textContent = wrongWords.size;
  document.getElementById('wl-badge').textContent = total + ' 词';
  document.getElementById('ww-badge').textContent = wrongWords.size + ' 词';
  document.getElementById('star-fc').style.opacity = starredWords.size > 0 ? '1' : '0.3';
  document.getElementById('star-ww').style.opacity = wrongWords.size > 0 ? '1' : '0.3';

  document.getElementById('s-level').textContent = game.level;
  const lp = getLevelProg();
  document.getElementById('s-xp-cur').textContent = lp.cur;
  document.getElementById('s-xp-next').textContent = lp.next;
  document.getElementById('s-level-fill').style.width = lp.pct + '%';

  const todayXP = game.todayXP || 0;
  const goalPct = Math.min(1, todayXP / 50);
  document.getElementById('goal-xp').textContent = todayXP;
  const circumference = 2 * Math.PI * 42;
  document.getElementById('goal-ring-fg').style.strokeDashoffset = circumference * (1 - goalPct);
  if (goalPct >= 1) document.getElementById('goal-ring-fg').setAttribute('stroke', '#FFC800');

  const row = document.getElementById('streak-row');
  row.innerHTML = '';
  const days = ['一', '二', '三', '四', '五', '六', '日'];
  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  for (let i = 0; i < 7; i++) {
    const dot = document.createElement('div');
    dot.className = 'streak-dot ' + (i <= todayIdx && game.streak > 0 ? 'on' : 'off');
    dot.textContent = days[i];
    row.appendChild(dot);
  }
  updateNav();
  checkAchievements();
}

// ==================== UNIT Helpers ====================
function getUnitPool(selectedUnit) {
  return selectedUnit > 0 ? WORDS.filter(w => w.unit === selectedUnit) : [...WORDS];
}

function renderUnitChips(rowId, infoId, selectedUnit, onSelectFn) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const units = [...new Set(WORDS.map(w => w.unit || 1))].sort((a, b) => a - b);
  let html = '<span class="fc-unit-chip all' + (selectedUnit === 0 ? ' on' : '') + '" onclick="' + onSelectFn + '(0)">全部</span>';
  units.forEach(u => {
    const count = WORDS.filter(w => w.unit === u).length;
    html += '<span class="fc-unit-chip' + (selectedUnit === u ? ' on' : '') + '" onclick="' + onSelectFn + '(' + u + ')">U' + u + '<span style="opacity:.5;font-size:10px">(' + count + ')</span></span>';
  });
  row.innerHTML = html;
  const info = document.getElementById(infoId);
  if (info) {
    info.textContent = selectedUnit === 0
      ? '已选择：全部 UNIT（共 ' + WORDS.length + ' 词）'
      : 'UNIT ' + selectedUnit + '：' + WORDS.filter(w => w.unit === selectedUnit).length + ' 词';
  }
}

// Expose select functions globally
function selectQzUnit(u) { qzSelectedUnit = u; renderUnitChips('qz-unit-row', 'qz-unit-info', qzSelectedUnit, 'selectQzUnit'); }
function selectMtUnit(u) { mtSelectedUnit = u; renderUnitChips('mt-unit-row', 'mt-unit-info', mtSelectedUnit, 'selectMtUnit'); }
function selectWrUnit(u) { wrSelectedUnit = u; renderUnitChips('wr-unit-row', 'wr-unit-info', wrSelectedUnit, 'selectWrUnit'); }
window.selectQzUnit = selectQzUnit;
window.selectMtUnit = selectMtUnit;
window.selectWrUnit = selectWrUnit;

// ==================== Flashcard ====================
function resetFlashcard() {
  document.getElementById('fc-start').classList.remove('hidden');
  document.getElementById('fc-play').classList.add('hidden');
  document.getElementById('fc-done').classList.add('hidden');
  renderFcUnitSelector();
  renderFcSizeSelector();
}

function renderFcUnitSelector() {
  const row = document.getElementById('fc-unit-row');
  if (!row) return;
  const units = [...new Set(WORDS.map(w => w.unit || 1))].sort((a, b) => a - b);
  let html = '<span class="fc-unit-chip all' + (fcSelectedUnit === 0 ? ' on' : '') + '" onclick="selectFcUnit(0)">全部</span>';
  units.forEach(u => {
    const count = WORDS.filter(w => w.unit === u).length;
    html += '<span class="fc-unit-chip' + (fcSelectedUnit === u ? ' on' : '') + '" onclick="selectFcUnit(' + u + ')">U' + u + '<span style="opacity:.5;font-size:10px">(' + count + ')</span></span>';
  });
  row.innerHTML = html;
  const info = document.getElementById('fc-unit-info');
  if (info) {
    if (fcSelectedUnit === 0) {
      info.textContent = '已选择：全部 UNIT（共 ' + WORDS.length + ' 词）';
    } else {
      const cnt = WORDS.filter(w => w.unit === fcSelectedUnit).length;
      const known = WORDS.filter(w => w.unit === fcSelectedUnit && wordStates[w.w] === 'known').length;
      info.textContent = 'UNIT ' + fcSelectedUnit + '：' + cnt + ' 词，已掌握 ' + known + ' 词';
    }
  }
}

function selectFcUnit(u) { fcSelectedUnit = u; renderFcUnitSelector(); }
window.selectFcUnit = selectFcUnit;

function renderFcSizeSelector() {
  const row = document.getElementById('fc-size-row');
  if (!row) return;
  const sizes = [10, 15, 20, 30, 50];
  let html = '';
  sizes.forEach(s => {
    html += '<span class="fc-size-chip' + (fcSessionSize === s ? ' on' : '') + '" onclick="selectFcSize(' + s + ')">' + s + ' 词</span>';
  });
  row.innerHTML = html;
}

function selectFcSize(s) { fcSessionSize = s; renderFcSizeSelector(); }
window.selectFcSize = selectFcSize;

function toggleShuffle(el) { fcS.shuffle = !fcS.shuffle; el.classList.toggle('on', fcS.shuffle); }
function toggleStarredOnly(el) {
  fcS.starredOnly = !fcS.starredOnly;
  el.classList.toggle('on', fcS.starredOnly);
  fcS.wrongOnly = false;
  document.getElementById('fc-opt-wrong').classList.remove('on');
}
function toggleWrongOnly(el) {
  fcS.wrongOnly = !fcS.wrongOnly;
  el.classList.toggle('on', fcS.wrongOnly);
  fcS.starredOnly = false;
  document.getElementById('fc-opt-starred').classList.remove('on');
}
window.toggleShuffle = toggleShuffle;
window.toggleStarredOnly = toggleStarredOnly;
window.toggleWrongOnly = toggleWrongOnly;

function startFlashcard() {
  let pool;
  let unitPool = fcSelectedUnit > 0 ? WORDS.filter(w => w.unit === fcSelectedUnit) : WORDS;
  if (fcS.starredOnly) pool = unitPool.filter(w => starredWords.has(w.w));
  else if (fcS.wrongOnly) pool = [...wrongWords].map(ww => WORDS.find(w => w.w === ww)).filter(Boolean).filter(w => fcSelectedUnit === 0 || w.unit === fcSelectedUnit);
  else pool = unitPool.filter(w => wordStates[w.w] !== 'known');
  if (pool.length === 0) pool = [...unitPool];
  pool.sort(() => Math.random() - 0.5);
  fcS.list = pool.slice(0, Math.min(fcSessionSize, pool.length));
  fcS.index = 0;
  fcS.knownCount = 0;
  fcS.total = fcS.list.length;
  document.getElementById('fc-start').classList.add('hidden');
  document.getElementById('fc-done').classList.add('hidden');
  document.getElementById('fc-play').classList.remove('hidden');
  showFlashcard();
}

function getFcWord() { return document.getElementById('fc-word').textContent; }

function showFlashcard() {
  if (fcS.index >= fcS.total) return finishFlashcard();
  const w = fcS.list[fcS.index];
  const card = document.getElementById('fc-card');
  card.classList.remove('flipped', 'swipe-left', 'swipe-right');
  document.getElementById('fc-word').textContent = w.w;
  document.getElementById('fc-phon').textContent = w.p;
  document.getElementById('fc-meaning').textContent = w.m;
  document.getElementById('fc-pos').textContent = w.pos;
  document.getElementById('fc-example').textContent = w.e;
  document.getElementById('fc-root').textContent = w.root || '—';
  document.getElementById('fc-mn').textContent = w.mn || '—';
  document.getElementById('fc-count').textContent = (fcS.index + 1) + '/' + fcS.total;
  document.getElementById('fc-fill').style.width = (fcS.index / fcS.total * 100) + '%';
  document.getElementById('fc-unit-badge').textContent = w.unit ? 'UNIT ' + w.unit : '';
  const star = document.getElementById('fc-star');
  star.classList.toggle('on', starredWords.has(w.w));
  setTimeout(() => speak(w.w), 300);
}

function flipCard() {
  const card = document.getElementById('fc-card');
  card.classList.toggle('flipped');
  sfxFlip();
}

function toggleStar() {
  const w = fcS.list[fcS.index];
  if (starredWords.has(w.w)) { starredWords.delete(w.w); showToast('已取消星标'); }
  else { starredWords.add(w.w); showToast('⭐ 已加星标'); }
  save();
  document.getElementById('fc-star').classList.toggle('on', starredWords.has(w.w));
}

function markFlashcard(known) {
  const w = fcS.list[fcS.index];
  const card = document.getElementById('fc-card');
  if (known) {
    wordStates[w.w] = 'known';
    fcS.knownCount++;
    addXP(5);
    wrongWords.delete(w.w);
    sfxCorrect();
    card.classList.add('swipe-right');
  } else {
    wordStates[w.w] = 'learning';
    wrongWords.add(w.w);
    sfxWrong();
    card.classList.add('swipe-left');
  }
  save();
  fcS.index++;
  setTimeout(showFlashcard, 300);
}

function skipCard() { fcS.index++; showFlashcard(); }

function finishFlashcard() {
  document.getElementById('fc-play').classList.add('hidden');
  document.getElementById('fc-done').classList.remove('hidden');
  document.getElementById('fc-done-count').textContent = fcS.total;
  document.getElementById('fc-done-known').textContent = fcS.knownCount;
  updateHome();
}

// Expose flashcard functions globally
window.resetFlashcard = resetFlashcard;
window.startFlashcard = startFlashcard;
window.getFcWord = getFcWord;
window.flipCard = flipCard;
window.toggleStar = toggleStar;
window.markFlashcard = markFlashcard;
window.skipCard = skipCard;
window.speak = speak;

// Swipe support
let touchStartX = 0, touchEndX = 0;
document.addEventListener('touchstart', e => {
  if (document.getElementById('page-flashcard').classList.contains('hidden')) return;
  if (document.getElementById('fc-play').classList.contains('hidden')) return;
  touchStartX = e.changedTouches[0].screenX;
}, { passive: true });
document.addEventListener('touchend', e => {
  if (document.getElementById('page-flashcard').classList.contains('hidden')) return;
  if (document.getElementById('fc-play').classList.contains('hidden')) return;
  touchEndX = e.changedTouches[0].screenX;
  const diff = touchEndX - touchStartX;
  if (Math.abs(diff) < 60) return;
  if (diff > 0) markFlashcard(true);
  else markFlashcard(false);
}, { passive: true });

// ==================== Quiz ====================
function resetQuiz() {
  document.getElementById('qz-start').classList.remove('hidden');
  document.getElementById('qz-play').classList.add('hidden');
  document.getElementById('qz-done').classList.add('hidden');
  renderUnitChips('qz-unit-row', 'qz-unit-info', qzSelectedUnit, 'selectQzUnit');
}

function renderHearts() {
  const el = document.getElementById('qz-hearts');
  el.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const h = document.createElement('span');
    h.className = 'h' + (i >= game.hearts ? ' lost' : '');
    h.textContent = '❤️';
    el.appendChild(h);
  }
}

function startQuiz() {
  qzS.index = 0; qzS.score = 0;
  const unitPool = getUnitPool(qzSelectedUnit);
  qzS.total = Math.min(10, unitPool.length);
  qzS.questions = [];
  const pool = [...unitPool].sort(() => Math.random() - 0.5).slice(0, qzS.total);
  pool.forEach(w => {
    qzS.questions.push({ word: w, type: Math.random() < 0.6 ? 'choice' : 'dict', answered: false, correct: false });
  });
  document.getElementById('qz-start').classList.add('hidden');
  document.getElementById('qz-done').classList.add('hidden');
  document.getElementById('qz-play').classList.remove('hidden');
  renderHearts();
  showQuestion();
}

function showQuestion() {
  if (qzS.index >= qzS.total) return finishQuiz();
  const q = qzS.questions[qzS.index];
  document.getElementById('qz-count').textContent = (qzS.index + 1) + '/' + qzS.total;
  document.getElementById('qz-score-display').textContent = '⭐ ' + qzS.score;
  document.getElementById('qz-fill').style.width = (qzS.index / qzS.total * 100) + '%';
  document.getElementById('qz-feedback').classList.add('hidden');
  document.getElementById('qz-next-btn').classList.add('hidden');
  renderHearts();

  if (q.type === 'choice') {
    document.getElementById('qz-choice').classList.remove('hidden');
    document.getElementById('qz-dict').classList.add('hidden');
    document.getElementById('qz-word').textContent = q.word.w;
    const correct = q.word.m;
    const wrongs = getUnitPool(qzSelectedUnit).filter(w => w.w !== q.word.w).sort(() => Math.random() - 0.5).slice(0, 3).map(w => w.m);
    const options = [correct, ...wrongs].sort(() => Math.random() - 0.5);
    const labels = ['A', 'B', 'C', 'D'];
    const c = document.getElementById('qz-options');
    c.innerHTML = '';
    options.forEach((opt, i) => {
      const d = document.createElement('div');
      d.className = 'qz-option';
      d.innerHTML = '<div class="qz-opt-lbl">' + labels[i] + '</div><span>' + opt + '</span>';
      d.onclick = () => answerChoice(d, opt, correct, q.word);
      c.appendChild(d);
    });
  } else {
    document.getElementById('qz-dict').classList.remove('hidden');
    document.getElementById('qz-choice').classList.add('hidden');
    document.getElementById('qz-dict-answer').textContent = q.word.w;
    document.getElementById('qz-dict-input').value = '';
    document.getElementById('qz-dict-input').classList.remove('ok', 'no');
    document.getElementById('qz-dict-feedback').classList.add('hidden');
    document.getElementById('qz-dict-next').classList.add('hidden');
    document.getElementById('qz-dict-submit').classList.remove('hidden');
    setTimeout(() => speak(q.word.w), 300);
  }
}

function answerChoice(el, selected, correct, word) {
  const opts = document.querySelectorAll('#qz-options .qz-option');
  opts.forEach(o => o.classList.add('disabled'));
  const ok = selected === correct;
  const q = qzS.questions[qzS.index];
  q.answered = true;
  q.correct = ok;
  if (ok) {
    el.classList.add('correct');
    qzS.score++;
    addXP(10);
    sfxCorrect();
    wordStates[word.w] = wordStates[word.w] === 'known' ? 'known' : 'learning';
    wrongWords.delete(word.w);
  } else {
    el.classList.add('wrong');
    opts.forEach(o => { if (o.querySelector('span').textContent === correct) o.classList.add('correct'); });
    wrongWords.add(word.w);
    wordStates[word.w] = 'learning';
    game.hearts = Math.max(0, game.hearts - 1);
    sfxWrong();
  }
  save();
  const fb = document.getElementById('qz-feedback');
  fb.className = 'qz-feedback ' + (ok ? 'ok' : 'no');
  fb.innerHTML = (ok ? '✅ 正确！' : '❌ 正确答案：' + correct) +
    '<div class="fb-ex">' + word.w + ' — ' + word.m + ' (' + word.pos + ')</div>' +
    '<div class="fb-ex">例句：' + word.e + '</div>';
  fb.classList.remove('hidden');
  document.getElementById('qz-next-btn').classList.remove('hidden');
  renderHearts();
  updateNav();
}

function submitDict() {
  const q = qzS.questions[qzS.index];
  const input = document.getElementById('qz-dict-input');
  const ans = input.value.trim().toLowerCase();
  const correct = q.word.w.toLowerCase();
  q.answered = true;
  q.correct = (ans === correct);
  if (q.correct) {
    input.classList.add('ok');
    qzS.score++;
    addXP(10);
    sfxCorrect();
    wrongWords.delete(q.word.w);
    wordStates[q.word.w] = wordStates[q.word.w] === 'known' ? 'known' : 'learning';
  } else {
    input.classList.add('no');
    wrongWords.add(q.word.w);
    wordStates[q.word.w] = 'learning';
    game.hearts = Math.max(0, game.hearts - 1);
    sfxWrong();
  }
  save();
  const fb = document.getElementById('qz-dict-feedback');
  fb.className = 'qz-feedback ' + (q.correct ? 'ok' : 'no');
  fb.innerHTML = (q.correct ? '✅ 正确！' : '❌ 正确答案：' + q.word.w) +
    '<div class="fb-ex">' + q.word.m + ' (' + q.word.pos + ')</div>' +
    '<div class="fb-ex">例句：' + q.word.e + '</div>';
  fb.classList.remove('hidden');
  document.getElementById('qz-dict-submit').classList.add('hidden');
  document.getElementById('qz-dict-next').classList.remove('hidden');
  renderHearts();
  updateNav();
}

function nextQuestion() { qzS.index++; showQuestion(); }

function finishQuiz() {
  document.getElementById('qz-play').classList.add('hidden');
  document.getElementById('qz-done').classList.remove('hidden');
  const score = qzS.score, total = qzS.total;
  document.getElementById('qz-done-score').textContent = score + '/' + total;
  const pct = score / total;
  let emoji, title, label;
  if (pct >= 0.9) { emoji = '🏆'; title = '太棒了！'; label = '你已经是单词大师了！'; }
  else if (pct >= 0.7) { emoji = '🎉'; title = '做得不错！'; label = '继续努力！'; }
  else if (pct >= 0.5) { emoji = '💪'; title = '加油！'; label = '多复习错词本！'; }
  else { emoji = '📚'; title = '需要努力'; label = '先用闪卡学习吧！'; }
  document.getElementById('qz-done-emoji').textContent = emoji;
  document.getElementById('qz-done-title').textContent = title;
  document.getElementById('qz-done-label').textContent = label;
  if (score === total) { game.achievements.quiz10 = true; save(); launchConfetti(100); }
  updateHome();
}

// Expose quiz functions globally
window.resetQuiz = resetQuiz;
window.startQuiz = startQuiz;
window.submitDict = submitDict;
window.nextQuestion = nextQuestion;

// ==================== Write Mode ====================
function resetWrite() {
  document.getElementById('wr-start').classList.remove('hidden');
  document.getElementById('wr-play').classList.add('hidden');
  document.getElementById('wr-done').classList.add('hidden');
  renderUnitChips('wr-unit-row', 'wr-unit-info', wrSelectedUnit, 'selectWrUnit');
}

function startWrite() {
  wrS.index = 0; wrS.score = 0;
  const unitPool = getUnitPool(wrSelectedUnit);
  wrS.total = Math.min(10, unitPool.length);
  const pool = unitPool.filter(w => wordStates[w.w] !== 'known');
  const finalPool = pool.length >= wrS.total ? pool : [...unitPool];
  wrS.words = [...finalPool].sort(() => Math.random() - 0.5).slice(0, wrS.total);
  document.getElementById('wr-start').classList.add('hidden');
  document.getElementById('wr-done').classList.add('hidden');
  document.getElementById('wr-play').classList.remove('hidden');
  showWrite();
}

function showWrite() {
  if (wrS.index >= wrS.total) return finishWrite();
  const w = wrS.words[wrS.index];
  document.getElementById('wr-count').textContent = (wrS.index + 1) + '/' + wrS.total;
  document.getElementById('wr-score-display').textContent = '⭐ ' + wrS.score;
  document.getElementById('wr-fill').style.width = (wrS.index / wrS.total * 100) + '%';
  document.getElementById('wr-cn').textContent = w.m;
  document.getElementById('wr-pos').textContent = w.pos;
  document.getElementById('wr-input').value = '';
  document.getElementById('wr-input').classList.remove('ok', 'no');
  document.getElementById('wr-feedback').classList.add('hidden');
  document.getElementById('wr-submit').classList.remove('hidden');
  document.getElementById('wr-next').classList.add('hidden');
  document.getElementById('wr-input').focus();
}

function submitWrite() {
  const w = wrS.words[wrS.index];
  const input = document.getElementById('wr-input');
  const ans = input.value.trim().toLowerCase();
  const correct = w.w.toLowerCase();
  const ok = ans === correct;
  if (ok) {
    input.classList.add('ok');
    wrS.score++;
    addXP(10);
    sfxCorrect();
    wrongWords.delete(w.w);
    wordStates[w.w] = wordStates[w.w] === 'known' ? 'known' : 'learning';
  } else {
    input.classList.add('no');
    wrongWords.add(w.w);
    wordStates[w.w] = 'learning';
    game.hearts = Math.max(0, game.hearts - 1);
    sfxWrong();
  }
  save();
  const fb = document.getElementById('wr-feedback');
  fb.className = 'qz-feedback ' + (ok ? 'ok' : 'no');
  fb.innerHTML = (ok ? '✅ 正确！' : '❌ 正确答案：' + w.w) +
    '<div class="fb-ex">' + w.m + ' (' + w.pos + ')</div>' +
    '<div class="fb-ex">' + w.p + ' — 例句：' + w.e + '</div>';
  fb.classList.remove('hidden');
  document.getElementById('wr-submit').classList.add('hidden');
  document.getElementById('wr-next').classList.remove('hidden');
  updateNav();
}

function nextWrite() { wrS.index++; showWrite(); }

function finishWrite() {
  document.getElementById('wr-play').classList.add('hidden');
  document.getElementById('wr-done').classList.remove('hidden');
  document.getElementById('wr-done-score').textContent = wrS.score + '/' + wrS.total;
  const pct = wrS.score / wrS.total;
  let emoji, title, label;
  if (pct >= 0.9) { emoji = '🏆'; title = '拼写大师！'; label = '记忆力超群！'; }
  else if (pct >= 0.7) { emoji = '🎉'; title = '做得不错！'; label = '继续加油！'; }
  else if (pct >= 0.5) { emoji = '💪'; title = '还需练习'; label = '多用闪卡学习！'; }
  else { emoji = '📚'; title = '继续努力'; label = '先复习再挑战！'; }
  document.getElementById('wr-done-emoji').textContent = emoji;
  document.getElementById('wr-done-title').textContent = title;
  document.getElementById('wr-done-label').textContent = label;
  updateHome();
}

window.resetWrite = resetWrite;
window.startWrite = startWrite;
window.submitWrite = submitWrite;
window.nextWrite = nextWrite;

// ==================== Match Game ====================
function resetMatch() {
  document.getElementById('mt-start').classList.remove('hidden');
  document.getElementById('mt-play').classList.add('hidden');
  document.getElementById('mt-done').classList.add('hidden');
  renderUnitChips('mt-unit-row', 'mt-unit-info', mtSelectedUnit, 'selectMtUnit');
}

function startMatch() {
  const unitPool = getUnitPool(mtSelectedUnit);
  const pool = [...unitPool].sort(() => Math.random() - 0.5).slice(0, 6);
  mtS.pairs = [];
  pool.forEach(w => {
    mtS.pairs.push({ id: w.w, text: w.w, type: 'en', word: w });
    mtS.pairs.push({ id: w.w, text: w.m, type: 'cn', word: w });
  });
  mtS.pairs.sort(() => Math.random() - 0.5);
  mtS.matched = 0;
  mtS.total = 6;
  mtS.firstSel = null;
  mtS.locked = false;
  mtS.startTime = Date.now();
  if (mtS.timerInt) clearInterval(mtS.timerInt);
  mtS.timerInt = setInterval(() => {
    const sec = Math.floor((Date.now() - mtS.startTime) / 1000);
    document.getElementById('mt-timer').textContent = '⏱ ' + sec + 's';
  }, 200);
  document.getElementById('mt-start').classList.add('hidden');
  document.getElementById('mt-done').classList.add('hidden');
  document.getElementById('mt-play').classList.remove('hidden');
  document.getElementById('mt-count').textContent = '0/' + mtS.total;
  document.getElementById('mt-fill').style.width = '0%';

  const grid = document.getElementById('mt-grid');
  grid.innerHTML = '';
  mtS.pairs.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'match-card ' + (p.type === 'en' ? 'left' : 'right');
    card.textContent = p.text;
    card.dataset.idx = i;
    card.onclick = () => selectMatchCard(i, card);
    grid.appendChild(card);
  });
}

function selectMatchCard(idx, el) {
  if (mtS.locked) return;
  if (el.classList.contains('matched')) return;
  if (el.classList.contains('selected')) { el.classList.remove('selected'); mtS.firstSel = null; return; }

  if (!mtS.firstSel) {
    mtS.firstSel = { idx, el };
    el.classList.add('selected');
    return;
  }
  const first = mtS.firstSel;
  const firstP = mtS.pairs[first.idx];
  const secondP = mtS.pairs[idx];
  mtS.locked = true;

  if (firstP.id === secondP.id && firstP.type !== secondP.type) {
    setTimeout(() => {
      first.el.classList.remove('selected');
      first.el.classList.add('matched');
      el.classList.add('matched');
      sfxMatch();
      mtS.matched++;
      document.getElementById('mt-count').textContent = mtS.matched + '/' + mtS.total;
      document.getElementById('mt-fill').style.width = (mtS.matched / mtS.total * 100) + '%';
      mtS.firstSel = null;
      mtS.locked = false;
      if (mtS.matched >= mtS.total) finishMatch();
    }, 200);
  } else {
    el.classList.add('selected', 'wrong');
    first.el.classList.add('wrong');
    sfxWrong();
    setTimeout(() => {
      el.classList.remove('selected', 'wrong');
      first.el.classList.remove('selected', 'wrong');
      mtS.firstSel = null;
      mtS.locked = false;
    }, 600);
  }
}

function finishMatch() {
  clearInterval(mtS.timerInt);
  const sec = Math.floor((Date.now() - mtS.startTime) / 1000);
  let xp = 15;
  if (sec < 30) { xp = 30; game.achievements.match30 = true; save(); }
  else if (sec < 60) xp = 20;
  addXP(xp);
  launchConfetti(80);
  document.getElementById('mt-play').classList.add('hidden');
  document.getElementById('mt-done').classList.remove('hidden');
  document.getElementById('mt-done-time').textContent = sec;
  document.getElementById('mt-done-xp').textContent = '+' + xp + ' XP';
  let emoji, title;
  if (sec < 30) { emoji = '⚡'; title = '闪电速度！'; }
  else if (sec < 60) { emoji = '🎉'; title = '配对完成！'; }
  else { emoji = '✅'; title = '完成了！'; }
  document.getElementById('mt-done-emoji').textContent = emoji;
  document.getElementById('mt-done-title').textContent = title;
  updateHome();
}

window.resetMatch = resetMatch;
window.startMatch = startMatch;

// ==================== Wrong Words ====================
function onWwUnitChange() {
  wwSelectedUnit = parseInt(document.getElementById('ww-unit-select').value) || 0;
  const tag = document.getElementById('ww-unit-tag');
  if (wwSelectedUnit > 0) { tag.style.display = ''; tag.textContent = 'UNIT ' + wwSelectedUnit; }
  else { tag.style.display = 'none'; }
  renderWrongWords();
}
window.onWwUnitChange = onWwUnitChange;

function populateWwUnitSelect() {
  const sel = document.getElementById('ww-unit-select');
  if (!sel) return;
  const wrongWordObjs = [...wrongWords].map(w => WORDS.find(x => x.w === w)).filter(Boolean);
  const units = [...new Set(wrongWordObjs.map(w => w.unit || 1))].sort((a, b) => a - b);
  let html = '<option value="0">全部 UNIT</option>';
  units.forEach(u => {
    const cnt = wrongWordObjs.filter(w => (w.unit || 1) === u).length;
    html += '<option value="' + u + '"' + (wwSelectedUnit === u ? ' selected' : '') + '>UNIT ' + u + ' (' + cnt + ' 错词)</option>';
  });
  sel.innerHTML = html;
}

function renderWrongWords() {
  populateWwUnitSelect();
  const search = (document.getElementById('ww-search')?.value || '').toLowerCase();
  let list = [...wrongWords].map(w => WORDS.find(x => x.w === w)).filter(Boolean);
  if (wwSelectedUnit > 0) list = list.filter(w => (w.unit || 1) === wwSelectedUnit);
  const filtered = search ? list.filter(w => w.w.toLowerCase().includes(search) || w.m.includes(search)) : list;
  document.getElementById('ww-count').textContent = filtered.length;
  const c = document.getElementById('ww-list');
  if (filtered.length === 0) {
    c.innerHTML = '<div class="ww-empty"><div class="emoji">🎉</div><p>' +
      (wwSelectedUnit > 0 ? '该 UNIT 错词本为空！继续保持！' : '错词本为空！继续保持！') + '</p></div>';
    return;
  }
  c.innerHTML = '';
  filtered.forEach(w => {
    const d = document.createElement('div');
    d.className = 'ww-item';
    d.innerHTML = '<div class="ww-word">' +
      '<div><span class="we">' + w.w + '</span>' +
      (w.unit ? '<span class="ww-unit-tag">UNIT ' + w.unit + '</span>' : '') +
      '<span class="wp">' + w.p + '</span> ' +
      '<span style="cursor:pointer" onclick="window.speak(\'' + w.w.replace(/'/g, "\\'") + '\')">🔊</span></div>' +
      '<div class="wc">' + w.m + ' (' + w.pos + ')</div>' +
      (w.root ? '<div class="ww-root">🔍 ' + w.root + '</div>' : '') +
      (w.mn ? '<div class="ww-mn">💡 ' + w.mn + '</div>' : '') +
      '<div class="wx">' + w.e + '</div></div>' +
      '<div class="ww-actions">' +
      '<button class="b-ok" title="标记已掌握" onclick="window.masterWord(\'' + w.w.replace(/'/g, "\\'") + '\')">✅</button>' +
      '<button class="b-del" title="移出错词本" onclick="window.removeWrong(\'' + w.w.replace(/'/g, "\\'") + '\')">🗑️</button></div>';
    c.appendChild(d);
  });
}
window.renderWrongWords = renderWrongWords;

function masterWord(word) {
  wordStates[word] = 'known';
  wrongWords.delete(word);
  save();
  renderWrongWords();
  showToast('🎉 已掌握！');
  sfxCorrect();
  updateHome();
}
window.masterWord = masterWord;

function removeWrong(word) {
  wrongWords.delete(word);
  save();
  renderWrongWords();
  showToast('已移出错词本');
  updateHome();
}
window.removeWrong = removeWrong;

// ==================== Word List ====================
function resetWordList() {
  const sel = document.getElementById('wl-unit-select');
  if (sel) {
    const units = [...new Set(WORDS.map(w => w.unit || 1))].sort((a, b) => a - b);
    let html = '<option value="0">全部 UNIT</option>';
    units.forEach(u => {
      const count = WORDS.filter(w => w.unit === u).length;
      html += '<option value="' + u + '">UNIT ' + u + ' (' + count + '词)</option>';
    });
    sel.innerHTML = html;
  }
  renderWordList();
}

function setWlFilter(f, el) {
  wlFilter = f;
  document.querySelectorAll('.wl-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderWordList();
}
window.setWlFilter = setWlFilter;

function renderWordList() {
  const search = (document.getElementById('wl-search')?.value || '').toLowerCase();
  const wlUnit = parseInt(document.getElementById('wl-unit-select')?.value || '0');
  let list = WORDS.filter(w => {
    if (wlUnit > 0 && w.unit !== wlUnit) return false;
    if (search && !w.w.toLowerCase().includes(search) && !w.m.includes(search) && !w.pos.includes(search)) return false;
    const s = wordStates[w.w];
    if (wlFilter === 'known') return s === 'known';
    if (wlFilter === 'learning') return s === 'learning';
    if (wlFilter === 'starred') return starredWords.has(w.w);
    if (wlFilter === 'wrong') return wrongWords.has(w.w);
    return true;
  });
  document.getElementById('wl-count').textContent = list.length;
  const c = document.getElementById('wl-table');
  if (list.length === 0) {
    c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3)">没有匹配的单词</div>';
    return;
  }
  c.innerHTML = '';
  list.forEach(w => {
    const s = wordStates[w.w];
    const icon = s === 'known' ? '✅' : s === 'learning' ? '🔄' : '⚪';
    const isWrong = wrongWords.has(w.w);
    const isStar = starredWords.has(w.w);
    const row = document.createElement('div');
    row.className = 'wl-row';
    row.innerHTML =
      '<div><div class="wl-en">' + w.w + (isWrong ? ' 📝' : '') +
      ' <span class="wl-unit-tag">U' + (w.unit || 1) + '</span></div>' +
      '<div class="wl-phon">' + w.p + '</div>' +
      (w.root ? '<div class="wl-root">🔍 ' + w.root + '</div>' : '') +
      (w.mn ? '<div class="wl-mn">💡 ' + w.mn + '</div>' : '') +
      '</div>' +
      '<div class="wl-pos">' + w.pos + '</div>' +
      '<div class="wl-cn">' + w.m + '</div>' +
      '<span class="wl-star ' + (isStar ? 'on' : '') + '" onclick="event.stopPropagation();window.toggleStarWord(\'' + w.w.replace(/'/g, "\\'") + '\')">⭐</span>' +
      '<button class="wl-tts" onclick="event.stopPropagation();window.speak(\'' + w.w.replace(/'/g, "\\'") + '\')">🔊</button>' +
      '<div class="wl-status" onclick="event.stopPropagation();window.cycleState(\'' + w.w.replace(/'/g, "\\'") + '\')" title="点击切换">' + icon + '</div>';
    c.appendChild(row);
  });
}
window.renderWordList = renderWordList;

function toggleStarWord(word) {
  if (starredWords.has(word)) { starredWords.delete(word); showToast('已取消星标'); }
  else { starredWords.add(word); showToast('⭐ 已加星标'); }
  save();
  renderWordList();
}
window.toggleStarWord = toggleStarWord;

function cycleState(word) {
  const s = wordStates[word];
  if (s === 'known') wordStates[word] = 'unknown';
  else if (s === 'learning') { wordStates[word] = 'known'; wrongWords.delete(word); }
  else wordStates[word] = 'learning';
  save();
  renderWordList();
  updateHome();
}
window.cycleState = cycleState;

// ==================== Achievements Page ====================
function renderAchievements() {
  const c = document.getElementById('ach-grid');
  c.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const unlocked = game.achievements[a.id];
    const prog = a.prog ? a.prog() : 0;
    const d = document.createElement('div');
    d.className = 'ach-card' + (unlocked ? '' : ' locked');
    d.innerHTML =
      '<div class="ach-icon">' + a.icon + '</div>' +
      '<div class="ach-name">' + a.name + '</div>' +
      '<div class="ach-desc">' + a.desc + '</div>' +
      '<div class="ach-prog"><div class="ach-prog-fill" style="width:' + (prog * 100) + '%"></div></div>' +
      (unlocked ? '<div style="font-size:10px;color:var(--green-d);font-weight:800;margin-top:4px">✅ 已解锁</div>'
        : '<div style="font-size:10px;color:var(--t3);margin-top:4px">' + Math.floor(prog * 100) + '%</div>');
    c.appendChild(d);
  });
}

// ==================== Import ====================
function openImportModal() { document.getElementById('import-modal').classList.remove('hidden'); }
window.openImportModal = openImportModal;

function closeImportModal() {
  document.getElementById('import-modal').classList.add('hidden');
  document.getElementById('import-text').value = '';
}
window.closeImportModal = closeImportModal;

function doImport() {
  const text = document.getElementById('import-text').value.trim();
  if (!text) { showToast('请粘贴单词内容'); return; }
  const replace = document.getElementById('import-replace').checked;
  const lines = text.split(/[\n,，]/).map(l => l.trim()).filter(Boolean);
  const newWords = [];
  lines.forEach(line => {
    const parts = line.split(/[|｜,，\t]/).map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const word = { w: parts[0], m: parts[1] || '', pos: parts[2] || '', p: parts[3] || '', e: parts[4] || '' };
    if (word.w && /^[a-zA-Z]/.test(word.w)) newWords.push(word);
  });
  if (newWords.length === 0) { showToast('未识别到有效单词'); return; }
  if (replace) { WORDS = newWords; wordStates = {}; wrongWords = new Set(); starredWords = new Set(); }
  else {
    const existing = new Set(WORDS.map(w => w.w));
    newWords.forEach(w => { if (!existing.has(w.w)) WORDS.push(w); });
  }
  save();
  closeImportModal();
  renderWordList();
  updateHome();
  showToast('✅ 成功导入 ' + newWords.length + ' 个单词！');
}
window.doImport = doImport;

// ==================== Auth UI ====================
function updateAuthUI() {
  const area = document.getElementById('nav-auth-area');
  if (!area) return;
  if (isLoggedIn()) {
    const email = getUserEmail();
    const cloudOn = isCloudReady();
    area.innerHTML = `
      <span class="cloud-icon ${cloudOn ? 'on' : 'off'}">${cloudOn ? '☁️' : '⚠️'}</span>
      <span class="user-badge" title="${email}">${email}</span>
      <button class="auth-btn logout" onclick="window.handleLogout()">退出</button>
    `;
  } else {
    area.innerHTML = '<button class="auth-btn" onclick="window.openAuthModal()">登录</button>';
  }
}
window.updateAuthUI = updateAuthUI;

function openAuthModal(mode) {
  authMode = mode || 'login';
  document.getElementById('auth-modal').classList.remove('hidden');
  document.getElementById('auth-title').textContent = authMode === 'login' ? '登录' : '注册';
  document.getElementById('auth-sub').textContent = authMode === 'login' ? '登录后数据自动云端同步' : '注册新账号，开始云端同步';
  document.getElementById('auth-submit-btn').textContent = authMode === 'login' ? '登录' : '注册';
  const sw = document.getElementById('auth-switch');
  sw.innerHTML = authMode === 'login' ? '还没有账号？<span>去注册</span>' : '已有账号？<span>去登录</span>';
  document.getElementById('auth-err').textContent = '';
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-pass').value = '';
  setTimeout(() => document.getElementById('auth-email').focus(), 100);
}
window.openAuthModal = openAuthModal;

function closeAuthModal() { document.getElementById('auth-modal').classList.add('hidden'); }
window.closeAuthModal = closeAuthModal;

function toggleAuthMode() { openAuthModal(authMode === 'login' ? 'register' : 'login'); }
window.toggleAuthMode = toggleAuthMode;

async function handleAuthSubmit() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-pass').value;
  const errEl = document.getElementById('auth-err');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = '请填写邮箱和密码'; return; }
  if (password.length < 6) { errEl.textContent = '密码至少6位'; return; }
  const btn = document.getElementById('auth-submit-btn');
  btn.textContent = '处理中...';
  btn.disabled = true;
  try {
    if (authMode === 'register') {
      await cloudRegister(email, password);
      showSyncBadge('注册成功，数据已同步', false);
    } else {
      await cloudLogin(email, password);
      showSyncBadge('登录成功', false);
    }
    closeAuthModal();
    updateAuthUI();
    updateHome();
    renderAll();
  } catch (e) {
    errEl.textContent = e.message || '操作失败，请重试';
  } finally {
    btn.textContent = authMode === 'login' ? '登录' : '注册';
    btn.disabled = false;
  }
}
window.handleAuthSubmit = handleAuthSubmit;

async function handleLogout() {
  try { await cloudLogout(); showSyncBadge('已退出登录', false); } catch (e) { /* ignore */ }
  updateAuthUI();
  loadLocal();
  updateHome();
  renderAll();
}
window.handleLogout = handleLogout;

function showSyncBadge(msg, isError) {
  const badge = document.getElementById('sync-badge');
  badge.textContent = msg;
  badge.className = 'sync-badge show' + (isError ? ' err' : '');
  setTimeout(() => badge.classList.remove('show'), 2000);
}

function renderAll() {
  try {
    updateHome();
    renderWordList();
    renderWrongWords();
    renderAchievements();
  } catch (e) { console.log('[renderAll]', e.message); }
}

// ==================== Keyboard ====================
document.addEventListener('keydown', e => {
  if (!document.getElementById('page-flashcard').classList.contains('hidden') &&
      !document.getElementById('fc-play').classList.contains('hidden')) {
    if (e.key === ' ') { e.preventDefault(); flipCard(); }
    if (e.key === 'ArrowLeft') markFlashcard(false);
    if (e.key === 'ArrowRight') markFlashcard(true);
    if (e.key === 'Escape') skipCard();
  }
  if (!document.getElementById('page-write').classList.contains('hidden') &&
      !document.getElementById('wr-play').classList.contains('hidden')) {
    if (e.key === 'Enter') {
      if (!document.getElementById('wr-submit').classList.contains('hidden')) { e.preventDefault(); submitWrite(); }
      else if (!document.getElementById('wr-next').classList.contains('hidden')) { e.preventDefault(); nextWrite(); }
    }
  }
  if (!document.getElementById('page-quiz').classList.contains('hidden') &&
      !document.getElementById('qz-play').classList.contains('hidden')) {
    if (e.key === 'Enter') {
      if (!document.getElementById('qz-dict-submit').classList.contains('hidden')) { e.preventDefault(); submitDict(); }
      else if (!document.getElementById('qz-next-btn').classList.contains('hidden')) { e.preventDefault(); nextQuestion(); }
      else if (!document.getElementById('qz-dict-next').classList.contains('hidden')) { e.preventDefault(); nextQuestion(); }
    }
  }
});

// ==================== Init ====================
window.addEventListener('beforeunload', () => {
  if (isLoggedIn()) cloudSyncNow();
});

window.addEventListener('online', () => {
  if (isLoggedIn()) {
    showSyncBadge('已联网，同步中...', false);
    cloudSyncNow().then(() => showSyncBadge('同步完成', false));
  }
});

// Load local data first
loadLocal();

// Render auth UI immediately
updateAuthUI();

// Init Supabase async
initSupabase().then(ok => {
  updateAuthUI();
  if (ok) {
    cloudCheckSession().then(loggedIn => {
      if (loggedIn) {
        showSyncBadge('已自动登录', false);
        updateAuthUI();
        updateHome();
        renderAll();
      }
    }).catch(e => console.log('[Session] check failed:', e));
  }
}).catch(e => {
  console.error('[Init] initSupabase failed:', e);
  updateAuthUI();
});

// Render home
updateHome();
