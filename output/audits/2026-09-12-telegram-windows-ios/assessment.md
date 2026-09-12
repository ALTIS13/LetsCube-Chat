# Telegram Desktop on Windows, and Telegram iOS 26 with Liquid Glass

An assessment for the owner, written 2026-09-12 on branch
`audit/telegram-windows-ios`, cut from `bf538c4` on `design/recording-telegram-row`.
No product code is changed by this document.

It answers what the owner asked for on 2026-09-12:

> «сделай также на всякий случай оценку относительно интерфейса Telegram на
> Windows для понимания строения большей части функционала и iOS последней
> версии с Liquid Glass для лучшего понимания дизайна — если сможешь найти в
> интернете референсы»

So: **Windows for structure, iOS for design language.** It also revisits the
A/B navigation question in the light of his eight screenshots and his three
corrections, and lists where those corrections move the 22 answers he accepted
the same day (`9a52db5`).

## What this is built on, and what it is not built on

**Primary, and load-bearing:**

- **The owner's eight screenshots of his own Telegram Desktop**, as described to
  me. I did not see the images; I worked from the description, and every claim
  below that rests on them says so.
- **Telegram Desktop's own source**, read at `dev` on GitHub. Every number in
  section 1 that is not from a screenshot is quoted from a named file.
- **Apple's own words** from the WWDC 2025 session «Meet Liquid Glass»
  transcript and Apple Newsroom.
- **Telegram's own blog** for what its iOS and Android apps actually did.
- **Our own code**, read on this branch.

**What I could not verify, and am not asserting:**

- **I did not run Telegram Desktop and did not measure a pixel of it.** The
  Windows structure is the owner's screenshots plus source code.
- **The source I read is the `dev` branch.** It may be ahead of the build in his
  screenshots. I did not pin a version, so treat the constants as "what Telegram
  Desktop does now", not "what his build did on the day".
- **Apple's Human Interface Guidelines pages did not yield to fetching** — they
  are rendered in the browser and returned only their titles. Apple's words
  below come from the WWDC transcript and Newsroom, which are Apple's, and from
  three secondary summaries which are marked as secondary wherever used.
- **I measured no contrast of Telegram's**, on either platform.
- **Nothing here was checked on an iPhone, an Android phone or a real Windows
  window.**
- **I did not open the owner's live Telegram.** He offered it; it holds real
  conversations with real people, and the screenshots and published references
  answer the same questions without reading anyone's messages. That decision is
  recorded in `9a52db5`.

---

# 1. Telegram Desktop on Windows — the structure

## 1.1 The window is four columns, and three of them are negotiable

Telegram Desktop divides the window into, from the left edge:

1. **the folder rail**, fixed;
2. **the chat list**, user-draggable;
3. **the conversation**, what is left over;
4. **the profile**, user-draggable, present only when it fits.

The constants are in `Telegram/SourceFiles/window/window.style`:

| Constant | Value | What it governs |
| --- | --- | --- |
| `windowFiltersWidth` | 72px | the folder rail |
| `columnMinimalWidthLeft` | 260px | chat list, narrowest normal width |
| `columnMaximalWidthLeft` | 540px | chat list, widest |
| `columnMinimalWidthMain` | 380px | the conversation |
| `columnMinimalWidthThird` | 292px | the profile column, narrowest |
| `columnMaximalWidthThird` | 392px | the profile column, widest |
| `adaptiveChatWideWidth` | 880px | above this the conversation lays out "wide" |
| `windowMinWidth` | 380px | the window itself |

Which layout the window is in is one of three
(`Telegram/SourceFiles/window/window_adaptive.h`):

```cpp
enum class WindowLayout { OneColumn, Normal, ThreeColumn };
enum class ChatLayout  { Normal, Wide };
```

`Window::SessionController` computes the split every time the window changes
(`window_session_controller.h`):

```cpp
struct ColumnLayout {
    int bodyWidth = 0; int dialogsWidth = 0;
    int chatWidth = 0; int thirdWidth = 0;
    Adaptive::WindowLayout windowLayout = Adaptive::WindowLayout();
};
```

Three things follow, and each one is a decision we have not made:

- **The widths are a saved ratio, not a breakpoint.**
  `countDialogsWidthFromRatio()` multiplies the body width by a stored
  `dialogsWidthRatio` and then clamps up to `columnMinimalWidthLeft`. The ratio
  survives a relaunch — changelog 2.1.15 beta (30.06.20): *"Fix saving chats
  list width between application relaunches."*
- **The third column appears only when the arithmetic allows it.**
  `minimalThreeColumnWidth()` is `columnMinimalWidthLeft + columnMinimalWidthMain
  + columnMinimalWidthThird` = **932px** of body, and `computeColumnLayout()`
  only goes to three columns above it. `canShowThirdSection()` and
  `canShowThirdSectionWithoutResize()` are separate questions: Telegram will
  offer to shrink the other columns for you.
- **When space runs out, both side columns shrink together.**
  `shrinkDialogsAndThirdColumns()` takes from both, floors the profile at 292
  and gives the remainder back to the chat list.

## 1.2 The chat list collapses to avatars, and the width is exact

This is the owner's screenshot 5 — «очень удобная функция и она работает почти
со всем интерфейсом» — and it is in the source twice.

`Window::SessionController::dialogsSmallColumnWidth()` is:

