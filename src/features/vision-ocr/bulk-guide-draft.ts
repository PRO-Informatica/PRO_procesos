import type { GuideOcrDraft } from "./guide-draft";
import type { VisionTemplateType } from "./template-classifier";

// A changed classification must select that format's parsed data, never just
// relabel fields belonging to a different supplier. This does not run OCR.
export function bulkGuideDraft(reading: { draft: GuideOcrDraft; variants?: Partial<Record<VisionTemplateType, GuideOcrDraft>> }, type: VisionTemplateType): GuideOcrDraft | null {
  const draft = reading.variants?.[type] ?? (reading.draft.details.documentType === type ? reading.draft : null);
  return draft?.details.documentType === type ? { ...draft, details: { ...draft.details } } : null;
}
