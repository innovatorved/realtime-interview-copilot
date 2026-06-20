/** Build the interview background block from preset context + resume/JD. */

export interface BuildContextBlockArgs {
  resumeText?: string | null;
  jobDescription?: string | null;
  existingBg?: string;
}

export function buildContextBlock({
  resumeText,
  jobDescription,
  existingBg = "",
}: BuildContextBlockArgs): string {
  const parts: string[] = [];
  const base = existingBg.trim();
  if (base) parts.push(base);

  const resume = resumeText?.trim();
  if (resume) {
    parts.push(`\n\n--- RESUME ---\n${resume}`);
  }

  const jd = jobDescription?.trim();
  if (jd) {
    parts.push(`\n\n--- JOB DESCRIPTION ---\n${jd}`);
  }

  return parts.join("");
}

export function presetHasAttachedContext(preset: {
  resumeText?: string | null;
  jobDescription?: string | null;
}): boolean {
  return !!(preset.resumeText?.trim() || preset.jobDescription?.trim());
}
