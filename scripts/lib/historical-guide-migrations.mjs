import assert from "node:assert/strict";

// Applied DEV migrations remain immutable. The first PROD application records
// these exact, reviewed variants in its ledger instead of filling old records.
export function historicalGuideMigration(version, source) {
  const replaceOnce = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `Historical migration ${version} prerequisite changed`);
    source = source.replace(before, after);
  };
  if (version === "136") replaceOnce("add column laboratory_applied boolean not null default false;", "add column laboratory_applied boolean;");
  if (version === "137") {
    replaceOnce("add column details jsonb not null default '{}'::jsonb", "add column details jsonb");
    replaceOnce(`-- Recover the already reviewed OCR values without altering the capture/original.
update public.dispatch_guides g set details=c.review_payload->'details'
from public.guide_ocr_captures c where c.guide_id=g.id and c.status='SAVED'
  and jsonb_typeof(c.review_payload->'details')='object';`, "-- Historical guide details remain NULL; no release-time recovery.");
  }
  if (version === "139") replaceOnce(`-- Recover only the element explicitly recorded by the old Excel importer.
update public.programming set casting_element=app_private.normalize_casting_element(
 substring(notes from '(?im)^Elemento a fundir:[ \\t]*([^\\r\\n]+)'))
 where app_private.normalize_casting_element(substring(notes from '(?im)^Elemento a fundir:[ \\t]*([^\\r\\n]+)')) is not null;`, "-- Historical programming casting elements remain NULL; no inference from notes.");
  return source;
}

export function migrationBody(source) {
  assert.equal((source.match(/^begin;$/gmu) ?? []).length, 1);
  assert.equal((source.match(/^commit;$/gmu) ?? []).length, 1);
  return source.replace(/^begin;$/mu, "").replace(/^commit;$/mu, "");
}
