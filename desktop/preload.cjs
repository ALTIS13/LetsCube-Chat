const { contextBridge, ipcRenderer } = require("electron");

const RUNTIME_INFO_CHANNEL = "letscube-desktop:get-runtime-info";

contextBridge.exposeInMainWorld("letscubeDesktop", Object.freeze({
  platform: "windows",
  getRuntimeInfo: () => ipcRenderer.invoke(RUNTIME_INFO_CHANNEL),
}));
