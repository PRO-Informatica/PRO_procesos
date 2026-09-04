import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMixtoProjectReference,
  MIXTO_PROJECT_BILLING_NAME_MISSING_ERROR,
  MIXTO_PROJECT_MISMATCH_ERROR,
  MIXTO_PROJECT_REFERENCE_MISSING_ERROR,
  mixtoProjectMismatchMessage,
} from "../src/features/programming/project-reference.ts";
import {
  matchesFiscalIdentity,
  normalizeBusinessIdentity,
} from "../src/lib/business-identity.ts";

const billingLegalName = "Las Campanales - Sociedad Anónima";

test("normaliza únicamente formato y abreviaciones conocidas", () => {
  const equivalentValues = [
    "Las Campanales - S.A.",
    "Las Campanales - S. A.",
    "LAS CAMPANALES - SA",
    "Las   Campanales - Sociedad Anónima",
    "Las Campanales, Sociedad, Anónima",
  ];

  for (const value of equivalentValues) {
    assert.equal(
      normalizeBusinessIdentity(value),
      normalizeBusinessIdentity(billingLegalName),
    );
    assert.doesNotThrow(() =>
      assertMixtoProjectReference(billingLegalName, value),
    );
  }
});

test("rechaza nombres de proyectos distintos sin fuzzy matching", () => {
  const differentValues = [
    "Otro Proyecto - SA",
    "Las Campanales Norte - SA",
    "Las Campanales Sur - SA",
    "Campanales II - SA",
  ];

  for (const value of differentValues) {
    assert.throws(
      () => assertMixtoProjectReference(billingLegalName, value),
      { message: mixtoProjectMismatchMessage(billingLegalName, value) },
    );
  }
});

test("rechaza destinatario vacío o campo no identificado", () => {
  assert.throws(
    () => assertMixtoProjectReference(billingLegalName, ""),
    { message: MIXTO_PROJECT_REFERENCE_MISSING_ERROR },
  );
});

test("rechaza un proyecto seleccionado sin Razón Social de facturación", () => {
  assert.throws(
    () => assertMixtoProjectReference("", "Las Campanales - SA"),
    { message: MIXTO_PROJECT_BILLING_NAME_MISSING_ERROR },
  );
});

test("usa solo la Razón Social del proyecto seleccionado aunque el usuario tenga otros", () => {
  const selectedBillingLegalName = "Proyecto A - SA";
  const workbookProject = "Proyecto B - S.A.";
  assert.throws(
    () => assertMixtoProjectReference(selectedBillingLegalName, workbookProject),
    {
      message: mixtoProjectMismatchMessage(
        selectedBillingLegalName,
        workbookProject,
      ),
    },
  );
});

test("el error de proyecto distinto informa el valor esperado y el encontrado", () => {
  const expected = "INMOBILIARIA LOS ANTURIOS, S.A.";
  const found = "LAS CAMPANELAS, S. A.";
  const message = mixtoProjectMismatchMessage(expected, found);

  assert.match(message, new RegExp(MIXTO_PROJECT_MISMATCH_ERROR, "i"));
  assert.match(message, /INMOBILIARIA LOS ANTURIOS, S\.A\./);
  assert.match(message, /LAS CAMPANELAS, S\. A\./);
});

test("la identidad fiscal rechaza una factura de otro proyecto", () => {
  assert.equal(matchesFiscalIdentity({
    expectedName: "INMOBILIARIA LOS ANTURIOS, S.A.",
    actualName: "INMOBILIARIA LOS ANTURIOS, SOCIEDAD ANÓNIMA",
    expectedTaxId: "111871344",
    actualTaxId: "1118-71344",
  }), true);
  assert.equal(matchesFiscalIdentity({
    expectedName: "INMOBILIARIA LOS ANTURIOS, S.A.",
    actualName: "OTRO PROYECTO, S.A.",
  }), false);
});
