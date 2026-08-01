import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { v2 as cloudinary } from 'cloudinary';

export type SecureUploadResult = {
  storageKey: string;
  resourceType: string;
  format: string | null;
  bytes: number;
  sha256: string;
};

const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME: Record<string, { resourceType: 'image' | 'raw'; format: string }> = {
  'image/jpeg': { resourceType: 'image', format: 'jpg' },
  'image/jpg': { resourceType: 'image', format: 'jpg' },
  'image/png': { resourceType: 'image', format: 'png' },
  'image/webp': { resourceType: 'image', format: 'webp' },
  'image/heic': { resourceType: 'image', format: 'heic' },
  'application/pdf': { resourceType: 'raw', format: 'pdf' },
};

@Injectable()
export class SecureDocumentsService {
  constructor(private config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.get<string>('cloudinary.cloudName'),
      api_key: this.config.get<string>('cloudinary.apiKey'),
      api_secret: this.config.get<string>('cloudinary.apiSecret'),
    });
  }

  async upload(publicId: string, dataUri: string): Promise<SecureUploadResult> {
    const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUri.trim());
    if (!match) throw new BadRequestException('Μη έγκυρο αρχείο.');

    const [, mime, base64] = match;
    const allowed = ALLOWED_MIME[mime.toLowerCase()];
    if (!allowed) {
      throw new BadRequestException('Επιτρέπονται μόνο εικόνες (JPG, PNG, WEBP, HEIC) και PDF.');
    }

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.byteLength === 0) throw new BadRequestException('Το αρχείο είναι κενό.');
    if (buffer.byteLength > MAX_BYTES) {
      throw new BadRequestException('Το αρχείο ξεπερνά τα 10MB.');
    }

    const result = await cloudinary.uploader.upload(dataUri, {
      public_id: publicId,
      type: 'authenticated',
      resource_type: allowed.resourceType,
      overwrite: true,
      invalidate: true,
      unique_filename: false,
      use_filename: false,
    });

    return {
      storageKey: result.public_id,
      resourceType: result.resource_type ?? allowed.resourceType,
      format: result.format ?? allowed.format,
      bytes: result.bytes ?? buffer.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  signedUrl(
    storageKey: string,
    resourceType: string,
    format: string | null,
    ttlSeconds = 300,
  ): string {
    return cloudinary.utils.private_download_url(storageKey, format ?? '', {
      resource_type: resourceType,
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
      attachment: false,
    });
  }

  async destroy(storageKey: string, resourceType: string): Promise<void> {
    await cloudinary.uploader.destroy(storageKey, {
      type: 'authenticated',
      resource_type: resourceType,
      invalidate: true,
    });
  }
}
