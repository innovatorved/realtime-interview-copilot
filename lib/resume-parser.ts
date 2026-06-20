/** Parse resume files (txt, pdf, docx) into plain text for interview context. */

const MAX_CHARS = 6000;

const ALLOWED_EXTENSIONS = new Set(["txt", "pdf", "docx"]);

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return text.slice(0, MAX_CHARS);
}

function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (fromName && ALLOWED_EXTENSIONS.has(fromName)) return fromName;
  const mime = file.type.toLowerCase();
  if (mime === "text/plain") return "txt";
  if (mime === "application/pdf") return "pdf";
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return fromName;
}

async function parseTxt(file: File): Promise<string> {
  return truncate(await file.text());
}

async function parsePdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    if (text.trim()) pages.push(text);
    if (pages.join("\n").length >= MAX_CHARS) break;
  }
  return truncate(pages.join("\n\n"));
}

async function parseDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return truncate(result.value);
}

export interface ParseResumeResult {
  text: string;
  fileName: string;
}

export async function parseResumeFile(file: File): Promise<ParseResumeResult> {
  const ext = extensionOf(file);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported file type. Use .txt, .pdf, or .docx.");
  }

  let text: string;
  switch (ext) {
    case "txt":
      text = await parseTxt(file);
      break;
    case "pdf":
      text = await parsePdf(file);
      break;
    case "docx":
      text = await parseDocx(file);
      break;
    default:
      throw new Error("Unsupported file type. Use .txt, .pdf, or .docx.");
  }

  if (!text.trim()) {
    throw new Error("Could not extract text from that file.");
  }

  return { text, fileName: file.name };
}
