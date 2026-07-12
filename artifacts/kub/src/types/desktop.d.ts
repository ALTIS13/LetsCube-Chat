type LetscubeDesktopRuntimeInfo = {
  platform: "windows";
  version: string;
  build: number;
};

interface Window {
  letscubeDesktop?: {
    readonly platform: "windows";
    getRuntimeInfo(): Promise<LetscubeDesktopRuntimeInfo>;
  };
}
