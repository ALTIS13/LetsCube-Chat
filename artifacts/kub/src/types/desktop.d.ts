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
  icon?: string;
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
    getStorageState(): Promise<unknown>;
    /**
     * `null` restores the default location. The argument is the *parent*
     * folder: the shell creates its own profile folder inside it.
     *
     * Rejects with one of the codes in `DESKTOP_STORAGE_ERROR_CODES`.
     */
    setStorageLocation(location: string | null): Promise<unknown>;
    setCacheLimit(bytes: number): Promise<unknown>;
    clearCache(): Promise<unknown>;
    showMain(): Promise<void>;
    isMainForeground(): Promise<boolean>;
    notify(notification: LetscubeDesktopNotification): Promise<boolean>;
    removeNotification(notification: LetscubeDesktopNotificationIdentity): Promise<boolean>;
    takePendingNotificationRoute(): Promise<string | null>;
    startDragging(): Promise<void>;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    isMaximized(): Promise<boolean>;
    closeToTray(): Promise<void>;
  };
}
