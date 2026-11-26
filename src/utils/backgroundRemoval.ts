import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const MULTICLASS_MODEL_PROXY_URL = '/api/mediapipe-model/selfie-multiclass';
const SELFIE_FALLBACK_MODEL_PROXY_URL = '/api/mediapipe-model/selfie-segmenter';
const MAX_WORKING_DIMENSION = 512;

export interface PortraitCutoutPair {
  /** Background removed, shirt/clothes kept — used on Profile, Player Rating Card, Stats, Matchday roster */
  profileCutoutUrl: string;
  /** Background AND shirt/clothes removed (head, hair & neck only) — used on the Soccer Pitch with jersey collar */
  pitchCutoutUrl: string;
  /** Trimmed-mean neck/face skin tone hex (#rrggbb) sampled from the photo for natural collar skin blending */
  detectedSkinTone: string | null;
}

let segmenterPromise: Promise<{ segmenter: ImageSegmenter; isMulticlass: boolean }> | null = null;

const TFLITE_INFO_PATTERN =
  /^(INFO:|I\d{4}\s).*TensorFlow Lite|Created TensorFlow Lite XNNPACK delegate/i;

function isBenignTfliteLog(args: unknown[]): boolean {
  return args.some((arg) => typeof arg === 'string' && TFLITE_INFO_PATTERN.test(arg.trim()));
}

async function withQuietTfliteLogs<T>(fn: () => Promise<T>): Promise<T> {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (isBenignTfliteLog(args)) return;
    originalError.apply(console, args);
  };
  try {
    return await fn();
  } finally {
    console.error = originalError;
  }
}

async function getImageSegmenter(): Promise<{ segmenter: ImageSegmenter; isMulticlass: boolean }> {
  if (!segmenterPromise) {
    segmenterPromise = withQuietTfliteLogs(async () => {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      try {
        const multiclass = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MULTICLASS_MODEL_PROXY_URL,
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
        return { segmenter: multiclass, isMulticlass: true };
      } catch {
        const fallback = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: SELFIE_FALLBACK_MODEL_PROXY_URL,
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
        return { segmenter: fallback, isMulticlass: false };
      }
    }).catch((err) => {
      segmenterPromise = null;
      throw err;
    });
  }
  return segmenterPromise;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (src.startsWith('http://') || src.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for background removal.'));
    img.src = src;
  });
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function toHexChannel(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, '0');
}

function computeTrimmedSkinHex(samples: Array<{ r: number; g: number; b: number; lum: number }>): string | null {
  if (samples.length < 12) return null;
  samples.sort((a, b) => a.lum - b.lum);
  const start = Math.floor(samples.length * 0.2);
  const end = Math.max(start + 1, Math.ceil(samples.length * 0.8));
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    sumR += samples[i].r;
    sumG += samples[i].g;
    sumB += samples[i].b;
    count++;
  }
  if (count === 0) return null;
  return `#${toHexChannel(sumR / count)}${toHexChannel(sumG / count)}${toHexChannel(sumB / count)}`;
}

function resolveSingleMaskAsBackground(
  labels: string[],
  maskCount: number,
  maskData: Float32Array,
  maskW: number,
  maskH: number
): boolean {
  const firstLabel = (labels[0] || '').toLowerCase();
  if (firstLabel.includes('background')) return true;
  if (
    firstLabel.includes('person') ||
    firstLabel.includes('selfie') ||
    firstLabel.includes('foreground')
  ) {
    return false;
  }
  if (maskCount >= 2) return true;

  let centerSum = 0;
  let centerCount = 0;
  const cx0 = Math.floor(maskW * 0.35);
  const cx1 = Math.ceil(maskW * 0.65);
  const cy0 = Math.floor(maskH * 0.3);
  const cy1 = Math.ceil(maskH * 0.7);
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      centerSum += maskData[y * maskW + x];
      centerCount++;
    }
  }
  const centerAvg = centerCount > 0 ? centerSum / centerCount : 0.5;

  const padX = Math.max(1, Math.floor(maskW * 0.08));
  const padY = Math.max(1, Math.floor(maskH * 0.08));
  const corners = [
    maskData[padY * maskW + padX],
    maskData[padY * maskW + (maskW - 1 - padX)],
    maskData[(maskH - 1 - padY) * maskW + padX],
    maskData[(maskH - 1 - padY) * maskW + (maskW - 1 - padX)],
  ];
  const cornerAvg = corners.reduce((a, b) => a + b, 0) / corners.length;
  return cornerAvg > centerAvg;
}

