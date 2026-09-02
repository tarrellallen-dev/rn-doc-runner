// RN DOC Runner local OCR helper.
//
// Runs entirely on-device via Apple's Vision framework — no network
// calls, no cloud OCR. Subcommands:
//   recognize <imagePath>                              -> JSON recognized text lines (JPEG/PNG/HEIC/HEIF, anything ImageIO reads)
//   recognize-pdf <pdfPath>                             -> JSON recognized text lines per page, in order
//   render-pdf-page <pdfPath> <pageNumber> <out.png>    -> rasterizes one 1-indexed PDF page to a local PNG (Import Review preview)
//   generate-worklist <out.png> <rows.json>             -> synthetic worklist test image
//   generate-worklist-pdf <out.pdf> <rows.json> [n]      -> synthetic multi-page worklist test PDF (n rows/page)
//   convert <input> <output>                            -> local image format conversion (test-fixture use only, e.g. PNG -> HEIC)
//   generate-encrypted-pdf <out.pdf> <password>          -> synthetic password-protected PDF (test fixture for the fail-safe path)
//
// The generate-* and convert subcommands exist only so tests can create
// patient-free synthetic worklist images/PDFs locally instead of using
// real photographs — see RN DOC Runner Task 4.

import Foundation
import AppKit
import CoreGraphics
import CoreText
import ImageIO
import PDFKit
import Vision
import UniformTypeIdentifiers

func printJSON(_ object: [String: Any]) {
  let data = try? JSONSerialization.data(withJSONObject: object, options: [])
  if let data, let text = String(data: data, encoding: .utf8) {
    print(text)
  } else {
    print("{\"ok\":false,\"error\":\"json_encode_failed\"}")
  }
}

func fail(_ message: String) -> Never {
  printJSON(["ok": false, "error": message])
  exit(1)
}

func loadCGImage(path: String) -> CGImage? {
  let url = URL(fileURLWithPath: path)
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(source, 0, nil)
}

struct RecognizedLine {
  let text: String
  let confidence: Float
  let box: CGRect
}

func recognizeText(image: CGImage, orientation: CGImagePropertyOrientation) -> [RecognizedLine] {
  var lines: [RecognizedLine] = []
  let request = VNRecognizeTextRequest { request, _ in
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    for observation in observations {
      guard let candidate = observation.topCandidates(1).first else { continue }
      lines.append(RecognizedLine(text: candidate.string, confidence: candidate.confidence, box: observation.boundingBox))
    }
  }
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
  try? handler.perform([request])
  return lines
}

/// A correctly-oriented worklist yields fewer, longer, coherent lines;
/// an incorrectly rotated one tends to fragment into many short,
/// individually "confident" garbage tokens. Total confidence-weighted
/// character count favors coherent lines over fragment count, which a
/// naive (confidence * lineCount) score does not.
func weightedCharacterScore(_ lines: [RecognizedLine]) -> Float {
  lines.reduce(0) { $0 + $1.confidence * Float($1.text.count) }
}

func averageConfidence(_ lines: [RecognizedLine]) -> Float {
  guard !lines.isEmpty else { return 0 }
  return lines.reduce(0) { $0 + $1.confidence } / Float(lines.count)
}

/// Prefers the upright orientation and only tries the other three when it
/// clearly failed. An earlier version scored all four orientations up
/// front and picked whichever had the highest weighted-character score —
/// but with enough text on the page, a wrong rotation could score higher
/// than the correct one (Vision still "recognizes" plausible-looking
/// tokens from rotated text, just grouped into the wrong lines, which
/// silently scrambles row/column association downstream). Most worklist
/// photos are close to upright anyway (phone camera auto-rotation), so
/// trust "up" unless it produced too little text to be real content, and
/// only then fall back to comparing the other three orientations.
func recognizeWithOrientationCorrection(image: CGImage) -> (lines: [RecognizedLine], orientation: String) {
  let uprightLines = recognizeText(image: image, orientation: .up)
  let uprightIsPlausible = uprightLines.count >= 3 && averageConfidence(uprightLines) > 0.5
  if uprightIsPlausible {
    return (uprightLines, "up")
  }

  let fallbackCandidates: [(CGImagePropertyOrientation, String)] = [(.right, "right_90"), (.down, "down_180"), (.left, "left_270")]
  var best: (lines: [RecognizedLine], orientation: String) = (uprightLines, "up")
  var bestScore = weightedCharacterScore(uprightLines)
  for (orientation, label) in fallbackCandidates {
    let lines = recognizeText(image: image, orientation: orientation)
    let score = weightedCharacterScore(lines)
    if score > bestScore {
      bestScore = score
      best = (lines, label)
    }
  }
  return best
}

