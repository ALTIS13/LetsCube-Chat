# Проверка нижнего края iOS PWA

Owner: LETSCUBE PWA. Stage: D-111 fixed and verified on physical iPhones (`35a19e66`, 2026-09-27). Evidence: the installed-app measurement below, D-111 in `docs/INTERFACE_DEFECT_REGISTER.md`, and the tests it names. Blocker: none for the guest screens; a signed-in chat cannot be checked on a shared cloud phone. Next: the tester confirms the chat and composer on his own iPhone.

## The installed app measured from inside, and the fix (2026-09-27, evening)

MobileNext cannot evaluate JavaScript in an iOS web view (`mobilecli webview` answers that it is not supported on iOS), but it reads text on the screen. So the app itself was made to show its geometry: a temporary script loaded only with `?kub-viewport-diagnostic=1`, with `index.html` pointing the manifest at a copy whose `start_url` kept the flag, so the Add to Home Screen sheet offered "LETSCUBE QA" at the flagged URL and the installed app opened with it. It reported numbers, five stripes each drawn to a different claimed height, and where touches landed; nothing else.

On iPhone 17 Pro Max units (`iPhone18,2`, iOS 26.3.1), in the installed app (`navigator.standalone` true, `display-mode: standalone` true):

| moment | innerHeight | clientHeight | visual viewport | fixed `inset:0` | vh / lvh | svh | dvh | `--kub-app-height` |
|---|---|---|---|---|---|---|---|---|
| parse time (index.html) | 956 | 956 | 956 | — | — | — | — | — |
| ~10 s at rest | 894 | 894 | 894 | 0–894 | 956 | 894 | 894 | 894px |
| with content taller than 894 | 956 | 894 | 956 | 0–956 | 956 | 894 | 956 | 956px |

The safe-area insets were 62 top and 34 bottom. In the short ("small") state the page is drawn from the top, the bottom 62 pt show the page background — the band, `#050B18` in dark and `#E9EFF6` in light, exactly as the tester photographed — and touches at y=910 and 945 were not received while 600 was. With a 1400 px absolutely positioned stripe present, iOS switched to the "large" state: all five stripes reached 956 and touches at 910 and 945 were recorded. A 1400 px *fixed* layer alone did not switch it. `clientHeight` stayed 894 in both states, so `html`/`body` at `100%` both are the fitting document and would clip a correct shell. The earlier manifest-free probe read `innerHeight=932` because it was, at that moment, in the large state; that is why its y=890 touch arrived.

The candidate — `html` and `body` of the installed app at `100lvh` — was applied live from the diagnostic before any user got it: the large state at once and after 30 s; no band on the public home or the sign-in screen; touches at 600, 910 and 945; keyboard open (shell 570 = visual viewport, pan 175 compensated by `--kub-app-top`) and closed (back to 956 after 3 s and 15 s); landscape (440) and back (956). Shipped as `35a19e66` and checked again as users install it (the plain LETSCUBE icon, no flag): 0 uniform bottom rows on the public home after 30 s, on the sign-in screen after 20 s, and after a relaunch. `PwaRuntime` still follows `innerHeight` at rest, so if iOS ever returns to the small state the shell ends where touches still land.

Four physical units were used in all, each released right after its session; two more had no control agent (they asked for a provisioning profile) and were released unused, without installing anything. No account was entered and no conversation was on screen. The diagnostic, its manifest copy and its gate spec were removed afterwards, with the running image and the public bytes as proof.

## Physical Home Screen guest smoke (2026-09-27)

MobileNext provided a physical Apple iPhone 14 Pro Max (`iPhone15,3`) on iOS 26.5, with a 430×932 accessibility viewport. Safari's Share → Add to Home Screen created a LETSCUBE icon. Launching that icon opened `Web (com.apple.webapp)`, without Safari controls; the guest page and sign-in screen loaded. Opening the email field moved the sign-in content above the keyboard: the final visible legal text ended around y=471, while the keyboard toolbar began at y=556. Home → icon reopened the sign-in screen in the same Web app container. The cloud device was released after the test.

In contrast, Safari's regular tab showed the built-in 12-second boot-recovery screen, and Retry did not recover it. A fresh Private tab failed the same way. The public HTML returned HTTP 200 from Windows, and two unauthenticated desktop Playwright WebKit checks (plain 430×932 and `iPhone 14 Pro Max` device profile) reached `data-kub-boot-state=ready` with no page errors after 13 seconds. This isolates a physical iOS Safari guest-load symptom, not its cause. Without Safari Web Inspector, neither the failed module/request nor the installed PWA's active JS/service-worker hash was identified.

No account credentials, personal conversations or production screenshots were used. This smoke proves Home Screen installation and a limited keyboard interaction on the sign-in screen; it does **not** sign off D-111's chat/composer/attachment safe-area, the system-owned bottom strip, push, offline sync or update activation. The synthetic preview route is DEV/loopback-only and cannot be opened by a remote iPhone without a separate safe HTTPS setup.

