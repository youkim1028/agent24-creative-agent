import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectImage } from "./binary.js";

export interface UploadedImage {
  assetId: string;
  filename: string;
  boardLabel: string;
  localPath: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  sha256: string;
}

export type PublicUploadedImage = Omit<UploadedImage, "localPath" | "sha256">;

function safeLabel(value: string, fallback: string, max: number): string {
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (normalized || fallback).slice(0, max);
}

export class UploadRegistry {
  private readonly assets = new Map<string, UploadedImage>();

  async register(buffer: Buffer, filename: string, boardLabel: string): Promise<PublicUploadedImage> {
    const image = inspectImage(buffer);
    const assetId = randomUUID();
    const directory = path.resolve("artifacts", "uploads");
    await mkdir(directory, { recursive: true });
    const localPath = path.join(directory, `${assetId}.${image.extension}`);
    await writeFile(localPath, buffer);
    const stored: UploadedImage = {
      assetId,
      filename: safeLabel(filename, `upload.${image.extension}`, 120),
      boardLabel: safeLabel(boardLabel, "User reference board", 80),
      localPath,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    };
    this.assets.set(assetId, stored);
    const { localPath: _localPath, sha256: _sha256, ...publicAsset } = stored;
    return publicAsset;
  }

  get(assetId: string): UploadedImage | null {
    return this.assets.get(assetId) ?? null;
  }

  publicMany(assetIds: string[]): PublicUploadedImage[] {
    return assetIds.flatMap((assetId) => {
      const asset = this.get(assetId);
      if (!asset) return [];
      const { localPath: _localPath, sha256: _sha256, ...publicAsset } = asset;
      return [publicAsset];
    });
  }

  async releaseMany(assetIds: string[]): Promise<void> {
    await Promise.all(assetIds.map(async (assetId) => {
      const asset = this.assets.get(assetId);
      if (!asset) return;
      this.assets.delete(assetId);
      await unlink(asset.localPath).catch(() => undefined);
    }));
  }

  clear(): void {
    this.assets.clear();
  }
}

export const uploadRegistry = new UploadRegistry();
