# Проверка нижнего края iOS PWA

Owner: LETSCUBE PWA. Stage: source regression green; real installed-iPhone proof pending. Evidence: D-111 in `docs/INTERFACE_DEFECT_REGISTER.md` and `tests/e2e/installed-ios-viewport.spec.ts`. Blocker: no current screenshot, exact iOS version or interactive iPhone session for the reported band. Next: compare a real installed app before and after opening the keyboard.

## Что доступно на Windows 11

Локальные Playwright Chromium и WebKit проверяют 390/430 CSS px, подставленные safe-area inset, установленный режим и перемещение клавиатуры. Запускать `tests/e2e/installed-ios-viewport.spec.ts` в проектах `webkit-mobile-390` и `chromium-mobile-390`. Это проверяет нашу раскладку, но desktop WebKit не эмулирует Home Screen контейнер iOS, системную строку жестов, push или поведение реальной клавиатуры. Нельзя закрывать D-111 только этими тестами.

Вместо несуществующего iOS Simulator для Windows: BrowserStack Live из Windows предоставляет удалённый реальный iPhone. Выбрать конкретные модель и версию iOS; приоритет — актуальная iOS 27.0 и контрольная iOS 26.1+. Открыть только LETSCUBE, через «Поделиться» добавить сайт на экран Домой, кнопкой Show Home Screen запустить именно установленную иконку. Сначала проверить Safari, затем доступный браузер с командой «На экран Домой». Для iOS 26+ оставить «Открыть как веб-приложение» включённым. Снять полноэкранные кадры сразу после запуска, после открытия чата, с клавиатурой, после её закрытия и после повторного запуска; повторить в светлой/тёмной теме и в горизонтальной ориентации. У BrowserStack есть удалённые DevTools, но надо отдельно убедиться, что они подключились к установленному PWA, а не к исходной вкладке браузера. Для наиболее точной инспекции Home Screen PWA нужен удалённый Mac с Safari Web Inspector и iOS Simulator либо физическим iPhone; Safari 27 также предлагает Safari MCP для DOM, скриншотов и консоли на самом Mac.

Не вводить личные или production-admin учётные данные на общем облачном устройстве. Если тестовый вход недоступен, можно проверить экран авторизации и геометрию оболочки, но чат и composer остаются непроверенными. Push, фон и системные уведомления требуют отдельного теста на реальном устройстве и не доказываются скриншотами раскладки.

## Как отличить дефект высоты от безопасной зоны

Зафиксировать модель, версию iOS, браузер установки, включён ли «Открыть как веб-приложение», ориентацию, тему, время появления полосы (до клавиатуры или после) и её высоту на скриншоте. На инспектируемом установленном PWA выполнить в консоли этот безличный замер:

```js
(() => {
  const box = (selector) => {
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    return rect ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) } : null;
  };
  const viewport = window.visualViewport;
  return {
    standalone: navigator.standalone === true,
    displayMode: matchMedia('(display-mode: standalone)').matches,
    iosShell: document.documentElement.hasAttribute('data-ios-standalone'),
    screenHeight: screen.height,
    innerHeight,
    documentHeight: document.documentElement.clientHeight,
    visualHeight: viewport?.height,
    visualOffsetTop: viewport?.offsetTop,
    appHeightToken: getComputedStyle(document.documentElement).getPropertyValue('--kub-app-height').trim(),
    safeBottomToken: getComputedStyle(document.documentElement).getPropertyValue('--kub-safe-bottom').trim(),
    shell: box('[data-testid="desktop-app-shell"]'),
    composer: box('[data-testid="chat-composer-dock"]'),
    composerPaddingBottom: (() => {
      const dock = document.querySelector('[data-testid="chat-composer-dock"]');
      return dock ? getComputedStyle(dock).paddingBottom : null;
    })(),
  };
})()
```

Если `iosShell=false` при `displayMode=true`, сломано определение установленного режима. Если низ shell/composer выше видимого края на десятки CSS px, виновата высота контейнера. Если shell и composer доходят до края, а пустой участок совпадает примерно с нижним safe-area inset, это не обрезка viewport: надо оценивать окраску фона и расстояние органов управления от системной полосы жестов. Одна только экранная ширина или desktop screenshot не доказывает ни один из этих вариантов.

Источники: [WebKit об установке из сторонних браузеров](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [WebKit об изменениях iOS 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [Apple о выпуске iOS 27](https://developer.apple.com/news/releases/?id=09142026a), [WebKit о Safari 27 и Safari MCP](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/), [Apple о симуляторах](https://developer.apple.com/documentation/safari-developer-tools/installing-xcode-and-simulators), [BrowserStack Live об установке PWA](https://www.browserstack.com/support/faq/live/features-live/how-can-i-progressive-web-app-pwa-specific-scenarios-on-devices-in-live).
