import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, Notification, shell, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { createExpressApp } from "./server/index";
import { applyAgentSettings } from "./server/settings";
import { DATA_DIR, SETTINGS_FILE } from "./server/config";
import { cleanupOldSnapshots } from "./server/snapshot";
import { browserManager } from "./server/browser-manager";
import {
  getDefaultServiceProviderName,
  getProviderDefaultApiBase,
  normalizeProviderApiBase,
  normalizeProviderId,
  normalizeServiceProviderName,
} from "../src/shared/providers";
import type {
  AgentSettings,
  RuntimeInfo
} from "../src/shared/types";
import { isPreservedApiKeyInput } from "../src/shared/settings";
import type { DesktopThemeMode } from "../src/shared/desktop";
import type { TaskExecutionResult } from "./server/tasks";

interface StoredSettings extends Omit<AgentSettings, "apiKey" | "hasApiKey"> {
  encryptedApiKey?: string;
  plainApiKey?: string;
}

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

const defaultSettings: AgentSettings = {
  providerId: "openai-compatible",
  providerName: getDefaultServiceProviderName("openai-compatible"),
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  hasApiKey: false,
  model: "gpt-4o-mini",
  temperature: 0.4,
  contextWindowTokens: 128_000,
  reservedOutputTokens: 8_192,
  autoCompactTokenLimit: 96_000,
  compactionTargetRatio: 0.6,
  contextWindowSource: "default",
  contextWindowSourceDetail: "desktop-default",
  maxContextTurns: 12,
  enableContextCompaction: true,
  contextCompactionThreshold: 24,
  shellCommandTimeoutMs: 300_000,
  planningMode: "balanced",
  thinkingEnabled: true,
  thinkingEffort: "high",
  circuitBreakerEnabled: true,
  circuitBreakerConsecutiveFailureLimit: 3,
  circuitBreakerRepeatedToolCallLimit: 10,
  circuitBreakerTokenBudget: 0,
  enableMemory: true,
  enableKnowledge: true,
  workspacePath: "",
  fileAccessRoots: [],
  webHost: "127.0.0.1",
  webPort: 9898,
  webPassword: "",
  channels: {
    web: true,
    desktop: true,
    feishu: false,
    dingtalk: false,
    wechat: false,
    wecom: false
  }
};

let mainWindow: BrowserWindow | null = null;
let httpServer: http.Server | null = null;
let webServerPort = 9898;
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const TOGGLE_DEVTOOLS_SHORTCUT = process.platform === "darwin" ? "Command+Alt+L" : "Control+Alt+L";
const DESKTOP_THEME_BACKGROUNDS: Record<DesktopThemeMode, string> = {
  dark: "#0e1726",
  light: "#f8fafc",
};
if (!gotSingleInstanceLock) {
  app.quit();
}

let cachedApiKey = "";

function normalizeSettingsShape<T extends Partial<AgentSettings>>(settings: T): T {
  const providerId = normalizeProviderId(settings.providerId);
  const apiBase = normalizeProviderApiBase(
    settings.apiBase?.trim() || getProviderDefaultApiBase(providerId),
    providerId,
    settings.providerName,
  );
  return {
    ...settings,
    providerId,
    providerName: normalizeServiceProviderName(settings.providerName, apiBase, providerId) || getDefaultServiceProviderName(providerId),
    apiBase,
  };
}

// 启动时预加载 API Key，并在每次保存设置后刷新
async function refreshCachedApiKey() {
  const stored = await readStoredSettings();
  cachedApiKey = decryptApiKey(stored);
}