### Current-release guest follow-up and new D-111 geometry (2026-09-27)

On another allocated iPhone 14 Pro Max with iOS 26.5, the current public HTML and its entry JS/CSS returned HTTP 200 with expected MIME types. A normal Safari tab reached the guest sign-in page without the earlier boot-recovery screen. Share → Add to Home Screen created a LETSCUBE icon; `Web (com.apple.webapp)` opened the guest page and sign-in, then Home → icon returned to sign-in. The device was released. This is a current-build guest smoke, not proof that the earlier Safari failure's cause was fixed, or that the installed app activated a particular JS/SW build.

Four newer owner-supplied iPhone images were read only as anonymous RGB row statistics, without display, OCR, copies or personal-content extraction. Each is 1181×2560 pixels. The chat and list images have **the same 159 completely uniform bottom rows**, y=2401–2559, RGB(5,11,25), about 6.21% of the image height or 58 pt if the CSS screen height is 932 pt. The keyboard and app-switcher images do not have that uniform tail. Pixel colour alone cannot distinguish a page-owned background from an iOS-owned surface.

The source arithmetic matches that boundary conditionally: `index.html` and `PwaRuntime` write `--kub-app-height` from `innerHeight` at rest; if this iPhone reports 873 pt inside a 932 pt screen, `MainLayout` ends about 59 pt early. The composer also reserves `env(safe-area-inset-bottom)` and 12 px of input padding *inside* that shell. The existing synthetic test places a DOM overlay across the lower 59 pt and checks controls remain above it; it does not prove the real iOS strip is outside the paintable DOM. A full-height `100vh` fix could hide controls under a system-owned strip, while retaining a short shell could leave an avoidable gap if the strip is page-owned. Neither choice is justified by screenshots alone.

The next discriminating measurement needs the installed guest app's `screen.height`, `innerHeight`, `visualViewport.height`, CSS `100vh` height, safe-bottom inset, fixed anchor, shell bottom, keyboard flag and entry path, plus a temporary touch target covering the lower strip. A physical tap in the strip that reaches the page proves DOM hit-testing there; no event together with a separately validated in-page control supports a system-owned boundary. Do not enter an account or collect production screenshots. A second MobileNext allocation on this date returned an iPhone without its control agent and required a provisioning profile for installation; no profile was guessed or installed, and the unusable device was released. The Windows host still lacks Safari Web Inspector for this cloud device.

The temporary, unauthenticated paintability probe had no app scripts, manifest, account access or external requests; its viewport meta matched the messenger's. Its lower target extended below CSS `100vh` and reported only viewport/target geometry, scroll position and last tap coordinates. The local integrity test went red before the page existed and green in Chromium/WebKit; shrinking the target to 5 px broke its boundary assertion, and the beyond-viewport assertion failed when the target ended at 844 px. The temporary `1c066e8b` web image was healthy and alone before the exact public URL exposed the probe marker and extended target. The probe and its integrity test are deleted by the cleanup change that includes this report.

### Physical lower-edge probe and interpretation (2026-09-27)

On a physical iPhone 14 Pro Max (`iPhone15,3`) running iOS 26.5, Safari opened the exact temporary page and Add to Home Screen launched it in `Web (com.apple.webapp)`. In this manifest-free installed web app, accessibility text reported `screen.height=932`, `innerHeight=932`, `document.clientHeight=873`, `visualViewport.height=932`, `100vh=932`, `100dvh=932`, `fixed.bottom=932`, `safe.bottom=34px`, `edge.top=812`, `edge.bottom=1278`, `navigator.standalone=true` and `display.standalone=false`. The on-page control received `pointerdown` at client y=636; the same lower target received `pointerdown` at y=840 and then at **y=890**, inside the suspected y=873–932 strip. `scrollY=0` and viewport metrics remained unchanged. The device was released; no credentials, conversations or screenshots were used.

The y=890 event proves that at least part of that lower strip was DOM-hit-testable **in this Web App**, so a 59 pt dark tail cannot be classified as wholly system-owned from screenshots or `document.clientHeight` alone. It does **not** prove that the installed LETSCUBE messenger uses the same viewport/manifest behavior or that its shell/composer ends at 873. In fact this probe's `innerHeight=932` means the current `index.html` and `PwaRuntime` idle formula would already set `--kub-app-height=932px`; a synthetic red test forcing `innerHeight=873` would not reproduce the measured condition. Do not stretch or trim the messenger shell on this evidence alone. The next discriminating test must run in the installed LETSCUBE container with a checkable entry bundle and report its actual shell and composer bounds plus a controlled lower-edge touch. An isolated guest-only diagnostic in that app or Safari Web Inspector on a connected Mac could provide it; keep any temporary production instrumentation short-lived and remove it with exact running-image/public-byte proof.

### Safari boot follow-up, without another device allocation

