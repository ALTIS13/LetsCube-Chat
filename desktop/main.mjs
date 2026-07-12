import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import {
  isAllowedExternalUrl,
  isAllowedNavigationUrl,
  isAllowedPermission,
  PRODUCTION_APP_ORIGIN,
} from "./security.mjs";

const require = createRequire(import.meta.url);
const packageMetadata = require("./package.json");
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const APP_ID = "ru.letscube.messenger";
const RUNTIME_INFO_CHANNEL = "letscube-desktop:get-runtime-info";
const START_URL = `${PRODUCTION_APP_ORIGIN}/`;
let mainWindow = null;

app.setAppUserModelId(APP_ID);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    configureRuntimeBridge();
    createMainWindow();
  });
}

app.on("window-all-closed", () => app.quit());

function createMainWindow() {
  const window = new BrowserWindow({
    title: "LETSCUBE",
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#17212b",
    icon: join(currentDirectory, "assets/letscube.ico"),
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      partition: "persist:letscube",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: true,
    },
  });
  mainWindow = window;
  configureSessionPermissions(window.webContents.session);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  const guardNavigation = (event, url) => {
    if (isAllowedNavigationUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  void resetPackagedWebCaches(window.webContents.session)
    .then(() => window.loadURL(START_URL))
    .catch(() => window.show());
}

async function resetPackagedWebCaches(currentSession) {
  await Promise.allSettled([
    currentSession.clearCache(),
    currentSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] }),
  ]);
}

function configureSessionPermissions(currentSession) {
  currentSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => (
    isAllowedPermission(requestingOrigin, permission, details)
  ));
  currentSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(isAllowedPermission(requestingUrl, permission, details));
  });
}

function configureRuntimeBridge() {
  ipcMain.handle(RUNTIME_INFO_CHANNEL, (event) => {
    if (!isAllowedNavigationUrl(event.senderFrame.url)) {
      throw new Error("Desktop runtime request rejected.");
    }
    return {
      platform: "windows",
      version: app.getVersion(),
      build: normalizeDesktopBuild(packageMetadata.desktopBuild),
    };
  });
}

function normalizeDesktopBuild(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
