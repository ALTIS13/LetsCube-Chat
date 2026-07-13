type LetscubeDesktopRuntimeInfo = {
  platform: "windows";
  version: string;
  build: number;
};

type LetscubeDesktopUpdateChannel = "stable" | "test";

interface Window {
  letscubeDesktop?: {
    readonly platform: "windows";
    readonly version?: string;
    readonly build?: number;
    getRuntimeInfo(): Promise<LetscubeDesktopRuntimeInfo>;
    getUpdateState(): Promise<unknown>;
    getUpdateChannel(): Promise<unknown>;
    setUpdateChannel(channel: LetscubeDesktopUpdateChannel): Promise<unknown>;
    checkUpdate(): Promise<unknown>;
    installUpdate(): Promise<unknown>;
    showMain(): Promise<void>;
  };
}
