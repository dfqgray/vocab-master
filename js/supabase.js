// Supabase client, auth, and cloud sync module
const SUPABASE_URL = 'https://cbzmnpogteihbywamvlp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ArmMNthfTBG8yqo4rQ8gdA_4O-JXLwJ';

let supabase = null;
let currentUser = null;
let cloudReady = false;
let cloudInitError = '';

let syncTimer = null;
let isSyncing = false;
let pendingSync = false;

function initSupabase() {
  return new Promise((resolve) => {
    if (!window.supabase) {
      cloudInitError = 'SDK未加载，请检查网络';
      cloudReady = false;
      resolve(false);
      return;
    }
    if (typeof window.supabase.createClient !== 'function') {
      cloudInitError = 'SDK版本不兼容';
      cloudReady = false;
      resolve(false);
      return;
    }
    try {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      cloudReady = true;
      cloudInitError = '';
      resolve(true);
    } catch (e) {
      cloudInitError = '初始化异常: ' + e.message;
      cloudReady = false;
      resolve(false);
    }
  });
}

async function cloudRegister(email, password) {
  if (!cloudReady) throw new Error(cloudInitError || '云端未连接，请检查网络后刷新页面重试');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (data.user && !data.session) {
    throw new Error('注册成功！请前往邮箱 ' + email + ' 点击确认链接，然后返回登录');
  }
  if (data.user) {
    currentUser = data.user;
    await cloudInitProgress();
  }
  return data;
}

async function cloudLogin(email, password) {
  if (!cloudReady) throw new Error(cloudInitError || '云端未连接，请检查网络后刷新页面重试');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message && error.message.toLowerCase().includes('email not confirmed')) {
      throw new Error('邮箱未确认，请先前往邮箱点击确认链接');
    }
    throw error;
  }
  if (data.user) { currentUser = data.user; await cloudLoadProgress(); }
  return data;
}

async function cloudLogout() {
  if (!cloudReady) return;
  await cloudSyncNow();
  await supabase.auth.signOut();
  currentUser = null;
}

async function cloudChangePassword(newPassword) {
  if (!cloudReady) throw new Error('云端未连接');
  if (!currentUser) throw new Error('请先登录');
  if (!newPassword || newPassword.length < 6) throw new Error('新密码至少6位');
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

async function cloudCheckSession() {
  if (!cloudReady) return false;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return false;
  currentUser = data.session.user;
  await cloudLoadProgress();
  return true;
}

async function cloudInitProgress() {
  if (!currentUser) return;
  try { await cloudUploadProgress(); } catch (e) { console.log('[DB] init:', e.message); }
}

async function cloudLoadProgress() {
  if (!currentUser) return;
  try {
    const { data, error } = await supabase.from('user_progress').select('*').eq('user_id', currentUser.id).single();
    if (error && error.code !== 'PGRST116') throw error;
    if (data) {
      if (window.__loadCloudState) {
        window.__loadCloudState(data);
        if (window.__showToast) window.__showToast('☁️ 云端数据已同步到本地');
      }
    } else {
      // First time — upload local data to cloud
      const ok = await cloudUploadProgress();
      if (ok && window.__showToast) window.__showToast('☁️ 本地数据已上传到云端');
    }
  } catch (e) {
    console.error('[DB] 加载失败:', e);
    if (window.__showToast) window.__showToast('⚠️ 云端同步失败: ' + (e.message || '未知错误'));
  }
}

async function cloudUploadProgress() {
  if (!currentUser) return false;
  const state = window.__getAppState();
  try {
    // Only sync learning progress, not the full word list
    // (default words are in words.js, custom words are synced separately)
    const payload = {
      user_id: currentUser.id,
      word_states: state.wordStates,
      wrong_words: [...state.wrongWords],
      starred_words: [...state.starredWords],
      game_data: state.game,
      updated_at: new Date().toISOString()
    };
    // Only include custom_words if user has imported custom words
    if (window.__hasCustomWords && window.__hasCustomWords()) {
      payload.custom_words = state.WORDS;
    }
    const { error } = await supabase.from('user_progress').upsert(payload, { onConflict: 'user_id' });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[DB] 上传失败:', e);
    if (window.__showSyncBadge) window.__showSyncBadge('⚠️ 同步失败: ' + (e.message || '未知错误'), true);
    return false;
  }
}

function cloudSyncDebounced() {
  if (!cloudReady || !currentUser) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => cloudSyncNow(), 800);
}

async function cloudSyncNow() {
  if (!cloudReady || !currentUser) return;
  if (isSyncing) { pendingSync = true; return; }
  isSyncing = true;
  try {
    const ok = await cloudUploadProgress();
    if (ok && window.__showSyncBadge) window.__showSyncBadge('☁️ 同步完成', false);
  } finally {
    isSyncing = false;
    if (pendingSync) { pendingSync = false; cloudSyncNow(); }
  }
}

function isLoggedIn() { return !!currentUser; }
function getUserEmail() { return currentUser ? currentUser.email : null; }
function isCloudReady() { return cloudReady; }
function getCloudError() { return cloudInitError; }

export {
  initSupabase, cloudRegister, cloudLogin, cloudLogout, cloudChangePassword, cloudCheckSession,
  cloudSyncDebounced, cloudSyncNow, isLoggedIn, getUserEmail, isCloudReady, getCloudError
};
