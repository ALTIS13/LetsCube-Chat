import type { DistributionTarget } from "../platform/distribution";

export type PwaInstallCopy = {
  platform: DistributionTarget;
  title: string;
  description: string;
  buttonLabel: string;
  variantLabel: string;
  modeLabel: string;
  instructionTitle: string;
  instructionSteps: string[];
};

export function getPwaInstallCopy({
  platform,
  installed,
  isTablet = false,
}: {
  platform: DistributionTarget;
  installed: boolean;
  isTablet?: boolean;
}): PwaInstallCopy {
  if (platform === "android_native") {
    return {
      platform,
      title: "Android-приложение LETSCUBE",
      description: "Приложение уже запущено как Android APK. Установка через браузер здесь не нужна.",
      buttonLabel: "Установлено",
      variantLabel: "Android APK",
      modeLabel: "Native",
      instructionTitle: "Установка не требуется",
      instructionSteps: ["LETSCUBE уже открыт как Android-приложение."],
    };
  }

  if (platform === "windows_native") {
    return {
      platform,
      title: "Windows-приложение LETSCUBE",
      description: "Приложение уже запущено как Windows-клиент. Доступность обновлений проверяется автоматически.",
      buttonLabel: "Установлено",
      variantLabel: "Windows EXE",
      modeLabel: "Приложение",
      instructionTitle: "Установка не требуется",
      instructionSteps: ["LETSCUBE уже открыт как Windows-приложение."],
    };
  }

  const installedPrefix = installed ? "LETSCUBE установлен" : "Установить LETSCUBE";

  if (platform === "ios_pwa") {
    const device = isTablet ? "iPad" : "iPhone";
    return {
      platform,
      title: `${installedPrefix} на ${device}`,
      description: installed
        ? "Приложение уже открывается с экрана Домой без обычной вкладки браузера."
        : "Добавьте LETSCUBE на экран Домой из поддерживаемого браузера: кнопка ниже покажет шаги.",
      buttonLabel: "Установить",
      variantLabel: `${device} / iOS PWA`,
      modeLabel: installed ? "Установлено" : "Браузер",
      instructionTitle: `Установка на ${device}`,
      instructionSteps: [
        "Откройте LETSCUBE в браузере, который предлагает «На экран Домой».",
        "В меню «Поделиться» выберите «На экран Домой» — расположение меню зависит от браузера.",
        "На iOS 26 и новее оставьте включённым «Открыть как веб-приложение», затем нажмите «Добавить».",
        "Если этого пункта нет, откройте LETSCUBE в Safari и повторите шаги.",
      ],
    };
  }

  if (platform === "android_download") {
    return {
      platform,
      title: "LETSCUBE для Android",
      description: "Используйте отдельное Android-приложение. Доступность APK проверяется автоматически.",
      buttonLabel: "Скачать APK",
      variantLabel: "Android APK",
      modeLabel: "Браузер",
      instructionTitle: "Android-приложение",
      instructionSteps: [],
    };
  }

  if (platform === "windows_download") {
    return {
      platform,
      title: "LETSCUBE для Windows",
      description: "Используйте отдельное Windows-приложение. Доступность EXE проверяется автоматически.",
      buttonLabel: "Скачать EXE",
      variantLabel: "Windows EXE",
      modeLabel: "Браузер",
      instructionTitle: "Windows-приложение",
      instructionSteps: [],
    };
  }

  return {
    platform,
    title: "Веб-версия LETSCUBE",
    description: "Продолжайте работу в браузере. Отдельная установка для этой платформы не требуется.",
    buttonLabel: "",
    variantLabel: "Web",
    modeLabel: "Браузер",
    instructionTitle: "",
    instructionSteps: [],
  };
}
