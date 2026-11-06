# Task9: авторизованная PWA на iPhone, 2026-11-05

Владелец: координатор LETSCUBE. Этап: 9 из 12. **На физическом iPhone
подтверждены установленная PWA, production-вход, переход в «Задачи»
и возврат в этот раздел с Home Screen. На новой публичной сборке штатный
UI-выход вернул гостевой экран с первого подтверждения.** Карточка и экран
пустой вкладки «Мои» не подтверждены.

## 2026-11-06: допуск отдельной приватной карточки

Текущий production build `fbf03e4ad9f38675` содержит имя «Поиск по
задачам», сверено по точному контейнеру и публичному JS. Для выделенного
Tech Admin разрешён read-only допуск: нужная роль, исходный набор Auth
сеансов, 0 привязок и ожидающих доставок, 0 foreground. Планируемая
приватная задача адресована самому QA-актору и не требует Staff,
соисполнителей или уведомлений. Реальные SQL-чтения пустого случайного
QA-ключа и 5 локальных проверок ограждения прошли. Задачу не создавали,
новую аренду не выделяли; карточка и черновик на iPhone остаются открыты.

## 2026-11-06: первое подтверждение после выпуска исправления Auth

- **Изменённый вход.** Опубликованный коммит `2e1c3afc8a260c73690890144a976de472fbdb03`.
  Свежий публичный SW сообщил `456b562c6750bd54`; в JS, на который указал
  публичный HTML, найден обход обёртки для статусов `204/205/304`.
  Не переигрывали отдельные проверки Realme и браузерного воспроизведения.
  Активный SW и HTTP-ответ выхода на самом iPhone не инструментировали.
- **Физический результат.** Одна новая аренда iPhone 17 Pro Max
  (`iPhone18,2`, iOS 26.3.1). После установки с Home Screen подтверждён
  `com.apple.webapp`. Только прежний Location Staff: выключенный push,
  шесть исходных SID, одна свежая SID после production-входа. Ввод через
  проверенный stdin → прямой локальный сокет MobileCLI 1.0.13. «Меню» →
  «Выйти» → одно штатное подтверждение вернуло гостевой экран именно
  в `com.apple.webapp` до release. Первое наблюдение гостевого состояния
  заняло около 24 секунд с учётом опросов AX и readback, не замер задержки UI.
  Повторных входа или выхода, ручной перезагрузки и резервной очистки Auth не было.
- **Границы и очистка.** До release точная свежая SID и её действующие
  refresh-токены отсутствовали, набор шести прежних SID и push-привязки
  совпали, foreground-строк 0. Release в `finally` получил ACK; аренда
  отсутствует в инвентаре, около 95 секунд с готовности до readback.
  Независимая read-only сверка после release: метаданные старых сессий
  и их refresh-записей совпали с базой до входа; свежих SID, foreground-строк,
  активных push-привязок, новых web/native записей в очередях QA-актора
  (окно 20 минут) и оставшихся iOS-аренд 0. Чаты, задачи и карточки
  не открывали. Нет снимков, прямых SQL-записей, изменений продукта или деплоя.

## 2026-11-06: предыдущее поведение до исправления Auth

- **Допуск.** Публичный HTML указал на доступный JS, SW сообщил
  `7004fda17e293691`. [Релиз `9ed010f5`](2026-11-06-web-task-bell-slice.md)
  включает отдельную кнопку открытия карточки и поправку перехода из
  уведомления; изменения WNS в Edge Function и её тестах к прогону не относятся.
  Хеш активного SW на iPhone не измеряли. Read-only сверка на закреплённом
  кластере подтвердила прежнего выделенного Location Staff, выключенный push
  и отсутствие активных привязок. Активных приватных QA-кандидатов с этим
  исполнителем или соисполнителем: 0. Tech Admin не использовали; новую
  задачу не создавали, «Задачи» и чаты не открывали.
- **Устройство и ввод.** Одна аренда физического iPhone 17 Pro Max
  (`iPhone18,2`, iOS 26.3.1), установка нужна была только для входа.
  После запуска иконки подтверждён `com.apple.webapp`. Один контроллер
  держал аренду до окончания UI-проверки и readback. До аренды контрольные
  AX-примеры проверили уникальность кнопок и исключение значений полей.
  Использован ранее проверенный stdin → прямой локальный сокет MobileCLI
  1.0.13; повторный отрицательный контроль не обнаружил вымышленную строку
  в ответе или локальном логе. Нет секретов в аргументах, снимков или сырых
  AX-дампов в выводе.
