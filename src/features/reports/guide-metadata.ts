import { CASTING_ELEMENTS, normalizeCastingElement } from "../dispatches/casting-elements.ts";

type GuideMetadata = { casting_element?: unknown; laboratory_applied?: unknown; details?: unknown };

export function guideReportMetadata(guides: GuideMetadata[], programmingElement?: unknown) {
  const fallback = normalizeCastingElement(typeof programmingElement === "string" ? programmingElement : null);
  const castingElements = [...new Set(guides.map((guide) => normalizeCastingElement(typeof guide.casting_element === "string" ? guide.casting_element : null) ?? fallback).filter((value) => value !== null))];
  if (!guides.length && fallback) castingElements.push(fallback);
  const trucks = [...new Set(guides.flatMap((guide) => {
    const details = guide.details && typeof guide.details === "object" && !Array.isArray(guide.details) ? guide.details as Record<string, unknown> : {};
    return typeof details.truck === "string" && details.truck.trim() ? [details.truck.trim()] : [];
  }))];
  const laboratoryCount = guides.filter((guide) => guide.laboratory_applied === true).length;
  const unknownLaboratoryCount = guides.filter((guide) => typeof guide.laboratory_applied !== "boolean").length;
  const laboratoryLabel = !guides.length ? "Sin guías" : unknownLaboratoryCount === guides.length ? "Sin registrar"
    : laboratoryCount ? `Sí (${laboratoryCount} de ${guides.length} guías${unknownLaboratoryCount ? `; ${unknownLaboratoryCount} sin registrar` : ""})`
    : unknownLaboratoryCount ? `No en ${guides.length - unknownLaboratoryCount} guía(s); ${unknownLaboratoryCount} sin registrar` : "No";
  return {
    castingElements,
    castingElementLabel: castingElements.map((element) => CASTING_ELEMENTS[element]).join(", ") || "Sin registrar",
    trucks,
    laboratoryLabel,
  };
}
