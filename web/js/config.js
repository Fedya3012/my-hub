// App-wide configuration. Rename the app here (and in manifest.webmanifest).
export const APP_NAME = 'My Hub';
export const APP_VERSION = '0.7.0.6';

// ─── Tài khoản Google (đăng nhập + đồng bộ qua Google Drive) ─────────────────
// Leave GOOGLE_CLIENT_ID empty to run in Local mode only (the Account page then shows the setup
// guide). Otherwise create an OAuth 2.0 Client ID (type "Web application") in Google Cloud
// Console, enable the Google Drive API, add your site origin (e.g. https://yourname.github.io)
// and http://localhost:8080 to "Authorized JavaScript origins", and paste the client ID below.
// Step-by-step: docs/ACCOUNT.md. Scopes used:
//   drive.appdata          -> hidden app folder: database snapshot, progress, devices
//   drive.file             -> only files this app created (music, books, videos...)
//   openid email profile   -> show the signed-in name, email and avatar
export const GOOGLE_CLIENT_ID = '609232128319-4gmmeubarom3tli5gmqdq73ud6h9gcr8.apps.googleusercontent.com';
// App Android/Windows đăng nhập Google bằng trình duyệt; Google chuyển về trang này (phải khai báo trong
// "Authorized redirect URIs" của Client ID). Trang do GitHub Pages phục vụ (xem .github/workflows/pages.yml).
export const OAUTH_PAGE = 'https://fedya3012.github.io/my-hub/oauth.html';   // e.g. '1234-abc.apps.googleusercontent.com'
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file openid email profile';
export const DRIVE_FOLDER_NAME = 'My Hub';

// Where version.json lives (used by the updater). Relative = same server as the app.
export const VERSION_URL = 'version.json';