func runRecognize(args: [String]) {
  guard let path = args.first else { fail("missing_image_path") }
  guard let image = loadCGImage(path: path) else { fail("image_load_failed") }
  let result = recognizeWithOrientationCorrection(image: image)
  let linesJSON: [[String: Any]] = result.lines.map { line in
    [
      "text": line.text,
      "confidence": Double(line.confidence),
      "boundingBox": [
        "x": Double(line.box.origin.x),
        "y": Double(line.box.origin.y),
        "width": Double(line.box.size.width),
        "height": Double(line.box.size.height)
      ]
    ]
  }
  printJSON(["ok": true, "orientationApplied": result.orientation, "lines": linesJSON])
}

/// Unlike String.padding(toLength:), this only ever ADDS trailing spaces
/// for alignment — it never truncates a string longer than the target
/// width. padding(toLength:) silently drops characters past the target
/// length, which corrupted longer synthetic patient names in an earlier
/// version of this generator.
func padRight(_ text: String, toAtLeast minWidth: Int) -> String {
  text.count >= minWidth ? text : text + String(repeating: " ", count: minWidth - text.count)
}

func drawLine(context: CGContext, text: String, x: CGFloat, y: CGFloat, fontSize: CGFloat = 18) {
  let font = CTFontCreateWithName("Helvetica" as CFString, fontSize, nil)
  let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: CGColor(gray: 0.05, alpha: 1)]
  let attributed = NSAttributedString(string: text, attributes: attributes)
  let line = CTLineCreateWithAttributedString(attributed)
  context.textPosition = CGPoint(x: x, y: y)
  CTLineDraw(line, context)
}

struct WorklistRowFixture: Decodable {
  let patient: String
  let date: String
  let daysOutstanding: Int
  let category: String
}

func worklistLineText(_ row: WorklistRowFixture) -> String {
  "\(padRight(row.patient, toAtLeast: 24))  \(padRight(row.date, toAtLeast: 12))  \(padRight(String(row.daysOutstanding), toAtLeast: 18)) \(row.category)"
}

func decodeWorklistRows(fromPath rowsPath: String) -> [WorklistRowFixture] {
  guard let rowsData = FileManager.default.contents(atPath: rowsPath) else { fail("rows_file_not_readable") }
  guard let rows = try? JSONDecoder().decode([WorklistRowFixture].self, from: rowsData) else { fail("rows_json_invalid") }
  return rows
}

func drawWorklistTable(context: CGContext, rows: [WorklistRowFixture], height: Int) {
  var y = CGFloat(height - 60)
  drawLine(context: context, text: "RN DOC Runner — Synthetic Worklist (test fixture, no real patients)", x: 30, y: y, fontSize: 16)
  y -= 40
  drawLine(context: context, text: "Patient                  Date          Days Outstanding   Category", x: 30, y: y, fontSize: 16)
  y -= 30
  for row in rows {
    drawLine(context: context, text: worklistLineText(row), x: 30, y: y, fontSize: 16)
    y -= 34
  }
}

