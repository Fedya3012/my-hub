// Landing page of the Google sign-in (oauth-google.html). Google puts the result in the address (?code=…&state=…);
// this hands it to My Hub: to the window that opened the popup (web), through the Windows shell when the sign-in
// ran in the system browser (localhost), or back into the Android app (com.myhub.app://oauth, from GitHub Pages).
// The code is useless without the secret check value (PKCE) that only the waiting app holds.
(function () {
  var query = location.search || location.hash;
  var msg = document.getElementById('msg');
  history.replaceState(null, '', location.pathname);   // the code does not stay in the address bar or history
  if (window.opener && !window.opener.closed) {
    try { window.opener.postMessage({ type: 'hub-google', query: query }, location.origin); } catch (e) { /* opener gone */ }
    window.close();
    msg.textContent = 'Đã đăng nhập. Bạn có thể đóng cửa sổ này.';
    return;
  }
  if (/^http:\/\/localhost:\d+$/.test(location.origin)) {
    fetch('/__google', { method: 'POST', body: query }).then(function () {
      msg.textContent = 'Đã đăng nhập Google. Quay lại My Hub, có thể đóng trang này.';
    }, function () { msg.textContent = 'Không gửi được kết quả về My Hub. Hãy mở My Hub rồi thử lại.'; });
    return;
  }
  // Android: back into the app. Some browsers only follow an app link after a tap, hence the button.
  var back = 'com.myhub.app://oauth' + (query.charAt(0) === '?' ? query : '?' + query.slice(1));
  msg.innerHTML = 'Đang quay lại My Hub… <br><br><a id="back" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1f7a8c;color:#fff;text-decoration:none;font-weight:600">Mở lại My Hub</a>';
  document.getElementById('back').href = back;
  location.href = back;
})();
