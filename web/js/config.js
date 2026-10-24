// App-wide configuration. Rename the app here (and in manifest.webmanifest).
export const APP_NAME = 'My Hub';
export const APP_VERSION = '0.9.21.2';

// Where version.json lives (used by the updater). Relative = same server as the app.
export const VERSION_URL = 'version.json';

// Dropbox sync: the App key of a free Dropbox app (type "Scoped access" + "App folder", permissions files.content.read/write).
// Leave empty to type it in when connecting. docs/STORAGE.md explains how to create the app.
export const DROPBOX_APP_KEY = '';
// OneDrive sync: Application (client) ID of a free Microsoft Entra app (platform "Mobile and desktop", redirect
// https://login.microsoftonline.com/common/oauth2/nativeclient, permissions Files.ReadWrite.AppFolder + offline_access).
export const ONEDRIVE_CLIENT_ID = '';
// Google Drive: OAuth client of type "Desktop app" (Google Cloud Console → APIs & Services → Credentials).
// Its client secret is not secret for installed apps (Google's own rule). Both can also be pasted in the dialog.
export const GOOGLE_CLIENT_ID = '';
export const GOOGLE_CLIENT_SECRET = '';
// Google Drive one-tap sign-in ("Đăng nhập bằng Google"): OAuth client of type "Web application" with the origins
// https://fedya3012.github.io and http://localhost:47821 and the redirect <origin>/…/oauth-google.html.
export const GOOGLE_WEB_CLIENT_ID = '442469437504-i6tl22nkukmbeiqk5ikl3qa2d01euq3a.apps.googleusercontent.com';
// Its secret: needed to swap the sign-in code for a lasting (refresh) token. An app that runs on the user's device
// cannot hide it; it only lets someone ask Google for a sign-in in My Hub's name, never read anyone's Drive.
// Kept out of the public repository: paste it locally, or set it once the owner decides how to ship it.
export const GOOGLE_WEB_CLIENT_SECRET = '';
// Where Android's sign-in lands before going back to the app (GitHub Pages, workflow pages.yml).
export const GOOGLE_PAGES_REDIRECT = 'https://fedya3012.github.io/my-hub/oauth-google.html';
