import { DEFAULT_WORDS } from './words.js';
import {
  initSupabase, cloudRegister, cloudLogin, cloudLogout, cloudChangePassword, cloudCheckSession,
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
let fcS = { index: 0, list: [], knownCount: 0, total: 0, shuffle: false, starredOnly: false, wrongOnly: false, knownOnly: false, recognition: null, isListening: false };
let qzS = { index: 0, total: 10, score: 0, questions: [], current: null };
let wrS = { index: 0, total: 10, score: 0, words: [] };
let mtS = { pairs: [], matched: 0, total: 6, startTime: 0, timerInt: null, firstSel: null, locked: false };

let fcSelectedUnits = [];
let fcSessionSize = 15;
let qzSelectedUnits = [];
let mtSelectedUnits = [];
let wrSelectedUnits = [];
let wwSelectedUnits = [];
let wlSelectedUnits = [];
let wlFilter = 'all';
let authMode = 'login';
let landMode = 'login'; // landing page mode

// Expose state for supabase module (avoids circular dependency)
window.__getAppState = () => ({ wordStates, wrongWords, starredWords, game, WORDS });
window.__saveLocal = saveLocal;
window.__showToast = showToast;
window.__showSyncBadge = showSyncBadge;
// Properly load cloud data into module-level state (fixes sync bug)
window.__loadCloudState = (data) => {
  if (data.word_states) wordStates = data.word_states;
  if (data.wrong_words) wrongWords = new Set(data.wrong_words);
  if (data.starred_words) starredWords = new Set(data.starred_words);
  if (data.game_data) {
    game = Object.assign(
      { xp: 0, streak: 0, lastStudyDate: null, hearts: 5, level: 1, todayXP: 0, todayDate: null, achievements: {} },
      data.game_data
    );
  }
  if (data.custom_words && data.custom_words.length > 0) WORDS = data.custom_words;
  saveLocal();
  updateHome();
  renderAll();
};
// Only sync custom_words if user actually imported custom words
window.__hasCustomWords = () => {
  try {
    const def = JSON.stringify(DEFAULT_WORDS);
    const cur = JSON.stringify(WORDS);
    return cur !== def;
  } catch (e) { return false; }
};

// ==================== Storage ====================
const WORDS_VERSION = 'v7_fullfields_2028';

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
let ttsVoice = null;        // user-selected voice
let ttsVoices = [];         // all available English voices
let ttsVoiceName = localStorage.getItem('pvm_tts_voice') || ''; // persisted preference

function initTTSVoices() {
  if (!window.speechSynthesis) return;
  ttsVoices = speechSynthesis.getVoices();
  if (ttsVoices.length === 0) return;
  // Filter to English voices only
  const enVoices = ttsVoices.filter(v => v.lang.startsWith('en'));
  if (enVoices.length === 0) return;
  // If user previously selected a voice, restore it
  if (ttsVoiceName) {
    ttsVoice = enVoices.find(v => v.name === ttsVoiceName) || null;
  }
  // Otherwise pick the best available voice automatically
  if (!ttsVoice) {
    // Priority: premium voices first
    const premium = enVoices.find(v => v.name.includes('Google') && v.name.includes('US'))  // Chrome
      || enVoices.find(v => v.name.includes('Samantha'))   // macOS
      || enVoices.find(v => v.name.includes('Daniel'))     // macOS UK
      || enVoices.find(v => v.name.includes('Microsoft') && v.name.includes('US') && v.name.includes('Natural')) // Edge
      || enVoices.find(v => v.name.includes('US English')) // fallback
      || enVoices[0];
    ttsVoice = premium;
  }
}

// Chrome loads voices async, Safari sync
if (window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = () => {
    initTTSVoices();
    renderTTSSelector();
  };
  initTTSVoices(); // Safari
  renderTTSSelector();
}

function renderTTSSelector() {
  const sel = document.getElementById('tts-voice-select');
  const wrap = document.getElementById('tts-selector');
  if (!sel || !wrap) return;
  const voices = getAvailableVoices();
  if (voices.length === 0) return;
  wrap.style.display = '';
  let html = '<option value="">🔊 ' + getTTSEngineName() + '</option>';
  // Group voices by source
  const grouped = {};
  voices.forEach(v => {
    let group = '其他';
    if (v.name.includes('Google')) group = 'Google';
    else if (v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Alex')) group = 'macOS';
    else if (v.name.includes('Microsoft')) group = 'Microsoft';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(v);
  });
  const order = ['Google', 'macOS', 'Microsoft', '其他'];
  order.forEach(g => {
    if (grouped[g]) {
      html += '<optgroup label="' + g + '">';
      grouped[g].forEach(v => {
        const sel = v.name === ttsVoiceName ? ' selected' : '';
        html += '<option value="' + v.name.replace(/"/g, '&quot;') + '"' + sel + '>' + v.name + '</option>';
      });
      html += '</optgroup>';
    }
  });
  sel.innerHTML = html;
}

// Refresh voice list periodically (voices may load after first page load)
setTimeout(() => { initTTSVoices(); renderTTSSelector(); }, 500);

function getTTSEngineName() {
  if (!ttsVoice) return '系统默认';
  if (ttsVoice.name.includes('Google')) return 'Google (推荐)';
  if (ttsVoice.name.includes('Samantha')) return 'Samantha (macOS)';
  if (ttsVoice.name.includes('Daniel')) return 'Daniel (macOS)';
  if (ttsVoice.name.includes('Microsoft')) return 'Microsoft Azure';
  return ttsVoice.name;
}

function speak(word) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'en-US';
  u.rate = 0.85;
  if (ttsVoice) u.voice = ttsVoice;
  speechSynthesis.speak(u);
}

// Native audio from Supabase Storage (book CD word-level MP3s)
const AUDIO_BASE = 'https://cbzmnpogteihbywamvlp.supabase.co/storage/v1/object/public/audio';
let nativeAudio = null;
function playNativeAudio(word) {
  if (!word) return;
  const safe = word.replace(/[/ ]/g, '_');
  const url = AUDIO_BASE + '/' + safe + '.mp3';
  if (nativeAudio) { nativeAudio.pause(); nativeAudio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  const a = new Audio(url);
  a.onerror = () => { speak(word); };
  nativeAudio = a;
  a.play();
}

function setTTSVoice(name) {
  ttsVoiceName = name;
  localStorage.setItem('pvm_tts_voice', name);
  ttsVoice = ttsVoices.find(v => v.name === name) || null;
  if (name === '' && ttsVoices.length > 0) {
    // Reset to auto (best available)
    initTTSVoices();
    ttsVoiceName = ttsVoice ? ttsVoice.name : '';
    localStorage.setItem('pvm_tts_voice', ttsVoiceName);
  }
}

function getAvailableVoices() {
  if (!window.speechSynthesis) return [];
  const voices = speechSynthesis.getVoices();
  return voices.filter(v => v.lang.startsWith('en'));
}

// ==================== Speech Recognition ====================
let SpeechRecognitionAPI = null;
let recognitionTranscripts = [];
(function detectSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) { SpeechRecognitionAPI = SR; }
})();

function isSpeechRecognitionSupported() {
  return !!SpeechRecognitionAPI;
}

function createRecognition() {
  if (!SpeechRecognitionAPI) return null;
  const rec = new SpeechRecognitionAPI();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.continuous = true;
  return rec;
}

function startListening() {
  if (fcS.isListening) return;
  if (!isSpeechRecognitionSupported()) {
    showToast('此浏览器不支持语音识别，请使用 Chrome 或 Edge');
    return;
  }

  // Stop any ongoing TTS
  if (window.speechSynthesis) speechSynthesis.cancel();

  const rec = createRecognition();
  if (!rec) {
    showToast('语音识别不可用');
    return;
  }

  recognitionTranscripts = [];
  fcS.recognition = rec;
  fcS.isListening = true;
  updateSpeakUI();

  rec.onresult = (event) => {
    // Accumulate all final transcripts
    for (let i = 0; i < event.results.length; i++) {
      const transcript = (event.results[i][0].transcript || '').trim();
      if (transcript) recognitionTranscripts.push(transcript);
    }
  };

  rec.onerror = (event) => {
    if (event.error === 'aborted') {
      // User aborted, no message needed
    } else if (event.error === 'no-speech') {
      // Continuous mode: wait for speech, don't show error
    } else if (event.error === 'not-allowed') {
      showToast('麦克风权限未授权，请在浏览器设置中允许');
      fcS.isListening = false;
      fcS.recognition = null;
      updateSpeakUI();
    } else {
      showToast('识别出错: ' + event.error);
      fcS.isListening = false;
      fcS.recognition = null;
      updateSpeakUI();
    }
  };

  rec.onend = () => {
    fcS.isListening = false;
    fcS.recognition = null;
    updateSpeakUI();
    // Process accumulated result when recognition ends
    const transcript = recognitionTranscripts.join(' ').trim();
    if (transcript) {
      showRecognitionResult(transcript);
    }
  };

  rec.start();
}

function stopListening() {
  if (fcS.recognition) {
    try { fcS.recognition.stop(); } catch (e) { /* ignore */ }
  }
}

function toggleListening() {
  if (fcS.isListening) {
    stopListening();
  } else {
    startListening();
  }
}
window.toggleListening = toggleListening;

function levenshteinDistance(a, b) {
  const al = a.length, bl = b.length;
  const matrix = [];
  for (let i = 0; i <= al; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= bl; j++) { matrix[0][j] = j; }
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      matrix[i][j] = a[i - 1] === b[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1], matrix[i - 1][j], matrix[i][j - 1]) + 1;
    }
  }
  return matrix[al][bl];
}

