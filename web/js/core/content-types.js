// Every kind of content the hub knows about. The Library shows all of them;
// `module` is the module that opens/plays it. Add a type here when adding a module.
export const CONTENT_TYPES = {
  music:   { label: 'Nhạc',     icon: 'music',   module: 'music',   mime: [/^audio\//], ext: ['mp3', 'flac', 'm4a', 'alac', 'aac', 'ogg', 'oga', 'opus', 'wav', 'aif', 'aiff', 'wv', 'ape', 'dsf', 'dff', 'wma'] },
  podcast: { label: 'Podcast',  icon: 'podcast', module: 'music',   mime: [], ext: [] },
  fanfic:  { label: 'Fanfic',   icon: 'quill',   module: 'fanfic',  mime: [], ext: ['html', 'htm'] },
  book:    { label: 'Sách',     icon: 'book',    module: 'books',   mime: [/^application\/(pdf|epub\+zip|x-mobipocket-ebook|vnd\.comicbook\+zip|x-fictionbook\+xml)$/], ext: ['pdf', 'epub', 'mobi', 'azw', 'azw3', 'kf8', 'prc', 'fb2', 'fbz', 'cbz', 'cbr', 'cb7', 'djvu', 'docx'] },
  video:   { label: 'Video',    icon: 'video',   module: 'video',   mime: [/^video\//], ext: ['mp4', 'mkv', 'webm', 'mov'] },
  image:   { label: 'Ảnh',      icon: 'image',   module: 'gallery', mime: [/^image\//], ext: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
  note:    { label: 'Ghi chú',  icon: 'note',    module: 'notes',   mime: [/^text\//], ext: ['md', 'txt'] },
};

export function detectType(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  for (const [type, def] of Object.entries(CONTENT_TYPES)) {
    if (def.mime.some(re => re.test(file.type)) || def.ext.includes(ext)) return type;
  }
  return 'note';
}

export const STATUS = {
  new: 'Chưa mở',
  'in-progress': 'Đang dở',
  done: 'Đã xong',
};
