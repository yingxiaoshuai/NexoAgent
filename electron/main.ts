import { app, BrowserWindow, ipcMain, shell, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { createExpressApp } from "./server/index";
import { applyAgentSettings } from "./server/settings";
import { getProviderDefaultApiBase, getProviderName, normalizeProviderId } from "../src/shared/providers";
import type {
  AgentSettings,
  RuntimeInfo
} from "../src/shared/types";
import { isPreservedApiKeyInput } from "../src/shared/settings";

interface StoredSettings extends Omit<AgentSettings, "apiKey" | "hasApiKey"> {
  encryptedApiKey?: string;
  plainApiKey?: string;
}

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

const defaultSettings: AgentSettings = {
  providerId: "openai-compatible",
  providerName: getProviderName("openai-compatible"),
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
  maxSteps: 20,
  shellCommandTimeoutMs: 300_000,
  planningMode: "balanced",
  circuitBreakerEnabled: true,
  circuitBreakerConsecutiveFailureLimit: 3,
  circuitBreakerRepeatedToolCallLimit: 3,
  circuitBreakerNoProgressLimit: 4,
  circuitBreakerMaxRuntimeMs: 600_000,
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

if (!gotSingleInstanceLock) {
  app.quit();
}

let cachedApiKey = "";

function normalizeSettingsShape<T extends Partial<AgentSettings>>(settings: T): T {
  const providerId = normalizeProviderId(settings.providerId);
  return {
    ...settings,
    providerId,
    providerName: getProviderName(providerId),
    apiBase: (settings.apiBase?.trim() || getProviderDefaultApiBase(providerId)).replace(/\/+$/, ""),
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

async function startHttpServer() {
  await refreshCachedApiKey();
  await syncServerSettingsFromDisk();
  const expressApp = createExpressApp(() => cachedApiKey);
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
  return path.join(app.getPath("userData"), "settings.json");
}

function appAssetPath(fileName: string) {
  return path.join(app.getAppPath(), "assets", fileName);
}

function windowIconPath() {
  return process.platform === "win32" ? appAssetPath("nexoagent-icon.ico") : appAssetPath("nexoagent-icon.png");
}

async function readStoredSettings(): Promise<StoredSettings | null> {
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

  await fs.mkdir(app.getPath("userData"), { recursive: true });
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
    backgroundColor: "#0e1726",
    show: false,
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

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadURL(getDesktopAppUrl());
  }
}

ipcMain.handle("runtime:info", (): RuntimeInfo => ({
  surface: "desktop",
  platform: process.platform,
  version: app.getVersion(),
  userDataPath: app.getPath("userData"),
  webBaseUrl: getDesktopAppUrl(),
}));

ipcMain.handle("settings:load", loadSettings);
ipcMain.handle("settings:save", async (_event, settings: AgentSettings) => {
  const result = await saveSettings(settings);
  await refreshCachedApiKey();
  pushSettingsToBackend(result, cachedApiKey);
  return result;
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
