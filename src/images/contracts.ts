import { z } from "zod";

export const imageProviderSchema = z.enum(["pexels", "unsplash", "official", "user_upload"]);

export const imageIntentSchema = z.object({
  query: z.string().trim().min(3).max(160),
  purpose: z.string().trim().min(3).max(180),
  orientation: z.enum(["landscape", "portrait", "square"]).default("landscape"),
  preferredSource: z.enum(["auto", "user_upload", "official", "stock"]).default("auto"),
});

export const selectedImageSchema = z.object({
  slideId: z.string().min(1).max(24),
  assetId: z.string().min(1).max(120),
  provider: imageProviderSchema,
  localRelativePath: z.string().regex(/^images\/[A-Za-z0-9._-]+$/),
  previewUrl: z.string().regex(/^\/api\/images\/[A-Za-z0-9._%-]+$/),
  sourcePageUrl: z.string().url().nullable(),
  attributionText: z.string().min(1).max(180),
  creatorName: z.string().max(100).nullable(),
  creatorUrl: z.string().url().nullable(),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ImageProvider = z.infer<typeof imageProviderSchema>;
export type ImageIntent = z.infer<typeof imageIntentSchema>;
export type SelectedImage = z.infer<typeof selectedImageSchema>;

export interface ImageCandidate {
  assetId: string;
  provider: ImageProvider;
  providerAssetId: string;
  previewUrl: string;
  downloadUrl: string | null;
  downloadLocation: string | null;
  sourcePageUrl: string | null;
  attributionText: string;
  creatorName: string | null;
  creatorUrl: string | null;
  width: number;
  height: number;
  localSourcePath: string | null;
}

export interface ImageResolutionResult {
  selected: SelectedImage[];
  warnings: string[];
  searchCalls: number;
}
