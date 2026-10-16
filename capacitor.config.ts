import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.kub.messenger",
  appName: "LETSCUBE",
  webDir: "artifacts/kub/dist/public",
  android: { loggingBehavior: "none" },
};

export default config;
