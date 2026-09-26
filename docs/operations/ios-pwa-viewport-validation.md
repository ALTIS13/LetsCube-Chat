# Проверка нижнего края iOS PWA

Owner: LETSCUBE PWA. Stage: the shell uses paintable-height measurement, and the attachment sheet uses an independent fixed-anchor measurement; local viewport 42/42 and attachment 36/36 regressions green. Evidence: D-111 in `docs/INTERFACE_DEFECT_REGISTER.md` and `tests/e2e/installed-ios-viewport.spec.ts`. Blocker: the tester's installed iPhone has not supplied inspectable geometry or active JS bundle identity. Next: compare the real installed app at rest, with an attachment and keyboard open, after dismissal and after relaunch.

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
    entryScript: [...document.scripts].map((script) => script.src).filter(Boolean).map((src) => new URL(src).pathname).find((path) => /\/assets\/index-[^/]+\.js$/.test(path)) ?? null,
    standalone: navigator.standalone === true,
    displayMode: matchMedia('(display-mode: standalone)').matches,
    iosShell: document.documentElement.hasAttribute('data-ios-standalone'),
    screenHeight: screen.height,
    innerHeight,
    documentHeight: document.documentElement.clientHeight,
    visualHeight: viewport?.height,
    visualOffsetTop: viewport?.offsetTop,
    visualPageTop: viewport?.pageTop,
    bodyTop: Math.round(document.body.getBoundingClientRect().top),
    appHeightToken: getComputedStyle(document.documentElement).getPropertyValue('--kub-app-height').trim(),
    paintableHeightToken: getComputedStyle(document.documentElement).getPropertyValue('--kub-paintable-height').trim(),
    fixedPaintableGapToken: getComputedStyle(document.documentElement).getPropertyValue('--kub-fixed-paintable-gap').trim(),
    appTopToken: getComputedStyle(document.documentElement).getPropertyValue('--kub-app-top').trim(),
    safeBottomToken: getComputedStyle(document.documentElement).getPropertyValue('--kub-safe-bottom').trim(),
    fixedAnchor: (() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden';
      document.body.appendChild(probe);
      const bottom = Math.round(probe.getBoundingClientRect().bottom);
      probe.remove();
      return bottom;
    })(),
    shell: box('[data-testid="desktop-app-shell"]'),
    navigation: box('[aria-label="Навигация"]'),
    composer: box('[data-testid="chat-composer-dock"]'),
    attachmentSheet: box('[data-testid="attach-sheet"]'),
    attachmentSend: box('[data-testid="attach-send"]'),
    composerPaddingBottom: (() => {
      const dock = document.querySelector('[data-testid="chat-composer-dock"]');
      return dock ? getComputedStyle(dock).paddingBottom : null;
    })(),
  };
})()
```

`fixedAnchor` — независимо измеренный нижний якорь fixed-элементов. На iOS он может совпадать с полной CSS-высотой либо уже с короткой paintable-областью; разницу нельзя выводить из одного `100vh`. Для открытой панели проверить, что `attachmentSend.bottom` не уходит ниже доступного края, а при клавиатуре под панелью не остаётся старый отступ индикатора Home.

Сравнить `entryScript` с опубликованным текущим bundle до выводов по новому исправлению: установленная PWA может ещё исполнять старый кэш. Если `iosShell=false` при `displayMode=true`, сломано определение установленного режима. Если низ shell/navigation/composer уходит ниже `visualHeight`, оболочка больше видимого окна. При открытой клавиатуре сравнить `bodyTop`, `visualPageTop`, верх shell и шапки: отрицательный `bodyTop` при нулевом `scrollY` означает системный сдвиг, который `scrollTo(0, 0)` не исправляет. Если shell и composer доходят до края, а пустой участок совпадает примерно с нижним safe-area inset, это не обрезка viewport: надо оценивать окраску фона и расстояние органов управления от системной полосы жестов. Участок экрана, который не входит в paintable viewport PWA, может принадлежать системе; CSS приложения не сможет его закрасить. Одна только экранная ширина или desktop screenshot не доказывает ни один из этих вариантов.

Источники: [WebKit об установке из сторонних браузеров](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [WebKit об изменениях iOS 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [Apple о выпуске iOS 27](https://developer.apple.com/news/releases/?id=09142026a), [WebKit о Safari 27 и Safari MCP](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/), [Apple о симуляторах](https://developer.apple.com/documentation/safari-developer-tools/installing-xcode-and-simulators), [BrowserStack Live об установке PWA](https://www.browserstack.com/support/faq/live/features-live/how-can-i-progressive-web-app-pwa-specific-scenarios-on-devices-in-live).
