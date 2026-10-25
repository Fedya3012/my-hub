export default {
  id: 'library',
  name: 'Thư viện',
  version: '0.4.2',
  core: true,            // cannot be disabled: it is the home screen
  icon: 'library',
  route: 'library',
  order: 1,
  description: 'Trang chủ tổng hợp mọi nội dung: lọc, tìm kiếm, sắp xếp, thống kê, thao tác nhanh.',
  contentTypes: '*',
  files: ['js/modules/library/index.js', 'js/modules/library/manifest.js'],
};
