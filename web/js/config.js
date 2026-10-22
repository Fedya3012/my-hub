// App-wide configuration. Rename the app here (and in manifest.webmanifest).
export const APP_NAME = 'My Hub';
export const APP_VERSION = '0.9.11.0';

// Where version.json lives (used by the updater). Relative = same server as the app.
export const VERSION_URL = 'version.json';

// Dropbox sync: the App key of a free Dropbox app (type "Scoped access" + "App folder", permissions files.content.read/write).
// Leave empty to type it in when connecting. docs/STORAGE.md explains how to create the app.
export const DROPBOX_APP_KEY = '';
// OneDrive sync: Application (client) ID of a free Microsoft Entra app (platform "Mobile and desktop", redirect
// https://login.microsoftonline.com/common/oauth2/nativeclient, permissions Files.ReadWrite.AppFolder + offline_access).
export const ONEDRIVE_CLIENT_ID = '';
