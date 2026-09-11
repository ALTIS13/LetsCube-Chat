import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { showAppAlert } from "@/lib/appDialogs";
import {
  mediaSendShape,
  originalLimitAlertTitle,
  originalLimitMessage,
  shouldConfirmMediaSend,
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
 * On a phone the choice was already made in the attach menu, so the files are
 * staged at once — an original over the limit is refused here, before anything
 * reads it, and the rest of the pick goes on. On a desktop a batch with a photo
 * or a video in it opens the send dialog first, because that is where
 * «Сжать изображение» is.
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
    const shape = mediaSendShape(typeof window === "undefined" ? null : window.matchMedia?.bind(window));

    if (options?.compress === false) {
      const { within, over } = splitByOriginalLimit(files);
      if (over.length) {
        showAppAlert(
          over.map((file) => originalLimitMessage(file, shape)).filter(Boolean).join("\n"),
          originalLimitAlertTitle(over.length),
        );
      }
      if (within.length) stageRef.current(within, source, false);
      return;
    }

    if (shouldConfirmMediaSend({ shape, source, files })) {
      setRequest({ id: nextIdRef.current++, files, source });
      return;
    }
    stageRef.current(files, source, true);
  }, []);

  const closeRequest = useCallback(() => setRequest(null), []);

  return { request, handleIncomingFiles, closeRequest };
}
