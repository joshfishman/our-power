/**
 * Compress and resize an image file on the client side.
 * Uses canvas to resize the image and convert it to JPEG.
 *
 * @param file - The original File/Blob to compress
 * @param options - Compression options
 * @returns A new File with the compressed image
 */
export async function compressImage(
  file: File,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    /** Output MIME type. Defaults to 'image/jpeg' */
    type?: string;
  } = {},
): Promise<File> {
  const { maxWidth = 2048, maxHeight = 2048, quality = 0.8, type = 'image/jpeg' } = options;

  // If the file is already small enough (under 1MB), skip compression for non-large images
  // But still compress if it's over 3MB regardless
  if (file.size < 1 * 1024 * 1024) {
    return file;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Calculate new dimensions while maintaining aspect ratio
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to compress image'));
            return;
          }

          // Determine the file extension based on output type
          const ext = type === 'image/png' ? '.png' : '.jpg';
          const originalName = file.name.replace(/\.[^.]+$/, '');
          const newFile = new File([blob], `${originalName}${ext}`, {
            type,
            lastModified: Date.now(),
          });

          resolve(newFile);
        },
        type,
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      // If we can't load/compress, return original file
      resolve(file);
    };

    img.src = url;
  });
}