function checkPronunciation(spoken, target) {
  const s = spoken.toLowerCase().replace(/[^a-z]/g, '').trim();
  const t = target.toLowerCase().replace(/[^a-z]/g, '').trim();
  if (s === t) return { correct: true, close: false };
  const dist = levenshteinDistance(s, t);
  if (dist <= 2 && s.length >= t.length * 0.6) return { correct: false, close: true };
  return { correct: false, close: false };
}

function updateSpeakUI() {
  const btn = document.getElementById('fc-speak-btn');
  const fb = document.getElementById('fc-speak-feedback');
  if (!btn) return;

  // Hide feedback when starting new listen
  if (fb && fcS.isListening) fb.classList.add('hidden');

  if (fcS.isListening) {
    btn.classList.add('listening');
    btn.classList.remove('success', 'error');
    btn.textContent = '🔴 停止录音';
  } else {
    btn.classList.remove('listening', 'success', 'error');
    btn.textContent = '🎤 开始录音';
  }
}

function showRecognitionResult(transcript) {
  const word = fcS.list[fcS.index].w;
  const result = checkPronunciation(transcript, word);
  const fb = document.getElementById('fc-speak-feedback');
  const iconEl = document.getElementById('fc-speak-fb-icon');
  const textEl = document.getElementById('fc-speak-fb-text');
  const btn = document.getElementById('fc-speak-btn');

  if (!fb) return;

  fb.classList.remove('hidden', 'correct', 'close', 'wrong');

  if (result.correct) {
    fb.classList.add('correct');
    iconEl.textContent = '✅';
    textEl.textContent = '发音正确！你说的是 "' + transcript + '"';
    if (btn) { btn.classList.remove('listening', 'error'); btn.classList.add('success'); }
    sfxCorrect();
    addXP(2);
  } else if (result.close) {
    fb.classList.add('close');
    iconEl.textContent = '⚠️';
    textEl.textContent = '接近了！你说的是 "' + transcript + '"，目标词是 "' + word + '"';
    if (btn) { btn.classList.remove('listening', 'success'); btn.classList.add('error'); }
  } else {
    fb.classList.add('wrong');
    iconEl.textContent = '❌';
    textEl.textContent = '不太对。你说的是 "' + transcript + '"，目标词是 "' + word + '"';
    if (btn) { btn.classList.remove('listening', 'success'); btn.classList.add('error'); }
  }
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
function getUnitPool(selectedUnits) {
  if (!selectedUnits || selectedUnits.length === 0) return [...WORDS];
  return WORDS.filter(w => selectedUnits.includes(w.unit || 1));
}

function renderUnitChips(rowId, infoId, selectedUnits, toggleFnName) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const units = [...new Set(WORDS.map(w => w.unit || 1))].sort((a, b) => a - b);
  const allSelected = selectedUnits.length === 0;
  let html = '<span class="fc-unit-chip all' + (allSelected ? ' on' : '') + '" onclick="window.' + toggleFnName + '(0)">全部</span>';
  units.forEach(u => {
    const count = WORDS.filter(w => w.unit === u).length;
    const isOn = selectedUnits.includes(u);
    html += '<span class="fc-unit-chip' + (isOn ? ' on' : '') + '" onclick="window.' + toggleFnName + '(' + u + ')">U' + u + '<span style="opacity:.5;font-size:10px">(' + count + ')</span></span>';
  });
  row.innerHTML = html;
  const info = document.getElementById(infoId);
  if (info) {
    if (allSelected) {
      info.textContent = '已选择：全部 UNIT（共 ' + WORDS.length + ' 词）';
    } else {
      const sorted = [...selectedUnits].sort((a, b) => a - b);
      const totalWords = WORDS.filter(w => selectedUnits.includes(w.unit || 1)).length;
      info.textContent = '已选择：UNIT ' + sorted.join(', ') + '（共 ' + totalWords + ' 词）';
    }
  }
}

