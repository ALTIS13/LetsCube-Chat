import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, History, LoaderCircle, RotateCcw, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PRODUCT_STACKING_LEVELS } from "@/lib/conversationStacking";
import { FOCUS_RING } from "@/lib/controlSurface";
import { inspectVideoEdit, trimVideo, type VideoEditInfo, type VideoEditResult } from "@/lib/videoEdit";
import { cn } from "@/lib/utils";

export interface AttachVideoEditorProps {
  file: File;
  url: string;
  onApply: (result: VideoEditResult) => boolean | void;
  onCancel: () => void;
  onRestore?: () => void;
}

type Busy = "inspect" | "export" | "closing" | null;
type Operation = { controller: AbortController; file: File; url: string; generation: number; done: Promise<unknown> };
type Range = { start: number; end: number };
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), video[controls], [tabindex="0"]';

function time(value: number, duration: number) {
  const precision = duration < 1 ? 3 : duration < 10 ? 2 : 0;
  const factor = 10 ** precision;
  const rounded = Math.round(Math.max(0, value) * factor) / factor;
  const minutes = Math.floor(rounded / 60);
  return `${String(minutes).padStart(2, "0")}:${(rounded % 60).toFixed(precision).padStart(precision ? precision + 3 : 2, "0")}`;
}

function ToolButton({ label, tool, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string; tool: string; children: ReactNode;
}) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <button {...props} type="button" aria-label={label} data-video-editor-tool={tool}
        className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-text)] hover:bg-[color:var(--kub-surface-2)] disabled:cursor-not-allowed disabled:opacity-45", FOCUS_RING, props.className)}>
        {children}
      </button>
    </TooltipTrigger>
    <TooltipContent style={{ zIndex: PRODUCT_STACKING_LEVELS.modal }}>{label}</TooltipContent>
  </Tooltip>;
}

