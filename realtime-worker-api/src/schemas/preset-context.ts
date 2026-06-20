/** Zod schemas for preset resume/JD context (user + admin). */

import { z } from "zod";

export const MAX_RESUME_TEXT_CHARS = 6000;
export const MAX_JD_TEXT_CHARS = 4000;

const safePresetIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);

export const presetContextPatchSchema = z.object({
  resumeText: z.string().max(MAX_RESUME_TEXT_CHARS).nullable().optional(),
  resumeFileName: z.string().max(255).nullable().optional(),
  jobDescription: z.string().max(MAX_JD_TEXT_CHARS).nullable().optional(),
});

export type PresetContextPatch = z.infer<typeof presetContextPatchSchema>;

export const presetContextQuerySchema = z.object({
  userId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  presetId: safePresetIdSchema,
});

export type PresetContextQuery = z.infer<typeof presetContextQuerySchema>;

export const presetContextFieldsSchema = z.object({
  resumeText: z.string().max(MAX_RESUME_TEXT_CHARS).nullable().optional(),
  resumeFileName: z.string().max(255).nullable().optional(),
  jobDescription: z.string().max(MAX_JD_TEXT_CHARS).nullable().optional(),
});
