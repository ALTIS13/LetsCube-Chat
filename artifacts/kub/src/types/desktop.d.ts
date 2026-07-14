type LetscubeDesktopRuntimeInfo = {
  platform: "windows";
  version: string;
  build: number;
};

type LetscubeDesktopUpdateChannel = "stable" | "test";

type LetscubeDesktopNotification = {
  id: number;
  title: string;
  body: string;
  kind: "message" | "task" | "system";
  group: string;
  header?: {
    id: string;
    title: string;
    route: string;
  };
  route: string;
};

type LetscubeDesktopNotificationIdentity = Pick<
  LetscubeDesktopNotification,
  "id" | "kind" | "group"
>;

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
    isMainForeground(): Promise<boolean>;
    notify(notification: LetscubeDesktopNotification): Promise<boolean>;
    removeNotification(notification: LetscubeDesktopNotificationIdentity): Promise<boolean>;
    takePendingNotificationRoute(): Promise<string | null>;
  };
}
