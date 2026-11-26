import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Eraser,
  Loader2,
  Maximize2,
  Minimize2,
  Move,
  Pipette,
  RotateCcw,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { STANDARD_TEAM_COLORS, StandardTeamColor } from '../types';
import { PortraitCutoutPair, removePortraitBackgroundDual } from '../utils/backgroundRemoval';
import { DEFAULT_NECK_SKIN_TONE, PlayerKitShouldersSvg } from './SoccerPitch';

export interface CroppedPhotoResult {
  /** Standardized 256x256 profile portrait (with shirt kept; background removed when cutout active) */
  profilePhotoDataUrl: string;
  /** Standardized 240x300 tall open-headroom pitch portrait (head & neck only; background + shirt removed when cutout active) */
  pitchPhotoDataUrl: string;
  /** Matched skin tone hex (#rrggbb) for the natural neck/collarbone fill inside the neckline */
  skinTone: string;
}

interface CircularPhotoCropperProps {
  imageSrc: string;
  title?: string;
  busy?: boolean;
  confirmLabel?: string;
  initialSkinTone?: string;
  externalError?: string | null;
  onCancel: () => void;
  onConfirm: (result: CroppedPhotoResult) => void;
}

const STAGE_W = 320;
const STAGE_H = 316;

// Pitch layout constants (exact 4:5 portrait ratio with generous headroom above shoulders)
const PITCH_PORTRAIT_W = 76;
const PITCH_PORTRAIT_H = 95;
const PITCH_SHOULDERS_W = 78;
const PITCH_SHOULDERS_H = 29;
const PITCH_SHOULDERS_TOP_IN_PORTRAIT = 73; // 95 - 22px overlap behind jersey
const PITCH_NECKLINE_Y_IN_PORTRAIT = 83; // Where neck seats into collar
const PROFILE_TOP_OFFSET_IN_PORTRAIT = 28; // Centers head + upper shirt cleanly in 1:1 profile avatar

const BASE_CAPTURE_W = 200;
const ANCHOR_Y = 256; // Collar neckline anchor line on stage (leaves 256px open space above collar)
const PHOTO_BASE_Y = ANCHOR_Y - 76; // Constant photo anchor so resizing shoulders never shifts the photo

const PITCH_OUT_W = 240;
const PITCH_OUT_H = 300;
const PROFILE_OUT_SIZE = 256;

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3.2;
const MIN_SHOULDER_SCALE = 0.55;
const MAX_SHOULDER_SCALE = 1.45;
const MAX_DATA_URL_LENGTH = 170000;

const KIT_DOT_CLASSES: Record<StandardTeamColor, string> = {
  Red: 'bg-red-600 border-red-300',
  Blue: 'bg-blue-600 border-blue-300',
  Black: 'bg-zinc-900 border-slate-300',
  Yellow: 'bg-yellow-400 border-emerald-700',
};

const SKIN_TONE_PRESETS: { hex: string; label: string }[] = [
  { hex: '#f4d4be', label: 'Fair' },
  { hex: '#e2b696', label: 'Light' },
  { hex: '#d4a27e', label: 'Medium' },
  { hex: '#b8825d', label: 'Tan' },
  { hex: '#8d5a3b', label: 'Deep' },
  { hex: '#5c3824', label: 'Rich' },
];

function normalizeHexColor(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (src.startsWith('http://') || src.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for export.'));
    img.src = src;
  });
}

function exportTransparentCanvas(sourceCanvas: HTMLCanvasElement): string {
  const webpQualities = [0.88, 0.72, 0.56];
  for (const q of webpQualities) {
    const candidate = sourceCanvas.toDataURL('image/webp', q);
    if (candidate.startsWith('data:image/webp') && candidate.length <= MAX_DATA_URL_LENGTH) {
      return candidate;
    }
  }

  const scaleSteps = [1, 0.85, 0.7, 0.58];
  for (const factor of scaleSteps) {
    let target = sourceCanvas;
    if (factor !== 1) {
      const scaled = document.createElement('canvas');
      scaled.width = Math.max(1, Math.round(sourceCanvas.width * factor));
      scaled.height = Math.max(1, Math.round(sourceCanvas.height * factor));
      const sctx = scaled.getContext('2d');
      if (sctx) {
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(sourceCanvas, 0, 0, scaled.width, scaled.height);
        target = scaled;
      }
    }
    const pngCandidate = target.toDataURL('image/png');
    if (pngCandidate.length <= MAX_DATA_URL_LENGTH) {
      return pngCandidate;
    }
  }

  return sourceCanvas.toDataURL('image/png');
}

