// Account page: the GitHub account (sign in / out, profile, sync status, devices, repo data).
// Reached from the sidebar badge (#storage-badge) and Settings; not shown in the navigation.
export default {
  id: 'account',
  name: 'Tài khoản',
  version: '0.3.1',
  core: true,
  nav: false,
  icon: 'user',
  route: 'account',
  order: 98,
  description: 'Tài khoản GitHub: đăng nhập, đồng bộ giữa máy tính và điện thoại qua kho riêng tư, thiết bị, đăng xuất.',
  files: ['js/modules/account/index.js', 'js/modules/account/manifest.js'],
};
