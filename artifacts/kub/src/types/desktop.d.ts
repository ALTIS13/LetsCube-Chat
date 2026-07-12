type LetscubeDesktopRuntimeInfo = {
  platform: "windows";
  version: string;
  build: number;
};

interface Window {
  letscubeDesktop?: {
    readonly platform: "windows";
    readonly version?: string;
    readonly build?: number;
    getRuntimeInfo(): Promise<LetscubeDesktopRuntimeInfo>;
  };
}