function renderCroppedCanvas(
  img: HTMLImageElement,
  useTransparentBg: boolean,
  zoom: number,
  offset: { x: number; y: number },
  activeCaptureW: number,
  captureTopY: number,
  outW: number,
  outH: number
): string {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  const exportBaseImageScale = BASE_CAPTURE_W / Math.max(1, Math.min(natW, natH));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize image cropper.');
  }

  if (useTransparentBg) {
    ctx.clearRect(0, 0, outW, outH);
  } else {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, outW, outH);
  }

  // Standardize the shoulder-calibrated open capture region cleanly to (outW x outH) with zero circle clip
  const outRatio = outW / activeCaptureW;
  const stageImgW = natW * exportBaseImageScale * zoom;
  const stageImgH = natH * exportBaseImageScale * zoom;
  const drawW = stageImgW * outRatio;
  const drawH = stageImgH * outRatio;
  const destCx = outW / 2 + offset.x * outRatio;
  const destCy = (PHOTO_BASE_Y + offset.y - captureTopY) * outRatio;
  const drawX = destCx - drawW / 2;
  const drawY = destCy - drawH / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, drawX, drawY, drawW, drawH);

  if (useTransparentBg) {
    return exportTransparentCanvas(canvas);
  }

  let dataUrl = canvas.toDataURL('image/jpeg', 0.84);
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.62);
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.45);
  }
  return dataUrl;
}