/**
 * Runs MediaPipe Selfie Multiclass segmentation ONCE to produce:
 * 1) profileCutoutUrl: background removed ONLY (keeps hair, face, neck, and shirt/clothes)
 * 2) pitchCutoutUrl:   background AND shirt/clothes removed (keeps head, hair, neck, and accessories only)
 * 3) detectedSkinTone: trimmed-mean skin color sampled directly from neck (body-skin) / face-skin pixels
 */
export async function removePortraitBackgroundDual(imageSrc: string): Promise<PortraitCutoutPair> {
  const [{ segmenter, isMulticlass }, img] = await Promise.all([
    getImageSegmenter(),
    loadImageElement(imageSrc),
  ]);

  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_WORKING_DIMENSION / Math.max(1, natW, natH));
  const width = Math.max(1, Math.round(natW * scale));
  const height = Math.max(1, Math.round(natH * scale));

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) {
    throw new Error('Canvas context unavailable for background removal.');
  }

  srcCtx.drawImage(img, 0, 0, width, height);

  const result = await withQuietTfliteLogs(async () => segmenter.segment(srcCanvas));
  try {
    const masks = result.confidenceMasks;
    if (!masks || masks.length === 0) {
      throw new Error('Background segmentation mask was not produced.');
    }

    const labels = typeof segmenter.getLabels === 'function' ? segmenter.getLabels() : [];
    const baseData = srcCtx.getImageData(0, 0, width, height);

    const profileCanvas = document.createElement('canvas');
    profileCanvas.width = width;
    profileCanvas.height = height;
    const profileCtx = profileCanvas.getContext('2d');

    const pitchCanvas = document.createElement('canvas');
    pitchCanvas.width = width;
    pitchCanvas.height = height;
    const pitchCtx = pitchCanvas.getContext('2d');

    if (!profileCtx || !pitchCtx) {
      throw new Error('Canvas output context unavailable for background removal.');
    }

    const profileImgData = profileCtx.createImageData(width, height);
    const pitchImgData = pitchCtx.createImageData(width, height);
    profileImgData.data.set(baseData.data);
    pitchImgData.data.set(baseData.data);

    const profilePixels = profileImgData.data;
    const pitchPixels = pitchImgData.data;

    let detectedSkinTone: string | null = null;

    // Multiclass model (6 classes: 0=background, 1=hair, 2=body-skin/neck, 3=face-skin, 4=clothes, 5=others/accessories)
    if (isMulticlass && masks.length >= 5) {
      const profileKeepIndices: number[] = [];
      const pitchKeepIndices: number[] = [];
      let bodySkinIdx = 2 < masks.length ? 2 : -1;
      let faceSkinIdx = 3 < masks.length ? 3 : -1;

      for (let i = 0; i < masks.length; i++) {
        const lbl = (labels[i] || '').toLowerCase();
        if (lbl) {
          const isBg = lbl.includes('background');
          const isClothes =
            lbl.includes('cloth') || lbl.includes('apparel') || lbl.includes('garment');
          if (lbl.includes('body')) bodySkinIdx = i;
          if (lbl.includes('face')) faceSkinIdx = i;
          if (!isBg) {
            profileKeepIndices.push(i);
            if (!isClothes) {
              pitchKeepIndices.push(i);
            }
          }
        } else {
          if (i !== 0) {
            profileKeepIndices.push(i);
            if (i !== 4) {
              pitchKeepIndices.push(i);
            }
          }
        }
      }

      const finalProfileKeep =
        profileKeepIndices.length > 0
          ? profileKeepIndices
          : [1, 2, 3, 4, 5].filter((i) => i < masks.length);
      const finalPitchKeep =
        pitchKeepIndices.length > 0
          ? pitchKeepIndices
          : [1, 2, 3, 5].filter((i) => i < masks.length);

      const allArrays = masks.map((m) => m.getAsFloat32Array());
      const maskW = masks[0].width;
      const maskH = masks[0].height;
      const bodySkinArray = bodySkinIdx >= 0 ? allArrays[bodySkinIdx] : null;
      const faceSkinArray = faceSkinIdx >= 0 ? allArrays[faceSkinIdx] : null;

      const neckSkinSamples: Array<{ r: number; g: number; b: number; lum: number }> = [];
      const faceSkinSamples: Array<{ r: number; g: number; b: number; lum: number }> = [];

      for (let y = 0; y < height; y++) {
        const my = maskH === height ? y : Math.min(maskH - 1, Math.floor((y * maskH) / height));
        const maskRowOffset = my * maskW;
        const pixelRowOffset = y * width;
        const sampleRow = y % 3 === 0;

        for (let x = 0; x < width; x++) {
          const mx = maskW === width ? x : Math.min(maskW - 1, Math.floor((x * maskW) / width));
          const mIdx = maskRowOffset + mx;

          let profileFg = 0;
          for (let k = 0; k < finalProfileKeep.length; k++) {
            profileFg += allArrays[finalProfileKeep[k]][mIdx];
          }

          let pitchFg = 0;
          for (let k = 0; k < finalPitchKeep.length; k++) {
            pitchFg += allArrays[finalPitchKeep[k]][mIdx];
          }

          const pIdx = (pixelRowOffset + x) * 4;
          const origAlpha = baseData.data[pIdx + 3];
          profilePixels[pIdx + 3] = Math.round(origAlpha * smoothstep(0.28, 0.62, profileFg));
          pitchPixels[pIdx + 3] = Math.round(origAlpha * smoothstep(0.28, 0.62, pitchFg));

          // Sample true neck/face skin tone on stride for natural collar skin blending
          if (sampleRow && x % 3 === 0 && origAlpha > 200) {
            const r = baseData.data[pIdx];
            const g = baseData.data[pIdx + 1];
            const b = baseData.data[pIdx + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            if (bodySkinArray && bodySkinArray[mIdx] > 0.58) {
              neckSkinSamples.push({ r, g, b, lum });
            } else if (faceSkinArray && faceSkinArray[mIdx] > 0.62) {
              faceSkinSamples.push({ r, g, b, lum });
            }
          }
        }
      }

      // Prefer neck (body-skin) samples since that sits right against the collar; fall back to face skin
      detectedSkinTone =
        computeTrimmedSkinHex(neckSkinSamples) || computeTrimmedSkinHex(faceSkinSamples);
    } else {
      // Fallback 2-class selfie segmenter (removes background)
      const primaryMask = masks[0];
      const maskW = primaryMask.width;
      const maskH = primaryMask.height;
      const maskData = primaryMask.getAsFloat32Array();
      const mask0IsBackground = resolveSingleMaskAsBackground(
        labels,
        masks.length,
        maskData,
        maskW,
        maskH
      );

      for (let y = 0; y < height; y++) {
        const my = maskH === height ? y : Math.min(maskH - 1, Math.floor((y * maskH) / height));
        const maskRowOffset = my * maskW;
        const pixelRowOffset = y * width;

        for (let x = 0; x < width; x++) {
          const mx = maskW === width ? x : Math.min(maskW - 1, Math.floor((x * maskW) / width));
          const rawVal = maskData[maskRowOffset + mx];
          const fgConfidence = mask0IsBackground ? 1 - rawVal : rawVal;

          const alphaFactor = smoothstep(0.28, 0.65, fgConfidence);
          const pIdx = (pixelRowOffset + x) * 4;
          const nextAlpha = Math.round(baseData.data[pIdx + 3] * alphaFactor);
          profilePixels[pIdx + 3] = nextAlpha;
          pitchPixels[pIdx + 3] = nextAlpha;
        }
      }
    }

    profileCtx.putImageData(profileImgData, 0, 0);
    pitchCtx.putImageData(pitchImgData, 0, 0);

    return {
      profileCutoutUrl: profileCanvas.toDataURL('image/png'),
      pitchCutoutUrl: pitchCanvas.toDataURL('image/png'),
      detectedSkinTone,
    };
  } finally {
    result.close();
  }
}

export async function removePortraitBackground(imageSrc: string): Promise<string> {
  const { pitchCutoutUrl } = await removePortraitBackgroundDual(imageSrc);
  return pitchCutoutUrl;
}