async function findAvailablePort(preferredPort: number, host: string) {
  const canListen = (port: number) => new Promise<boolean>((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });

  if (await canListen(preferredPort)) return preferredPort;

  return new Promise<number>((resolve, reject) => {
    const tester = net.createServer();
    tester.once("error", reject);
    tester.once("listening", () => {
      const address = tester.address();
      const port = typeof address === "object" && address ? address.port : preferredPort;
      tester.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    tester.listen(0, host);
  });
}

async function syncServerSettingsFromDisk() {
  const stored = await readStoredSettings();
  if (!stored) return;
  const apiKey = decryptApiKey(stored);
  const normalized = normalizeSettingsShape(stored);
  applyAgentSettings({
    ...defaultSettings,
    ...normalized,
    apiKey,
    hasApiKey: Boolean(apiKey),
  });
}

function pushSettingsToBackend(settings: AgentSettings, apiKey = "") {
  const normalized = normalizeSettingsShape(settings);
  applyAgentSettings({
    ...normalized,
    apiKey,
    hasApiKey: Boolean(apiKey) || normalized.hasApiKey,
  });
}

function getDesktopAppUrl() {
  return `http://localhost:${webServerPort}`;
}

function getWindowThemeMode(themeMode?: DesktopThemeMode): DesktopThemeMode {
  if (themeMode) {
    return themeMode;
  }
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function applyDesktopTheme(themeMode: DesktopThemeMode) {
  nativeTheme.themeSource = themeMode;

  if (!mainWindow) {
    return;
  }

  mainWindow.setBackgroundColor(DESKTOP_THEME_BACKGROUNDS[themeMode]);
}

function openTaskSessionFromDesktop(sessionId: string) {
  focusMainWindow();

  const deliver = () => {
    mainWindow?.webContents.send("task:open-session", { sessionId });
  };

  if (mainWindow?.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", deliver);
    return;
  }

  deliver();
}

function buildTaskNotificationBody(result: TaskExecutionResult) {
  if (result.status === "failed") {
    return result.assistantPreview || "The task failed. Click to open the task session.";
  }
  if (result.status === "needs_input") {
    return result.assistantPreview || "The task needs follow-up. Click to open the task session.";
  }
  if (result.status === "interrupted") {
    return result.assistantPreview || "The task was interrupted. Click to open the task session.";
  }
  return result.assistantPreview || "The task session is ready.";
}

function showTaskFinishedNotification(result: TaskExecutionResult) {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: result.status === "failed" ? `Nexo Task Failed: ${result.taskName}` : `Nexo Task Ready: ${result.taskName}`,
    body: buildTaskNotificationBody(result),
    icon: windowIconPath(),
    silent: false,
  });
  notification.on("click", () => {
    openTaskSessionFromDesktop(result.sessionId);
  });
  notification.show();
}

async function startHttpServer() {
  await refreshCachedApiKey();
  await syncServerSettingsFromDisk();
  const expressApp = createExpressApp(() => cachedApiKey, {
    onTaskFinished: (result, meta) => {
      if (meta.origin === "scheduler") {
        showTaskFinishedNotification(result);
      }
    },
  });
  const host = "0.0.0.0";
  const port = await findAvailablePort(9898, host);
  webServerPort = port;
  httpServer = http.createServer(expressApp);
  await new Promise<void>((resolve, reject) => {
    httpServer!.once("error", reject);
    httpServer!.listen(port, host, () => {
      console.log(`Nexo Agent web console: ${getDesktopAppUrl()}`);
      resolve();
    });
  });
}

function settingsPath() {
  return SETTINGS_FILE;
}

let settingsMigrated = false;

async function ensureSettingsMigrated() {
  if (settingsMigrated) return;
  settingsMigrated = true;

  try {
    await fs.access(SETTINGS_FILE);
    return;
  } catch {
    // Continue with legacy migration.
  }

  const legacyPath = path.join(app.getPath("userData"), "settings.json");
  try {
    const raw = await fs.readFile(legacyPath, "utf8");
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(SETTINGS_FILE, raw, "utf8");
  } catch {
    // No legacy settings to migrate.
  }
}

function appAssetPath(fileName: string) {
  return path.join(app.getAppPath(), "assets", fileName);
}

function windowIconPath() {
  return process.platform === "win32" ? appAssetPath("nexoagent-icon.ico") : appAssetPath("nexoagent-icon.png");
}

async function readStoredSettings(): Promise<StoredSettings | null> {
  await ensureSettingsMigrated();
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    return JSON.parse(raw) as StoredSettings;
  } catch (error) {
    return null;
  }
}

function decryptApiKey(stored: StoredSettings | null): string {
  if (!stored) {
    return "";
  }

  if (stored.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage
        .decryptString(Buffer.from(stored.encryptedApiKey, "base64"))
        .trim();
    } catch (error) {
      return "";
    }
  }

  return stored.plainApiKey?.trim() ?? "";
}

function encryptApiKey(apiKey: string) {
  const cleanKey = apiKey.trim();

  if (!cleanKey) {
    return {};
  }

  if (safeStorage.isEncryptionAvailable()) {
    return {
      encryptedApiKey: safeStorage.encryptString(cleanKey).toString("base64")
    };
  }

  return { plainApiKey: cleanKey };
}

async function loadSettings(): Promise<AgentSettings> {
  const stored = await readStoredSettings();
  const apiKey = decryptApiKey(stored);
  const normalized = stored ? normalizeSettingsShape(stored) : null;

  return {
    ...defaultSettings,
    ...(normalized ?? {}),
    apiKey: "",
    hasApiKey: Boolean(apiKey)
  };
}

