import { Service } from '@angular/core';
import {
  IMAGE_JPEG_QUALITY,
  IMAGE_KEEP_BELOW_BYTES,
  IMAGE_MAX_SIDE_PX,
  SENDABLE_IMAGE_TYPES,
} from '../constants';

@Service()
export class ImageCompressor {
  async prepare(file: File): Promise<File> {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') {
      return file;
    }

    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, IMAGE_MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
      const sendable = SENDABLE_IMAGE_TYPES.includes(file.type);
      if (scale === 1 && sendable && file.size <= IMAGE_KEEP_BELOW_BYTES) {
        bitmap.close();
        return file;
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        bitmap.close();
        return file;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', IMAGE_JPEG_QUALITY),
      );
      if (!blob || (sendable && blob.size >= file.size)) {
        return file;
      }
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
    } catch {
      return file;
    }
  }
}
