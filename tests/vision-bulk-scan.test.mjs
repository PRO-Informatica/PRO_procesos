import assert from 'node:assert/strict';
import test from 'node:test';
import { bulkGuideDraft } from '../src/features/vision-ocr/bulk-guide-draft.ts';

const normal = { guideNumber: '6015-000543', details: { documentType: 'DISPATCH_GUIDE', orderNumber: '672' }, lines: [{ quantity: '6.5' }] };
const mixto = { guideNumber: '349463', details: { documentType: 'MIXTO_OPERATION', orderNumber: '88' }, lines: [{ quantity: '14' }] };
const panexus = { guideNumber: '12082', details: { documentType: 'PANEXUS_OPERATION', orderNumber: '88' }, lines: [{ quantity: '14' }] };

test('confirming or correcting a bulk type chooses its cached supplier fields without changing other pages', () => {
  const reading = { draft: normal, variants: { DISPATCH_GUIDE: normal, MIXTO_OPERATION: mixto, PANEXUS_OPERATION: panexus } };
  for (const expected of [mixto, panexus, normal]) {
    const result = bulkGuideDraft(reading, expected.details.documentType);
    assert.deepEqual(result, expected);
    result.details.orderNumber = 'corrected by resident';
    assert.equal(expected.details.orderNumber, expected === normal ? '672' : '88');
  }
  assert.equal(reading.draft.guideNumber, '6015-000543');
});

test('a missing supplier variant cannot reuse another format with a new label', () => {
  assert.equal(bulkGuideDraft({ draft: normal }, 'PANEXUS_OPERATION'), null);
  assert.equal(bulkGuideDraft({ draft: normal, variants: { MIXTO_OPERATION: normal } }, 'MIXTO_OPERATION'), null);
  assert.deepEqual(bulkGuideDraft({ draft: normal }, 'DISPATCH_GUIDE'), normal);
});
