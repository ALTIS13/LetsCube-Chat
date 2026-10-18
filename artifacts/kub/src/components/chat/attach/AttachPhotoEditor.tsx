import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Cropper from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { ArrowLeft, Check, History, LoaderCircle, PenLine, RotateCcw, RotateCw, Square, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PRODUCT_STACKING_LEVELS } from "@/lib/conversationStacking";
import { FOCUS_RING } from "@/lib/controlSurface";
import type { MediaQuality } from "@/lib/mediaQuality";
import { exportPhotoEdit, renderPhotoEditPreview, type PhotoEditIntent, type PhotoEditMark, type PhotoEditPoint, type PhotoEditRect, type PhotoEditResult } from "@/lib/photoEdit";
import { cn } from "@/lib/utils";

export interface AttachPhotoEditorProps {
  file: File;
  url: string;
  quality: MediaQuality;
  onApply: (result: PhotoEditResult) => boolean | void;
  onCancel: () => void;
  onRestore?: () => void;
}

type Stage = "geometry" | "markup";
type MarkTool = "cover" | "pen";
type Preview = { url: string; width: number; height: number };
type Operation = { controller: AbortController; file: File; url: string };
type Gesture = {
  pointerId: number; tool: MarkTool; points: PhotoEditPoint[]; color: string; width: number;
  lastX: number; lastY: number; distance: number;
};
const COLORS = [
  { value: "#ffffff", label: "Белый" }, { value: "#e11d48", label: "Красный" },
  { value: "#facc15", label: "Жёлтый" }, { value: "#22c55e", label: "Зелёный" },
  { value: "#2563eb", label: "Синий" },
] as const;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';