export default function AttachVideoEditor({ file, url, onApply, onCancel, onRestore }: AttachVideoEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef({ file, url });
  inputRef.current = { file, url };
  const aliveRef = useRef(false);
  const closedRef = useRef(false);
  const generationRef = useRef(0);
  const operationRef = useRef<Operation | null>(null);
  const frameRef = useRef<number | null>(null);
  const [info, setInfo] = useState<VideoEditInfo | null>(null);
  const [selection, setSelection] = useState<Range>({ start: 0, end: 0 });
  const [startText, setStartText] = useState("0");
  const [endText, setEndText] = useState("0");
  const [busy, setBusy] = useState<Busy>("inspect");
  const [error, setError] = useState<string | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const { start, end } = selection;
  const minimum = Math.min(0.1, info?.duration ?? 0.1);

  function stopPreview() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    videoRef.current?.pause();
  }
  function abortOperation() {
    operationRef.current?.controller.abort();
    operationRef.current = null;
  }
  function retire() {
    closedRef.current = true;
    abortOperation();
    stopPreview();
  }
  function isCurrent(operation: Operation) {
    return aliveRef.current && !closedRef.current && operationRef.current === operation
      && generationRef.current === operation.generation
      && inputRef.current.file === operation.file && inputRef.current.url === operation.url;
  }
  function beginOperation(): Operation {
    abortOperation();
    const operation = { controller: new AbortController(), file, url, generation: generationRef.current, done: Promise.resolve() as Promise<unknown> };
    operationRef.current = operation;
    return operation;
  }
  async function exit(restore = false) {
    if (closedRef.current || (restore && !onRestore)) return;
    const pending = operationRef.current;
    const generation = generationRef.current;
    const input = inputRef.current;
    retire();
    setBusy("closing");
    // The helper settles only after its conversion/output/input disposal finishes.
    await pending?.done;
    if (!aliveRef.current || generationRef.current !== generation
      || inputRef.current.file !== input.file || inputRef.current.url !== input.url) return;
    if (restore) onRestore?.(); else onCancel();
  }
  const cancelRef = useRef(() => void exit());
  cancelRef.current = () => void exit();

  useLayoutEffect(() => {
    aliveRef.current = true;
    closedRef.current = false;
    generationRef.current++;
    setInfo(null); setSelection({ start: 0, end: 0 }); setStartText("0"); setEndText("0");
    setBusy("inspect"); setError(null); setMediaFailed(false); setProgress(0);
    const operation = beginOperation();
    const reading = inspectVideoEdit(file, { signal: operation.controller.signal });
    operation.done = reading.catch(() => undefined);
    void reading.then(result => {
      if (!isCurrent(operation)) return;
      setInfo(result); setSelection({ start: 0, end: result.duration });
      setStartText("0"); setEndText(String(result.duration)); setBusy(null);
    }, () => {
      if (isCurrent(operation)) { setError("Редактирование этого видео недоступно в этом браузере."); setBusy(null); }
    });
    return () => { aliveRef.current = false; retire(); };
  }, [file, url]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(node => node.getClientRects().length > 0);
    const focus = (event: FocusEvent) => { if (!root.contains(event.target as Node)) root.focus({ preventScroll: true }); };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); cancelRef.current();
      } else if (event.key === "Tab") {
        const nodes = focusables();
        const at = nodes.indexOf(document.activeElement as HTMLElement);
        if (at < 0 || (event.shiftKey ? at === 0 : at === nodes.length - 1)) {
          event.preventDefault(); event.stopPropagation();
          (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
        }
      }
    };
    document.addEventListener("focusin", focus, true);
    document.addEventListener("keydown", keys, true);
    root.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("keydown", keys, true);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  function seek(value: number) {
    const video = videoRef.current;
    if (video && video.readyState > 0) video.currentTime = value;
  }
  function enforceRange() {
    const video = videoRef.current;
    if (!video || !info || closedRef.current) return;
    if (video.currentTime < start) video.currentTime = start;
    if (video.currentTime >= end) {
      video.pause();
      if (video.currentTime > end) video.currentTime = end;
    }
  }
  function watchPreview() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    const tick = () => {
      frameRef.current = null;
      enforceRange();
      if (videoRef.current && !videoRef.current.paused && !closedRef.current) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }
  function playPreview() {
    const video = videoRef.current;
    if (!info || busy || closedRef.current) { video?.pause(); return; }
    if (video && (video.currentTime < start || video.currentTime >= end - 0.001)) video.currentTime = start;
    watchPreview();
  }
  function update(which: keyof Range, value: number, syncText: boolean) {
    if (!info || busy || !Number.isFinite(value)) return;
    stopPreview();
    const next = which === "start"
      ? { start: Math.max(0, Math.min(end - minimum, value)), end }
      : { start, end: Math.min(info.duration, Math.max(start + minimum, value)) };
    // Remove interior floating-point tails without rounding beyond exact bounds.
    const rounded = Number(next[which].toFixed(6));
    next[which] = which === "start"
      ? Math.max(0, Math.min(end - minimum, rounded))
      : Math.min(info.duration, Math.max(start + minimum, rounded));
    setSelection(next);
    if (syncText) { setStartText(String(next.start)); setEndText(String(next.end)); }
    seek(which === "start" ? next.start : Math.min(videoRef.current?.currentTime ?? next.start, next.end));
    setError(null);
  }
  function numeric(which: keyof Range, text: string) {
    if (which === "start") setStartText(text); else setEndText(text);
    if (text.trim() !== "") update(which, Number(text), false);
  }
  function reset() {
    if (!info || busy || closedRef.current) return;
    stopPreview(); setSelection({ start: 0, end: info.duration });
    setStartText("0"); setEndText(String(info.duration)); setError(null); seek(0);
  }
  const validDraft = startText.trim() !== "" && endText.trim() !== ""
    && Number.isFinite(Number(startText)) && Number.isFinite(Number(endText))
    && Math.abs(Number(startText) - start) < 0.000001 && Math.abs(Number(endText) - end) < 0.000001;
  const valid = Boolean(info) && !mediaFailed && validDraft && start >= 0
    && end <= (info?.duration ?? 0) && end > start && end - start >= minimum - 0.000001;

  async function apply() {
    if (closedRef.current || busy || !valid) return;
    stopPreview();
    const operation = beginOperation();
    setBusy("export"); setError(null); setProgress(0);
    const output = trimVideo(file, { start, end }, {
      signal: operation.controller.signal,
      onProgress: value => { if (isCurrent(operation) && Number.isFinite(value)) setProgress(Math.max(0, Math.min(1, value))); },
    });
    operation.done = output.catch(() => undefined);
    let result: VideoEditResult;
    try { result = await output; }
    catch {
      if (isCurrent(operation)) { setBusy(null); setError("Не удалось обрезать видео. Попробуйте ещё раз."); }
      return;
    }
    if (!isCurrent(operation)) return;
    let accepted: boolean | void;
    try { accepted = onApply(result); } catch { accepted = false; }
    if (!isCurrent(operation)) return;
    if (accepted === false) {
      setBusy(null); setError("Не удалось применить изменения. Попробуйте ещё раз.");
      return;
    }
    retire();
  }

  const step = info ? Math.min(0.01, info.duration / 100) : 0.01;
  return <TooltipProvider delayDuration={350}>
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label="Редактор видео" tabIndex={-1}
      data-video-editor="true" data-video-editor-state={info ? "ready" : busy === "inspect" ? "loading" : "unsupported"}
      data-video-editor-busy={busy ?? "false"}
      onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      className="fixed inset-0 box-border flex min-h-0 flex-col bg-[color:var(--kub-bg)] text-[color:var(--kub-text)]"
      style={{ zIndex: PRODUCT_STACKING_LEVELS.modal, height: "var(--kub-app-height, 100dvh)", paddingTop: "var(--kub-safe-top, 0px)", paddingBottom: "var(--kub-safe-bottom, 0px)" }}>
      <header className="grid shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 border-b border-[color:var(--kub-border-color)] px-3 py-2">
        <ToolButton tool="cancel" label="Отменить редактирование" onClick={() => void exit()} disabled={busy === "closing"}><X size={22} /></ToolButton>
        <h2 className="min-w-0 text-center text-base font-semibold">Обрезка видео</h2>
        <ToolButton tool="apply" label="Применить изменения" onClick={() => void apply()} disabled={Boolean(busy) || !valid}>
          {busy === "export" ? <LoaderCircle size={22} className="animate-spin" /> : <Check size={22} />}
        </ToolButton>
      </header>

      <div data-video-editor-viewport="true" className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[color:var(--kub-inset)] p-4">
        <video ref={videoRef} src={url} controls playsInline muted preload="metadata" aria-label="Предпросмотр выбранного фрагмента"
          className="block h-full min-h-0 w-full object-contain" onPlay={playPreview}
          onPause={() => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); frameRef.current = null; }}
          onSeeking={enforceRange} onTimeUpdate={enforceRange}
          onError={() => { if (!closedRef.current) { setMediaFailed(true); setError("Не удалось открыть предпросмотр видео."); } }} />
        {busy === "inspect" && <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-[color:var(--kub-inset)] text-sm"><LoaderCircle size={20} className="animate-spin" />Проверка видео…</div>}
      </div>

      <footer className="shrink-0 border-t border-[color:var(--kub-border-color)] px-4 pb-3 pt-2">
        <div className="mx-auto max-w-3xl">
          {error && <p role="alert" className="mb-2 text-sm text-[color:var(--kub-danger)]">{error}</p>}
          {info && <>
            <div className="mb-1 flex min-h-11 items-center justify-between gap-2">
              <output data-video-editor-duration="true" className="text-sm tabular-nums">{time(end - start, info.duration)} / {time(info.duration, info.duration)}</output>
              <div className="flex shrink-0 gap-1">
                {onRestore && <ToolButton tool="restore" label="Восстановить исходное видео" onClick={() => void exit(true)} disabled={busy === "closing"}><History size={20} /></ToolButton>}
                <ToolButton tool="reset" label="Сбросить границы обрезки" onClick={reset} disabled={Boolean(busy)}><RotateCcw size={20} /></ToolButton>
              </div>
            </div>
            {(["start", "end"] as const).map(which => {
              const label = which === "start" ? "Начало" : "Конец";
              const value = selection[which];
              return <div key={which} className="grid grid-cols-[52px_minmax(0,1fr)_84px] items-center gap-3">
                <label htmlFor={`video-editor-${which}`} className="text-sm text-[color:var(--kub-text-secondary)]">{label}</label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <input id={`video-editor-${which}`} type="range" data-video-editor-range={which} aria-label={`${label} фрагмента`}
                      aria-valuetext={time(value, info.duration)} min={which === "start" ? 0 : start + minimum}
                      max={which === "start" ? Number((end - minimum).toFixed(6)) : info.duration} step="any" value={value} disabled={Boolean(busy)}
                      onChange={event => update(which, Number(event.target.value), true)}
                      className={cn("h-11 min-w-0 w-full accent-[color:var(--kub-cyan)]", FOCUS_RING)} />
                  </TooltipTrigger>
                  <TooltipContent style={{ zIndex: PRODUCT_STACKING_LEVELS.modal }}>{label}: {time(value, info.duration)}</TooltipContent>
                </Tooltip>
                <input type="number" inputMode="decimal" data-video-editor-number={which} aria-label={`${label}, секунды`}
                  value={which === "start" ? startText : endText} min={which === "start" ? 0 : start + minimum}
                  max={which === "start" ? end - minimum : info.duration} step={step} disabled={Boolean(busy)}
                  onChange={event => numeric(which, event.target.value)}
                  onBlur={() => { setStartText(String(start)); setEndText(String(end)); }}
                  className={cn("h-11 min-w-0 w-full rounded-md border border-[color:var(--kub-border-color)] bg-[color:var(--kub-surface)] px-2 text-sm tabular-nums", FOCUS_RING)} />
              </div>;
            })}
          </>}
          {!info && onRestore && <div className="flex justify-end"><ToolButton tool="restore" label="Восстановить исходное видео" onClick={() => void exit(true)} disabled={busy === "closing"}><History size={20} /></ToolButton></div>}
          {busy === "export" && <div className="mt-2 flex items-center gap-3 text-sm" role="status">
            <progress aria-label="Сохранение фрагмента" aria-valuenow={Math.round(progress * 100)} value={progress} max={1} className="h-2 min-w-0 flex-1 accent-[color:var(--kub-cyan)]" />
            <span className="w-11 text-right tabular-nums">{Math.round(progress * 100)}%</span>
          </div>}
          {busy === "closing" && <p role="status" className="mt-2 text-sm text-[color:var(--kub-text-secondary)]">Отмена…</p>}
        </div>
      </footer>
    </div>
  </TooltipProvider>;
}
