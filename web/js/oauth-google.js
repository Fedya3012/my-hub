// Landing page of the Google sign-in (oauth-google.html). Google puts the result in the address (#access_token=…);
// this hands it to My Hub and closes: to the window that opened the popup (web), or through the Windows shell
// when the sign-in ran in the system browser. The token never goes anywhere else.
(function () {
  var hash = location.hash;
  var msg = document.getElementById('msg');
  history.replaceState(null, '', location.pathname);   // the token does not stay in the address bar or history
  if (window.opener && !window.opener.closed) {
    try { window.opener.postMessage({ type: 'hub-google', hash: hash }, location.origin); } catch (e) { /* opener gone */ }
    window.close();
    msg.textContent = 'Đã đăng nhập. Bạn có thể đóng cửa sổ này.';
    return;
  }
  if (/^http:\/\/localhost:\d+$/.test(location.origin)) {
    fetch('/__google', { method: 'POST', body: hash }).then(function () {
      msg.textContent = 'Đã đăng nhập Google. Quay lại My Hub, có thể đóng trang này.';
    }, function () { msg.textContent = 'Không gửi được kết quả về My Hub. Hãy mở My Hub rồi thử lại.'; });
    return;
  }
  msg.textContent = 'Không tìm thấy cửa sổ My Hub. Hãy mở My Hub rồi thử lại.';
})();