During the physical session, a separate Windows fetch of the public HTML named `/assets/index-DmqnUTnW.js`; the failing Safari tab's actual request status was not captured. A later deploy changed the public entry to `/assets/index-Dd_fcDhO.js`, and the former URL now returns 404. Thus the iPhone symptom was observed before the later deploy and is not evidence that the current release still fails. An old HTML document requesting an asset removed by a later deploy is a plausible update-boundary failure, **not** a proven explanation for this Safari observation; the shared-web asset-retention work is owned by LetsCube Main.

On the newer public build, ordinary desktop and iPhone-Safari User-Agent requests returned byte-identical HTML and entry JS, with HTTP 200 and `application/javascript` for the entry; linked CSS and icons also returned 200. Unauthenticated desktop WebKit with the iPhone 14 Pro Max profile and service workers allowed reached `data-kub-boot-state=ready` after 13 seconds, without page errors. The source narrows the built-in recovery screen to a failed module resource, an uncaught window error/rejected Promise, or 12 seconds without `letscube:app-rendered` (`artifacts/kub/index.html`); it does not encode which occurred. Auth/session loading or a caught React render error would render a different React screen. No Safari-only source path or proven root cause was found.

For a future **already authorised** guest-only iPhone session, capture Console and Network for the Safari tab before navigation, then record only entry/dependency path, status/MIME, error category, and whether `#root` has `data-kub-boot-id` and `data-kub-app-ready`; do not capture personal data or production screens. MobileNext currently exposes only iOS unified logs, not Safari Web Inspector or JS/network inspection; empty unified logs would not rule out a page error. [Apple documents inspection of Safari tabs and Home Screen web apps from a connected Mac](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios). [BrowserStack Live documents Safari Web Inspector on iOS](https://www.browserstack.com/docs/live/debug-website/devtools), with an iOS 17.4+ limitation to the first default Safari tab; access to an *installed* PWA target there remains unverified. Neither path was used in this session.

## CSS-guard regression after the viewport release (2026-09-27)

The published build left iOS component selectors unlayered, defined `--kub-safe-bottom` a second time on the attachment sheet, and used two runtime viewport tokens without CSS defaults. Four unit guards failed; moving the selectors into `@layer components` alone made the chat title 15px instead of 17px in both Chromium and WebKit. The local patch keeps `--kub-safe-bottom` single-source, gives only the attachment sheet a keyboard-specific inset token, provides runtime-token defaults, uses an `ios:` utility variant where iOS must override base Tailwind typography/positioning, and preserves 48px touch floors.

Local evidence in the isolated worktree: 70/70 focused unit tests; 44/44 installed-viewport browser cases in Chromium and WebKit; 25/25 applicable safe-area cases (the other 25 are intentionally engine-skipped); 10/10 Android/web bottom-navigation cases at 360px and 390px; typecheck and Vite build with its own `sw.js build` marker. Synthetic fixture screenshots at 390px and 1440px in both themes were inspected. Mutation probes showed the title regressing to 15px, the More button to 44px, and a 30px keyboard gap when the corresponding new rules were disabled; each test returned green after restoration. These are local/browser results, not physical Home Screen acceptance or production proof.

Production static proof for `d2686623`: after the old web replica exited, the public HTML referenced accessible JS/CSS assets and `sw.js` precached those same paths (`sw.js` build `fddb0c1fadc19058`). The prior source and bundle had `kub-ios-chat-list-title` but no `ios:text-base`; the new source and public JS have the reverse. This proves the deployed web bytes changed, not that an installed iPhone has activated the new bundle or that its system-owned strip is fixed.

## Что доступно на Windows 11

Локальные Playwright Chromium и WebKit проверяют 390/430 CSS px, подставленные safe-area inset, установленный режим и перемещение клавиатуры. Запускать `tests/e2e/installed-ios-viewport.spec.ts` в проектах `webkit-mobile-390` и `chromium-mobile-390`. Это проверяет нашу раскладку, но desktop WebKit не эмулирует Home Screen контейнер iOS, системную строку жестов, push или поведение реальной клавиатуры. Нельзя закрывать D-111 только этими тестами.

Вместо несуществующего iOS Simulator для Windows: MobileNext и BrowserStack Live из Windows предоставляют удалённый реальный iPhone. Выбрать конкретные модель и версию iOS; приоритет — актуальная iOS 27.0 и контрольная iOS 26.1+. Открыть только LETSCUBE, через «Поделиться» добавить сайт на экран Домой и запустить именно установленную иконку. Сначала проверить Safari, затем доступный браузер с командой «На экран Домой». Для iOS 26+ оставить «Открыть как веб-приложение» включённым. На безопасном непроизводственном fixture проверить запуск, чат, клавиатуру, закрытие клавиатуры и повторный запуск в светлой/тёмной теме и горизонтальной ориентации; production-экраны не снимать. У BrowserStack есть удалённые DevTools, но надо отдельно убедиться, что они подключились к установленному PWA, а не к исходной вкладке браузера. Для наиболее точной инспекции Home Screen PWA нужен удалённый Mac с Safari Web Inspector и iOS Simulator либо физическим iPhone; Safari 27 также предлагает Safari MCP для DOM, скриншотов и консоли на самом Mac.

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
