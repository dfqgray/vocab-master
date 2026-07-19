// AI Story Generator — contextual vocabulary memorization
// Calls Supabase Edge Function (api-key stored server-side, never exposed)

// Get stubborn words — words marked wrong 3+ times today
export function getStubbornWords(reviewSchedule, getWordObj) {
  const today = new Date().toISOString().slice(0, 10);
  const stubborn = [];
  for (const [word, data] of Object.entries(reviewSchedule)) {
    const todayWrongs = (data.history || []).filter(
      h => h.date === today && h.result === 'wrong'
    ).length;
    if (todayWrongs >= 3) {
      const wObj = getWordObj ? getWordObj(word) : null;
      stubborn.push({
        word,
        meaning: wObj ? wObj.m : '',
        pos: wObj ? wObj.pos : '',
        level: data.level || 0,
        wrongCount: todayWrongs
      });
    }
  }
  return stubborn;
}

// Generate story via Supabase Edge Function → DeepSeek
export async function generateStory(words) {
  const { data, error } = await window.supabaseClient.functions.invoke('ai-story', {
    body: { words }
  });

  if (error) throw new Error(error.message || '请求失败');
  if (data.error) throw new Error(data.error);
  return data.story;
}

// Render story HTML — **word** → clickable bold
export function renderStoryHTML(text, words) {
  const meaningMap = {};
  words.forEach(w => { meaningMap[w.word.toLowerCase()] = w.meaning; });

  // Escape HTML
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Replace **word** with clickable spans
  html = html.replace(/\*\*(.+?)\*\*/g, (match, word) => {
    const clean = word.trim();
    const meaning = meaningMap[clean.toLowerCase()] || '';
    return `<strong class="ai-word" data-word="${clean.replace(/"/g, '&quot;')}" data-meaning="${meaning.replace(/"/g, '&quot;')}" onclick="window.toggleAIWord(this)">${clean}</strong>`;
  });

  return html.replace(/\n/g, '<br>');
}

// Toggle meaning popup on word click
export function toggleAIWord(el) {
  document.querySelectorAll('.ai-popup').forEach(p => p.remove());
  const popup = document.createElement('span');
  popup.className = 'ai-popup';
  popup.textContent = el.dataset.meaning;
  const rect = el.getBoundingClientRect();
  popup.style.left = Math.max(4, rect.left) + 'px';
  popup.style.top = (rect.bottom + 4) + 'px';
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 3000);
  const dismiss = () => { popup.remove(); document.removeEventListener('click', dismiss); };
  setTimeout(() => document.addEventListener('click', dismiss), 100);
}
