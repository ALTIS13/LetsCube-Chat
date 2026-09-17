"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KubIcon, KubModal } from "@/components/kub";
import { requestAppConfirm } from "@/lib/appDialogs";
import { showActionFeedback } from "@/lib/actionFeedback";
import { DISABLED_SINK_FILLED, DISABLED_TEXT, FOCUS_RING, PRESS_FILLED, PRESS_SINK } from "@/lib/controlSurface";
import {
  CHANNEL_NAME_MAX,
  buildChannelTree,
  canManageChannels,
  channelNameRemaining,
  normalizeChannelName,
  type ChannelGroup,
  type ChannelKind,
  type ChatRole,
  type ServerChannel,
} from "@/lib/serverChannels";
import {
  CANCEL_LABEL,
  CATEGORIES_UNAVAILABLE,
  CATEGORY_ADD_LABEL,
  CATEGORY_NAME_LABEL,
  CATEGORY_NAME_PLACEHOLDER,
  CHANNELS_DIALOG_TITLE,
  CHANNELS_EMPTY,
  CHANNELS_HINT,
  CHANNEL_ADD_LABEL,
  CHANNEL_CATEGORY_LABEL,
  CHANNEL_CREATE_SUBMIT,
  CHANNEL_KIND_LABEL,
  CHANNEL_KIND_OPTIONS,
  CHANNEL_NAME_LABEL,
  CHANNEL_SAVE_SUBMIT,
  GENERAL_CHANNEL_NOTE,
  SEAT_LIMIT_LABEL,
  SEAT_LIMIT_DEFAULT,
  SEAT_LIMIT_MAX,
  SEAT_LIMIT_MIN,
  SPEAK_ROLE_LABEL,
  SPEAK_ROLE_LISTENERS_NOTE,
  SPEAK_ROLE_OPTIONS,
  UNCATEGORIZED_LABEL,
  canRemoveChannel,
  categoryRemovalPrompt,
  categoryRemovedFeedback,
  channelKindLabel,
  channelNamePlaceholder,
  channelRemovalPrompt,
  channelRemovedFeedback,
  normalizeSeatLimit,
  speakRoleNarrowsSpeech,
  voiceChannelSummaryLine,
} from "@/lib/serverChannelVocabulary";
import { useChannelAdmin } from "@/hooks/useChannelAdmin";
import { cn } from "@/lib/utils";

/**
 * Adding, renaming, moving and removing a group's channels, its voice rooms and
 * the headings that group them.
 *
 * The rail lists them; this changes them. It is one dialog rather than a screen
 * per thing because all five verbs act on the same list and a person doing one
 * of them is nearly always about to do another — a new heading exists to be
 * filled, and a room made by mistake is removed in the next breath.
 *
 * **Reordering is two buttons, not a drag.** That is a decision rather than the
 * brief's: a drag inside a scrolling dialog is the one gesture a phone cannot
 * disambiguate from the scroll it sits in, and the same control has to work for
 * a keyboard. `reorderPositions` is what both would call anyway — it renumbers
 * the run from zero and returns only the rows that change, so a move that lands
 * where it started writes nothing whichever gesture asked for it.
 *
 * **The run a move is computed in is the channels of one kind under one
 * heading**, which is exactly the run a person sees. Positions then repeat
 * between headings, and that is harmless: `buildChannelTree` groups first and
 * orders second, so two channels at position 0 are never compared unless they
 * are in the same group, where this makes them unique.
 *
 * It is raised through an event rather than mounted per surface, the way
 * `requestContentReport` is, so that the settings screen and the rail open the
 * same dialog instead of holding two copies of its state.
 */

const MANAGE_REQUEST_EVENT = "kub:channel-manage";

export interface ChannelManageRequest {
  chatId: string;
  /** The group's own name, for the dialog's description line. */
  chatName?: string | null;
  /** This person's `chat_members.role`. The dialog refuses to open without an admin one. */
  role: string | null | undefined;
}

/**
 * Asks for the dialog. Safe from anywhere, including a menu item's handler.
 *
 * This is the whole of what another surface needs: the rail's
 * `onManageChannels` is `() => requestChannelManage({ chatId, chatName, role })`
 * and nothing else has to change.
 */
export function requestChannelManage(request: ChannelManageRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChannelManageRequest>(MANAGE_REQUEST_EVENT, { detail: request }));
}

