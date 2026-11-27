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
  const previewKitColor: StandardTeamColor = 'Blue';
  const [skinTone, setSkinTone] = useState<string>(() =>
    normalizeHexColor(initialSkinTone, DEFAULT_NECK_SKIN_TONE)
  );
  const [autoDetectedSkinTone, setAutoDetectedSkinTone] = useState<string | null>(null);

  // Dual in-browser AI cutout state: profile (with shirt, bg removed) + pitch (head & neck only)
  const [cutoutPair, setCutoutPair] = useState<PortraitCutoutPair | null>(null);
  const [useTransparentBg, setUseTransparentBg] = useState(true);
  const [removingBg, setRemovingBg] = useState(true);
  const [bgError, setBgError] = useState<string | null>(null);

  // Automatically apply background removal (for profile) and dress/shirt removal (for field icon) on mount
  useEffect(() => {
    let active = true;
    setRemovingBg(true);
    setBgError(null);
    removePortraitBackgroundDual(imageSrc)
      .then((pair) => {
        if (!active) return;
        setCutoutPair(pair);
        setUseTransparentBg(true);
        if (pair.detectedSkinTone && /^#[0-9a-fA-F]{6}$/.test(pair.detectedSkinTone)) {
          const matched = pair.detectedSkinTone.toLowerCase();
          setAutoDetectedSkinTone(matched);
          setSkinTone(matched);
        }
      })
      .catch((err) => {
        if (!active) return;
        console.warn('Auto cutout fallback notice:', err);
        setBgError(
          err instanceof Error
            ? err.message
            : 'Using original photo fallback for alignment.'
        );
      })
      .finally(() => {
        if (active) setRemovingBg(false);
      });

    return () => {
      active = false;
    };
  }, [imageSrc]);

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

  const PANEL_W = 216;
  const PANEL_H = 240;
  const FIELD_STAGE_SCALE = PANEL_W / STAGE_W;
  const PROFILE_CIRCLE_SIZE = 188;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragOriginRef.current) return;
    const dx = (e.clientX - dragOriginRef.current.pointerX) / FIELD_STAGE_SCALE;
    const dy = (e.clientY - dragOriginRef.current.pointerY) / FIELD_STAGE_SCALE;
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

      // Tall 240x300 pitch cutout
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

      // Balanced 256x256 profile avatar
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

  // Large Left Panel: Profile Photo ratio
  const largeProfileRatio = PROFILE_CIRCLE_SIZE / activeCaptureW;
  const largeProfileCx = PROFILE_CIRCLE_SIZE / 2 + offset.x * largeProfileRatio;
  const largeProfileCy = (PHOTO_BASE_Y + offset.y - profileCaptureTop) * largeProfileRatio;

  const isRemoteHttp = activePitchSrc.startsWith('http://') || activePitchSrc.startsWith('https://');
  const previewKitIndex = STANDARD_TEAM_COLORS.indexOf(previewKitColor);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-cropper-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden my-auto">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <h3 id="photo-cropper-title" className="text-base font-semibold text-slate-900">
            {title}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isLocked}
              onClick={handleReset}
              className="px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
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
        </div>

        {/* Two Equal-Size Side-by-Side Interactive Panels: Left = Profile, Right = Field */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3.5 justify-items-center">
            {/* Left Panel: Profile Photo */}
            <div className="flex flex-col items-center gap-2 w-full">
              <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onWheel={handleWheel}
                style={{ width: PANEL_W, height: PANEL_H }}
                className={`relative rounded-xl overflow-hidden select-none touch-none bg-slate-900 border border-slate-200 flex items-center justify-center shadow-inner ${
                  dragging ? 'cursor-grabbing' : isLocked ? 'cursor-wait' : 'cursor-grab'
                }`}
              >
                <div
                  style={{ width: PROFILE_CIRCLE_SIZE, height: PROFILE_CIRCLE_SIZE }}
                  className="relative rounded-full bg-gradient-to-b from-[#0b1f44] to-[#173b7a] border-2 border-white/80 overflow-hidden shadow-md pointer-events-none"
                >
                  <img
                    src={activeProfileSrc}
                    alt="Profile preview"
                    draggable={false}
                    style={{
                      width: `${renderW * largeProfileRatio}px`,
                      height: `${renderH * largeProfileRatio}px`,
                      left: `${largeProfileCx}px`,
                      top: `${largeProfileCy}px`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    className="absolute max-w-none pointer-events-none select-none"
                  />
                </div>

                {removingBg && (
                  <div className="absolute inset-0 z-40 bg-slate-950/70 flex flex-col items-center justify-center gap-2 text-white">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  </div>
                )}
              </div>
              <span className="text-xs font-bold text-slate-800">Profile</span>
            </div>

            {/* Right Panel: Field Icon */}
            <div className="flex flex-col items-center gap-2 w-full">
              <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onWheel={handleWheel}
                style={{ width: PANEL_W, height: PANEL_H }}
                className={`relative rounded-xl overflow-hidden select-none touch-none border border-slate-200 shadow-inner ${
                  useTransparentBg ? 'pitch-stripes' : 'bg-slate-800'
                } ${dragging ? 'cursor-grabbing' : isLocked ? 'cursor-wait' : 'cursor-grab'}`}
              >
                <div
                  style={{
                    width: STAGE_W,
                    height: STAGE_H,
                    transform: `scale(${FIELD_STAGE_SCALE})`,
                    transformOrigin: 'bottom center',
                    left: '50%',
                    bottom: 0,
                    marginLeft: -(STAGE_W / 2),
                  }}
                  className="absolute pointer-events-none"
                >
                  {/* Layer 1: Back Interior Collar */}
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

                  {/* Layer 2: Draggable & Zoomable Photo */}
                  <img
                    ref={imgRef}
                    src={activePitchSrc}
                    alt="Field alignment preview"
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

                  {/* Layer 4: Dashed Neck-Opening & Shoulder Alignment Guide */}
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
                    <path
                      d="M32.8 6.0C36.8 12.8 42.0 16.5 48 16.5C54.0 16.5 59.2 12.8 63.2 6.0"
                      stroke="#ffffff"
                      strokeOpacity="0.9"
                      strokeWidth="1.3"
                      strokeDasharray="3.2 2.6"
                      strokeLinecap="round"
                    />
                    <path
                      d="M1.2 35.6C2.4 30.2 3.8 25.2 5.6 20.6C6.6 17.2 8.4 14.6 11.7 12.8C16.6 10.2 24.8 7.8 32.8 6.0M63.2 6.0C71.2 7.8 79.4 10.2 84.3 12.8C87.6 14.6 89.4 17.2 90.4 20.6C92.2 25.2 93.6 30.2 94.8 35.6"
                      stroke="#ffffff"
                      strokeOpacity="0.62"
                      strokeWidth="1"
                      strokeDasharray="3.2 3.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>

                {dragging && (
                  <div
                    aria-hidden="true"
                    className="absolute left-1/2 top-0 bottom-0 w-px bg-white/35 z-30 pointer-events-none"
                  />
                )}

                {removingBg && (
                  <div className="absolute inset-0 z-40 bg-slate-950/70 flex flex-col items-center justify-center gap-2 text-white">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  </div>
                )}
              </div>
              <span className="text-xs font-bold text-slate-800">Field</span>
            </div>
          </div>

          {bgError && (
            <div className="w-full p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              {bgError}
            </div>
          )}

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