export const CircularPhotoCropper: React.FC<CircularPhotoCropperProps> = ({
  imageSrc,
  title = 'Fit Photo to Soccer Jersey',
  busy = false,
  confirmLabel = 'Apply Photo',
  initialSkinTone,
  externalError = null,
  onCancel,
  onConfirm,
}) => {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({
    w: BASE_CAPTURE_W,
    h: BASE_CAPTURE_W,
  });
  const [imageReady, setImageReady] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [shoulderScale, setShoulderScale] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [previewKitColor, setPreviewKitColor] = useState<StandardTeamColor>('Blue');
  const [skinTone, setSkinTone] = useState<string>(() =>
    normalizeHexColor(initialSkinTone, DEFAULT_NECK_SKIN_TONE)
  );
  const [autoDetectedSkinTone, setAutoDetectedSkinTone] = useState<string | null>(null);

  // Dual in-browser AI cutout state: profile (with shirt, bg removed) + pitch (head & neck only)
  const [cutoutPair, setCutoutPair] = useState<PortraitCutoutPair | null>(null);
  const [useTransparentBg, setUseTransparentBg] = useState(false);
  const [removingBg, setRemovingBg] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragOriginRef = useRef<{
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const activePitchSrc = useTransparentBg && cutoutPair ? cutoutPair.pitchCutoutUrl : imageSrc;
  const activeProfileSrc = useTransparentBg && cutoutPair ? cutoutPair.profileCutoutUrl : imageSrc;
  const isLocked = busy || removingBg || exporting;

  useEffect(() => {
    let cancelled = false;
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
      setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
      setImageReady(true);
      return;
    }

    const probe = new Image();
    if (activePitchSrc.startsWith('http://') || activePitchSrc.startsWith('https://')) {
      probe.crossOrigin = 'anonymous';
    }
    probe.onload = () => {
      if (!cancelled && probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setNaturalSize({ w: probe.naturalWidth, h: probe.naturalHeight });
        setImageReady(true);
      }
    };
    probe.src = activePitchSrc;

    return () => {
      cancelled = true;
    };
  }, [activePitchSrc]);

  // Tall open-headroom shoulder alignment geometry (no head circle limit)
  const activeCaptureW = BASE_CAPTURE_W * shoulderScale;
  const pitchRatio = activeCaptureW / PITCH_PORTRAIT_W;
  const shouldersW = Math.round(PITCH_SHOULDERS_W * pitchRatio);
  const shouldersH = Math.round(PITCH_SHOULDERS_H * pitchRatio);
  const captureCx = STAGE_W / 2;
  const captureTop = ANCHOR_Y - PITCH_NECKLINE_Y_IN_PORTRAIT * pitchRatio;
  const shouldersTop = captureTop + PITCH_SHOULDERS_TOP_IN_PORTRAIT * pitchRatio;
  const profileCaptureTop = captureTop + PROFILE_TOP_OFFSET_IN_PORTRAIT * pitchRatio;

  // Photo scale stays independent of shoulderScale so user can match proportions freely
  const baseImageScale = BASE_CAPTURE_W / Math.max(1, Math.min(naturalSize.w, naturalSize.h));

  const clampOffset = useCallback(
    (nextX: number, nextY: number, nextZoom: number, nextShoulderScale: number) => {
      const scaledW = naturalSize.w * baseImageScale * nextZoom;
      const scaledH = naturalSize.h * baseImageScale * nextZoom;
      const captureDim = BASE_CAPTURE_W * nextShoulderScale;
      const maxX = Math.max(captureDim * 0.9, Math.abs(scaledW - captureDim) / 2 + 120);
      const maxY = Math.max(captureDim * 0.9, Math.abs(scaledH - captureDim) / 2 + 120);
      return {
        x: Math.max(-maxX, Math.min(maxX, nextX)),
        y: Math.max(-maxY, Math.min(maxY, nextY)),
      };
    },
    [naturalSize, baseImageScale]
  );

  const applyZoom = useCallback(
    (nextRawZoom: number) => {
      const clampedZoom =
        Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextRawZoom)) * 100) / 100;
      setZoom(clampedZoom);
      setOffset((prev) => clampOffset(prev.x, prev.y, clampedZoom, shoulderScale));
    },
    [clampOffset, shoulderScale]
  );

  const applyShoulderScale = useCallback(
    (nextRawScale: number) => {
      const clampedScale =
        Math.round(Math.max(MIN_SHOULDER_SCALE, Math.min(MAX_SHOULDER_SCALE, nextRawScale)) * 100) /
        100;
      setShoulderScale(clampedScale);
      setOffset((prev) => clampOffset(prev.x, prev.y, zoom, clampedScale));
    },
    [clampOffset, zoom]
  );

  const handleToggleRemoveBackground = async () => {
    setBgError(null);
    setExportError(null);

    if (useTransparentBg) {
      setUseTransparentBg(false);
      return;
    }

    if (cutoutPair) {
      setUseTransparentBg(true);
      return;
    }

    setRemovingBg(true);
    try {
      const pair = await removePortraitBackgroundDual(imageSrc);
      setCutoutPair(pair);
      if (pair.detectedSkinTone && /^#[0-9a-fA-F]{6}$/.test(pair.detectedSkinTone)) {
        const matched = pair.detectedSkinTone.toLowerCase();
        setAutoDetectedSkinTone(matched);
        setSkinTone(matched);
      }
      setUseTransparentBg(true);
    } catch (err) {
      setBgError(
        err instanceof Error
          ? err.message
          : 'Could not remove background automatically. You can still upload the original photo.'
      );
    } finally {
      setRemovingBg(false);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isLocked) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors
    }
    setDragging(true);
    dragOriginRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: offset.x,
      startY: offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragOriginRef.current) return;
    const dx = e.clientX - dragOriginRef.current.pointerX;
    const dy = e.clientY - dragOriginRef.current.pointerY;
    setOffset(
      clampOffset(
        dragOriginRef.current.startX + dx,
        dragOriginRef.current.startY + dy,
        zoom,
        shoulderScale
      )
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      setDragging(false);
      dragOriginRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer already released
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (isLocked) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    applyZoom(zoom + delta);
  };

  const handleReset = () => {
    setZoom(1);
    setShoulderScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleConfirmCrop = async () => {
    setExportError(null);
    setExporting(true);
    try {
      const [pitchImg, profileImg] = await Promise.all([
        loadHtmlImage(activePitchSrc),
        activeProfileSrc === activePitchSrc
          ? loadHtmlImage(activePitchSrc)
          : loadHtmlImage(activeProfileSrc),
      ]);

      // Tall 240x300 pitch cutout (massive open headroom above shoulders, zero circle cut)
      const pitchPhotoDataUrl = renderCroppedCanvas(
        pitchImg,
        useTransparentBg,
        zoom,
        offset,
        activeCaptureW,
        captureTop,
        PITCH_OUT_W,
        PITCH_OUT_H
      );

      // Balanced 256x256 profile avatar (keeps shirt, background removed when cutout active)
      const profilePhotoDataUrl = renderCroppedCanvas(
        profileImg,
        useTransparentBg,
        zoom,
        offset,
        activeCaptureW,
        profileCaptureTop,
        PROFILE_OUT_SIZE,
        PROFILE_OUT_SIZE
      );

      onConfirm({
        profilePhotoDataUrl,
        pitchPhotoDataUrl,
        skinTone: normalizeHexColor(skinTone, DEFAULT_NECK_SKIN_TONE),
      });
    } catch {
      setExportError(
        'Unable to export this photo. Please try choosing an image file from your device.'
      );
    } finally {
      setExporting(false);
    }
  };

  const renderW = naturalSize.w * baseImageScale * zoom;
  const renderH = naturalSize.h * baseImageScale * zoom;

  // Mini standardized pitch preview (exact 76x95 open-headroom portrait + 78x29 sculpted shoulders)
  const miniPitchRatio = PITCH_PORTRAIT_W / activeCaptureW;
  const miniPitchCx = PITCH_PORTRAIT_W / 2 + offset.x * miniPitchRatio;
  const miniPitchCy = (PHOTO_BASE_Y + offset.y - captureTop) * miniPitchRatio;

  // Mini standardized profile preview (52x52 circular avatar showing shirt kept + bg removed)
  const miniProfileSize = 52;
  const miniProfileRatio = miniProfileSize / activeCaptureW;
  const miniProfileCx = miniProfileSize / 2 + offset.x * miniProfileRatio;
  const miniProfileCy = (PHOTO_BASE_Y + offset.y - profileCaptureTop) * miniProfileRatio;

  const isRemoteHttp = activePitchSrc.startsWith('http://') || activePitchSrc.startsWith('https://');
  const previewKitIndex = STANDARD_TEAM_COLORS.indexOf(previewKitColor);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-cropper-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden my-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3 id="photo-cropper-title" className="text-base font-semibold text-slate-900">
              {title}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Align neck &amp; shoulders to the jersey — full open space above the head, no circular cut.
            </p>
          </div>
          <button
            type="button"
            disabled={isLocked}
            onClick={onCancel}
            aria-label="Close photo editor"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Open-Headroom Shoulder Alignment Stage (NO circular limit) */}
        <div className="p-5 space-y-4">
          <div className="flex flex-col items-center gap-3">
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onWheel={handleWheel}
              style={{ width: STAGE_W, height: STAGE_H }}
              className={`relative rounded-xl overflow-hidden select-none touch-none ${
                useTransparentBg ? 'pitch-stripes' : 'bg-slate-800'
              } ${dragging ? 'cursor-grabbing' : isLocked ? 'cursor-wait' : 'cursor-grab'}`}
            >
              {/* Layer 1: Back Interior Collar (Behind Neck) */}
              <div
                aria-hidden="true"
                style={{
                  width: `${shouldersW}px`,
                  height: `${shouldersH}px`,
                  left: `${captureCx - shouldersW / 2}px`,
                  top: `${shouldersTop}px`,
                }}
                className="absolute z-10 pointer-events-none"
              >
                <PlayerKitShouldersSvg
                  color={previewKitColor}
                  teamIndex={previewKitIndex}
                  layer="back"
                  skinTone={skinTone}
                  className="w-full h-full"
                />
              </div>

              {/* Layer 2: Draggable & Zoomable Photo (Full Open Headroom Above Collar) */}
              <img
                ref={imgRef}
                src={activePitchSrc}
                alt="Jersey alignment preview"
                crossOrigin={isRemoteHttp ? 'anonymous' : undefined}
                draggable={false}
                onLoad={(e) => {
                  const target = e.currentTarget;
                  if (target.naturalWidth > 0 && target.naturalHeight > 0) {
                    setNaturalSize({
                      w: target.naturalWidth,
                      h: target.naturalHeight,
                    });
                    setImageReady(true);
                  }
                }}
                style={{
                  width: `${renderW}px`,
                  height: `${renderH}px`,
                  left: `${captureCx + offset.x}px`,
                  top: `${PHOTO_BASE_Y + offset.y}px`,
                  transform: 'translate(-50%, -50%)',
                }}
                className="absolute z-20 max-w-none pointer-events-none select-none"
              />

              {/* Layer 3: Front Pro Realistic Soccer Jersey Shoulders */}
              <div
                aria-hidden="true"
                style={{
                  width: `${shouldersW}px`,
                  height: `${shouldersH}px`,
                  left: `${captureCx - shouldersW / 2}px`,
                  top: `${shouldersTop}px`,
                }}
                className="absolute z-30 pointer-events-none"
              >
                <PlayerKitShouldersSvg
                  color={previewKitColor}
                  teamIndex={previewKitIndex}
                  layer="front"
                  skinTone={skinTone}
                  className="w-full h-full drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
                />
              </div>

              {/* Layer 4: Dashed Neck-Opening & Shoulder Alignment Guide ONLY */}
              <svg
                aria-hidden="true"
                viewBox="0 0 96 36"
                fill="none"
                style={{
                  width: `${shouldersW}px`,
                  height: `${shouldersH}px`,
                  left: `${captureCx - shouldersW / 2}px`,
                  top: `${shouldersTop}px`,
                }}
                className="absolute z-30 pointer-events-none overflow-visible"
              >
                {/* Dashed neck opening guide */}
                <path
                  d="M27.6 6.2C32.8 14 39.6 17.6 48 17.6C56.4 17.6 63.2 14 68.4 6.2"
                  stroke="#ffffff"
                  strokeOpacity="0.9"
                  strokeWidth="1.3"
                  strokeDasharray="3.2 2.6"
                  strokeLinecap="round"
                />
                {/* Subtle dashed shoulder slope boundary */}
                <path
                  d="M1.4 35.6C1.6 32.1 2.1 28.9 3 26.2C5 20.2 8.8 15.5 13.6 12.2C18 9.2 22.8 7.3 27.2 6.2M68.8 6.2C73.2 7.3 78 9.2 82.4 12.2C87.2 15.5 91 20.2 93 26.2C93.9 28.9 94.4 32.1 94.6 35.6"
                  stroke="#ffffff"
                  strokeOpacity="0.62"
                  strokeWidth="1"
                  strokeDasharray="3.2 3.2"
                  strokeLinecap="round"
                />
              </svg>

              {/* Center vertical alignment line while dragging */}
              {dragging && (
                <div
                  aria-hidden="true"
                  className="absolute left-1/2 top-0 bottom-0 w-px bg-white/35 z-30 pointer-events-none"
                />
              )}

              {/* Processing overlay */}
              {removingBg && (
                <div className="absolute inset-0 z-40 bg-slate-950/75 flex flex-col items-center justify-center gap-2 text-white px-4 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  <span className="text-xs font-semibold">Creating Profile &amp; Pitch cutouts...</span>
                  <span className="text-[10px] text-slate-300">
                    Profile keeps shirt · Pitch keeps head &amp; neck only
                  </span>
                </div>
              )}

              {/* Subtle drag hint */}
              {!dragging && !removingBg && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-2.5 py-0.5 rounded-md bg-slate-950/70 text-white/90 text-[10px] font-medium inline-flex items-center gap-1 whitespace-nowrap">
                  <Move className="w-3 h-3" />
                  Drag photo to seat neck in collar
                </div>
              )}
            </div>

            {/* Dual Cutout Action Bar */}
            <div className="w-full flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={isLocked}
                onClick={handleToggleRemoveBackground}
                className={`flex-1 px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 border transition-colors disabled:opacity-50 ${
                  useTransparentBg
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                    : 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                {removingBg ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Processing Cutouts...
                  </>
                ) : useTransparentBg ? (
                  <>
                    <Undo2 className="w-3.5 h-3.5" />
                    Cutout Active (Profile w/ Shirt · Pitch Head &amp; Neck) · Undo
                  </>
                ) : (
                  <>
                    <Eraser className="w-3.5 h-3.5" />
                    Remove Background (Profile w/ Shirt · Pitch Head &amp; Neck)
                  </>
                )}
              </button>
            </div>

            {bgError && (
              <div className="w-full p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                {bgError}
              </div>
            )}

            {/* Side-by-Side Standardized Previews: Pitch (Tall Headroom + Pro Jersey) & Profile (With Shirt) */}
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 w-full justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {/* Standardized Pitch Preview (Exact 76x95 Open Headroom + 78x29 Shoulders) */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className="w-[88px] h-[94px] rounded-lg pitch-stripes flex items-end justify-center overflow-hidden shadow-inner border border-emerald-900/20 pb-0.5">
                    <div className="relative w-[78px] h-[102px] flex justify-center scale-[0.88] origin-bottom">
                      <div className="absolute bottom-0 left-0 w-[78px] h-[29px] z-10">
                        <PlayerKitShouldersSvg
                          color={previewKitColor}
                          teamIndex={previewKitIndex}
                          layer="back"
                          skinTone={skinTone}
                          className="w-[78px] h-[29px]"
                        />
                      </div>
                      <div className="absolute bottom-[7px] left-1/2 -translate-x-1/2 w-[76px] h-[95px] overflow-hidden z-20">
                        <img
                          src={activePitchSrc}
                          alt="Standardized pitch preview"
                          draggable={false}
                          style={{
                            width: `${renderW * miniPitchRatio}px`,
                            height: `${renderH * miniPitchRatio}px`,
                            left: `${miniPitchCx}px`,
                            top: `${miniPitchCy}px`,
                            transform: 'translate(-50%, -50%)',
                          }}
                          className="absolute max-w-none pointer-events-none select-none"
                        />
                      </div>
                      <div className="absolute bottom-0 left-0 w-[78px] h-[29px] z-30">
                        <PlayerKitShouldersSvg
                          color={previewKitColor}
                          teamIndex={previewKitIndex}
                          layer="front"
                          skinTone={skinTone}
                          className="w-[78px] h-[29px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
                        />
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-600">On Pitch</span>
                </div>

                {/* Standardized Profile Preview (Keeps Shirt, BG Removed) */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className="w-[56px] h-[56px] rounded-full bg-gradient-to-b from-[#0b1f44] to-[#173b7a] border border-slate-300 flex items-center justify-center overflow-hidden relative shadow-xs">
                    <div className="relative w-[52px] h-[52px] rounded-full overflow-hidden">
                      <img
                        src={activeProfileSrc}
                        alt="Standardized profile preview"
                        draggable={false}
                        style={{
                          width: `${renderW * miniProfileRatio}px`,
                          height: `${renderH * miniProfileRatio}px`,
                          left: `${miniProfileCx}px`,
                          top: `${miniProfileCy}px`,
                          transform: 'translate(-50%, -50%)',
                        }}
                        className="absolute max-w-none pointer-events-none select-none"
                      />
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-600">Profile</span>
                </div>

                {/* Kit Color Switcher */}
                <div className="text-xs space-y-1.5 min-w-0">
                  <div className="text-[11px] font-semibold text-slate-800 leading-tight">
                    Kit Preview
                  </div>
                  <div className="flex items-center gap-1.5">
                    {STANDARD_TEAM_COLORS.map((kit) => (
                      <button
                        key={kit}
                        type="button"
                        onClick={() => setPreviewKitColor(kit)}
                        title={`Preview ${kit} jersey`}
                        aria-label={`Preview ${kit} jersey`}
                        className={`w-4 h-4 rounded-full border transition-transform ${
                          KIT_DOT_CLASSES[kit]
                        } ${
                          previewKitColor === kit
                            ? 'ring-2 ring-slate-900 ring-offset-1 scale-110'
                            : 'opacity-65 hover:opacity-100'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isLocked}
                onClick={handleReset}
                className="px-2 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-40"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            </div>

            {/* Natural Neck Skin Match Controls */}
            <div className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
              {/* Natural Neck Skin Tone Matcher */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-700 shrink-0">
                  Neck Skin Match
                </span>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {autoDetectedSkinTone && (
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setSkinTone(autoDetectedSkinTone)}
                      title="Use auto-sampled skin tone from photo"
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold transition-all disabled:opacity-50 ${
                        skinTone.toLowerCase() === autoDetectedSkinTone.toLowerCase()
                          ? 'border-slate-900 bg-white text-slate-900 ring-1 ring-slate-900'
                          : 'border-slate-300 bg-white/80 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                        style={{ backgroundColor: autoDetectedSkinTone }}
                      />
                      Auto
                    </button>
                  )}
                  {SKIN_TONE_PRESETS.map((preset) => {
                    const active = skinTone.toLowerCase() === preset.hex.toLowerCase();
                    return (
                      <button
                        key={preset.hex}
                        type="button"
                        disabled={isLocked}
                        onClick={() => setSkinTone(preset.hex)}
                        title={`${preset.label} skin tone`}
                        aria-label={`Set neck skin tone to ${preset.label}`}
                        style={{ backgroundColor: preset.hex }}
                        className={`w-4 h-4 rounded-full border border-black/20 transition-transform disabled:opacity-50 ${
                          active
                            ? 'ring-2 ring-slate-900 ring-offset-1 scale-110'
                            : 'hover:scale-110'
                        }`}
                      />
                    );
                  })}
                  <label
                    title="Fine-tune exact skin tone color"
                    className="w-5 h-5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer transition-colors relative overflow-hidden"
                  >
                    <Pipette className="w-3 h-3" />
                    <input
                      type="color"
                      disabled={isLocked}
                      value={skinTone}
                      onChange={(e) =>
                        setSkinTone(normalizeHexColor(e.target.value, DEFAULT_NECK_SKIN_TONE))
                      }
                      aria-label="Custom neck skin tone color"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Dual Independent Controls: Photo Size + Shoulder & Collar Size */}
          <div className="space-y-3 pt-1">
            {/* Control 1: Uploaded Photo Size (Zoom) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">Photo Size (Zoom)</span>
                <span className="font-mono-tabular font-semibold text-slate-900">
                  {Math.round(zoom * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={isLocked || zoom <= MIN_ZOOM}
                  onClick={() => applyZoom(zoom - 0.12)}
                  aria-label="Zoom out photo"
                  className="w-8 h-8 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center shrink-0 disabled:opacity-40 transition-colors"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.02}
                  value={zoom}
                  disabled={isLocked}
                  onChange={(e) => applyZoom(Number(e.target.value))}
                  aria-label="Photo zoom level"
                  className="w-full accent-emerald-700 cursor-pointer"
                />
                <button
                  type="button"
                  disabled={isLocked || zoom >= MAX_ZOOM}
                  onClick={() => applyZoom(zoom + 0.12)}
                  aria-label="Zoom in photo"
                  className="w-8 h-8 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center shrink-0 disabled:opacity-40 transition-colors"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Control 2: Shoulder & Collar Size Only */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">Shoulder &amp; Collar Size</span>
                <span className="font-mono-tabular font-semibold text-slate-900">
                  {Math.round(shoulderScale * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={isLocked || shoulderScale <= MIN_SHOULDER_SCALE}
                  onClick={() => applyShoulderScale(shoulderScale - 0.08)}
                  aria-label="Shrink jersey shoulders"
                  className="w-8 h-8 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center shrink-0 disabled:opacity-40 transition-colors"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                </button>
                <input
                  type="range"
                  min={MIN_SHOULDER_SCALE}
                  max={MAX_SHOULDER_SCALE}
                  step={0.02}
                  value={shoulderScale}
                  disabled={isLocked}
                  onChange={(e) => applyShoulderScale(Number(e.target.value))}
                  aria-label="Shoulder and collar size"
                  className="w-full accent-slate-800 cursor-pointer"
                />
                <button
                  type="button"
                  disabled={isLocked || shoulderScale >= MAX_SHOULDER_SCALE}
                  onClick={() => applyShoulderScale(shoulderScale + 0.08)}
                  aria-label="Expand jersey shoulders"
                  className="w-8 h-8 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center shrink-0 disabled:opacity-40 transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {(exportError || externalError) && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {exportError || externalError}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={isLocked}
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isLocked || !imageReady}
            onClick={handleConfirmCrop}
            className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
          >
            {busy || exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {busy || exporting ? 'Saving...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
