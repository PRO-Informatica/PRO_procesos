import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMixtoProjectReference,
  MIXTO_PROJECT_BILLING_NAME_MISSING_ERROR,
  MIXTO_PROJECT_MISMATCH_ERROR,
  MIXTO_PROJECT_REFERENCE_MISSING_ERROR,
  mixtoProjectMismatchMessage,
  validateMixtoProjectReference,
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

test("Excel identifica el proyecto por dirección exacta y usa razón social como warning", () => {
  const reference = validateMixtoProjectReference({
    projectAddress: "9 CALLE 5A-62, ZONA 9, QUETZALTENANGO",
    workbookAddress: "9 calle 5a 62 zona 9 quetzaltenango",
    billingLegalName: "INMOBILIARIA LOS ANTURIOS, S.A.",
    invoiceRecipient: "OTRA RAZÓN SOCIAL, S.A.",
  });
  assert.match(reference.warning, /razón social receptora|destinatario de factura/i);
});

test("Excel acepta ADO con diferencias de escritura y explica la coincidencia", () => {
  const reference = validateMixtoProjectReference({
    projectId: "ado",
    projectLabel: "ADO · ADO-PRO",
    projectAddress: "1RA CALLE BOULBEARD PRINCIPAL LABOR XELA ZONA 1 LA ESPERANZA QUETZALTENANGO",
    workbookAddress: "1ra. Calle Boulebart Principal Labor Xela, Zona 1 del Municipio de la Ezperanza, Quetzaltenango",
    billingLegalName: "ADO, S.A.",
    invoiceRecipient: "ADO, S.A.",
    candidateProjects: [{
      id: "ado",
      label: "ADO · ADO-PRO",
      address: "1RA CALLE BOULBEARD PRINCIPAL LABOR XELA ZONA 1 LA ESPERANZA QUETZALTENANGO",
      billingLegalName: "ADO, S.A.",
    }],
  });

  assert.equal(reference.comparison.result, "MATCH");
  assert.match(reference.warnings.join(" "), /pequeñas diferencias de escritura/u);
  assert.match(reference.warnings.join(" "), /Dirección configurada/u);
  assert.match(reference.warnings.join(" "), /Dirección detectada/u);
});

test("Excel no elige el primer proyecto cuando hay candidatos ambiguos", () => {
  assert.throws(() => validateMixtoProjectReference({
    projectId: "project-a",
    projectLabel: "Proyecto A",
    projectAddress: "9 CALLE 5A-62 ZONA 9",
    workbookAddress: "9 CALLE 5A 62 ZONA 9",
    billingLegalName: "MISMA EMPRESA, S.A.",
    invoiceRecipient: "MISMA EMPRESA, S.A.",
    candidateProjects: [
      {
        id: "project-a",
        label: "Proyecto A",
        address: "9 CALLE 5A-62 ZONA 9",
        billingLegalName: "MISMA EMPRESA, S.A.",
      },
      {
        id: "project-b",
        label: "Proyecto B",
        address: "9 CALLE 5A 62 ZONA 9",
        billingLegalName: "MISMA EMPRESA, S.A.",
      },
    ],
  }), /más de un proyecto autorizado/u);
});

test("Excel rechaza una dirección diferente aunque la razón social coincida", () => {
  assert.throws(() => validateMixtoProjectReference({
    projectAddress: "9 CALLE 5A-62 ZONA 9",
    workbookAddress: "9 CALLE 5A-63 ZONA 9",
    billingLegalName: "INMOBILIARIA LOS ANTURIOS, S.A.",
    invoiceRecipient: "INMOBILIARIA LOS ANTURIOS, S.A.",
  }), /Dirección exacta de Obra/u);
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
