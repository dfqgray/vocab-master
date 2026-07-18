// Textbook Loader — handles loading, switching, and per-textbook progress
import { TEXTBOOKS, getTextbook, DEFAULT_TEXTBOOK_ID } from './textbooks.js';

let activeTextbookId = null;
let activeTextbook = null;
let _WORDS = []; // the currently loaded word list

// Get the active textbook ID
export function getActiveTextbookId() {
  return activeTextbookId;
}

// Get the active textbook metadata
export function getActiveTextbook() {
  return activeTextbook;
}

// Get the currently loaded word list
export function getWords() {
  return _WORDS;
}

// Set the current word list (called by loadTextbook)
function setWords(words) {
  _WORDS = words;
}

// ==================== Local Progress (per-textbook) ====================

function progressKey(tid) {
  return 'pvm_progress_' + tid;
}

export function loadProgress(tid) {
  try {
    const raw = localStorage.getItem(progressKey(tid));
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  // Return empty progress
  return { wordStates: {}, wrongWords: [], starredWords: [], game: { xp: 0, streak: 0, lastStudyDate: null, hearts: 5, level: 1, todayXP: 0, todayDate: null, achievements: {} } };
}

export function saveProgress(tid, data) {
  try {
    localStorage.setItem(progressKey(tid), JSON.stringify(data));
  } catch (e) { /* ignore */ }
}

// ==================== Textbook Loading ====================

// Load and activate a textbook by ID
export async function loadTextbook(id) {
  const tb = getTextbook(id);
  if (!tb) throw new Error('教材不存在: ' + id);

  // If same textbook already loaded, do nothing
  if (activeTextbookId === id && _WORDS.length > 0) return tb;

  // Load words
  let words;
  if (tb.bundled) {
    // Bundled — import from local module
    const mod = await import(tb.modulePath);
    words = mod[tb.moduleExport];
  } else {
    // Remote — load from localStorage cache or download
    const cached = localStorage.getItem('pvm_cached_' + id);
    if (cached) {
      try { words = JSON.parse(cached); } catch (e) { /* fall through */ }
    }
    if (!words || words.length === 0) {
      throw new Error('教材 ' + tb.name + ' 需要下载，请检查网络后重试');
    }
  }

  // Set as active
  activeTextbookId = id;
  activeTextbook = tb;
  setWords(words);

  // Save active textbook to localStorage (for session restore)
  localStorage.setItem('active_textbook', id);

  return tb;
}

// ==================== Init ====================

// Initialize on app startup — restore last active textbook
export async function initTextbook() {
  // Determine which textbook to load
  const savedId = localStorage.getItem('active_textbook');

  // Migration: if old-style pvm_words exists, migrate to pet2020
  if (!savedId && localStorage.getItem('pvm_words')) {
    migrateOldData();
  }

  const tid = savedId || DEFAULT_TEXTBOOK_ID;

  // Ensure the textbook exists in the registry
  const tb = getTextbook(tid);
  if (!tb) {
    // Fallback to default
    localStorage.setItem('active_textbook', DEFAULT_TEXTBOOK_ID);
    return loadTextbook(DEFAULT_TEXTBOOK_ID);
  }

  return loadTextbook(tid);
}

// Migrate old-style data to per-textbook format
function migrateOldData() {
  try {
    const oldWords = localStorage.getItem('pvm_words');
    const oldStates = localStorage.getItem('pvm_states');
    const oldWrong = localStorage.getItem('pvm_wrong');
    const oldStarred = localStorage.getItem('pvm_starred');
    const oldGame = localStorage.getItem('pvm_game');

    if (oldStates || oldWrong || oldStarred || oldGame) {
      const progress = {
        wordStates: oldStates ? JSON.parse(oldStates) : {},
        wrongWords: oldWrong ? JSON.parse(oldWrong) : [],
        starredWords: oldStarred ? JSON.parse(oldStarred) : [],
        game: oldGame ? JSON.parse(oldGame) : { xp: 0, streak: 0, lastStudyDate: null, hearts: 5, level: 1, todayXP: 0, todayDate: null, achievements: {} }
      };
      localStorage.setItem(progressKey('pet2020'), JSON.stringify(progress));
      // Keep old pvm_words for words_pet.js fallback, but remove progress keys
      localStorage.removeItem('pvm_states');
      localStorage.removeItem('pvm_wrong');
      localStorage.removeItem('pvm_starred');
      localStorage.removeItem('pvm_game');
    }
  } catch (e) { /* ignore migration errors */ }
}