/**
 * Which mounted host answers the event.
 *
 * Two surfaces mount one — `ChatWindow`, beside the rail, and the group's
 * settings screen — and both answering would put two identical dialogs on top
 * of each other. So every host registers and **the one that registered first
 * acts**, which is not the same as the first one claiming a flag and the rest
 * staying deaf: a claim held by a host that then unmounts leaves the others
 * unsubscribed, and the request reaches nobody. Both stay subscribed and the
 * question «am I the first?» is asked at the moment the event arrives, so
 * whichever host outlives the other takes over by itself.
 */
const hosts: ((request: ChannelManageRequest) => void)[] = [];

/** One dialog per document. `ChatSettingsView` renders a host; `ChatWindow` does too. */
export function ChannelManageDialogHost() {
  const [request, setRequest] = useState<ChannelManageRequest | null>(null);

  useEffect(() => {
    const accept = (detail: ChannelManageRequest) => setRequest(detail);
    hosts.push(accept);
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<ChannelManageRequest>).detail;
      if (!detail?.chatId) return;
      if (hosts[0] !== accept) return;
      accept(detail);
    };
    window.addEventListener(MANAGE_REQUEST_EVENT, onRequest);
    return () => {
      window.removeEventListener(MANAGE_REQUEST_EVENT, onRequest);
      const at = hosts.indexOf(accept);
      if (at >= 0) hosts.splice(at, 1);
    };
  }, []);

  if (!request) return null;
  // A control the database will refuse is worse than no control, and a dialog
  // it will refuse is worse than a control: every write inside needs
  // `is_chat_admin`, which is what `canManageChannels` mirrors.
  if (!canManageChannels(request.role)) return null;
  return (
    <ChannelManageModal
      // A second request while one is open replaces it rather than stacking,
      // and the key resets every draft field with it.
      key={request.chatId}
      request={request}
      onClose={() => setRequest(null)}
    />
  );
}

type Draft =
  | { kind: "none" }
  | { kind: "create-channel"; channelKind: ChannelKind; categoryId: string | null }
  | { kind: "edit-channel"; id: string; channelKind: ChannelKind }
  | { kind: "create-category" }
  | { kind: "edit-category"; id: string };