// Multi-select toggle functions for Quiz, Match, Write
function toggleQzUnit(u) {
  if (u === 0) { qzSelectedUnits = []; }
  else {
    const idx = qzSelectedUnits.indexOf(u);
    if (idx >= 0) qzSelectedUnits.splice(idx, 1);
    else qzSelectedUnits.push(u);
  }
  renderUnitChips('qz-unit-row', 'qz-unit-info', qzSelectedUnits, 'toggleQzUnit');
}
function toggleMtUnit(u) {
  if (u === 0) { mtSelectedUnits = []; }
  else {
    const idx = mtSelectedUnits.indexOf(u);
    if (idx >= 0) mtSelectedUnits.splice(idx, 1);
    else mtSelectedUnits.push(u);
  }
  renderUnitChips('mt-unit-row', 'mt-unit-info', mtSelectedUnits, 'toggleMtUnit');
}
function toggleWrUnit(u) {
  if (u === 0) { wrSelectedUnits = []; }
  else {
    const idx = wrSelectedUnits.indexOf(u);
    if (idx >= 0) wrSelectedUnits.splice(idx, 1);
    else wrSelectedUnits.push(u);
  }
  renderUnitChips('wr-unit-row', 'wr-unit-info', wrSelectedUnits, 'toggleWrUnit');
}
window.toggleQzUnit = toggleQzUnit;
window.toggleMtUnit = toggleMtUnit;
window.toggleWrUnit = toggleWrUnit;