- **Выход.** После входа появился ровно один свежий iPhone SID, шесть
  прежних SID сохранились. «Меню» → «Выйти» → подтверждение «Выйти из
  аккаунта?» удалило свежий SID, но в пределах окна проверки остались
  «Меню», «Чаты» и «Профиль». Второе штатное подтверждение вернуло гостевой
  экран без ручной перезагрузки и без серверного обхода. Точный SID и его
  действующие refresh-токены отсутствуют, набор шести прежних SID совпал
  точно, foreground-строк 0, web/native привязки без
  изменений. Причина задержки первого UI-выхода и его HTTP-ответ не измерены.
- **Очистка.** Release в `finally` получил ACK, точная аренда исчезла из
  инвентаря. От готовности до readback около 100 секунд, это не данные
  биллинга. Независимая read-only проверка подтвердила: 6 прежних сеансов,
  0 свежих сеансов и foreground-строк, 0 активных push-привязок,
  0 web/native push-записей в очередях QA-актора за последние 20 минут,
  0 активных iOS-аренд. Нет прямых SQL-записей, деплоя или изменений
  продукта.

На этой сборке оставался открытым выход с первого подтверждения; результат
на исправленной сборке приведён выше. Для карточки по-прежнему нужна
заранее допущенная точная приватная QA-задача.

## Физический прогон после уточнения допуска

Владелец разрешил штатные Auth/foreground-записи выделенного QA-актора,
но не прямую запись SQL, миграции или посторонние данные. Read-only
проверка связала вход с Location Staff: это тестовый профиль, не Tech Admin
с Realme, с локальным доступом к задачам, отключённым push и без активных
привязок. Под ролью у него нет назначенных ему задач; в более широкой области
есть видимые записи. Карточки и чаты не открывали. Отдельный Windows-тред
не обнаружен; сверили [границу Windows](2026-11-05-task10-windows-wns-readiness.md),
не использовали Windows-устройство и не затрагивали прежние сеансы.

- **Среда.** Физический iPhone 17 Pro Max (`iPhone18,2`, iOS 26.3.1).
  Safari использован только для Add to Home Screen. Запуск иконки сообщил
  `com.apple.webapp`. Отдельный гостевой тест клавиатуры не повторяли.
  Первая аренда была освобождена до открытия сайта: проверка ошибочно
  требовала совпадения отображаемого имени каталога и runtime. Повторная
  проверка привязалась к точной аренде и фактическому идентификатору модели.
