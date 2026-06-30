import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentSettings,
  BrowserActionRequest,
  BrowserActionResponse,
  BrowserBounds,
  BrowserElementPickResult,
  BrowserState,
  RuntimeInfo,
} from "../src/shared/types";
import type { DesktopApi, DesktopThemeMode } from "../src/shared/desktop";

const desktopApi: DesktopApi = {
  getRuntimeInfo: (): Promise<RuntimeInfo> => ipcRenderer.invoke("runtime:info"),
  loadSettings: (): Promise<AgentSettings> => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: AgentSettings): Promise<AgentSettings> =>
    ipcRenderer.invoke("settings:save", settings),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  setThemeMode: (mode: DesktopThemeMode): Promise<void> => ipcRenderer.invoke("theme:set", mode),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  unmaximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:unmaximize"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),
  openBrowserWorkbench: (): Promise<void> => ipcRenderer.invoke("browser:open-workbench"),
  closeBrowserWorkbench: (): Promise<void> => ipcRenderer.invoke("browser:close-workbench"),
  setBrowserBounds: (bounds: Partial<BrowserBounds>): Promise<void> => ipcRenderer.invoke("browser:set-bounds", bounds),
  setBrowserZoom: (mode: "in" | "out" | "reset"): Promise<BrowserState> => ipcRenderer.invoke("browser:set-zoom", mode),
  getBrowserState: (): Promise<BrowserState> => ipcRenderer.invoke("browser:get-state"),
  browserAction: (request: BrowserActionRequest): Promise<BrowserActionResponse> => ipcRenderer.invoke("browser:action", request),
  pickBrowserElement: (): Promise<BrowserElementPickResult> => ipcRenderer.invoke("browser:pick-element"),
  onWindowMaximizedChange: (listener) => {
    const channel = "window:maximized-changed";
    const wrapped = (_event: unknown, maximized: boolean) => listener(maximized);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  onBrowserStateChange: (listener) => {
    const channel = "browser:state-changed";
    const wrapped = (_event: unknown, state: BrowserState) => listener(state);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  onTaskSessionRequested: (listener) => {
    const channel = "task:open-session";
    const wrapped = (_event: unknown, payload: { sessionId?: string } | string) => {
      const sessionId = typeof payload === "string" ? payload : payload?.sessionId;
      if (sessionId) listener(sessionId);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("nexoDesktop", desktopApi);