// ==================== Flashcard ====================
function resetFlashcard() {
  document.getElementById('fc-start').classList.remove('hidden');
  document.getElementById('fc-play').classList.add('hidden');
  document.getElementById('fc-done').classList.add('hidden');
  // Reset speech recognition
  stopListening();
  const fb = document.getElementById('fc-speak-feedback');
  if (fb) fb.classList.add('hidden');
  renderFcUnitSelector();
  renderFcSizeSelector();
}

function renderFcUnitSelector() {
  const row = document.getElementById('fc-unit-row');
  if (!row) return;
  const units = [...new Set(WORDS.map(w => w.unit || 1))].sort((a, b) => a - b);
  const allSelected = fcSelectedUnits.length === 0;
  let html = '<span class="fc-unit-chip all' + (allSelected ? ' on' : '') + '" onclick="window.toggleFcUnit(0)">全部</span>';
  units.forEach(u => {
    const count = WORDS.filter(w => w.unit === u).length;
    const isOn = fcSelectedUnits.includes(u);
    html += '<span class="fc-unit-chip' + (isOn ? ' on' : '') + '" onclick="window.toggleFcUnit(' + u + ')">U' + u + '<span style="opacity:.5;font-size:10px">(' + count + ')</span></span>';
  });
  row.innerHTML = html;
  const info = document.getElementById('fc-unit-info');
  if (info) {
    if (allSelected) {
      info.textContent = '已选择：全部 UNIT（共 ' + WORDS.length + ' 词）';
    } else {
      const sorted = [...fcSelectedUnits].sort((a, b) => a - b);
      const totalWords = WORDS.filter(w => fcSelectedUnits.includes(w.unit || 1)).length;
      const knownWords = WORDS.filter(w => fcSelectedUnits.includes(w.unit || 1) && wordStates[w.w] === 'known').length;
      info.textContent = '已选择：UNIT ' + sorted.join(', ') + '（共 ' + totalWords + ' 词，已掌握 ' + knownWords + ' 词）';
    }
  }
}

function toggleFcUnit(u) {
  if (u === 0) { fcSelectedUnits = []; }
  else {
    const idx = fcSelectedUnits.indexOf(u);
    if (idx >= 0) fcSelectedUnits.splice(idx, 1);
    else fcSelectedUnits.push(u);
  }
  // Auto-adjust session size if it exceeds new total
  const total = getUnitPool(fcSelectedUnits).length;
  if (fcSessionSize > total) fcSessionSize = total;
  renderFcUnitSelector();
  renderFcSizeSelector();
}
window.toggleFcUnit = toggleFcUnit;

function renderFcSizeSelector() {
  const row = document.getElementById('fc-size-row');
  if (!row) return;
  const unitPool = getUnitPool(fcSelectedUnits);
  const total = unitPool.length;
  const fixedSizes = [10, 15, 20, 30, 50].filter(s => s < total);
  const sizes = [...fixedSizes, total];
  let html = '';
  sizes.forEach(s => {
    const isMax = s >= total;
    html += '<span class="fc-size-chip' + (fcSessionSize === s ? ' on' : '') + '" onclick="selectFcSize(' + s + ')">' + (isMax ? '全部 ' : '') + s + ' 词</span>';
  });
  row.innerHTML = html;
}

function selectFcSize(s) { fcSessionSize = s; renderFcSizeSelector(); }
window.selectFcSize = selectFcSize;

function toggleShuffle(el) { fcS.shuffle = !fcS.shuffle; el.classList.toggle('on', fcS.shuffle); }
function toggleStarredOnly(el) {
  fcS.starredOnly = !fcS.starredOnly;
  el.classList.toggle('on', fcS.starredOnly);
  fcS.wrongOnly = false; fcS.knownOnly = false;
  document.getElementById('fc-opt-wrong').classList.remove('on');
  document.getElementById('fc-opt-known').classList.remove('on');
}
function toggleWrongOnly(el) {
  fcS.wrongOnly = !fcS.wrongOnly;
  el.classList.toggle('on', fcS.wrongOnly);
  fcS.starredOnly = false; fcS.knownOnly = false;
  document.getElementById('fc-opt-starred').classList.remove('on');
  document.getElementById('fc-opt-known').classList.remove('on');
}
function toggleKnownOnly(el) {
  fcS.knownOnly = !fcS.knownOnly;
  el.classList.toggle('on', fcS.knownOnly);
  fcS.starredOnly = false; fcS.wrongOnly = false;
  document.getElementById('fc-opt-starred').classList.remove('on');
  document.getElementById('fc-opt-wrong').classList.remove('on');
}
window.toggleShuffle = toggleShuffle;
window.toggleStarredOnly = toggleStarredOnly;
window.toggleWrongOnly = toggleWrongOnly;
window.toggleKnownOnly = toggleKnownOnly;