func runGenerateWorklist(args: [String]) {
  guard args.count >= 2 else { fail("usage: generate-worklist <out.png> <rows.json>") }
  let outputPath = args[0]
  let rows = decodeWorklistRows(fromPath: args[1])

  let width = 1000
  let rowHeight = 34
  let height = 120 + rowHeight * rows.count
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard let context = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { fail("bitmap_context_failed") }

  context.setFillColor(CGColor(gray: 1.0, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  drawWorklistTable(context: context, rows: rows, height: height)

  guard let cgImage = context.makeImage() else { fail("image_render_failed") }
  let url = URL(fileURLWithPath: outputPath)
  guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { fail("png_destination_failed") }
  CGImageDestinationAddImage(destination, cgImage, nil)
  guard CGImageDestinationFinalize(destination) else { fail("png_write_failed") }
  printJSON(["ok": true, "path": outputPath, "rows": rows.count])
}

/// Test-fixture utility only: converts one local image file to another
/// local image file (format inferred from the output extension), used to
/// produce synthetic HEIC fixtures from the PNG generator above without
/// ever touching a real photo. Never used in the live-record path.
func runConvertImage(args: [String]) {
  guard args.count >= 2 else { fail("usage: convert <input> <output>") }
  guard let image = loadCGImage(path: args[0]) else { fail("image_load_failed") }
  let outputPath = args[1]
  let ext = (outputPath as NSString).pathExtension.lowercased()
  let utType: UTType
  switch ext {
  case "heic", "heif": utType = .heic
  case "png": utType = .png
  case "jpg", "jpeg": utType = .jpeg
  default: fail("unsupported_output_extension:\(ext)")
  }
  let url = URL(fileURLWithPath: outputPath)
  guard let destination = CGImageDestinationCreateWithURL(url as CFURL, utType.identifier as CFString, 1, nil) else {
    fail("image_destination_failed")
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { fail("image_write_failed") }
  printJSON(["ok": true, "path": outputPath])
}

/// Synthetic multi-page PDF worklist generator (test fixtures only).
/// `rowsPerPage` (default 3) splits the given rows across pages so
/// multi-page ordering/page-number preservation can be tested for real.
func runGenerateWorklistPdf(args: [String]) {
  guard args.count >= 2 else { fail("usage: generate-worklist-pdf <out.pdf> <rows.json> [rowsPerPage]") }
  let outputPath = args[0]
  let rows = decodeWorklistRows(fromPath: args[1])
  let rowsPerPage = args.count >= 3 ? (Int(args[2]) ?? 3) : 3
  guard rowsPerPage > 0 else { fail("rows_per_page_must_be_positive") }

  let width: CGFloat = 1000
  let rowHeight: CGFloat = 34
  var mediaBox = CGRect(x: 0, y: 0, width: width, height: 400)
  guard let consumer = CGDataConsumer(url: URL(fileURLWithPath: outputPath) as CFURL) else { fail("pdf_consumer_failed") }
  guard let pdfContext = CGContext(consumer: consumer, mediaBox: &mediaBox, nil) else { fail("pdf_context_failed") }

  let pages = stride(from: 0, to: rows.count, by: rowsPerPage).map { Array(rows[$0..<min($0 + rowsPerPage, rows.count)]) }
  let pageList = pages.isEmpty ? [[]] : pages
  for pageRows in pageList {
    let pageHeight = 120 + Int(rowHeight) * pageRows.count
    var pageBox = CGRect(x: 0, y: 0, width: width, height: CGFloat(pageHeight))
    pdfContext.beginPage(mediaBox: &pageBox)
    pdfContext.setFillColor(CGColor(gray: 1.0, alpha: 1))
    pdfContext.fill(CGRect(x: 0, y: 0, width: width, height: CGFloat(pageHeight)))
    drawWorklistTable(context: pdfContext, rows: pageRows, height: pageHeight)
    pdfContext.endPage()
  }
  pdfContext.closePDF()
  printJSON(["ok": true, "path": outputPath, "rows": rows.count, "pages": pageList.count])
}

struct RecognizedPage {
  let pageNumber: Int
  let lines: [RecognizedLine]
  let orientationApplied: String
}

/// Shared by recognize-pdf and render-pdf-page: opens a local PDF and
/// fails safely (never guesses/attempts a password) on a missing,
/// corrupted/unreadable, encrypted, or zero-page PDF instead of
/// throwing or proceeding on bad input.
func loadPdfDocumentForReading(path: String) -> CGPDFDocument {
  guard FileManager.default.fileExists(atPath: path) else { fail("pdf_not_found") }
  let url = URL(fileURLWithPath: path)
  guard let document = CGPDFDocument(url as CFURL) else { fail("pdf_load_failed") }
  // A PDF can be "encrypted" (owner-password restricted printing/editing) yet still
  // openable with no user password — only a document that genuinely refuses to
  // unlock with an empty password is treated as requiring credentials we don't have
  // and never attempt to guess.
  if document.isEncrypted && !document.unlockWithPassword("") {
    fail("pdf_encrypted")
  }
  guard document.numberOfPages > 0 else { fail("pdf_no_pages") }
  return document
}

func rasterizePdfPage(_ page: CGPDFPage, scale: CGFloat) -> CGImage? {
  let pageRect = page.getBoxRect(.mediaBox)
  let width = max(1, Int(pageRect.width * scale))
  let height = max(1, Int(pageRect.height * scale))
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard let context = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { return nil }
  context.setFillColor(CGColor(gray: 1.0, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.scaleBy(x: scale, y: scale)
  context.translateBy(x: -pageRect.origin.x, y: -pageRect.origin.y)
  context.drawPDFPage(page)
  return context.makeImage()
}

/// Rasterizes and OCRs every page of a local PDF, in order, entirely
/// on-device. Fails safely (never guesses/attempts a password) on an
/// encrypted PDF, and fails safely on a corrupted/unreadable/zero-page
/// PDF instead of throwing.
func runRecognizePdf(args: [String]) {
  guard let path = args.first else { fail("missing_pdf_path") }
  let document = loadPdfDocumentForReading(path: path)
  let pageCount = document.numberOfPages

  var recognizedPages: [RecognizedPage] = []
  let scale: CGFloat = 2.0
  for pageNumber in 1...pageCount {
    guard let page = document.page(at: pageNumber) else { fail("pdf_page_unreadable:\(pageNumber)") }
    guard let pageImage = rasterizePdfPage(page, scale: scale) else { fail("pdf_rasterize_failed:\(pageNumber)") }
    let result = recognizeWithOrientationCorrection(image: pageImage)
    recognizedPages.append(RecognizedPage(pageNumber: pageNumber, lines: result.lines, orientationApplied: result.orientation))
  }

  let pagesJSON: [[String: Any]] = recognizedPages.map { page in
    [
      "pageNumber": page.pageNumber,
      "orientationApplied": page.orientationApplied,
      "lines": page.lines.map { line in
        [
          "text": line.text,
          "confidence": Double(line.confidence),
          "boundingBox": [
            "x": Double(line.box.origin.x),
            "y": Double(line.box.origin.y),
            "width": Double(line.box.size.width),
            "height": Double(line.box.size.height)
          ]
        ]
      }
    ]
  }
  printJSON(["ok": true, "pageCount": pageCount, "pages": pagesJSON])
}

/// Renders a single 1-indexed PDF page to a local PNG — used only by the
/// desktop app's Import Review preview panel (Phase 2 / Task P2-1) so
/// the RN can see the source page beside the extracted row before
/// correcting or approving it. Nothing here ever leaves the device.
func runRenderPdfPage(args: [String]) {
  guard args.count >= 3 else { fail("usage: render-pdf-page <pdfPath> <pageNumber> <out.png>") }
  let document = loadPdfDocumentForReading(path: args[0])
  guard let pageNumber = Int(args[1]), pageNumber >= 1, pageNumber <= document.numberOfPages else {
    fail("pdf_page_out_of_range")
  }
  guard let page = document.page(at: pageNumber) else { fail("pdf_page_unreadable:\(pageNumber)") }
  guard let image = rasterizePdfPage(page, scale: 2.0) else { fail("pdf_rasterize_failed:\(pageNumber)") }
  let outputPath = args[2]
  let url = URL(fileURLWithPath: outputPath)
  guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fail("png_destination_failed")
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { fail("png_write_failed") }
  printJSON(["ok": true, "path": outputPath])
}

/// Test-fixture-only: a genuinely password-protected one-page PDF, used
/// solely to prove `recognize-pdf` fails safely (never attempts to guess
/// or brute-force the password) rather than crashing or hanging.
func runGenerateEncryptedPdf(args: [String]) {
  guard args.count >= 2 else { fail("usage: generate-encrypted-pdf <out.pdf> <password>") }
  let outputPath = args[0]
  let password = args[1]

  let page = PDFPage()
  let document = PDFDocument()
  document.insert(page, at: 0)

  let options: [PDFDocumentWriteOption: Any] = [
    .userPasswordOption: password,
    .ownerPasswordOption: password
  ]
  guard document.write(to: URL(fileURLWithPath: outputPath), withOptions: options) else { fail("encrypted_pdf_write_failed") }
  printJSON(["ok": true, "path": outputPath])
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else { fail("usage: ocr-helper <recognize|recognize-pdf|render-pdf-page|generate-worklist|generate-worklist-pdf|convert|generate-encrypted-pdf> ...") }
let command = arguments[1]
let rest = Array(arguments.dropFirst(2))

switch command {
case "recognize":
  runRecognize(args: rest)
case "recognize-pdf":
  runRecognizePdf(args: rest)
case "render-pdf-page":
  runRenderPdfPage(args: rest)
case "generate-worklist":
  runGenerateWorklist(args: rest)
case "generate-worklist-pdf":
  runGenerateWorklistPdf(args: rest)
case "convert":
  runConvertImage(args: rest)
case "generate-encrypted-pdf":
  runGenerateEncryptedPdf(args: rest)
default:
  fail("unknown_command:\(command)")
}
