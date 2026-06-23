import { contextBridge, ipcRenderer } from "electron";
import type { AgentSettings, RuntimeInfo } from "../src/shared/types";

const desktopApi = {
  getRuntimeInfo: (): Promise<RuntimeInfo> => ipcRenderer.invoke("runtime:info"),
  loadSettings: (): Promise<AgentSettings> => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: AgentSettings): Promise<AgentSettings> =>
    ipcRenderer.invoke("settings:save", settings),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
};

contextBridge.exposeInMainWorld("nexoDesktop", desktopApi);