function startFlashcard() {
  let pool;
  let unitPool = getUnitPool(fcSelectedUnits);
  if (fcS.starredOnly) pool = unitPool.filter(w => starredWords.has(w.w));
  else if (fcS.wrongOnly) pool = [...wrongWords].map(ww => WORDS.find(w => w.w === ww)).filter(Boolean).filter(w => fcSelectedUnits.length === 0 || fcSelectedUnits.includes(w.unit || 1));
  else if (fcS.knownOnly) pool = unitPool.filter(w => wordStates[w.w] === 'known');
  else pool = unitPool.filter(w => wordStates[w.w] !== 'known');
  if (pool.length === 0) pool = [...unitPool];
  pool.sort(() => Math.random() - 0.5);
  fcS.list = pool.slice(0, Math.min(fcSessionSize, pool.length));
  fcS.index = 0;
  fcS.knownCount = 0;
  fcS.total = fcS.list.length;
  // Show/hide speak button based on browser support
  const speakBtn = document.getElementById('fc-speak-btn');
  if (speakBtn) speakBtn.classList.toggle('hidden', !isSpeechRecognitionSupported());
  document.getElementById('fc-start').classList.add('hidden');
  document.getElementById('fc-done').classList.add('hidden');
  document.getElementById('fc-play').classList.remove('hidden');
  showFlashcard();
  setTimeout(() => {
    const inp = document.getElementById('fc-write-input');
    if (inp) inp.focus();
  }, 100);
}

function getFcWord() { return document.getElementById('fc-word').textContent; }

