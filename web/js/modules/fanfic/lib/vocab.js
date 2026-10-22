// Fixed vocabularies of Xưởng Viết (AO3 / Wattpad style). Keys are stored; labels are Vietnamese UI text.
export const STATUSES = {
  draft: 'Bản nháp',
  wip: 'Đang viết',
  complete: 'Hoàn thành',
  hiatus: 'Tạm ngưng',
  abandoned: 'Bỏ dở',
};
// Library-wide status (core/content-types.js STATUS) for each writing status.
export const HUB_STATUS = { draft: 'new', wip: 'in-progress', hiatus: 'in-progress', complete: 'done', abandoned: 'done' };

// AO3 ratings (audience), archive warnings and categories.
export const AUDIENCE = {
  nr: { label: 'Chưa xếp loại', short: 'NR', color: '#8a8a8a' },
  g: { label: 'Mọi lứa tuổi', short: 'G', color: '#5aa35a' },
  t: { label: 'Thiếu niên trở lên', short: 'T', color: '#d1a10d' },
  m: { label: 'Trưởng thành', short: 'M', color: '#e07a1f' },
  e: { label: 'Người lớn (18+)', short: 'E', color: '#c0392b' },
};
export const WARNINGS = {
  none: 'Không có cảnh báo',
  choose: 'Tác giả không cảnh báo',
  violence: 'Bạo lực',
  death: 'Nhân vật chính chết',
  noncon: 'Không đồng thuận',
  underage: 'Vị thành niên',
};
export const CATEGORIES = { gen: 'Gen', fm: 'F/M', mm: 'M/M', ff: 'F/F', multi: 'Nhiều cặp', other: 'Khác' };

// Where the fanfic comes from: written here, or someone else's work saved to track and read.
export const ORIGINS = { mine: 'Tôi viết', saved: 'Đã lưu (của tác giả khác)' };

export const CH_STATUS = { idea: 'Ý tưởng', draft: 'Nháp', revised: 'Đã sửa', final: 'Hoàn chỉnh' };
export const CH_LABELS = { '': 'Không nhãn', red: '#e5534b', orange: '#f0883e', yellow: '#d4a72c', green: '#57ab5a', blue: '#539bf5', purple: '#b083f0' };

export const NOTE_KINDS = {
  character: ['Nhân vật', 'fx-person'],
  plot: ['Cốt truyện', 'fx-plot'],
  research: ['Tư liệu', 'fx-research'],
  world: ['Bối cảnh', 'fx-world'],
  idea: ['Ý tưởng', 'fx-idea'],
  todo: ['Việc cần làm', 'check'],
};

export const FANDOM_KINDS = {
  book: 'Sách', film: 'Phim', tv: 'Phim truyền hình', anime: 'Anime / Manga', game: 'Trò chơi',
  comic: 'Truyện tranh', music: 'Âm nhạc / Thần tượng', original: 'Nguyên tác (Original)', other: 'Khác',
};
