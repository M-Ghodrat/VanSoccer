/**
 * Compresses an uploaded logo or promotional image client-side into a compact
 * data URL (<= 65KB) suitable for Firestore storage and crisp ribbon rendering.
 */
export function compressBrandImageFile(file: File, maxDim = 220): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please select an image file (PNG, JPG, or WebP).'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : '';
      if (!src) {
        reject(new Error('Invalid image file.'));
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image format.'));
      img.onload = () => {
        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;
        if (!naturalW || !naturalH) {
          reject(new Error('Could not read image dimensions.'));
          return;
        }

        const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
        const targetW = Math.max(1, Math.round(naturalW * scale));
        const targetH = Math.max(1, Math.round(naturalH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }

        ctx.clearRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        // Try WebP first (preserves transparency with tiny file size), fall back to JPEG/PNG
        const attempts: Array<() => string> = [
          () => canvas.toDataURL('image/webp', 0.84),
          () => canvas.toDataURL('image/webp', 0.68),
          () => canvas.toDataURL('image/png'),
          () => canvas.toDataURL('image/jpeg', 0.82),
          () => canvas.toDataURL('image/jpeg', 0.65),
        ];

        for (const make of attempts) {
          try {
            const out = make();
            if (
              /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(out) &&
              out.length <= 72000
            ) {
              resolve(out);
              return;
            }
          } catch {
            // Try next format
          }
        }

        // Final smaller fallback for very detailed images
        const smallCanvas = document.createElement('canvas');
        smallCanvas.width = Math.max(1, Math.round(targetW * 0.65));
        smallCanvas.height = Math.max(1, Math.round(targetH * 0.65));
        const sctx = smallCanvas.getContext('2d');
        if (sctx) {
          sctx.drawImage(img, 0, 0, smallCanvas.width, smallCanvas.height);
          const fallback = smallCanvas.toDataURL('image/jpeg', 0.72);
          if (fallback.length <= 72000) {
            resolve(fallback);
            return;
          }
        }

        reject(new Error('Image is too large. Please pick a simpler or smaller image.'));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