export function ChannelManageModal({
  request,
  onClose,
}: {
  request: ChannelManageRequest;
  onClose: () => void;
}) {
  const admin = useChannelAdmin(request.chatId, true);
  const [draft, setDraft] = useState<Draft>({ kind: "none" });
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [seats, setSeats] = useState<string>("");
  const [speakRole, setSpeakRole] = useState<ChatRole>("member");

  const tree = useMemo(
    () => buildChannelTree({ categories: admin.categories, channels: admin.channels }),
    [admin.categories, admin.channels],
  );

  const closeDraft = useCallback(() => {
    setDraft({ kind: "none" });
    admin.clearWriteError();
  }, [admin]);

  const openCreateChannel = useCallback(
    (into: string | null) => {
      setDraft({ kind: "create-channel", channelKind: "text", categoryId: into });
      setName("");
      setCategoryId(into);
      // The column's own default, shown rather than left blank. An empty seat
      // field normalises to the same ten on submit, so the row came out right
      // and the form had told the person nothing — photographed in the light
      // theme at 1440 with «Сколько мест» empty above a room that was about to
      // be made with ten.
      setSeats(String(SEAT_LIMIT_DEFAULT));
      setSpeakRole("member");
      admin.clearWriteError();
    },
    [admin],
  );

  /**
   * A form that has just opened is scrolled to.
   *
   * It is appended below the list, so on a screen with a few channels already
   * in it the fields — and the button that submits them — open below the fold
   * of the dialog's own body. `block: "nearest"` moves the least that makes it
   * visible and does nothing when it already is, so a form opened at the top of
   * a short list does not jump.
   */
  const revealDraft = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ block: "nearest" });
  }, []);

  /**
   * And the foot of the form is scrolled to again whenever the form grows.
   *
   * Photographed in the light theme at 1440: choosing «Голосовой» adds the seat
   * field, three speak options and the listeners note to a form that already
   * reached the bottom of the dialog's body, and «Создать» went below the fold
   * with them. Opening the form is not the only moment it can end up out of
   * reach — changing what it is for is another, and `draft` is replaced on both.
   *
   * `speakRole` is in the list for the same reason and was found the same way:
   * choosing «Только администраторы» adds the listeners note beneath the
   * options, which pushed «Отмена» and «Создать» half under the dialog's footer
   * at 390. It does not replace `draft`, so without it here the form grew and
   * nothing moved.
   *
   * The sentinel has a height so the buttons come to rest clear of the fold
   * rather than flush against it.
   */
  const draftFoot = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (draft.kind === "none") return;
    draftFoot.current?.scrollIntoView({ block: "nearest" });
  }, [draft, speakRole]);

  const openEditChannel = useCallback(
    (channel: ServerChannel) => {
      setDraft({ kind: "edit-channel", id: channel.id, channelKind: channel.kind });
      setName(channel.name);
      setCategoryId(channel.categoryId);
      setSeats(String(normalizeSeatLimit(channel.maxParticipants)));
      setSpeakRole((channel.speakRole as ChatRole | null) ?? "member");
      admin.clearWriteError();
    },
    [admin],
  );

  const submitDraft = useCallback(async () => {
    if (admin.busy) return;
    if (draft.kind === "create-channel") {
      const created = await admin.createChannel({
        kind: draft.channelKind,
        name,
        categoryId,
      });
      if (created) closeDraft();
      return;
    }
    if (draft.kind === "edit-channel") {
      const current = admin.channels.find((channel) => channel.id === draft.id);
      // Only what changed is written. Saving a room after touching its seat
      // count used to send the name back unchanged as well, which is a request
      // nobody needed and an `updated_at` that says the name was edited when it
      // was not.
      if (normalizeChannelName(name) !== current?.name) {
        const renamed = await admin.renameChannel(draft.channelKind, draft.id, name);
        if (!renamed) return;
      }
      if ((current?.categoryId ?? null) !== categoryId) {
        const moved = await admin.moveChannelToCategory(draft.channelKind, draft.id, categoryId);
        if (!moved) return;
      }
      if (draft.channelKind === "voice") {
        const saved = await admin.updateVoiceSettings(draft.id, {
          // The field's own text, uncleaned. `useChannelAdmin` is the one place
          // that decides what number the column gets — see `VoiceSettingsInput`.
          maxParticipants: seats,
          speakRole,
        });
        if (!saved) return;
      }
      closeDraft();
      return;
    }
    if (draft.kind === "create-category") {
      const created = await admin.createCategory(name);
      if (created) closeDraft();
      return;
    }
    if (draft.kind === "edit-category") {
      const renamed = await admin.renameCategory(draft.id, name);
      if (renamed) closeDraft();
    }
  }, [admin, categoryId, closeDraft, draft, name, seats, speakRole]);

  const removeChannel = useCallback(
    async (channel: ServerChannel) => {
      const prompt = channelRemovalPrompt({
        kind: channel.kind,
        name: channel.name,
        participantCount: channel.participantCount,
      });
      const agreed = await requestAppConfirm({ ...prompt, tone: "danger", icon: "delete" });
      if (!agreed) return;
      const done = await admin.removeChannel(channel.kind, channel.id);
      if (!done) return;
      // The row is gone, so nothing on screen says the press worked. This is the
      // one action in the dialog whose result is not visible in the list.
      const said = channelRemovedFeedback(channel.kind, channel.name);
      showActionFeedback({ kind: "success", ...said, key: `channel-removed:${channel.id}` });
    },
    [admin],
  );

  const removeCategory = useCallback(
    async (group: ChannelGroup) => {
      const category = group.category;
      if (!category) return;
      const prompt = categoryRemovalPrompt({ name: category.name, channelCount: group.channels.length });
      const agreed = await requestAppConfirm({ ...prompt, tone: "danger", icon: "delete" });
      if (!agreed) return;
      const done = await admin.removeCategory(category.id);
      if (!done) return;
      const said = categoryRemovedFeedback(group.channels.length);
      showActionFeedback({ kind: "success", ...said, key: `category-removed:${category.id}` });
    },
    [admin],
  );

  const moveChannel = useCallback(
    (group: ChannelGroup, channel: ServerChannel, delta: number) => {
      // The run is the channels of this kind under this heading — the run the
      // person can see. Text and voice are separate tables with separate
      // position sequences, so mixing them would order by an accident of which
      // table counted first.
      const siblings = group.channels.filter((row) => row.kind === channel.kind);
      const from = siblings.findIndex((row) => row.id === channel.id);
      if (from < 0) return;
      void admin.reorderChannels(siblings, channel.id, from + delta);
    },
    [admin],
  );

  const moveCategory = useCallback(
    (categoryId: string, delta: number) => {
      const ordered = [...admin.categories].sort((a, b) => a.position - b.position);
      const from = ordered.findIndex((category) => category.id === categoryId);
      if (from < 0) return;
      void admin.reorderCategories(categoryId, from + delta);
    },
    [admin],
  );

  const remaining = channelNameRemaining(name);
  const nameIsUsable = normalizeChannelName(name) !== null;
  const drafting = draft.kind !== "none";

  /**
   * The create-channel form, rendered in one place and used in two.
   *
   * Two call sites because it belongs inside the heading it is adding to when
   * there is one, and after the list when there is not — and «when there is
   * not» is the ordinary case: a group with no channels has no sections at all.
   */
  const renderCreateChannelForm = (open: Extract<Draft, { kind: "create-channel" }>) => (
    <div ref={revealDraft} className="kub-raise rounded-xl px-3 py-3" data-testid="channel-create-form">
      <ChannelFields
        idPrefix="channel-create"
        kind={open.channelKind}
        name={name}
        remaining={remaining}
        categories={admin.categories}
        categoriesSupported={admin.categoriesSupported}
        categoryId={categoryId}
        seats={seats}
        speakRole={speakRole}
        busy={admin.busy}
        onName={setName}
        onKind={(next) => setDraft({ ...open, channelKind: next })}
        onCategory={setCategoryId}
        onSeats={setSeats}
        onSpeakRole={setSpeakRole}
      />
      <FormButtons
        submitLabel={CHANNEL_CREATE_SUBMIT}
        submitTestId="channel-create-submit"
        busy={admin.busy}
        canSubmit={nameIsUsable}
        onSubmit={() => void submitDraft()}
        onCancel={closeDraft}
      />
      <div ref={draftFoot} aria-hidden="true" className="h-2" />
    </div>
  );

  return (
    <KubModal
      open
      onClose={() => {
        if (!admin.busy) onClose();
      }}
      title={CHANNELS_DIALOG_TITLE}
      description={request.chatName ?? undefined}
      icon={<KubIcon name="hash" size={18} />}
      size="md"
      contentClassName="px-4 py-4 sm:px-5"
      footer={
        <button
          type="button"
          onClick={onClose}
          data-testid="channel-manage-close"
          className={cn(
            "kub-button inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] kub-raise-hover",
            PRESS_SINK,
            FOCUS_RING,
            DISABLED_TEXT,
          )}
        >
          Готово
        </button>
      }
    >
      <div data-testid="channel-manage-dialog" className="flex flex-col gap-3">
        <p className="text-xs leading-snug text-[color:var(--kub-muted)]" data-testid="channel-manage-hint">
          {CHANNELS_HINT}
        </p>

        {!admin.categoriesSupported && (
          <p
            data-testid="channel-manage-categories-unavailable"
            className="text-xs leading-snug text-[color:var(--kub-muted)]"
          >
            {CATEGORIES_UNAVAILABLE}
          </p>
        )}

        {admin.error && (
          <p data-testid="channel-manage-read-error" className={REFUSAL_CLASS}>
            {admin.error}
          </p>
        )}

        {admin.ready && tree.length === 0 && !admin.error && (
          <p data-testid="channel-manage-empty" className="text-sm text-[color:var(--kub-muted)]">
            {CHANNELS_EMPTY}
          </p>
        )}

        {tree.map((group, groupIndex) => (
          <section
            key={group.category?.id ?? "loose"}
            data-testid="channel-manage-group"
            data-category-id={group.category?.id ?? ""}
            className="flex flex-col gap-1"
          >
            <header className="flex min-h-8 items-center gap-1 px-1">
              <span
                data-testid="channel-manage-group-name"
                className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]"
              >
                {group.category?.name ?? UNCATEGORIZED_LABEL}
              </span>
              {group.category && (
                <>
                  <IconAction
                    name="chevronUp"
                    label="Выше"
                    testId="category-up"
                    available={groupIndex > firstCategoryIndex(tree)}
                    disabled={admin.busy}
                    onClick={() => moveCategory(group.category!.id, -1)}
                  />
                  <IconAction
                    name="chevronDown"
                    label="Ниже"
                    testId="category-down"
                    available={groupIndex < tree.length - 1}
                    disabled={admin.busy}
                    onClick={() => moveCategory(group.category!.id, 1)}
                  />
                  <IconAction
                    name="edit"
                    label="Переименовать раздел"
                    testId="category-rename"
                    disabled={admin.busy}
                    onClick={() => {
                      setDraft({ kind: "edit-category", id: group.category!.id });
                      setName(group.category!.name);
                      admin.clearWriteError();
                    }}
                  />
                  <IconAction
                    name="delete"
                    label="Удалить раздел"
                    testId="category-remove"
                    tone="danger"
                    disabled={admin.busy}
                    onClick={() => void removeCategory(group)}
                  />
                </>
              )}
              <IconAction
                name="create"
                label="Добавить канал в раздел"
                testId="channel-add-here"
                disabled={admin.busy}
                onClick={() => openCreateChannel(group.category?.id ?? null)}
              />
            </header>

            {draft.kind === "edit-category" && draft.id === group.category?.id ? (
              <NameForm
                containerRef={revealDraft}
                testId="category-edit-form"
                label={CATEGORY_NAME_LABEL}
                placeholder={CATEGORY_NAME_PLACEHOLDER}
                value={name}
                remaining={remaining}
                busy={admin.busy}
                submitLabel={CHANNEL_SAVE_SUBMIT}
                canSubmit={nameIsUsable}
                onChange={setName}
                onSubmit={() => void submitDraft()}
                onCancel={closeDraft}
              />
            ) : null}

            {group.channels.length > 0 && (
              <ul className="kub-raise divide-y divide-[color:var(--kub-rule)] overflow-hidden rounded-xl">
                {group.channels.map((channel) => {
                  const editing = draft.kind === "edit-channel" && draft.id === channel.id;
                  const siblings = group.channels.filter((row) => row.kind === channel.kind);
                  const at = siblings.findIndex((row) => row.id === channel.id);
                  return (
                    <li
                      key={`${channel.kind}:${channel.id}`}
                      data-testid="channel-manage-row"
                      data-channel-id={channel.id}
                      data-channel-kind={channel.kind}
                    >
                      <div className="flex min-h-11 items-center gap-2 px-3 py-1.5">
                        <KubIcon
                          name={channel.kind === "voice" ? "voice" : "hash"}
                          size={16}
                          tone="muted"
                          className="shrink-0"
                          label={channelKindLabel(channel.kind)}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span
                            data-testid="channel-row-name"
                            className="truncate text-sm text-[color:var(--kub-text)]"
                          >
                            {channel.name}
                          </span>
                          {/* Wraps where the name truncates. A name is one
                              thing and its end can be guessed; «5 мест · Только
                              администраторы» came out «5 мест · Только ад…» at
                              390, which loses the half that says what the
                              setting does. */}
                          <span
                            data-testid="channel-row-summary"
                            className="text-[11px] leading-tight text-[color:var(--kub-muted)]"
                          >
                            {channel.kind === "voice"
                              ? voiceChannelSummaryLine({
                                  maxParticipants: channel.maxParticipants,
                                  speakRole: (channel.speakRole as ChatRole | null) ?? null,
                                })
                              : channel.isGeneral
                                ? GENERAL_CHANNEL_NOTE
                                : ""}
                          </span>
                        </span>
                        <IconAction
                          name="chevronUp"
                          label="Выше"
                          testId="channel-up"
                          available={at > 0}
                          disabled={admin.busy}
                          onClick={() => moveChannel(group, channel, -1)}
                        />
                        <IconAction
                          name="chevronDown"
                          label="Ниже"
                          testId="channel-down"
                          available={at >= 0 && at < siblings.length - 1}
                          disabled={admin.busy}
                          onClick={() => moveChannel(group, channel, 1)}
                        />
                        <IconAction
                          name="edit"
                          label="Настроить канал"
                          testId="channel-edit"
                          disabled={admin.busy}
                          onClick={() => openEditChannel(channel)}
                        />
                        <IconAction
                          name="delete"
                          label={channel.kind === "voice" ? "Убрать комнату" : "Убрать канал"}
                          testId="channel-remove"
                          tone="danger"
                          // `topics.is_general`: the channel the group started
                          // with cannot be removed, so its column is held open
                          // rather than filled with a control that would fail.
                          available={canRemoveChannel(channel)}
                          disabled={admin.busy}
                          onClick={() => void removeChannel(channel)}
                        />
                      </div>

                      {editing && (
                        <div ref={revealDraft} className="px-3 pb-3" data-testid="channel-edit-form">
                          <ChannelFields
                            idPrefix="channel-edit"
                            kind={channel.kind}
                            kindLocked
                            name={name}
                            remaining={remaining}
                            categories={admin.categories}
                            categoriesSupported={admin.categoriesSupported}
                            categoryId={categoryId}
                            seats={seats}
                            speakRole={speakRole}
                            busy={admin.busy}
                            onName={setName}
                            onKind={() => undefined}
                            onCategory={setCategoryId}
                            onSeats={setSeats}
                            onSpeakRole={setSpeakRole}
                          />
                          <FormButtons
                            submitLabel={CHANNEL_SAVE_SUBMIT}
                            submitTestId="channel-edit-submit"
                            busy={admin.busy}
                            canSubmit={nameIsUsable}
                            onSubmit={() => void submitDraft()}
                            onCancel={closeDraft}
                          />
                          <div ref={draftFoot} aria-hidden="true" className="h-2" />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {draft.kind === "create-channel" && draft.categoryId === (group.category?.id ?? null) &&
              renderCreateChannelForm(draft)}
          </section>
        ))}

        {/* The same form, when no section claimed it.
            It used to be rendered ONLY inside the matching section, so in a
            group with no channels yet — `tree.length === 0`, which is what
            almost every group on this deployment actually is — the draft was
            set and nothing appeared. Pressing «Добавить канал» did exactly
            nothing, which is how the owner reported it. The category form below
            never had the fault because it was always outside the map. */}
        {draft.kind === "create-channel" &&
          !tree.some((group) => (group.category?.id ?? null) === draft.categoryId) &&
          renderCreateChannelForm(draft)}

        {draft.kind === "create-category" && (
          <NameForm
            containerRef={revealDraft}
            testId="category-create-form"
            label={CATEGORY_NAME_LABEL}
            placeholder={CATEGORY_NAME_PLACEHOLDER}
            value={name}
            remaining={remaining}
            busy={admin.busy}
            submitLabel={CHANNEL_CREATE_SUBMIT}
            canSubmit={nameIsUsable}
            onChange={setName}
            onSubmit={() => void submitDraft()}
            onCancel={closeDraft}
          />
        )}

        {admin.writeError && (
          <p data-testid="channel-manage-error" className={REFUSAL_CLASS}>
            {admin.writeError}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <AddButton
            testId="channel-create-open"
            icon="create"
            label={CHANNEL_ADD_LABEL}
            disabled={admin.busy || drafting}
            onClick={() => openCreateChannel(null)}
          />
          {admin.categoriesSupported && (
            <AddButton
              testId="category-create-open"
              icon="folderAdd"
              label={CATEGORY_ADD_LABEL}
              disabled={admin.busy || drafting}
              onClick={() => {
                setDraft({ kind: "create-category" });
                setName("");
                admin.clearWriteError();
              }}
            />
          )}
        </div>
      </div>
    </KubModal>
  );
}

/**
 * Where the first heading is in the drawn tree.
 *
 * `buildChannelTree` puts the uncategorised group first and drops it when it is
 * empty, so the index of the first heading is 0 or 1 and cannot be assumed. The
 * topmost heading's «выше» has nowhere to go.
 */
function firstCategoryIndex(tree: readonly ChannelGroup[]): number {
  return tree.findIndex((group) => group.category !== null);
}

const REFUSAL_CLASS =
  "rounded-xl border border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] px-3 py-2 text-xs leading-snug text-[color:var(--kub-danger-text)]";

/**
 * A field's caption, and the well it is cut into.
 *
 * A well keeps its perimeter — rule 11's first named exception — because in the
 * dark theme the inset step alone measures under the floor against the sheet
 * holding it. The focus indicator is the outline, never a ring: Tailwind builds
 * `ring` out of box-shadow, which the material already answers.
 */
const FIELD_CLASS = cn(
  "h-11 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 text-sm text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]",
  FOCUS_RING,
);
const CAPTION_CLASS =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]";

/**
 * The width of one icon control, held open where there is no control.
 *
 * Photographed at 390 before this existed: the general channel has no «Убрать»,
 * so its pencil sat in the column every other row's ✕ sits in, and the four
 * columns of a two-row list did not line up. A control that is absent has to
 * leave its column behind, or the row above stops being readable as the same
 * row as the one below.
 *
 * `aria-hidden` and not focusable: it is a gap, not a disabled control. The
 * difference matters to a screen reader, which would otherwise announce a
 * button that does nothing.
 */
function IconSlot() {
  return <span aria-hidden="true" data-testid="channel-action-slot" className="kub-icon-action shrink-0" />;
}

/**
 * An icon control — and, where it cannot act, nothing at all.
 *
 * `available: false` draws the empty column instead of a disabled button. That
 * is not the material's «disabled» rule dodged, it is the rule one level up:
 * these controls rest at `--kub-muted` with no surface of their own, so
 * `DISABLED_TEXT` would colour them the colour they already are — photographed
 * at 390, a «выше» on the first row of a run was pixel-identical to a «выше»
 * that worked. A well (`DISABLED_SINK`) would be visible but would put a dark
 * square on the one row a person is least interested in. Offering no control is
 * the product's own answer elsewhere on this screen, and it is the honest one:
 * there is nowhere above the first row.
 *
 * `disabled` stays for the transient case — a write in flight — where the
 * control really is coming back and must not be pressed twice.
 */
function IconAction({
  name,
  label,
  testId,
  onClick,
  disabled,
  available = true,
  tone,
}: {
  name: "chevronUp" | "chevronDown" | "edit" | "delete" | "create";
  label: string;
  testId: string;
  onClick: () => void;
  disabled?: boolean;
  available?: boolean;
  tone?: "danger";
}) {
  if (!available) return <IconSlot />;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={label}
      title={label}
      className={cn(
        // 32px on a pointer, 44px on a finger — the shared opt-in, because an
        // icon-only control is otherwise the size of its glyph.
        "kub-icon-action kub-interactive shrink-0 rounded-lg p-1.5 kub-raise-hover",
        tone === "danger" ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-muted)]",
        PRESS_SINK,
        FOCUS_RING,
        DISABLED_TEXT,
      )}
    >
      <KubIcon name={name} size={15} tone="currentColor" />
    </button>
  );
}

function AddButton({
  testId,
  icon,
  label,
  onClick,
  disabled,
}: {
  testId: string;
  icon: "create" | "folderAdd";
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        // A border rather than a resting veil, and the reason is measured: a
        // resting `kub-raise` is the same single layer `kub-raise-hover` paints,
        // so a button carrying both has a hover that has stopped existing —
        // `tests/unit/edge-vocabulary.test.mjs` holds that exact rule for the
        // audio segment, and this button had the same fault until a probe read
        // `background-image` off it at rest and found the hover's own value
        // already there. It is a target, which is rule 11's second named
        // exception to a nested box having no perimeter.
        "kub-button inline-flex h-10 min-w-0 items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] px-3 text-sm font-semibold text-[color:var(--kub-accent-text)] kub-raise-hover",
        PRESS_SINK,
        FOCUS_RING,
        DISABLED_TEXT,
      )}
    >
      <KubIcon name={icon} size={15} tone="currentColor" className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function FormButtons({
  submitLabel,
  submitTestId,
  busy,
  canSubmit,
  onSubmit,
  onCancel,
}: {
  submitLabel: string;
  submitTestId: string;
  busy: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className={cn(
          "kub-button inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] kub-raise-hover",
          PRESS_SINK,
          FOCUS_RING,
          DISABLED_TEXT,
        )}
      >
        {CANCEL_LABEL}
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || !canSubmit}
        data-testid={submitTestId}
        className={cn(
          "kub-button inline-flex h-9 items-center justify-center rounded-lg bg-[var(--kub-action-primary-background)] px-3 text-sm font-semibold text-[color:var(--kub-action-primary-foreground)]",
          PRESS_FILLED,
          FOCUS_RING,
          DISABLED_SINK_FILLED,
        )}
      >
        {busy ? "Сохраняем…" : submitLabel}
      </button>
    </div>
  );
}

/** The heading form: one field, because a heading is only a name. */
function NameForm({
  containerRef,
  testId,
  label,
  placeholder,
  value,
  remaining,
  busy,
  submitLabel,
  canSubmit,
  onChange,
  onSubmit,
  onCancel,
}: {
  containerRef?: (node: HTMLDivElement | null) => void;
  testId: string;
  label: string;
  placeholder: string;
  value: string;
  remaining: number;
  busy: boolean;
  submitLabel: string;
  canSubmit: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div ref={containerRef} className="kub-raise rounded-xl px-3 py-3" data-testid={testId}>
      <label className={CAPTION_CLASS} htmlFor={`${testId}-name`}>
        {label}
      </label>
      <input
        id={`${testId}-name`}
        data-testid={`${testId}-name`}
        autoFocus
        value={value}
        disabled={busy}
        placeholder={placeholder}
        // The constraint's own limit, so `char_length` can only be reached by a
        // paste of astral characters — which `normalizeChannelName` cuts by code
        // point before the write.
        maxLength={CHANNEL_NAME_MAX}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && canSubmit && !busy) onSubmit();
        }}
        className={FIELD_CLASS}
      />
      <Remaining remaining={remaining} />
      <FormButtons
        submitLabel={submitLabel}
        submitTestId={`${testId}-submit`}
        busy={busy}
        canSubmit={canSubmit}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  );
}

