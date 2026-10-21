// Repeat / shuffle modes: one icon and one label per mode, shared by the menus and the buttons that show the mode.
export const REPEAT_MODES = [
  { id: 'stop1', icon: 'rep-stop1', label: 'Phát một bài hát', desc: 'Phát bài hiện tại rồi dừng' },
  { id: 'off', icon: 'rep-cat-stop', label: 'Phát danh mục', desc: 'Phát danh mục hiện tại rồi dừng' },
  { id: 'allcats', icon: 'rep-all-stop', label: 'Phát tất cả danh mục', desc: 'Phát lần lượt tất cả danh mục rồi dừng' },
  { id: 'one', icon: 'repeat-one', label: 'Lặp lại bài hát', desc: 'Phát bài hiện tại và lặp lại' },
  { id: 'all', icon: 'repeat', label: 'Lặp lại danh mục', desc: 'Phát danh mục hiện tại và lặp lại' },
  { id: 'repeatcats', icon: 'rep-all-loop', label: 'Lặp lại tất cả danh mục', desc: 'Phát lần lượt tất cả danh mục và lặp lại' },
];
export const repeatMode = (id) => REPEAT_MODES.find(m => m.id === id) || REPEAT_MODES[1];

// Shuffle: songs inside a category and / or the order of the categories.
export const shuffleId = (songs, cats) => songs && cats ? 'both' : songs ? 'songs' : cats ? 'cats' : 'off';
export const SHUFFLE_MODES = [
  { id: 'off', icon: 'shuf-off', label: 'Tắt ngẫu nhiên', songs: false, cats: false },
  { id: 'songs', icon: 'shuf-songs', label: 'Trộn bài hát', desc: 'Danh mục vẫn theo thứ tự', songs: true, cats: false },
  { id: 'cats', icon: 'shuf-cats', label: 'Danh mục ngẫu nhiên', desc: 'Bài hát vẫn theo thứ tự', songs: false, cats: true },
  { id: 'both', icon: 'shuf-both', label: 'Ngẫu nhiên bài hát/danh mục', desc: 'Trộn cả bài hát lẫn thứ tự danh mục', songs: true, cats: true },
];
export const shuffleMode = (songs, cats) => SHUFFLE_MODES.find(m => m.id === shuffleId(songs, cats));