function showFlashcard() {
  if (fcS.index >= fcS.total) return finishFlashcard();
  // Immediately stop any previous audio (native + TTS)
  if (nativeAudio) { nativeAudio.pause(); nativeAudio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  // Clear writing pad for new word
  clearWriteInput();
  const w = fcS.list[fcS.index];
  const card = document.getElementById('fc-card');
  card.classList.remove('flipped', 'swipe-left', 'swipe-right');
  // Reset speech recognition state for new card
  stopListening();
  updateSpeakUI();
  const fb = document.getElementById('fc-speak-feedback');
  if (fb) fb.classList.add('hidden');
  document.getElementById('fc-word').textContent = w.w;
  document.getElementById('fc-phon').textContent = w.p;
  // 释 (definition)
  document.getElementById('fc-pos').textContent = w.pos;
  document.getElementById('fc-meaning').textContent = w.m;
  // 例 (example)
  document.getElementById('fc-example').textContent = w.e || '';
  document.getElementById('fc-example-box').classList.toggle('hidden', !w.e);
  // 搭 (collocations)
  document.getElementById('fc-coll').textContent = w.coll || '';
  document.getElementById('fc-coll-box').classList.toggle('hidden', !w.coll);
  // 记 (root + mnemonic)
  document.getElementById('fc-root').textContent = w.root || '';
  document.getElementById('fc-root-box').classList.toggle('hidden', !w.root);
  document.getElementById('fc-mn').textContent = w.mn || '';
  document.getElementById('fc-mn-box').classList.toggle('hidden', !w.mn);
  // 派 (derived)
  document.getElementById('fc-deriv').textContent = w.deriv || '';
  document.getElementById('fc-deriv-box').classList.toggle('hidden', !w.deriv);
  // 反/近/复 (other)
  const other = [w.ant ? '↔ ' + w.ant : '', w.syn ? '≈ ' + w.syn : '', w.plur ? '📋 ' + w.plur : ''].filter(Boolean).join('  ');
  document.getElementById('fc-other').textContent = other;
  document.getElementById('fc-other-box').classList.toggle('hidden', !other);
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
  // Stop audio when flipping back to front
  if (!card.classList.contains('flipped')) {
    if (nativeAudio) { nativeAudio.pause(); nativeAudio = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
  }
}

function toggleStar() {
  const w = fcS.list[fcS.index];
  if (starredWords.has(w.w)) { starredWords.delete(w.w); showToast('已取消星标'); }
  else { starredWords.add(w.w); showToast('⭐ 已加星标'); }
  save();
  document.getElementById('fc-star').classList.toggle('on', starredWords.has(w.w));
}

function markFlashcard(known) {
  // Immediately stop any playing audio
  if (nativeAudio) { nativeAudio.pause(); nativeAudio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
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

// ==================== Write Pad (native input, iPad Scribble friendly) ====================
function clearWriteInput() {
  const inp = document.getElementById('fc-write-input');
  if (inp) { inp.value = ''; inp.focus(); }
  const res = document.getElementById('fc-write-result');
  if (res) res.classList.add('hidden');
}
window.clearWriteInput = clearWriteInput;

function checkWriteWord() {
  const inp = document.getElementById('fc-write-input');
  const res = document.getElementById('fc-write-result');
  if (!inp || !res) return;
  const raw = inp.value.trim();
  if (!raw) return;
  const target = fcS.list[fcS.index].w.toLowerCase();
  // Split by spaces / newlines, filter empty
  const words = raw.split(/[\s,，、]+/).filter(Boolean).map(w => w.toLowerCase());
  if (words.length === 0) return;

  res.classList.remove('hidden', 'ok', 'no');

  // Check each word
  const wrongIdx = [];
  words.forEach((w, i) => { if (w !== target) wrongIdx.push(i); });

  if (wrongIdx.length === 0) {
    res.classList.add('ok');
    res.textContent = words.length > 1
      ? '✅ 写了 ' + words.length + ' 遍，全部正确！'
      : '✅ 正确！';
    sfxCorrect();
  } else if (wrongIdx.length === words.length) {
    res.classList.add('no');
    res.textContent = '❌ 都不对。正确答案：' + fcS.list[fcS.index].w;
  } else {
    res.classList.add('no');
    const bad = wrongIdx.map(i => '第' + (i + 1) + '个').join('、');
    res.textContent = '⚠️ ' + bad + ' 不对，应为：' + fcS.list[fcS.index].w;
  }
}
window.checkWriteWord = checkWriteWord;

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
window.playNativeAudio = playNativeAudio;
window.setTTSVoice = setTTSVoice;
window.getAvailableVoices = getAvailableVoices;
window.getTTSEngineName = getTTSEngineName;

// ==================== Quiz ====================
function resetQuiz() {
  document.getElementById('qz-start').classList.remove('hidden');
  document.getElementById('qz-play').classList.add('hidden');
  document.getElementById('qz-done').classList.add('hidden');
  renderUnitChips('qz-unit-row', 'qz-unit-info', qzSelectedUnits, 'toggleQzUnit');
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
  const unitPool = getUnitPool(qzSelectedUnits);
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
    const wrongs = getUnitPool(qzSelectedUnits).filter(w => w.w !== q.word.w).sort(() => Math.random() - 0.5).slice(0, 3).map(w => w.m);
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
    window.__qzDictWord = q.word.w;
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
  renderUnitChips('wr-unit-row', 'wr-unit-info', wrSelectedUnits, 'toggleWrUnit');
}

function startWrite() {
  wrS.index = 0; wrS.score = 0;
  const unitPool = getUnitPool(wrSelectedUnits);
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
  renderUnitChips('mt-unit-row', 'mt-unit-info', mtSelectedUnits, 'toggleMtUnit');
}

function startMatch() {
  const unitPool = getUnitPool(mtSelectedUnits);
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
function renderWwUnitChips() {
  const row = document.getElementById('ww-unit-row');
  if (!row) return;
  const wrongWordObjs = [...wrongWords].map(w => WORDS.find(x => x.w === w)).filter(Boolean);
  const units = [...new Set(wrongWordObjs.map(w => w.unit || 1))].sort((a, b) => a - b);
  const allUnits = [...new Set(WORDS.map(w => w.unit || 1))].sort((a, b) => a - b);
  const allSelected = wwSelectedUnits.length === 0;
  let html = '<span class="fc-unit-chip all' + (allSelected ? ' on' : '') + '" onclick="window.toggleWwUnit(0)">全部</span>';
  allUnits.forEach(u => {
    const cnt = wrongWordObjs.filter(w => (w.unit || 1) === u).length;
    const isOn = wwSelectedUnits.includes(u);
    html += '<span class="fc-unit-chip' + (isOn ? ' on' : '') + (cnt === 0 ? ' empty' : '') + '" onclick="window.toggleWwUnit(' + u + ')">U' + u + '<span style="opacity:.5;font-size:10px">(' + cnt + ')</span></span>';
  });
  row.innerHTML = html;
  const info = document.getElementById('ww-unit-info');
  if (info) {
    const filtered = getWwFilteredList();
    if (allSelected) {
      info.textContent = '已选择：全部 UNIT（共 ' + filtered.length + ' 错词）';
    } else {
      const sorted = [...wwSelectedUnits].sort((a, b) => a - b);
      info.textContent = '已选择：UNIT ' + sorted.join(', ') + '（共 ' + filtered.length + ' 错词）';
    }
  }
}

function getWwFilteredList() {
  const search = (document.getElementById('ww-search')?.value || '').toLowerCase();
  let list = [...wrongWords].map(w => WORDS.find(x => x.w === w)).filter(Boolean);
  if (wwSelectedUnits.length > 0) list = list.filter(w => wwSelectedUnits.includes(w.unit || 1));
  if (search) list = list.filter(w => w.w.toLowerCase().includes(search) || w.m.includes(search));
  return list;
}

function toggleWwUnit(u) {
  if (u === 0) { wwSelectedUnits = []; }
  else {
    const idx = wwSelectedUnits.indexOf(u);
    if (idx >= 0) wwSelectedUnits.splice(idx, 1);
    else wwSelectedUnits.push(u);
  }
  renderWrongWords();
}
window.toggleWwUnit = toggleWwUnit;

function renderWrongWords() {
  renderWwUnitChips();
  const filtered = getWwFilteredList();
  document.getElementById('ww-count').textContent = filtered.length;
  const c = document.getElementById('ww-list');
  if (filtered.length === 0) {
    c.innerHTML = '<div class="ww-empty"><div class="emoji">🎉</div><p>' +
      (wwSelectedUnits.length > 0 ? '所选 UNIT 错词本为空！继续保持！' : '错词本为空！继续保持！') + '</p></div>';
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
      '<span style="cursor:pointer" onclick="window.speak(\'' + w.w.replace(/'/g, "\\'") + '\')">🔊</span>' +
      '<span style="cursor:pointer;margin-left:4px" onclick="window.playNativeAudio(\'' + w.w.replace(/'/g, "\\'") + '\')" title="原声">🎙️</span></div>' +
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
  renderWlUnitChips();
  renderWordList();
}

function renderWlUnitChips() {
  const row = document.getElementById('wl-unit-row');
  if (!row) return;
  const units = [...new Set(WORDS.map(w => w.unit || 1))].sort((a, b) => a - b);
  const allSelected = wlSelectedUnits.length === 0;
  let html = '<span class="fc-unit-chip all' + (allSelected ? ' on' : '') + '" onclick="window.toggleWlUnit(0)">全部</span>';
  units.forEach(u => {
    const count = WORDS.filter(w => w.unit === u).length;
    const isOn = wlSelectedUnits.includes(u);
    html += '<span class="fc-unit-chip' + (isOn ? ' on' : '') + '" onclick="window.toggleWlUnit(' + u + ')">U' + u + '<span style="opacity:.5;font-size:10px">(' + count + ')</span></span>';
  });
  row.innerHTML = html;
  const info = document.getElementById('wl-unit-info');
  if (info) {
    if (allSelected) {
      info.textContent = '已选择：全部 UNIT（共 ' + WORDS.length + ' 词）';
    } else {
      const sorted = [...wlSelectedUnits].sort((a, b) => a - b);
      const totalWords = WORDS.filter(w => wlSelectedUnits.includes(w.unit || 1)).length;
      info.textContent = '已选择：UNIT ' + sorted.join(', ') + '（共 ' + totalWords + ' 词）';
    }
  }
}

function toggleWlUnit(u) {
  if (u === 0) { wlSelectedUnits = []; }
  else {
    const idx = wlSelectedUnits.indexOf(u);
    if (idx >= 0) wlSelectedUnits.splice(idx, 1);
    else wlSelectedUnits.push(u);
  }
  renderWordList();
}
window.toggleWlUnit = toggleWlUnit;

function setWlFilter(f, el) {
  wlFilter = f;
  document.querySelectorAll('.wl-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderWordList();
}
window.setWlFilter = setWlFilter;

function renderWordList() {
  renderWlUnitChips();
  const search = (document.getElementById('wl-search')?.value || '').toLowerCase();
  let list = WORDS.filter(w => {
    if (wlSelectedUnits.length > 0 && !wlSelectedUnits.includes(w.unit || 1)) return false;
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
      (w.coll ? '<div class="wl-mn" style="background:#e8f5e9;color:#2e7d32">📎 ' + w.coll + '</div>' : '') +
      (w.deriv ? '<div class="wl-mn" style="background:#fce4ec;color:#c62828">🌿 ' + w.deriv + '</div>' : '') +
      '</div>' +
      '<div class="wl-pos">' + w.pos + '</div>' +
      '<div class="wl-cn">' + w.m + '</div>' +
      '<span class="wl-star ' + (isStar ? 'on' : '') + '" onclick="event.stopPropagation();window.toggleStarWord(\'' + w.w.replace(/'/g, "\\'") + '\')">⭐</span>' +
      '<button class="wl-tts" onclick="event.stopPropagation();window.speak(\'' + w.w.replace(/'/g, "\\'") + '\')">🔊</button>' +
      '<button class="wl-tts" onclick="event.stopPropagation();window.playNativeAudio(\'' + w.w.replace(/'/g, "\\'") + '\')" title="原声">🎙️</button>' +
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

// ==================== Landing Page ====================
function showApp() {
  document.getElementById('landing-page').classList.add('hidden');
  document.getElementById('app-content').classList.remove('hidden');
  updateAuthUI();
  updateHome();
  renderAll();
}

function showLanding() {
  document.getElementById('landing-page').classList.remove('hidden');
  document.getElementById('app-content').classList.add('hidden');
  // Reset landing form
  document.getElementById('land-email').value = '';
  document.getElementById('land-pass').value = '';
  document.getElementById('landing-err').textContent = '';
  document.getElementById('landing-fields').classList.remove('hidden');
  document.getElementById('landing-loading').classList.add('hidden');
}

function toggleLandingMode() {
  landMode = landMode === 'login' ? 'register' : 'login';
  const isLogin = landMode === 'login';
  document.getElementById('land-submit').textContent = isLogin ? '登录' : '注册';
  document.getElementById('land-switch').innerHTML = isLogin
    ? '还没有账号？<span>去注册</span>'
    : '已有账号？<span>去登录</span>';
  document.getElementById('landing-err').textContent = '';
}
window.toggleLandingMode = toggleLandingMode;

async function handleLandingSubmit() {
  const email = document.getElementById('land-email').value.trim();
  const password = document.getElementById('land-pass').value;
  const errEl = document.getElementById('landing-err');

  if (!email || !password) { errEl.textContent = '请填写邮箱和密码'; return; }
  if (password.length < 6) { errEl.textContent = '密码至少6位'; return; }

  const btn = document.getElementById('land-submit');
  btn.disabled = true;
  btn.textContent = '处理中...';

  try {
    if (landMode === 'register') {
      await cloudRegister(email, password);
    } else {
      await cloudLogin(email, password);
    }
    showApp();
    showSyncBadge(landMode === 'register' ? '注册成功！' : '登录成功！', false);
  } catch (e) {
    errEl.textContent = e.message || '操作失败，请重试';
  } finally {
    btn.disabled = false;
    btn.textContent = landMode === 'login' ? '登录' : '注册';
  }
}
window.handleLandingSubmit = handleLandingSubmit;

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
      <button class="auth-btn" style="background:var(--purple);color:#fff;box-shadow:0 4px 0 var(--purple-d)" onclick="window.openAuthModal('changePassword')">🔒</button>
      <button class="auth-btn logout" onclick="window.handleLogout()">退出</button>
    `;
  } else {
    area.innerHTML = '<button class="auth-btn" onclick="window.openAuthModal()">登录</button>';
  }
}
window.updateAuthUI = updateAuthUI;

function openAuthModal(mode) {
  authMode = mode || 'login';
  const isChangePw = authMode === 'changePassword';
  document.getElementById('auth-modal').classList.remove('hidden');
  document.getElementById('auth-title').textContent = isChangePw ? '修改密码' : (authMode === 'login' ? '登录' : '注册');
  document.getElementById('auth-sub').textContent = isChangePw ? '请输入新密码（至少6位）' : (authMode === 'login' ? '登录后数据自动云端同步' : '注册新账号，开始云端同步');
  document.getElementById('auth-submit-btn').textContent = isChangePw ? '确认修改' : (authMode === 'login' ? '登录' : '注册');
  const sw = document.getElementById('auth-switch');
  sw.innerHTML = isChangePw ? '' : (authMode === 'login' ? '还没有账号？<span>去注册</span>' : '已有账号？<span>去登录</span>');
  document.getElementById('auth-err').textContent = '';
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-pass').value = '';
  // Hide email field when changing password (already logged in)
  document.getElementById('auth-email').classList.toggle('hidden', isChangePw);
  setTimeout(() => {
    if (isChangePw) document.getElementById('auth-pass').focus();
    else document.getElementById('auth-email').focus();
  }, 100);
}
window.openAuthModal = openAuthModal;

function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('auth-email').classList.remove('hidden');
}
window.closeAuthModal = closeAuthModal;

function toggleAuthMode() { openAuthModal(authMode === 'login' ? 'register' : 'login'); }
window.toggleAuthMode = toggleAuthMode;

async function handleAuthSubmit() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-pass').value;
  const errEl = document.getElementById('auth-err');
  errEl.textContent = '';

  if (authMode === 'changePassword') {
    if (!password) { errEl.textContent = '请输入新密码'; return; }
    if (password.length < 6) { errEl.textContent = '新密码至少6位'; return; }
    const btn = document.getElementById('auth-submit-btn');
    btn.textContent = '处理中...';
    btn.disabled = true;
    try {
      await cloudChangePassword(password);
      closeAuthModal();
      showSyncBadge('密码修改成功', false);
    } catch (e) {
      errEl.textContent = e.message || '修改失败，请重试';
    } finally {
      btn.textContent = '确认修改';
      btn.disabled = false;
    }
    return;
  }

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
  try { await cloudLogout(); } catch (e) { /* ignore */ }
  showLanding();
  updateAuthUI();
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

// Disable landing submit until Supabase is ready
document.getElementById('land-submit').disabled = true;
document.getElementById('land-submit').textContent = '正在连接服务器...';

// Landing page is visible by default, app hidden
// Init Supabase async — if already logged in, skip landing page
initSupabase().then(ok => {
  // Enable landing submit button
  const landBtn = document.getElementById('land-submit');
  landBtn.disabled = false;
  landBtn.textContent = landMode === 'login' ? '登录' : '注册';

  if (ok) {
    cloudCheckSession().then(loggedIn => {
      if (loggedIn) {
        showApp();
        showSyncBadge('已自动登录', false);
      }
    }).catch(e => console.log('[Session] check failed:', e));
  }
}).catch(e => {
  console.error('[Init] initSupabase failed:', e);
  // Still enable button so user can retry
  const landBtn = document.getElementById('land-submit');
  landBtn.disabled = false;
  landBtn.textContent = landMode === 'login' ? '登录' : '注册';
});
