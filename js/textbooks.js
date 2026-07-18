// Textbook Registry — metadata for all available textbooks
// To add a new textbook: add an entry here + provide the word list file + audio folder in Supabase

export const TEXTBOOKS = [
  {
    id: 'pet2020',
    name: 'PET 核心词汇',
    subtitle: '俞敏洪·图解联想巧记速练',
    icon: '📗',
    color: '#58CC02',
    wordCount: 2028,
    units: 30,
    level: 'B1 中级',
    bundled: true,
    description: '剑桥通用英语第二级，适合初中生及英语中级水平学习者',
    modulePath: './words_pet.js',
    moduleExport: 'WORDS_PET'
  }
  // Future textbooks:
  // { id: 'ket', name: 'KET 核心词汇', icon: '📘', bundled: true, modulePath: './words_ket.js', moduleExport: 'WORDS_KET', ... },
  // { id: 'cet4', name: '大学英语四级', icon: '📙', bundled: false, downloadUrl: 'https://...', ... },
];

// Look up a textbook by ID
export function getTextbook(id) {
  return TEXTBOOKS.find(t => t.id === id);
}

// Default textbook ID (first in list, used on first visit)
export const DEFAULT_TEXTBOOK_ID = TEXTBOOKS[0].id;