```cpp
return st::defaultDialogRow.padding.left()
     + st::defaultDialogRow.photoSize
     + st::defaultDialogRow.padding.left();
```

and `defaultDialogRow` in `Telegram/SourceFiles/dialogs/dialogs.style` is
`padding: margins(10px, 8px, 10px, 8px)` with `photoSize: 46px`. So the
collapsed column is **66px — one avatar and its padding on both sides, and
nothing else.** That is not a smaller list; it is the list with everything but
the picture removed, which is exactly why he says he can still orient himself.

The list knows it is being narrowed rather than being told to switch modes
(`dialogs_inner_widget.h`):

```cpp
void setNarrowRatio(float64 narrowRatio);
float64 _narrowRatio = 0.;
int _narrowWidth = 0;
```

A **ratio**, not a boolean: the row interpolates between wide and narrow as you
drag, so there is no snap. `Dialogs::Widget` carries a second search control for
the narrow state, `object_ptr<Ui::IconButton> _searchForNarrowLayout` — the
search field cannot survive at 66px, so a button stands in for it.

Two public reports worth knowing, both user reports rather than measurements:
the collapsed state **does not persist across a restart**
([tdesktop#6409](https://github.com/telegramdesktop/tdesktop/issues/6409)), and
one user reports the collapsed sidebar vanishing entirely below a window width
of 1314px on Linux at 4K in v4.1.1
([tdesktop#25068](https://github.com/telegramdesktop/tdesktop/issues/25068)).
Neither is a constant I found in the source; treat them as "this area has rough
edges", not as behaviour to copy.

## 1.3 The folder rail

Screenshot 3: a vertical strip of folder tabs down the left edge, each an icon
with a label and an unread count — «Все чаты 201», «Личные 1», «Работа», …,
«Ред.».

The source is `Telegram/SourceFiles/window/window_filters_menu.h`. `FiltersMenu`
holds `_outer`, **`_menu` — a sidebar button for the main menu**, `_scroll`,
`_container`, `_list`, `_filters` (buttons by id) and `_favorite`. It handles
drag-and-drop reordering, context menus and keyboard navigation between folders.

Two points that matter to us:

- **The hamburger button lives at the top of the folder rail**, not in the chat
  list's header. That is `_menu`. It is why screenshot 3 has no header button
  above the list.
- **Telegram ships both arrangements as a setting.** Changelog 5.7.3 beta
  (13.11.24): *"Option to show folders above the chats list."* and 5.8
  (17.11.24): *"Horizontal strip mode for chat folders."* So the vertical rail
  and our present horizontal strip are not rivals — Telegram lets the person
  choose. The rail itself arrived in 2.0 (30.03.20): *"Switch between folders in
  the new side bar to easily access all of your chats."*

## 1.4 The side menu is a layer, and it costs no width

Screenshot 1 — avatar, name, «Сменить эмодзи-статус», an account switcher with
unread counts and «Добавить аккаунт», then «Мой профиль», «Кошелёк», «Создать
группу», «Создать канал», «Контакты», «Звонки», «Избранное», «Настройки»,
«Ночной режим» with a toggle, and a quiet version line at the bottom.

`Telegram/SourceFiles/window/window_main_menu.h` matches it almost item for item:

```cpp
class MainMenu final : public Ui::LayerWidget {
```

with `_userpicButton`, `_name`, `_setEmojiStatus`, `_emojiStatusPanel`, `_badge`,
`_toggleAccounts`, `_accounts`, `_scroll`, `_menu`, `_nightThemeToggle`,
`_telegram` and `_version`.

**`Ui::LayerWidget` is the finding.** The side menu is not a column and not a
dropdown anchored under a button: it is a layer over the whole window, summoned
and dismissed. It therefore costs nothing at rest — which is precisely the
owner's «удобно в боковом списке выпадающем по надобности».

## 1.5 Settings is a panel in the list column, with its own search

Screenshot 2: Settings occupies the left column, with search, «⋮» and «✕» in its
own header; then avatar, name, phone, @username and a QR button; then «Мой
аккаунт», «Уведомления и звуки», «Конфиденциальность», «Настройки чатов»,
«Папки с чатами», «Продвинутые настройки», «Звук и камера», «Заряд батареи и
анимация», «Язык — Русский»; then «Масштаб по умолчанию» with a slider; then
Premium; then «Вопросы о Telegram», «Возможности Telegram», «Задать вопрос».

The screenshot is the primary evidence for **where** it sits. The code
corroborates **what it is made of**: `Telegram/SourceFiles/settings/sections/`
holds one module per row —

`settings_information`, `settings_notifications`, `settings_privacy_security`,
`settings_chat`, `settings_folders`, `settings_advanced`, `settings_calls`,
`settings_power_saving`, `settings_premium`, `settings_active_sessions`,
`settings_local_passcode`, `settings_passkeys`, `settings_blocked_peers`,
`settings_websites`, `settings_local_storage`, `settings_shortcuts`,
`settings_global_ttl`, `settings_business`, `settings_credits`,
`settings_notifications_type`, `settings_notifications_reactions`.

Nineteen or so sections, each its own file, each its own screen. Not one form.

And the search in that header is recent and deliberate: changelog 6.5
(06.02.26) and 6.4.3 beta (28.01.26), both *"Search in Settings."* — with
`settings_search.cpp` and `settings_recent_searches.cpp` in the directory to
implement it.

## 1.6 The profile is a column — and the same component is also the modal

Screenshot 6: the profile panel on the right with «Чат», «Звук», «Подарок»,
phone, «О себе», username with a QR button, the counts (публикации, подарок,
фотографии, видео, файлы, аудиофайл, ссылки, голосовые, GIF), then «Поделиться
контактом», «Изменить контакт», «Удалить контакт», «Заблокировать» in red.

`Telegram/SourceFiles/info/info_wrap_widget.h`:

```cpp
enum class Wrap { Layer, Narrow, Side, Search, StoryAlbumEdit };
```

**One component, five presentations, chosen by how much room there is.** `Side`
is the third column of screenshot 6. `Layer` is the same content floating over
the window when the third column does not fit. `Narrow` is the one-column
phone. `wrapValue()` is a reactive stream, so the component re-dresses itself as
the window is resized rather than being torn down and rebuilt.

This is the structural idea of the whole application, and section 5 returns to
it.

## 1.7 Search: two searches, and the in-chat one takes the list column

Screenshot 8: searching inside a conversation turns the **left** column into
«Поиск в чате:» with an «Этот чат» chip, a close cross and a magnifier
illustration reading «Поиск по сообщениям». The conversation stays where it is
on the right.

`Telegram/SourceFiles/dialogs/dialogs_widget.h` carries it:

- `searchMessages(SearchState state)`, `SearchState _searchState`
- `PeerData *searchInPeer() const`, `PeerData *_searchQueryFrom`
- `object_ptr<HistoryView::TopBarWidget> _subsectionTopBar` — a **conversation**
  top bar living inside the **chat list** widget, which is the chip
- `object_ptr<Ui::IconButton> _searchForNarrowLayout`

and `dialogs_inner_widget.h` holds `std::unique_ptr<ChatSearchIn> _searchIn` and
`History *_searchInMigrated`.

So the two searches are one widget in two states, not two features. The chat
list's own field searches everything; giving it a peer scopes it to one
conversation and the column re-dresses. Changelog 5.1.4 (06.06.24): *"Improve
design of search in chat."*

## 1.8 «Звук и камера» is device pickers and live readouts, and nothing else

Screenshot 4: «Колонки и наушники → Устройство воспроизведения: По умолчанию»;
«Микрофон → Устройство записи: По умолчанию» with a **live level meter** under
it; «Звонки и видеочаты» with a toggle and its own two device pickers; «Камера →
Устройство записи» with a **live preview**; «Другие настройки → Приём звонков на
этом устройстве», «Перейти к системным настройкам звука». No sliders, no
processing modes.

`Telegram/SourceFiles/settings/sections/settings_calls.h` confirms each piece:
`ChoosePlaybackDeviceBox`, `ChooseCaptureDeviceBox`, `PlaybackDeviceNameValue`,
`CaptureDeviceNameValue`, `kMicTestUpdateInterval`, `kMicTestAnimationDuration`,
`AddCameraSubsection`, `ChooseCameraDeviceBox`, `CameraDeviceNameValue` and
`Webrtc::VideoTrack`.

The shape of the section is: **choose a device, and see it working.** The meter
and the preview are not a test you start — they are how the row tells you it
chose the right thing.

## 1.9 What is a panel and what is a modal

Telegram Desktop's rule, read off the code, is narrow and consistent:

| Kind | Examples | Mechanism |
| --- | --- | --- |
| **Column** | chat list, conversation, profile, settings | `ColumnLayout`, width from a saved ratio |
| **Rail** | folders | fixed `windowFiltersWidth: 72px` |
| **Layer** | the side menu, the profile when the third column will not fit | `Ui::LayerWidget`, `Info::Wrap::Layer` |
| **Box** | device choosers, confirmations | `ChoosePlaybackDeviceBox` and friends |

**A layer is what a column becomes when there is no room for it** — not a
separate design. That is why nothing in Telegram Desktop feels like a website
window opened over an application.

## 1.10 Against LETSCUBE today

Our files, read on this branch.

| | Telegram Desktop | LETSCUBE today |
| --- | --- | --- |
| **Columns** | 4 (rail, list, chat, profile), widths from a saved ratio | 2 panes. `artifacts/kub/src/components/layout/MainLayout.tsx:102` — `md:w-[360px] lg:w-[380px] xl:w-[400px]`, a breakpoint triple, not draggable, not stored |
| **Narrowing** | to 66px, avatars only, by a ratio | none. Two shadcn primitives with the ability exist and **nothing imports them**: `artifacts/kub/src/components/ui/sidebar.tsx` (`collapsible="icon"`, `--sidebar-width-icon`) and `artifacts/kub/src/components/ui/resizable.tsx` |
| **Folders** | 72px vertical rail with counts, drag reorder, favourite; a horizontal strip as an option | `artifacts/kub/src/components/sidebar/FolderTabs.tsx`, horizontal only, hidden while searching. No vertical variant on this branch |
| **Side menu** | `Ui::LayerWidget` over the window, hamburger at the top of the rail | a dropdown anchored under the avatar, `absolute left-0 top-12 w-64`, `artifacts/kub/src/components/sidebar/SidebarHeader.tsx:106-124` |
| **Settings** | a panel in the list column, one file per section, with its own search | `artifacts/kub/src/components/sidebar/SettingsModal.tsx`, one `KubModal size="xl"` of 789 lines over everything; rows from `artifacts/kub/src/lib/settingsRows.ts` |
| **Profile** | `Info::Wrap::Side` — a real third column, degrading to `Layer` | `artifacts/kub/src/components/chat/ChatInfoPanel.tsx` — a **draggable floating window** 380×620 (`artifacts/kub/src/lib/profileWindow.ts`), a full-screen sheet below 640px. It **used to be** a 320px right column and was made a window as D-050 |
| **In-chat search** | takes the list column | `artifacts/kub/src/components/chat/ChatSearchBar.tsx`, a capsule docked under the chat header, over the conversation |
| **Sound** | device pickers, live meter, camera preview; no sliders, no modes | `artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx` — two selects, a meter behind a «Проверка микрофона» button, a mic gain slider, three processing modes (one rendered disabled), three checkboxes, self-monitoring, reset |
| **Camera** | a device picker with a live preview, in settings | no picker anywhere; only a front/back toggle, and previews only in the composer (`CameraCaptureModal.tsx`, `VideoMessageRecorderModal.tsx`) |
| **Bottom bar on a computer** | none | none today either — but both navigation options A and B proposed one |

Three of our surfaces are the same idea solved three different ways, where
Telegram has one: a person's profile is the floating `ChatInfoPanel`, the
«Мини-профиль» sheet inside the search palette
(`artifacts/kub/src/components/search/SearchShared.tsx:248`), and an admin
`KubModal` (`artifacts/kub/src/pages/admin/UsersTab.tsx:1128`).

## 1.11 What it would cost to follow

Sizes are my estimate of scope, not a schedule.

**Small, and mostly already there:**

- **In-chat search into the list column.** `ChatSearchBar` already exists with
  its query, counters and result rows; what changes is where it mounts and that
  the chat keeps its scroll position. The chat-list column already swaps its
  body for `SidebarSearchResults`, so the mechanism is present.
- **Search in Settings.** `settingsRows.ts` is already a data structure with a
  contractual order — a search over it is a filter, not a rewrite. This is the
  cheapest single thing on the list and it is not in the 22 questions.
- **Sound and camera.** The meter already exists in `AudioSettingsSection.tsx`
  and is the only one in the product; making it live under the picker instead of
  behind a button is a small change. Answer 12a already removes the sliders and
  modes. A camera picker with a preview is new, but `CameraCaptureModal.tsx`
  already holds a live `<video srcObject>`.

**Medium:**

- **The folder rail.** A new component; `FolderTabs.tsx` stays for phones and as
  the horizontal option, which is what Telegram itself ships. The counts and the
  muted split already exist.
- **The side menu as a layer.** The avatar dropdown's contents are already the
  right list; what changes is that it becomes a layer and moves to the top of
  the rail. It must stay out of any `backdrop-filter` ancestor — rule 3 of
  `docs/operations/interface-material.md` — and it already uses a fixed
  click-catcher, so it is close.

**Large, and each with a named trap:**

- **The narrowable column.** The breakpoint triple must become a stored ratio
  driven into a CSS custom property. Three traps:
  - **The width is duplicated.** `MainLayout.tsx:102` and
    `artifacts/kub/src/pages/public/PublicPreviewCapturePage.tsx:233` both carry
    the 360/380/400 triple and must move together.
  - **Do not put the dragged width in React state.**
    `tests/e2e/chat-list-event-cost.spec.ts` counts renders of `Sidebar`,
    `ChatList` and `ChatListItem` per event, and those counts are a contract. A
    width in the store re-renders every row on every frame of a drag. Drive a CSS
    variable off a ref.
  - **Do not add a `z-index` to the column.** `MainLayout.tsx:92-100` says so in
    a comment: a stacking context there clamps every dialog the sidebar opens.
    Rules 3 and 12 of the material document are the same warning from two
    directions.
  - In our favour: `ChatListItem` has **no fixed height** and is content-sized,
    so an avatars-only state is a variant of the existing row rather than a
    second list.
- **Settings as a column.** 789 lines of modal become a panel with a header of
  its own. This makes **D-136 worse, not better**: today «Сохранить» persists
  only `full_name`, `username` and `bio` while every other control saves on
  change, and closing throws typed text away. A column has no «Закрыть» to hang
  a guard on. The per-section split that answer 11a implies is the fix, not an
  extra.
- **The profile as a column.** This **reverses D-050**, which turned the 320px
  right column into a floating window. The reason for D-050 is not recorded in
  the files I read, so this should be re-opened knowingly rather than quietly.
  Telegram's own answer is instructive: it did not choose between a column and a
  window — `Info::Wrap` is both, chosen by width, and we already have the same
  content in three places that could collapse into one.

---

# 2. Telegram iOS 26 and Liquid Glass — the design language

## 2.1 What the material actually does

Apple's own description, from the June 2025 Newsroom announcement:

> "This translucent material reflects and refracts its surroundings, while
> dynamically transforming to help bring greater focus to content."

> "Its color is informed by surrounding content and intelligently adapts between
> light and dark environments."

> "Controls are crafted out of Liquid Glass and act as a distinct functional
> layer that sits above apps. They give way to content and dynamically morph as
> users need more options or move between different parts of an app."

and, for the desktop and tablet shapes that matter to our Windows app, sidebars

> "refract the content behind them — while reflecting content and the user's
> wallpaper from around them — which ensures users always have a sense of their
> context."

## 2.2 Apple's rules, in Apple's words

From the WWDC 2025 session «Meet Liquid Glass» transcript:

- **Two variants.** *"Regular is the most versatile and the one you will be
  using the most. This variant gives you all the visual and adaptive effects
  we've talked about, and provides legibility regardless of context."* against
  *"Clear, on the other hand, does not have adaptive behaviors. It is
  permanently more transparent … To provide enough legibility for symbols or
  labels, it needs a dimming layer to darken the underlying content."*
- **Where it belongs.** *"You may be tempted to use Liquid Glass everywhere but
  it is best reserved for the navigation layer that floats above the content of
  your app."*
- **Never stacked.** *"always avoid glass on glass. Stacking Liquid Glass
  elements on top of each other can quickly make the interface feel cluttered
  and confusing. When placing elements on top of Liquid Glass, avoid applying
  the material to both layers."*
- **Scroll edges are part of the material, not decoration.** *"Scroll edge
  effects work in concert with Liquid Glass to maintain that crucial separation
  between the UI and content layers and ensure legibility, especially with
  dynamically scrolling content."*
- **Tint sparingly.** *"Tinting should only be used to bring emphasis to primary
  elements and actions in the UI… Avoid tinting all your elements. When every
  element is tinted, nothing stands out."*
- **Concentricity.** *"Glass controls nest perfectly into the rounded corners of
  windows, maintaining concentricity throughout the UI."*
- **Accessibility is automatic.** *"Liquid Glass offers several accessibility
  features, such as Reduced Transparency, Increased Contrast, and Reduced
  Motion… automatically applied when system-level settings are enabled."*

Two more, from sources that are not Apple and are labelled as such. Erik
Kennedy's illustrated iOS 26 guide measures the tab bar as a capsule **inset
21pt from left, right and bottom** — not full width for the first time — with
search as *"a little circular 'island' of Liquid Glass to the right"*, content
scrolling beneath it *"faded-out, but not blurred"*, and a large title of 34pt
compressing to 17pt semibold on scroll. And Wikipedia's sourced reception
section records that transparency drew legibility complaints, that Apple raised
opacity in navigation bars between betas, and that iOS 27 added a user slider
between clearer and more tinted glass.

That last point is worth holding: **Apple itself walked the transparency back
once people read real text on it.**

## 2.3 What Telegram actually did

Telegram's own blog, January 2026 (`telegram.org/blog/new-design-ai-summaries`):

> "Telegram for iOS now fully supports **Liquid Glass** — with **transparent
> elements** and beautiful **refraction effects** throughout the entire app."

and, in the same post, that effects can be turned down: *Settings > Power
Saving*, to *"maximize performance"* and *"extend battery life"*.

Three things follow that bear directly on us:

- **Telegram shipped the look without requiring iOS 26.** It drew the material
  itself rather than waiting for the system to hand it over — which is exactly
  our position, drawing it in CSS.
- **Telegram gave people a switch to turn it down.** We have no such control.
  Rule 6 of our material document forbids blurring anything that repeats, which
  is the same instinct, but the chat screen's own accounting already records
  blurred layers going from 3 to 9 on a phone.
- **Telegram then did the same on Android** (`telegram.org/blog/crafting-android-design-and-more`,
  February 2026): *"The new **bottom bar** lets you easily jump between your
  chats, settings, profile and more in **just one tap**."* Reporting on that
  release says the hamburger menu was **removed** on Android in favour of a
  four-tab bottom bar, in version 12.4.0.

That last fact is the strongest external support for the owner's correction:
**Telegram itself keeps the hamburger on the desktop and replaced it with a
bottom bar on the phone.** The owner asking for administration in the bottom
capsule on iOS and Android and in the side list on Windows is not a compromise
between two platforms — it is what Telegram does.

## 2.4 Against `docs/operations/interface-material.md`

Where we already agree, and it is most of it:

- **The navigation layer floats over content.** Rule 2's second corollary — «a
  ground is not content» — is Apple's point arrived at independently, and paid
  for the same way: chrome that sits *beside* content reveals only the page.
- **Scroll edges.** Our `--kub-chat-edge-blur`, the conversation dimmed 96% to
  88% and let go over 24px, is Apple's scroll edge effect. Rule 1 is bent for it
  deliberately, and Apple's transcript says the same thing about why it exists:
  separation between the layers, legibility over scrolling content.
- **Nothing that repeats is blurred.** Rule 6. Apple: keep it out of the content
  layer.
- **Accessibility fallback.** Our `@supports not (backdrop-filter…)` gives opaque
  fills and preserves the *relationship* rather than the values. Apple's
  equivalent is automatic; ours is hand-built, and it does not yet answer
  `prefers-reduced-transparency`.

Where we differ, and these are findings, not style notes:

- **We stack glass on glass, on a computer.** Apple's rule is explicit and we
  break it. The chat screen's option C puts capsules on a column that, from
  `md`, keeps its own panel glass — so the header capsule is glass over the
  pane's glass. On a phone the column's glass is off and the capsules frost the
  page, which is correct. This is worth a decision: either the capsules'
  backdrop on a computer is the conversation rather than a panel, or the panel
  goes. Apple's reason is legibility, and our own rule 7 says contrast has to be
  photographed — a glass-on-glass composite has not been measured as such.
- **We have one glass, Apple has two.** `--glass-fill` and
  `--glass-fill-strong` are a chrome/covering distinction, which is not the same
  axis as regular/clear. Apple's `clear` is *more* transparent with a dimming
  layer under it, used only over media. The nearest thing we have is the media
  viewer's frame, which deliberately uses **no** glass so as not to tint a
  photograph. That is a reasonable answer; it is just not Apple's.
- **We tint more than Apple would.** Our accent carries folder counts, bell
  counts, tab labels, the chosen tab, times that turn accent when unread, and
  the «Задачи»/«Админ-панель» rows in the avatar menu. Apple: tint primary
  actions only, *"when every element is tinted, nothing stands out"*. This is a
  place where LETSCUBE's own colours — which the owner explicitly wants kept —
  and Apple's guidance pull against each other, and the resolution is to keep
  the hues and spend them in fewer places.
- **Concentricity is not a rule we have.** Apple nests corner radii into the
  window's own. Our radii are chosen per component. On Windows this actually
  matters: the Tauri window has its own corners.
- **Nobody can turn it down.** Telegram added a Power Saving control. Nine
  blurred layers on a phone chat is our own recorded number, proven in Chromium
  and Playwright's WebKit and **not on a device**. A switch is cheap insurance
  and would also answer the older-iPhone question the material document leaves
  open.

---

# 3. The A/B navigation question, revisited

## 3.1 Neither A nor B, as written

The earlier assessment
(`output/renders/2026-09-12-navigation-ios/assessment.md`) offered **A «Как в
Telegram»** and **B «Плотный список»**. Both were drawn before the corrections,
and each of the three corrections lands on something both options got wrong:

| Correction | A | B |
| --- | --- | --- |
| Administration stays in the bottom capsule (iOS, Android) | ✓ already a tab by right | ✓ already a tab by right |
| Windows gets a collapsible side list | ✗ tab bar at the foot of the column, always on screen | ✗ a rail at the window's edge, always on screen |
| The list column narrows to avatars | ✗ absent | ✗ absent |

And there is a fourth problem neither option could have known about: **B's rail
and Telegram's folder rail want the same 72px of the window's left edge.** If
the folders go to the rail, as screenshot 3 shows, B's navigation rail has
nowhere to be.

The A/B question was also held back from the owner deliberately, and the reason
is recorded in `9a52db5`: his corrections change what is being chosen between.

## 3.2 The recommendation: **A+** — A, with the three corrections

Take A's phone as it is, and give the computer Telegram Desktop's actual
structure instead of a tab bar.

**On a phone, iPhone and Android — A unchanged, with administration kept.**

- The floating capsule holds **«Чаты», «Задачи», «Админка», «Настройки»** by
  right, plus the round search button beside it.
- «Админка» stays. This is the owner's correction, and section 2.3 shows
  Telegram made the same call on Android: hamburger removed, bottom bar kept.
- The person without rights gets «Чаты», «Настройки» and the round button.
- One caution, measured rather than assumed: A's tab labels are 11px, and D-061
  requires at least 8pt between labels at 360px. **Four tabs plus the round
  button has not been measured**, and answer 21a renames «Админка» to
  «Управление» — ten characters where seven fit today. Measure before choosing
  the word; see section 4.

**On a computer — web and Windows — Telegram Desktop's structure, not a tab bar.**

- **No bottom capsule at all.** Telegram Desktop has none; its navigation is the
  side list and the folder rail.
- **A 72pt folder rail at the left edge**, with the folder counts we already
  compute, and the **hamburger button at its top** — which is where
  `FiltersMenu::_menu` puts it.
- **The side list is a layer**, opened from that button and dismissed: «Мой
  профиль», «Избранное», «Новая группа», «Мои боты», «Задачи», **«Управление»**,
  «Настройки», a night-mode switch and a quiet version line. This is the owner's
  «удобно в боковом списке выпадающем по надобности», and it is where
  administration goes on Windows.
- **The chat list narrows by dragging**, from its present width down to an
  avatars-only strip. Store a ratio, not a breakpoint; restore it on launch —
  Telegram fixed exactly that in 2.1.15 and still has not fixed the collapsed
  state persisting (tdesktop#6409), which is a free lesson.
- **Settings opens in the list column**, not over the chat. That is answer 11a,
  and screenshot 2 is the picture of it.
- **A person's profile opens as the right column** when it fits, and as a layer
  when it does not — one component, two dresses, which is `Info::Wrap`.
- **Search inside a chat takes the list column**, leaving the conversation in
  place.

**Why A and not B.** The owner's direction in tracker item 30 is Telegram's way
of doing things with our colours. A is the reference one-to-one; B was a
denser rearrangement justified mainly by fitting more rows on a screen and by
putting a rail on a computer. Both of B's arguments are now answered better by
the corrections than by B: density on a computer comes from the narrowable
column, which gives the person the choice rather than deciding for them; and the
rail on a computer should be Telegram's folder rail, which B's navigation rail
would have displaced. What remains of B worth keeping is one detail — **the
brand mark in the list's top row**, since A drops the logo bar and the desktop
otherwise shows no logo at all. That is a free borrowing.

## 3.3 What A+ costs against A

- The desktop tab bar and the desktop round search button are **not built** —
  a saving.
- The folder rail, the side list layer and the narrowable column are **new** —
  section 1.11 sizes them.
- Blurred layers on the phone are unchanged from A's eight. On a computer they
  go **down**, because the tab bar and its search button are gone and the rail
  and the side list replace them only when open.
- D-112, the Windows window buttons over page controls, is solved the same way
  in A+ as in A and B: the buttons' 32pt strip becomes the top inset, and every
  surface already pads that token out of itself under rule 13.

---

# 4. Where the screenshots move the 22 answers

He answered «По рекомендации», taking 1a–22a. Then the screenshots and the
corrections arrived. Going through all twenty-two, here is what each becomes.

**Changed — four, plus two standing decisions.**

- **Q4 — the chat header's right circle, and chat search on a computer.**
  Answer 4a was: the correspondent's avatar in the circle, and on a computer
  chat search added to the header capsule. Screenshots 6 and 8 change the second
  half. **Becomes:** the avatar stays, and on a computer it opens the **profile
  column**, not a floating window; chat search does **not** go in the header
  capsule — it takes the **list column**. On a phone 4a is unchanged.
- **Q11 — where settings and profiles open on a computer.** 11a is **confirmed**
  by screenshots 2 and 6, not contradicted. But it gains two things it did not
  have: the settings column carries **its own search** — Telegram added exactly
  that in 6.5, and our `settingsRows.ts` makes it cheap — and the profile column
  should be the **same component** as the modal, chosen by width, rather than a
  second one. **Also worth saying plainly:** 11a reverses D-050, which turned
  our right column into a floating window. That should be re-opened knowingly.
- **Q12 — «Звук».** 12a is **confirmed** — device pickers only, a level meter,
  no sliders, no processing modes — and screenshot 4 adds what 12a did not ask
  for: a **camera device picker with a live preview**, a separate «Звонки и
  видеочаты» block with its own two pickers, «Приём звонков на этом устройстве»,
  and a link out to the system's sound settings. Also: Telegram's meter is
  **always live** under the picker, where ours hides behind «Проверка
  микрофона». **Becomes:** 12a plus a camera subsection, and the meter always
  on while the section is open.
- **Q18 — the location administrator.** 18a said the entry is a row in
  «Настройках». **The owner reversed this explicitly.** **Becomes:** the powers
  in 18a stand unchanged; the **entry** is the bottom capsule on iOS and
  Android, and the collapsible side list on Windows. Settings is not an entry on
  either.
- **Standing decision, reversed:** «"Админка" уходит из нижней панели; вход в
  управление — строкой в "Настройках"». It stays in the bottom capsule. Already
  recorded in `9a52db5`.
- **Standing decision, narrowed:** «Вкладка на телефоне называется "Настройки" и
  открывает настройки». Still right, and now load-bearing — with «Админка»
  staying, the capsule is Чаты / Задачи / Админка / Настройки, and «Профиль»
  disappears as a separate tab, which also closes the duplication complaint that
  «Профиль» opened Settings.

**Needs a measurement before it is settled — one.**

- **Q21 — plain words instead of jargon.** 21a stands everywhere except one
  place it did not anticipate. «Управление» is ten characters where «Админка» is
  seven, and with administration now **staying in the bottom capsule**, that
  label has to fit an 11px tab beside three others and a round button at 360px,
  under D-061's 8pt separation. **Do not decide this by eye.** Measure the four
  labels; if «Управление» does not fit, the options are a shorter tab label with
  the full word everywhere else, or an icon-only tab. Everywhere that is not the
  capsule, 21a is unaffected.

**Touched, but not contradicted — three.**

- **Q15 — which Telegram sections to add first.** 15a (Устройства, Пароль, then
  Чёрный список) is supported by the section list in 1.5, which also names
  `settings_passkeys` and `settings_websites` as later candidates.
- **Q19 — «Мои боты» as one page.** Unchanged, but on a computer it should take
  the same shape as everything else: list in the left column, the open bot on
  the right. `BotsPage.tsx` is already a `22rem` master/detail, so it is close.
- **Q22 — the order of work.** The order stands. Two dependencies it did not
  name: the **narrowable column and the desktop side list are navigation work**
  and belong in phase 0 with the rest, not later; and **settings-as-a-column
  (phase 4) depends on the column work in phase 0**, so phase 4 cannot start
  before phase 0 closes.

**Unchanged — the other fourteen.** Q1, Q2, Q3, Q5, Q6, Q7, Q8, Q9, Q10, Q13,
Q14, Q16, Q17, Q20. Nothing in the screenshots touches them. Two small
corroborations rather than changes: Q14's phone row is confirmed to sit in the
settings header block (screenshot 2 shows phone, @username and a QR button
there), and Q3's status band still needs the device check — Apple's material
adapts light and dark by itself, and whether iOS 26 does that over our light
theme is still only answerable on his iPhone.

---

# 5. Structural ideas worth taking that we had not considered

Five the owner named or showed, and three more that fall out of the source.

1. **The narrowable column, as a ratio rather than a mode.** `setNarrowRatio`
   interpolates; there is no snap and no second list. Ours can do the same
   because `ChatListItem` is content-sized. Copy the ratio, and copy the fix
   Telegram made in 2.1.15 — **persist it** — while avoiding the bug it still
   has, which is that the collapsed state does *not* persist (tdesktop#6409).
2. **The folder rail, as an option rather than a replacement.** Telegram ships
   both: a 72px vertical rail and a horizontal strip, chosen in settings (5.7.3
   beta, 5.8). We have the strip. Adding the rail does not mean losing it, and
   it puts the hamburger somewhere sensible.
3. **In-chat search takes the list column.** The conversation never moves, which
   is what makes it feel like part of the application rather than a bar dropped
   on top of it. Ours currently covers the top of the conversation.
4. **The profile is a column, and the modal is the same component.**
   `Info::Wrap { Layer, Narrow, Side }` is the real idea — not "a column instead
   of a modal" but **one component that re-dresses itself as the window
   changes**. We have the same content in three places. This is the single
   largest simplification available to us, and it is the one that would stop the
   product looking like separate screens bolted together.
5. **Live device readouts instead of controls.** A meter under the microphone
   picker and a preview under the camera picker answer «did I choose the right
   one» without asking the person to understand gain, noise suppression or
   processing modes. It is the clearest instance of the «Telegram decides, we
   ask» complaint from the parity audit.

And three the screenshots do not show but the source does:

6. **Search inside Settings** (tdesktop 6.5, 6.4.3 beta). Our `settingsRows.ts`
   is already an ordered data structure, so this is a filter over data we have.
   Cheapest item in this whole document, and it directly answers the «настройки
   лежат не там, где их ищут» complaint without moving a single setting.
7. **The side menu costs no width because it is a layer.** The reason Telegram
   can afford a long list of destinations is that the list is not on screen. Our
   avatar dropdown is close to this already; what it lacks is the rail's button
   and the account block at the top.
8. **Column widths are one arithmetic, in one place.** `computeColumnLayout()`,
   `minimalThreeColumnWidth()` and `shrinkDialogsAndThirdColumns()` are a single
   function deciding every column at once, including whether the third one fits
   at all. Ours is a Tailwind triple duplicated in two files. If we are adding a
   third column and a drag, this should become one function before it becomes
   three.

---

## Sources

Telegram Desktop source, read at `dev` on 2026-09-12:

- [`window/window.style`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/window/window.style) — column constants
- [`window/window_adaptive.h`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/window/window_adaptive.h) — layout enums
- [`window/window_session_controller.h`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/window/window_session_controller.h) and [`.cpp`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/window/window_session_controller.cpp) — `ColumnLayout`, `dialogsSmallColumnWidth`
- [`window/window_filters_menu.h`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/window/window_filters_menu.h) — the folder rail
- [`window/window_main_menu.h`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/window/window_main_menu.h) — the side menu as a layer
- [`dialogs/dialogs.style`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/dialogs/dialogs.style) — `defaultDialogRow`
- [`dialogs/dialogs_inner_widget.h`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/dialogs/dialogs_inner_widget.h) — `setNarrowRatio`
- [`dialogs/dialogs_widget.h`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/dialogs/dialogs_widget.h) — search state
- [`info/info_wrap_widget.h`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/info/info_wrap_widget.h) — `Wrap`
- [`settings/sections/`](https://github.com/telegramdesktop/tdesktop/tree/dev/Telegram/SourceFiles/settings/sections) and [`settings_calls.h`](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/settings/sections/settings_calls.h)
- [`changelog.txt`](https://github.com/telegramdesktop/tdesktop/blob/dev/changelog.txt)
- Issues [#6409](https://github.com/telegramdesktop/tdesktop/issues/6409), [#25068](https://github.com/telegramdesktop/tdesktop/issues/25068) — user reports, not measurements

Telegram:

- [Chat Folders](https://telegram.org/blog/folders) — the desktop folder sidebar
- [AI Summaries, New Design and More](https://telegram.org/blog/new-design-ai-summaries) — Liquid Glass on iOS
- [Android Redesign…](https://telegram.org/blog/crafting-android-design-and-more) — the Android bottom bar
- [9to5Google on the Android redesign](https://9to5google.com/2026/02/07/telegram-for-android-redesign-goes-all-in-on-liquid-glass-rolling-out-now/) — hamburger removed, v12.4.0

Apple, and about Apple:

- [Apple Newsroom, June 2025](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) — Apple's own description
- [WWDC 2025, «Meet Liquid Glass»](https://developer.apple.com/videos/play/wwdc2025/219/) — transcript, the rules quoted in 2.2
- [Erik Kennedy, iOS 26 design guidelines](https://www.learnui.design/blog/ios-design-guidelines-templates.html) — **secondary**, measurements
- [Create with Swift on the HIG](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/) — **secondary**, quotes three HIG lines
- [Wikipedia, Liquid Glass](https://en.wikipedia.org/wiki/Liquid_Glass) — **secondary**, sourced reception

Ours:

- `docs/operations/interface-material.md`
- `docs/PRODUCTION_PRIORITY_TRACKER.md`, item 30
- `output/renders/2026-09-12-navigation-ios/assessment.md`
- `output/audits/2026-09-12-telegram-parity/synthesis/owner-summary-ru.md`
- `docs/QA_RESULTS.md`, the 2026-09-12 entry recording the 22 answers and the
  three corrections (`9a52db5`)