- **Ввод.** В [MobileCLI 1.0.13](https://github.com/mobile-next/mobilecli/blob/1.0.13/server/server.go)
  HTTP-вход пишет параметры на уровне Info, поэтому не использовался для
  учётных данных. Прямой JSON-RPC в локальный сокет демона: вымышленная
  строка в установленной форме действительно появилась и была очищена,
  строка не вернулась в RPC-ответе, локальный журнал не вырос. Данные
  выделенного актора читались локально и передавались через stdin и сокет,
  не в аргументах, clipboard или выводе. Для AX оставляли только фиксированные
  названия и геометрию; снимков, записи экрана и сырых дампов не сохраняли.
  Внутреннее журналирование облачного провайдера отдельно не проверено.
- **Production Auth и навигация.** После входа появился ровно один новый SID,
  все шесть предыдущих остались. В `com.apple.webapp` появились «Чаты»,
  «Профиль» и «Задачи». Тап «Задачи» открыл заголовок и поле поиска задач.
  После Home был виден `com.apple.springboard`; тап той же иконки вернул
  `com.apple.webapp` с теми же заголовком и полем. У той же новой
  foreground-строки без открытого чата продвинулся `last_seen_at`. Сработал
  и штатный presence только этого QA-профиля; настройки не меняли и push
  не включали. Не проверяли данные/карточку задачи, черновики или Realtime.
  Публичная версия подтверждена отдельно; hash активного SW на iPhone не снят.
- **Очистка.** Таймер контроллера освободил рабочую аренду до штатного UI-выхода
  (483 секунды с готовности до подтверждения освобождения; не счётчик оплаты).
  Обе аренды получили ACK и исчезли из инвентаря. После release не осталось
  foreground-строк, но свежая Auth-сессия оставалась. Для неё связали точный
  SID, исходное время и iPhone UA. Штатный refresh только этого SID выполнялся
  в памяти на сервере; первый защитный контроль остановился до logout, потому
  что refresh обновил UA. Повторный readback подтвердил тот же SID, то же время
  создания и один действующий refresh-токен. JWT из следующего штатного
  refresh совпал с точными UID/SID; [`logout?scope=local`](https://github.com/supabase/auth/blob/v2.189.0/internal/api/logout.go)
  вернул 204. Ни токены, ни значения идентификаторов не выводили. Независимая
  проверка: свежей SID и её действующих refresh-токенов нет, шесть прежних
  SID сохранены, foreground 0, активные web/native привязки 0, iOS-инвентарь
  пуст. Прямых SQL-записей и глобального logout не было.

На 05.11 открытыми оставались штатный UI-выход и отдельный сценарий карточки
уже существующей, точно принадлежащей QA приватной задачи. Отсюда требование
для следующего прогона: один контроллер с резервом на UI-выход и сверку до release.

## Исходный барьер до уточнения допуска

Гостевой Home Screen, клавиатура и возврат уже проверены в
[ноябрьском прогоне](2026-11-05-task-workflows.md#follow-up-live-task-review-and-device-checks).
На исходном этапе ниже аренду не открывали.

- Публичный HTML ссылается на ожидаемый JS; SHA-256 JS совпал с release receipt,
  публичный SW сообщает `d86e22971566dee8`. Это проверка публичных байтов,
  а не установленной версии на iPhone.
- В выпущенном `736a5c85` оболочка запускает
  `usePushForegroundSession` при появлении `currentUser`; первый
  `push_foreground_session_touch` не ждёт перехода в чат или разрешения push.
  Чтение определения на закреплённом production-кластере в `BEGIN READ ONLY`
  подтвердило `DELETE` и `INSERT … ON CONFLICT DO UPDATE` в
  `public.push_foreground_sessions`, без проверки подписки или предпочтения
  push. Сам RPC не вызывали. Даже выделенная QA-учётка с выключенным push
  не делает обычный вход операцией только на чтение.
- MCP и локальный `mobilecli 1.0.13` вернули облачный каталог с iPhone 17 Pro
  Max / iOS 26.3.1. [JSON-RPC MobileCLI](https://github.com/mobile-next/mobile-openrpc/blob/main/mobilecli/openrpc.md#deviceiotext)
  через `127.0.0.1` принял метод `device.io.text` и отказал вымышленному
  device ID без эха строки; отдельный неизвестный метод вернул другую ошибку.
  Это была только проверка маршрута, не ввод на iOS. Не использовать для
  секретов ни HTTP-вход, ни MCP `mobile_type_keys`, ни CLI `io text [text]`.
  В физическом прогоне выше принят отдельный прямой маршрут в сокет.

## Исполняемый синтетический маршрут

Нужен **один отдельный доверенный HTTPS-origin**, доступный арендованному
iPhone и проксирующий только этот процесс на `127.0.0.1:53129` с сохранением
Host. Не production-домен, не действующий общий dev server и не публичный
туннель к рабочей папке. Прокси не должен писать содержимое запросов или
логировать доступ; после проверки маршрут убрать. Подтверждённого входа нет,
поэтому аренду не открывали. Сервер ниже публикует только скомпилированную
фикстуру, манифест и иконку; не читает QA-пароли, не подключается к Supabase,
отклоняет любые записи и ставит `connect-src 'none'`.

Из корня репозитория, PowerShell. Для локальной проверки оставить переменную
origin пустой; для устройства перед запуском задать согласованный HTTPS-origin
через `LETSCUBE_IPHONE_FIXTURE_ORIGIN`.
В этом checkout Windows-бинарника в `node_modules` нет. Команда использует
закреплённый `0.27.3` из существующего кэша pnpm, сверяет SHA-512 и удаляет
свою временную копию при выходе. Ничего не устанавливает.

```powershell
$report = Get-Content -Raw -LiteralPath 'docs/operations/2026-11-05-task9-iphone-pwa.md'
$source = [regex]::Match($report, '(?ms)^<!-- fixture-runner -->\r?\n```js\r?\n(.*?)^\x60{3}\r?$')
if (-not $source.Success) { throw 'Task9 fixture runner missing' }
$store = (pnpm.cmd store path).Trim()
$index = @(Get-ChildItem -LiteralPath (Join-Path $store 'index/e2') -Filter '*-@esbuild+win32-x64@0.27.3.json')
if ($index.Count -ne 1) { throw 'Pinned esbuild cache index missing' }
$sri = (Get-Content -Raw -LiteralPath $index[0].FullName | ConvertFrom-Json).files.'esbuild.exe'.integrity
if ($sri -notmatch '^sha512-([a-zA-Z0-9+/=]+)$') { throw 'Unexpected cache integrity' }
$hex = [BitConverter]::ToString([Convert]::FromBase64String($Matches[1])).Replace('-', '').ToLowerInvariant()
$cached = Join-Path $store ('files/' + $hex.Substring(0, 2) + '/' + $hex.Substring(2))
if ((Get-FileHash -LiteralPath $cached -Algorithm SHA512 -ErrorAction Stop).Hash -ne $hex) {
  throw 'Pinned esbuild integrity mismatch'
}
$dir = Join-Path (Resolve-Path -LiteralPath '.ops-private').Path ('task9-iphone-esbuild-' + [guid]::NewGuid().ToString('N'))
$exe = Join-Path $dir 'esbuild.exe'
$oldEsbuild = $env:ESBUILD_BINARY_PATH
$oldMutations = $env:KUB_QA_ALLOW_MUTATIONS
New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null
try {
  Copy-Item -LiteralPath $cached -Destination $exe -ErrorAction Stop
  if ((& $exe --version) -ne '0.27.3' -or $LASTEXITCODE -ne 0) { throw 'Wrong esbuild version' }
  $env:ESBUILD_BINARY_PATH = $exe
  $env:KUB_QA_ALLOW_MUTATIONS = '0'
  $source.Groups[1].Value | node --input-type=commonjs
  if ($LASTEXITCODE -ne 0) { throw 'Task9 fixture runner failed' }
} finally {
  $env:ESBUILD_BINARY_PATH = $oldEsbuild
  $env:KUB_QA_ALLOW_MUTATIONS = $oldMutations
  for ($i = 0; $i -lt 20 -and (Test-Path -LiteralPath $exe); $i++) {
    Remove-Item -LiteralPath $exe -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $exe) { Start-Sleep -Milliseconds 150 }
  }
  if (Test-Path -LiteralPath $exe) { throw 'Temporary esbuild binary still in use' }
  Remove-Item -LiteralPath $dir -ErrorAction Stop
}
```

Проверено локально: манифест/иконка/CSP, другой Host → 403, POST → 405,
путь вне списка → 404. WebKit 390 показал реальный синтетический TaskDetail,
обычная вкладка выдала `BROWSER_ONLY`. С подставленным признаком standalone
и событиями visibility проба прошла: фоновое событие само не прочитало задачу,
возврат сделал одно чтение, оба черновика сохранились; 0 внешних запросов,
записей и JS-ошибок. Процесс и временный бинарник удалены. Это проверка
инструмента, не измерение поведения iOS.

После HTTPS-проверки манифеста и положительного/отрицательного HTTP-контроля
выделить один физический iPhone с лимитом времени. Открыть
`/task9-iphone/` в Safari, добавить на Home Screen как веб-приложение и
открыть иконку **Task9 Fixture**. Safari не должен показать
`TASK9_QA_ARMED`; установленный `com.apple.webapp` должен. После Home →
та же иконка ждать `TASK9_QA_PASS`: реальное событие возврата, один новый
read фикстуры, оба исходных узла/значения черновиков сохранены, записей 0.
Без снимков. Освободить точный lease в `finally` даже при таймауте и
подтвердить release; остановить сервер (Ctrl+C или его лимит 10 минут).
Даже физический PASS здесь не доказывает production Auth, RLS, список Mine,
живой Realtime, сохранение задачи или нативный релиз Apple.

<!-- fixture-runner -->
```js
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { compileFixture, initializeTaskFixture } = require('./tests/helpers/task-detail-fixture.cjs');

function observeForeground() {
  const status = document.getElementById('proof');
  const f = window.fixture;
  const selectors = ['[data-testid="task-checklist-draft"]', 'textarea[aria-label="\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439 \u043a \u0437\u0430\u0434\u0430\u0447\u0435"]'];
  const values = ['Fictional iPhone checklist', 'Fictional iPhone comment'];
  const state = label => { status.textContent = label; };
  const poll = async predicate => {
    const deadline = Date.now() + 10000;
    do {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw Error('FIXTURE_TIMEOUT');
  };
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!standalone) { state('TASK9_QA_BROWSER_ONLY'); return; }
  void (async () => {
    try {
      await poll(() => f?.batches[0]?.done === 4 && selectors.every(s => document.querySelector(s)));
      const inputs = selectors.map(s => document.querySelector(s));
      inputs.forEach((input, i) => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, values[i]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const retained = () => inputs.every((node, i) =>
        node.isConnected && document.querySelector(selectors[i]) === node && node.value === values[i]);
      if (!retained() || f.batches.length !== 1 || f.writes !== 0) throw Error('FIXTURE_SETUP');
      f.enqueue({ hold: true });
      const returned = new Promise((resolve, reject) => {
        let hidden = false;
        const handler = () => {
          if (document.visibilityState === 'hidden') {
            hidden = true;
            if (f.batches.length === 1) return;
            document.removeEventListener('visibilitychange', handler);
            reject(Error('EARLY_READ'));
          } else if (hidden && document.visibilityState === 'visible') {
            document.removeEventListener('visibilitychange', handler);
            resolve();
          }
        };
        document.addEventListener('visibilitychange', handler);
      });
      state('TASK9_QA_ARMED');
      await returned;
      await poll(() => f.batches.length === 2);
      if (!retained()) throw Error('DRAFT_LOST_WHILE_HELD');
      f.release(1);
      await poll(() => f.batches[1].done === 4);
      if (!retained() || f.batches.length !== 2 || f.writes !== 0) throw Error('DRAFT_LOST_OR_WRITE');
      state('TASK9_QA_PASS');
    } catch { state('TASK9_QA_FAIL'); }
  })();
}

async function main() {
  if (process.env.KUB_QA_ALLOW_MUTATIONS !== '0') throw Error('MUTATION_GATE');
  const base = '/task9-iphone/';
  const port = 53129;
  const origin = new URL(process.env.LETSCUBE_IPHONE_FIXTURE_ORIGIN || 'http://127.0.0.1:' + port);
  if (origin.href !== origin.origin + '/' ||
      (origin.origin !== 'http://127.0.0.1:' + port &&
       (origin.protocol !== 'https:' || !origin.hostname.includes('.') ||
        /(^|\.)letscube\.ru$/i.test(origin.hostname)))) throw Error('ORIGIN_REFUSED');
  const fixture = await compileFixture({ styles: true });
  const assets = new Map([
    [base, ['text/html; charset=utf-8', `<!doctype html><html lang="en"><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
      <title>Task9 Fixture</title><link rel="manifest" href="manifest.webmanifest">
      <link rel="apple-touch-icon" href="icon.png"><link rel="stylesheet" href="fixture.css">
      <div id="root"></div><output id="proof" role="status">TASK9_QA_LOADING</output>
      <script defer src="init.js"></script><script defer src="fixture.js"></script>
      <script defer src="probe.js"></script></html>`]],
    [base + 'manifest.webmanifest', ['application/manifest+json', JSON.stringify({
      id: base, name: 'Task9 Fixture', short_name: 'Task9 Fixture', start_url: base, scope: base,
      display: 'standalone', icons: [{ src: 'icon.png', sizes: '192x192', type: 'image/png' }],
    })]],
    [base + 'icon.png', ['image/png', readFileSync('artifacts/kub/public/icons/icon-192.png')]],
    [base + 'fixture.css', ['text/css; charset=utf-8', fixture.css +
      '\n#proof{position:fixed;z-index:999999;inset:auto 8px max(8px,env(safe-area-inset-bottom)) auto;padding:4px;background:#111;color:#fff;pointer-events:none}']],
    [base + 'init.js', ['text/javascript; charset=utf-8',
      '(' + initializeTaskFixture + ')({mode:"modal",theme:"dark",initial:{},autoSubscribe:false})']],
    [base + 'fixture.js', ['text/javascript; charset=utf-8', fixture.js]],
    [base + 'probe.js', ['text/javascript; charset=utf-8', '(' + observeForeground + ')()']],
  ]);
  for (const family of ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext']) {
    const path = '/fonts/inter/inter-' + family + '.woff2';
    assets.set(path, ['font/woff2', readFileSync('artifacts/kub/public' + path)]);
  }
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; manifest-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (req.headers.host !== origin.host) return res.writeHead(403).end();
    if (req.method !== 'GET') return res.writeHead(405).end();
    const asset = assets.get(req.url);
    if (!asset) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': asset[0] }).end(asset[1]);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log('TASK9_FIXTURE_READY', port);
  const close = () => { server.close(); server.closeAllConnections(); };
  setTimeout(close, 600000).unref();
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
main().catch(() => { console.error('TASK9_FIXTURE_REFUSED'); process.exitCode = 1; });
```
