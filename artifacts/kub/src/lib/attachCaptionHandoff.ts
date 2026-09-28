/**
 * Text typed before an attachment becomes its caption (tracker item 65).
 *
 * The report, 2026-09-28: «если начать писать, а потом выбрать фото для
 * загрузки. У телеги ты тогда автоматом падаешь в поле подписи под фото со
 * своим набранным уже текстом. А здесь либо отправлять по отдельности, либо
 * слетит что-то одно из двух».
 *
 * Both Telegrams, read on 2026-09-28 rather than recalled, and they agree:
 *
 * - Telegram Desktop, `HistoryWidget::confirmSendingFiles`
 *   (`Telegram/SourceFiles/history/history_widget.cpp`, `dev`): the field's
 *   text goes to the send box as its caption and the field is emptied; the
 *   box's cancel puts the text the field had back, with its cursor — the
 *   caption as edited in the box is not what returns.
 * - Telegram for Android, `ChatActivity.openAttachMenu`: the attach sheet's
 *   comment view is set from the field's text; its send path ends with
 *   `setFieldText("")`, and a sheet dismissed without sending leaves the
 *   field as it was.
 *
 * So: the text moves into the sheet (Desktop's move rather than Android's
 * copy, because our computer's sheet is a panel above a composer that stays on
 * screen, where a copy would show the same words twice), a send spends it,
 * and any other way out gives the composer back the text it had.
 *
 * Pure, so `node --test` reads every case.
 */

/** What the sheet takes from the composer, or null when there is nothing to take. */
export function textForSheet(composerText: string, editing: boolean): string | null {
  // An edit's text is the message being edited, not a caption for a new one.
  if (editing || !composerText.trim()) return null;
  return composerText;
}

/**
 * The composer's text once the sheet gives it back. Anything typed into the
 * composer while the sheet stood over it — a computer's composer stays
 * clickable — is kept after it rather than written over.
 */
export function textAfterSheet(held: string, typedMeanwhile: string): string {
  if (!typedMeanwhile) return held;
  if (!held) return typedMeanwhile;
  return /\s$/.test(held) || /^\s/.test(typedMeanwhile) ? held + typedMeanwhile : `${held} ${typedMeanwhile}`;
}