function Remaining({ remaining }: { remaining: number }) {
  if (remaining > 16) return null;
  return (
    <div className="mt-1 text-right text-[11px] tabular-nums text-[color:var(--kub-muted)]">
      {remaining}
    </div>
  );
}

/** The channel form: name, kind, heading, and — for a room — its two settings. */
function ChannelFields({
  idPrefix,
  kind,
  kindLocked,
  name,
  remaining,
  categories,
  categoriesSupported,
  categoryId,
  seats,
  speakRole,
  busy,
  onName,
  onKind,
  onCategory,
  onSeats,
  onSpeakRole,
}: {
  idPrefix: string;
  kind: ChannelKind;
  kindLocked?: boolean;
  name: string;
  remaining: number;
  categories: readonly { id: string; name: string }[];
  categoriesSupported: boolean;
  categoryId: string | null;
  seats: string;
  speakRole: ChatRole;
  busy: boolean;
  onName: (value: string) => void;
  onKind: (value: ChannelKind) => void;
  onCategory: (value: string | null) => void;
  onSeats: (value: string) => void;
  onSpeakRole: (value: ChatRole) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className={CAPTION_CLASS} htmlFor={`${idPrefix}-name`}>
          {CHANNEL_NAME_LABEL}
        </label>
        <input
          id={`${idPrefix}-name`}
          data-testid={`${idPrefix}-name`}
          autoFocus
          value={name}
          disabled={busy}
          placeholder={channelNamePlaceholder(kind)}
          maxLength={CHANNEL_NAME_MAX}
          onChange={(event) => onName(event.target.value)}
          className={FIELD_CLASS}
        />
        <Remaining remaining={remaining} />
      </div>

      {!kindLocked && (
        <div>
          <span className={CAPTION_CLASS}>{CHANNEL_KIND_LABEL}</span>
          <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label={CHANNEL_KIND_LABEL}>
            {CHANNEL_KIND_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={kind === option.id}
                disabled={busy}
                data-testid={`${idPrefix}-kind-${option.id}`}
                onClick={() => onKind(option.id)}
                className={cn(
                  "h-10 rounded-lg px-2 text-xs font-semibold transition-colors",
                  kind === option.id
                    ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                    : "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)] kub-raise-hover",
                  kind === option.id ? PRESS_FILLED : PRESS_SINK,
                  FOCUS_RING,
                  DISABLED_SINK_FILLED,
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {categoriesSupported && (
        <div>
          <label className={CAPTION_CLASS} htmlFor={`${idPrefix}-category`}>
            {CHANNEL_CATEGORY_LABEL}
          </label>
          <select
            id={`${idPrefix}-category`}
            data-testid={`${idPrefix}-category`}
            value={categoryId ?? ""}
            disabled={busy}
            onChange={(event) => onCategory(event.target.value || null)}
            className={FIELD_CLASS}
          >
            <option value="">{UNCATEGORIZED_LABEL}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {kind === "voice" && (
        <>
          <div>
            <label className={CAPTION_CLASS} htmlFor={`${idPrefix}-seats`}>
              {SEAT_LIMIT_LABEL}
            </label>
            <input
              id={`${idPrefix}-seats`}
              data-testid={`${idPrefix}-seats`}
              type="number"
              inputMode="numeric"
              min={SEAT_LIMIT_MIN}
              max={SEAT_LIMIT_MAX}
              value={seats}
              disabled={busy}
              onChange={(event) => onSeats(event.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <span className={CAPTION_CLASS}>{SPEAK_ROLE_LABEL}</span>
            <div className="flex flex-col gap-1" role="radiogroup" aria-label={SPEAK_ROLE_LABEL}>
              {SPEAK_ROLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={speakRole === option.id}
                  disabled={busy}
                  data-testid={`${idPrefix}-speak-${option.id}`}
                  onClick={() => onSpeakRole(option.id)}
                  className={cn(
                    "flex h-10 items-center rounded-lg px-3 text-left text-xs font-semibold transition-colors",
                    speakRole === option.id
                      ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                      : "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)] kub-raise-hover",
                    speakRole === option.id ? PRESS_FILLED : PRESS_SINK,
                    FOCUS_RING,
                    DISABLED_SINK_FILLED,
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {speakRoleNarrowsSpeech(speakRole) && (
              <p
                data-testid={`${idPrefix}-listeners-note`}
                className="mt-1 text-[11px] leading-snug text-[color:var(--kub-muted)]"
              >
                {SPEAK_ROLE_LISTENERS_NOTE}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