function ToolButton({ label, tool, active, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string; tool: string; active?: boolean; children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          {...props}
          type="button"
          aria-label={label}
          aria-pressed={active}
          data-photo-editor-tool={tool}
          className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-text)] disabled:cursor-not-allowed disabled:opacity-45", active ? "bg-[color:var(--kub-surface-3)] ring-1 ring-[color:var(--kub-cyan)]" : "hover:bg-[color:var(--kub-surface-2)]", FOCUS_RING, props.className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" style={{ zIndex: PRODUCT_STACKING_LEVELS.modal }}>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function AttachPhotoEditor({ file, url, quality, onApply, onCancel, onRestore }: AttachPhotoEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef({ file, url });
  inputRef.current = { file, url };
  const aliveRef = useRef(false);
  const closedRef = useRef(false);
  const operationRef = useRef<Operation | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [stage, setStage] = useState<Stage>("geometry");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [area, setArea] = useState<PhotoEditRect | null>(null);
  const [rotation, setRotation] = useState<PhotoEditIntent["rotation"]>(0);
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState("original");
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [cropperKey, setCropperKey] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [marks, setMarks] = useState<readonly PhotoEditMark[]>([]);
  const [draft, setDraft] = useState<PhotoEditMark | null>(null);
  const [tool, setTool] = useState<MarkTool>("cover");
  const [color, setColor] = useState<string>(COLORS[1].value);
  const [penWidth, setPenWidth] = useState(0.01);
  const [busy, setBusy] = useState<"preview" | "export" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gif = file.type.toLowerCase() === "image/gif" || /\.gif$/i.test(file.name);

  function releasePreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
  }
  function abortOperation() {
    operationRef.current?.controller.abort();
    operationRef.current = null;
  }
  function retire() {
    closedRef.current = true;
    abortOperation();
    gestureRef.current = null;
    releasePreview();
  }
  function cancel() {
    if (closedRef.current) return;
    retire();
    onCancel();
  }
  function restore() {
    if (closedRef.current || !onRestore) return;
    retire();
    onRestore();
  }
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  useLayoutEffect(() => {
    aliveRef.current = true;
    closedRef.current = false;
    setStage("geometry"); setCrop({ x: 0, y: 0 }); setArea(null); setRotation(0); setZoom(1);
    setAspect("original"); setNatural(null); setPreview(null); setMarks([]); setDraft(null); setBusy(null); setError(null);
    setCropperKey(key => key + 1);
    return () => { aliveRef.current = false; retire(); };
  }, [file, url]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(node => node.getClientRects().length > 0);
    const focusInside = () => root.focus({ preventScroll: true });
    const focus = (event: FocusEvent) => { if (!root.contains(event.target as Node)) focusInside(); };
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
    focusInside();
    return () => {
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("keydown", keys, true);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const update = () => { const box = node.getBoundingClientRect(); setViewport({ width: box.width, height: box.height }); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, [stage]);

  function beginOperation(): Operation {
    abortOperation();
    const operation = { controller: new AbortController(), file, url };
    operationRef.current = operation;
    return operation;
  }
  function isCurrent(operation: Operation) {
    return aliveRef.current && !closedRef.current && operationRef.current === operation
      && inputRef.current.file === operation.file && inputRef.current.url === operation.url;
  }
  function intent(): PhotoEditIntent {
    const turned = rotation === 90 || rotation === 270;
    const width = turned ? natural?.height : natural?.width;
    const height = turned ? natural?.width : natural?.height;
    const full = area && width && height && Math.abs(area.x) < 0.5 && Math.abs(area.y) < 0.5
      && Math.abs(area.width - width) < 0.5 && Math.abs(area.height - height) < 0.5;
    return { rotation, crop: full ? null : area, marks: stage === "markup" ? marks : [] };
  }
  async function openMarkup() {
    if (closedRef.current || busy || !area || !natural || gif) return;
    const operation = beginOperation();
    setBusy("preview"); setError(null);
    try {
      const result = await renderPhotoEditPreview(file, intent(), operation.controller.signal);
      if (!isCurrent(operation)) return;
      const nextUrl = URL.createObjectURL(result.file);
      releasePreview(); previewUrlRef.current = nextUrl;
      setPreview({ url: nextUrl, width: result.width, height: result.height });
      setStage("markup"); setBusy(null);
    } catch {
      if (isCurrent(operation)) { setError("Не удалось подготовить фото. Попробуйте ещё раз."); setBusy(null); }
    }
  }
  async function apply() {
    if (closedRef.current || busy || !natural || !area || gif || gestureRef.current) return;
    const operation = beginOperation();
    setBusy("export"); setError(null);
    let result: PhotoEditResult;
    try {
      result = await exportPhotoEdit(file, intent(), { signal: operation.controller.signal, quality });
    } catch {
      if (isCurrent(operation)) { setError("Не удалось сохранить изменения. Попробуйте ещё раз."); setBusy(null); }
      return;
    }
    if (!isCurrent(operation)) return;
    let accepted: boolean | void;
    try {
      accepted = onApply(result);
    } catch {
      accepted = false;
    }
    if (!isCurrent(operation)) return;
    if (accepted === false) {
      setBusy(null);
      setError("Не удалось применить изменения. Попробуйте ещё раз.");
      return;
    }
    retire();
  }
  function clearGesture() { gestureRef.current = null; setDraft(null); }
  function backToGeometry() {
    clearGesture(); releasePreview(); setPreview(null); setArea(null);
    setStage("geometry");
    setMarks([]);
    setError(null);
  }
  function reset() {
    abortOperation(); clearGesture(); releasePreview(); setPreview(null);
    setStage("geometry"); setMarks([]); setCrop({ x: 0, y: 0 }); setArea(null);
    setRotation(0); setZoom(1); setAspect("original"); setError(null); setCropperKey(key => key + 1);
  }
  function markFor(gesture: Gesture): PhotoEditMark {
    if (gesture.tool === "pen") return { kind: "pen", points: gesture.points, color: gesture.color, width: gesture.width };
    const first = gesture.points[0], last = gesture.points.at(-1)!;
    const x = Math.min(first.x, last.x), y = Math.min(first.y, last.y);
    return { kind: "cover", x, y, width: Math.min(1 - x, Math.abs(first.x - last.x)), height: Math.min(1 - y, Math.abs(first.y - last.y)) };
  }
  function point(event: ReactPointerEvent<SVGSVGElement>): PhotoEditPoint {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - box.x) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.y) / box.height)) };
  }
  function startMark(event: ReactPointerEvent<SVGSVGElement>) {
    if (busy || closedRef.current || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const gesture: Gesture = { pointerId: event.pointerId, tool, points: [point(event)], color, width: penWidth,
      lastX: event.clientX, lastY: event.clientY, distance: 0 };
    gestureRef.current = gesture; setDraft(markFor(gesture)); setError(null);
  }
  function moveMark(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const next = point(event);
    const distance = Math.hypot(event.clientX - gesture.lastX, event.clientY - gesture.lastY);
    gesture.distance += distance; gesture.lastX = event.clientX; gesture.lastY = event.clientY;
    if (distance > 0) gesture.points = [...gesture.points, next];
    setDraft(markFor(gesture));
  }
  function finishMark(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    moveMark(event);
    const distance = gesture.distance;
    const mark = markFor(gesture);
    clearGesture();
    if (distance < 2) return;
    if (mark.kind === "cover" && (!mark.width || !mark.height)) return;
    setMarks(current => [...current, mark]);
  }

  const originalAspect = natural ? ((rotation === 90 || rotation === 270) ? natural.height / natural.width : natural.width / natural.height) : 1;
  const previewScale = preview ? Math.max(0, Math.min((viewport.width - 32) / preview.width, (viewport.height - 32) / preview.height)) : 0;
  const disabled = Boolean(busy) || !natural || !area || gif;
  const renderMark = (mark: PhotoEditMark, index: number, isDraft = false) => {
    if (!preview) return null;
    const attrs = { "data-photo-editor-mark": isDraft ? undefined : mark.kind, "data-photo-editor-draft": isDraft ? "true" : undefined };
    return mark.kind === "cover"
      ? <rect key={index} {...attrs} x={mark.x * preview.width} y={mark.y * preview.height} width={mark.width * preview.width} height={mark.height * preview.height} fill="#000000" />
      : <polyline key={index} {...attrs} points={mark.points.map(p => `${p.x * preview.width},${p.y * preview.height}`).join(" ")} fill="none" stroke={mark.color} strokeWidth={mark.width * Math.min(preview.width, preview.height)} strokeLinecap="round" strokeLinejoin="round" />;
  };

  return (
    <TooltipProvider delayDuration={350}>
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label="Редактор фото"
        tabIndex={-1}
        data-photo-editor="true"
        data-photo-editor-stage={stage}
        data-photo-editor-busy={busy ?? "false"}
        onKeyDown={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        className="fixed inset-0 box-border flex min-h-0 flex-col bg-[color:var(--kub-bg)] text-[color:var(--kub-text)]"
        style={{ zIndex: PRODUCT_STACKING_LEVELS.modal, height: "var(--kub-app-height, 100dvh)", paddingTop: "var(--kub-safe-top, 0px)", paddingBottom: "var(--kub-safe-bottom, 0px)" }}
      >
        <header className="grid shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 border-b border-[color:var(--kub-border-color)] px-3 py-2">
          <ToolButton tool="cancel" label="Отменить редактирование" onClick={cancel}><X size={22} /></ToolButton>
          <h2 className="min-w-0 text-center text-base font-semibold">Редактирование фото</h2>
          <ToolButton tool="apply" label="Применить изменения" onClick={() => void apply()} disabled={disabled}>
            {busy === "export" ? <LoaderCircle size={22} className="animate-spin" /> : <Check size={22} />}
          </ToolButton>
        </header>

        <div ref={viewportRef} data-photo-editor-viewport="true" className="relative min-h-0 flex-1 overflow-hidden bg-[color:var(--kub-inset)]">
          {stage === "geometry" && !gif && (
            <Cropper
              key={cropperKey}
              disableAutomaticStylesInjection
              image={url}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspect === "original" ? originalAspect : Number(aspect)}
              onCropChange={setCrop}
              onZoomChange={value => { setZoom(value); setError(null); }}
              onCropAreaChange={(_percent, pixels) => setArea(pixels)}
              onMediaLoaded={size => setNatural({ width: size.naturalWidth, height: size.naturalHeight })}
              mediaProps={{ onError: () => { setNatural(null); setArea(null); setError("Не удалось открыть фото."); } }}
              cropperProps={{ "aria-label": "Область кадрирования", tabIndex: busy ? -1 : 0 }}
              style={{ containerStyle: { inset: 16, pointerEvents: busy ? "none" : undefined } }}
              zoomWithScroll={!busy}
              restrictPosition
              maxZoom={3}
            />
          )}
          {stage === "markup" && preview && (
            <div className="absolute inset-4 flex items-center justify-center">
              <div className="relative shrink-0" style={{ width: preview.width * previewScale, height: preview.height * previewScale }}>
                <img src={preview.url} alt="Редактируемое фото" draggable={false} className="block h-full w-full" />
                <svg
                  data-photo-editor-markup="true"
                  viewBox={`0 0 ${preview.width} ${preview.height}`}
                  className="absolute inset-0 h-full w-full touch-none"
                  style={{ cursor: busy ? "wait" : "crosshair" }}
                  onPointerDown={startMark}
                  onPointerMove={moveMark}
                  onPointerUp={finishMark}
                  onPointerCancel={clearGesture}
                  onLostPointerCapture={clearGesture}
                  aria-label={tool === "cover" ? "Непрозрачное закрытие области" : "Рисование пером"}
                >
                  {marks.map((mark, index) => renderMark(mark, index))}
                  {draft && renderMark(draft, marks.length, true)}
                </svg>
              </div>
            </div>
          )}
          {busy === "preview" && <div role="status" className="absolute inset-0 flex items-center justify-center bg-black/50 text-white"><LoaderCircle size={28} className="animate-spin" aria-label="Подготовка фото" /></div>}
        </div>

        {(error || gif) && <p role="alert" data-photo-editor-error="true" className="shrink-0 px-4 py-2 text-sm text-[color:var(--kub-danger-text)]">{gif ? "Редактирование GIF недоступно: анимация должна сохраниться." : error}</p>}

        <footer className="shrink-0 space-y-2 border-t border-[color:var(--kub-border-color)] px-4 py-3">
          <div role="toolbar" aria-label="Инструменты фото" className="mx-auto flex max-w-xl flex-wrap items-center justify-center gap-2">
            {stage === "geometry" ? <>
              <ToolButton tool="rotate" label="Повернуть на 90 градусов" disabled={disabled} onClick={() => { setRotation(value => ((value + 90) % 360) as PhotoEditIntent["rotation"]); setCrop({ x: 0, y: 0 }); setArea(null); setError(null); }}><RotateCw size={21} /></ToolButton>
              <ToolButton tool="markup" label="Перейти к разметке" disabled={disabled} onClick={() => void openMarkup()}><PenLine size={21} /></ToolButton>
              <label className="sr-only" htmlFor="photo-editor-aspect">Формат кадра</label>
              <select id="photo-editor-aspect" data-photo-editor-tool="aspect" aria-label="Формат кадра" value={aspect} disabled={Boolean(busy) || gif} onChange={event => { setAspect(event.target.value); setCrop({ x: 0, y: 0 }); setZoom(1); setArea(null); setError(null); }} className={cn("h-11 min-w-28 rounded-lg border border-[color:var(--kub-border-color)] bg-[color:var(--kub-bg)] px-2 text-sm", FOCUS_RING)}>
                <option value="original">Исходный</option><option value="1">1:1</option><option value={4 / 3}>4:3</option><option value={3 / 4}>3:4</option><option value={16 / 9}>16:9</option><option value={9 / 16}>9:16</option>
              </select>
            </> : <>
              <ToolButton tool="geometry" label="К кадрированию: очистить разметку" disabled={Boolean(busy)} onClick={backToGeometry}><ArrowLeft size={21} /></ToolButton>
              <ToolButton tool="cover" label="Закрыть область непрозрачным цветом" active={tool === "cover"} disabled={Boolean(busy)} onClick={() => { clearGesture(); setTool("cover"); }}><Square size={21} fill="currentColor" /></ToolButton>
              <ToolButton tool="pen" label="Перо" active={tool === "pen"} disabled={Boolean(busy)} onClick={() => { clearGesture(); setTool("pen"); }}><PenLine size={21} /></ToolButton>
              <ToolButton tool="undo" label="Отменить последнюю разметку" disabled={Boolean(busy) || !marks.length} onClick={() => { clearGesture(); setMarks(current => current.slice(0, -1)); }}><Undo2 size={21} /></ToolButton>
            </>}
            <ToolButton tool="reset" label="Сбросить правки текущего фото" disabled={Boolean(busy) || gif} onClick={reset}><RotateCcw size={21} /></ToolButton>
            {onRestore && <ToolButton tool="restore" label="Восстановить исходное фото" onClick={restore}><History size={21} /></ToolButton>}
          </div>
          {stage === "geometry" ? (
            <label className="mx-auto flex max-w-xl items-center gap-3 text-sm">
              <ZoomOut size={18} aria-hidden="true" />
              <input data-photo-editor-tool="zoom" aria-label="Масштаб фото" type="range" min={1} max={3} step={0.01} value={zoom} disabled={Boolean(busy) || gif} onChange={event => { setZoom(Number(event.target.value)); setError(null); }} className={cn("h-11 min-w-0 flex-1 accent-[var(--kub-cyan)]", FOCUS_RING)} />
              <ZoomIn size={18} aria-hidden="true" /><output className="w-11 text-right tabular-nums">{zoom.toFixed(1)}×</output>
            </label>
          ) : tool === "pen" ? <>
            <div className="flex justify-center gap-2" role="group" aria-label="Цвет пера">
              {COLORS.map(candidate => <button key={candidate.value} type="button" data-photo-editor-color={candidate.value} aria-label={candidate.label} title={candidate.label} aria-pressed={color === candidate.value} disabled={Boolean(busy)} onClick={() => { clearGesture(); setColor(candidate.value); }} className={cn("flex h-11 w-11 items-center justify-center rounded-lg", color === candidate.value && "ring-1 ring-[color:var(--kub-text)]", FOCUS_RING)}><span className="h-6 w-6 rounded-full border border-[color:var(--kub-muted)]" style={{ backgroundColor: candidate.value }} /></button>)}
            </div>
            <label className="mx-auto flex max-w-xl items-center gap-3 text-sm">Толщина
              <input data-photo-editor-tool="pen-width" aria-label="Толщина пера" type="range" min={0.0025} max={0.03} step={0.0025} value={penWidth} disabled={Boolean(busy)} onChange={event => { clearGesture(); setPenWidth(Number(event.target.value)); }} className={cn("h-11 min-w-0 flex-1 accent-[var(--kub-cyan)]", FOCUS_RING)} />
            </label>
          </> : <div className="h-11" aria-hidden="true" />}
        </footer>
      </div>
    </TooltipProvider>
  );
}
