/**
 * OCR provider interface (Task 4). All providers run entirely on-device
 * — no network calls, no cloud OCR, no AI model in the live-record path.
 * `SwiftVisionOcrProvider` shells out to the bundled Apple Vision helper.
 * Additional local engines can be added later by implementing this same
 * interface; nothing elsewhere in the codebase depends on Vision
 * specifically.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The Swift helper always fails closed by printing a JSON error object
 * and then exiting non-zero (`fail()` in main.swift) — but a non-zero
 * exit makes Node's execFile PROMISE REJECT rather than resolve, and
 * the rejection's `.message` is just a generic "Command failed: ..."
 * string, not the JSON the binary actually printed. Node's execFile
 * error objects do carry the captured stdout/stderr on the error itself
 * (`ExecFileException`), so the real error code is recovered from
 * there. Without this, every fail-closed path here (encrypted PDF,
 * corrupted file, missing file, ...) would report a useless generic
 * message instead of the specific, actionable code.
 */
function parseErrorCode(error: unknown): string {
  const withStreams = error as { stdout?: unknown; message?: unknown };
  const stdout = typeof withStreams?.stdout === "string" ? withStreams.stdout : undefined;
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // stdout wasn't valid JSON — fall through to the generic message below.
    }
  }
  return error instanceof Error ? error.message : "unknown_error";
}

export interface OcrBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrLine {
  text: string;
  confidence: number;
  /** Normalized (0-1) box, Vision's convention: origin bottom-left. Used for table-row reconstruction. */
  boundingBox?: OcrBoundingBox;
}

export interface OcrResult {
  ok: boolean;
  lines: OcrLine[];
  orientationApplied?: string;
  error?: string;
}

export interface OcrProvider {
  readonly name: string;
  recognize(imagePath: string): Promise<OcrResult>;
}

export interface OcrPageResult {
  pageNumber: number;
  lines: OcrLine[];
  orientationApplied?: string;
}

export interface PdfOcrResult {
  ok: boolean;
  pageCount: number;
  pages: OcrPageResult[];
  error?: string;
}

/** Separate from OcrProvider (which is single-image only) so an engine without PDF rasterization support isn't forced to implement it. */
export interface PdfOcrProvider {
  recognizePdf(pdfPath: string): Promise<PdfOcrResult>;
}

export interface PdfPagePreviewResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Renders one page of a local PDF to a standalone PNG file (Import
 * Review preview panel, Phase 2 / Task P2-1). Kept separate from
 * PdfOcrProvider since previewing is a desktop-UI concern, not part of
 * the OCR extraction path.
 */
export interface PdfPagePreviewProvider {
  renderPdfPage(pdfPath: string, pageNumber: number, outputPath: string): Promise<PdfPagePreviewResult>;
}

export interface ImageConversionResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Converts one local image file to another local image format (output
 * format inferred from `outputPath`'s extension). Used by the Import
 * Review preview panel to turn a HEIC/HEIF source — which Chromium's
 * <img> renderer cannot display — into a PNG the renderer can show,
 * entirely on-device.
 */
export interface ImageConversionProvider {
  convertImage(inputPath: string, outputPath: string): Promise<ImageConversionResult>;
}

export interface SwiftVisionOcrProviderOptions {
  /** Absolute path to the built ocr-helper binary (ocr-helper/.build/release/ocr-helper). */
  binaryPath: string;
  timeoutMs?: number;
}

export class SwiftVisionOcrProvider implements OcrProvider, PdfOcrProvider, PdfPagePreviewProvider, ImageConversionProvider {
  readonly name = "apple-vision";
  private readonly binaryPath: string;
  private readonly timeoutMs: number;

  constructor(options: SwiftVisionOcrProviderOptions) {
    this.binaryPath = options.binaryPath;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async recognize(imagePath: string): Promise<OcrResult> {
    try {
      const { stdout } = await execFileAsync(this.binaryPath, ["recognize", imagePath], { timeout: this.timeoutMs });
      const parsed = JSON.parse(stdout) as { ok: boolean; lines?: OcrLine[]; orientationApplied?: string; error?: string };
      if (!parsed.ok) return { ok: false, lines: [], error: parsed.error ?? "recognize_failed" };
      return { ok: true, lines: parsed.lines ?? [], orientationApplied: parsed.orientationApplied };
    } catch (error) {
      return { ok: false, lines: [], error: parseErrorCode(error) };
    }
  }

  /**
   * Recognizes every page of a local PDF, in order, entirely on-device.
   * Fails safely (never guesses a password) on an encrypted PDF and
   * fails safely on a corrupted/unreadable/zero-page PDF — see
   * ocr-helper's `runRecognizePdf` for the exact fail-closed codes
   * (`pdf_encrypted`, `pdf_load_failed`, `pdf_not_found`, `pdf_no_pages`).
   */
  async recognizePdf(pdfPath: string): Promise<PdfOcrResult> {
    try {
      const { stdout } = await execFileAsync(this.binaryPath, ["recognize-pdf", pdfPath], { timeout: this.timeoutMs });
      const parsed = JSON.parse(stdout) as { ok: boolean; pageCount?: number; pages?: OcrPageResult[]; error?: string };
      if (!parsed.ok) return { ok: false, pageCount: 0, pages: [], error: parsed.error ?? "recognize_pdf_failed" };
      return { ok: true, pageCount: parsed.pageCount ?? 0, pages: parsed.pages ?? [] };
    } catch (error) {
      return { ok: false, pageCount: 0, pages: [], error: parseErrorCode(error) };
    }
  }

  /** Renders `pageNumber` (1-indexed) of a local PDF to `outputPath` as a PNG, entirely on-device. */
  async renderPdfPage(pdfPath: string, pageNumber: number, outputPath: string): Promise<PdfPagePreviewResult> {
    try {
      const { stdout } = await execFileAsync(
        this.binaryPath,
        ["render-pdf-page", pdfPath, String(pageNumber), outputPath],
        { timeout: this.timeoutMs }
      );
      const parsed = JSON.parse(stdout) as { ok: boolean; path?: string; error?: string };
      if (!parsed.ok) return { ok: false, error: parsed.error ?? "render_pdf_page_failed" };
      return { ok: true, path: parsed.path };
    } catch (error) {
      return { ok: false, error: parseErrorCode(error) };
    }
  }

  async convertImage(inputPath: string, outputPath: string): Promise<ImageConversionResult> {
    try {
      const { stdout } = await execFileAsync(this.binaryPath, ["convert", inputPath, outputPath], { timeout: this.timeoutMs });
      const parsed = JSON.parse(stdout) as { ok: boolean; path?: string; error?: string };
      if (!parsed.ok) return { ok: false, error: parsed.error ?? "convert_failed" };
      return { ok: true, path: parsed.path };
    } catch (error) {
      return { ok: false, error: parseErrorCode(error) };
    }
  }
}

/** Deterministic no-op provider for unit tests that should never touch a subprocess. */
export class FixedOcrProvider implements OcrProvider {
  readonly name = "fixed";
  constructor(private readonly result: OcrResult) {}
  async recognize(): Promise<OcrResult> {
    return this.result;
  }
}