async function saveSettings(settings: AgentSettings): Promise<AgentSettings> {
  const existing = await loadSettings();
  const mergedInput = normalizeSettingsShape({ ...existing, ...settings });
  const existingStored = await readStoredSettings();
  const { apiKey, hasApiKey, ...settingsForDisk } = {
    ...defaultSettings,
    ...mergedInput,
  };
  const secret =
    !isPreservedApiKeyInput(apiKey)
      ? encryptApiKey(apiKey)
      : {
          encryptedApiKey: existingStored?.encryptedApiKey,
          plainApiKey: existingStored?.plainApiKey
        };

  const stored: StoredSettings = {
    ...settingsForDisk,
    ...secret
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(stored, null, 2), "utf8");

  return loadSettings();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    icon: windowIconPath(),
    title: "Nexo Agent",
    backgroundColor: DESKTOP_THEME_BACKGROUNDS[getWindowThemeMode()],
    show: false,
    autoHideMenuBar: true,
    frame: process.platform === "win32" ? false : true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  browserManager.setMainWindow(mainWindow);

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", false);
  });
  mainWindow.on("closed", () => {
    browserManager.setMainWindow(null);
    mainWindow = null;
  });

  if (process.platform !== "darwin") {
    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isAppUrl = isDev
      ? url.startsWith(process.env.VITE_DEV_SERVER_URL ?? "")
      : url.startsWith(getDesktopAppUrl());

    if (!isAppUrl) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isToggleShortcut =
      input.type === "keyDown"
      && (
        input.key === "F12"
        || ((input.control || input.meta) && input.shift && input.key.toUpperCase() === "I")
      );

    if (isToggleShortcut) {
      event.preventDefault();
      toggleDeveloperTools();
    }
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadURL(getDesktopAppUrl());
  }

  applyDesktopTheme(getWindowThemeMode());
}

function focusMainWindow() {
  if (!mainWindow) {
    createWindow();
  }

  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

function toggleDeveloperTools() {
  focusMainWindow();
  if (!mainWindow) return;

  const applyToggle = () => {
    if (!mainWindow) return;
    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    } else {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", applyToggle);
    return;
  }

  applyToggle();
}

function registerDesktopShortcuts() {
  const registered = globalShortcut.register(TOGGLE_DEVTOOLS_SHORTCUT, toggleDeveloperTools);
  if (!registered) {
    console.warn(`[shortcut] failed to register ${TOGGLE_DEVTOOLS_SHORTCUT}`);
  }
}

ipcMain.handle("runtime:info", (): RuntimeInfo => ({
  surface: "desktop",
  platform: process.platform,
  version: app.getVersion(),
  userDataPath: DATA_DIR,
  webBaseUrl: getDesktopAppUrl(),
}));
ipcMain.handle("browser:open-workbench", async () => {
  await browserManager.openWorkbench();
});
ipcMain.handle("browser:close-workbench", async () => {
  await browserManager.closeWorkbench();
});
ipcMain.handle("browser:set-bounds", async (_event, bounds: Partial<{ x: number; y: number; width: number; height: number }>) => {
  browserManager.syncWindowBounds(bounds);
});
ipcMain.handle("browser:set-zoom", async (_event, mode: "in" | "out" | "reset") => browserManager.setZoom(mode));
ipcMain.handle("browser:get-state", async () => browserManager.getState());
ipcMain.handle("browser:action", async (_event, request) => browserManager.executeAction(request));
ipcMain.handle("browser:pick-element", async () => browserManager.pickElement());

ipcMain.handle("settings:load", loadSettings);
ipcMain.handle("settings:save", async (_event, settings: AgentSettings) => {
  const result = await saveSettings(settings);
  await refreshCachedApiKey();
  pushSettingsToBackend(result, cachedApiKey);
  return result;
});
ipcMain.handle("theme:set", async (_event, mode: DesktopThemeMode) => {
  applyDesktopTheme(mode);
});
ipcMain.handle("window:minimize", async () => {
  mainWindow?.minimize();
});
ipcMain.handle("window:maximize", async () => {
  if (!mainWindow) return;
  if (!mainWindow.isMaximized()) {
    mainWindow.maximize();
  }
});
ipcMain.handle("window:unmaximize", async () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  }
});
ipcMain.handle("window:close", async () => {
  mainWindow?.close();
});
ipcMain.handle("window:isMaximized", async () => {
  return mainWindow?.isMaximized() ?? false;
});
ipcMain.handle("shell:openExternal", async (_event, url: string) => {
  if (typeof url !== "string" || !url.trim()) return;
  await shell.openExternal(url.trim());
});

if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    await startHttpServer();
    void cleanupOldSnapshots();
    registerDesktopShortcuts();
    if (process.platform === "darwin" && app.dock) {
      app.dock.setIcon(appAssetPath("nexoagent-icon.png"));
    }
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  httpServer?.close();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  browserManager.destroy();
  globalShortcut.unregisterAll();
});
