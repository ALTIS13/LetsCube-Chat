import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { showAppAlert } from "@/lib/appDialogs";
import { opensAttachSheet } from "@/lib/attachSheet";
import {
  originalLimitAlertTitle,
  originalLimitMessage,
  splitByOriginalLimit,
  type IncomingFilesSource,
} from "@/lib/mediaCompression";

export interface MediaSendRequest {
  id: number;
  files: File[];
  source: IncomingFilesSource;
}

export type StageIncomingFiles = (files: File[], source: IncomingFilesSource, compress: boolean) => unknown;

/**
 * Where files the composer receives go next.
 *
 * The attach sheet is the send step on every shell (D-122): a photo or a video
 * picked, pasted or dropped becomes a request, which the composer opens the
 * sheet with. There is no desktop send dialog behind it any more, and no shape
 * to ask about — a desktop and a phone do the same thing.
 *
 * A batch that states its compression has already been through that step, so it
 * is staged as it is; that is what the sheet's own send does when the conversation
 * hands it no sender of its own. A photo or a video over the limit is refused
 * here, before anything reads it, and the rest of the batch goes on. Nothing
 * asks a second time, which is also what keeps a stated send from re-opening the
 * sheet it came from.
 *
 * `ChatWindow` and the DEV preview page both route through this, so the page the
 * renders are taken from makes exactly the decision the conversation makes.
 */
export function useIncomingMediaFiles(stage: StageIncomingFiles) {
  const [request, setRequest] = useState<MediaSendRequest | null>(null);
  const nextIdRef = useRef(1);
  const stageRef = useRef(stage);

  useLayoutEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  const handleIncomingFiles = useCallback((
    files: File[],
    source: IncomingFilesSource,
    options?: { compress?: boolean },
  ) => {
    if (!files.length) return;

    if (options?.compress === undefined) {
      if (opensAttachSheet({ source, files })) {
        setRequest({ id: nextIdRef.current++, files, source });
        return;
      }
      stageRef.current(files, source, true);
      return;
    }

    if (options.compress === false) {
      const { within, over } = splitByOriginalLimit(files);
      if (over.length) {
        showAppAlert(
          over.map((file) => originalLimitMessage(file)).filter(Boolean).join("\n"),
          originalLimitAlertTitle(over.length),
        );
      }
      if (within.length) stageRef.current(within, source, false);
      return;
    }

    stageRef.current(files, source, true);
  }, []);

  const closeRequest = useCallback(() => setRequest(null), []);

  return { request, handleIncomingFiles, closeRequest };
}
