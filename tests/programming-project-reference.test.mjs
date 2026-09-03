import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMixtoProjectReference,
  MIXTO_PROJECT_CODE_MISSING_ERROR,
  MIXTO_PROJECT_MISMATCH_ERROR,
  MIXTO_PROJECT_REFERENCE_MISSING_ERROR,
  mixtoProjectMismatchMessage,
  normalizeProjectReference,
} from "../src/features/programming/project-reference.ts";

const projectCode = "Las Campanales - SA";

test("normaliza únicamente formato y abreviaciones conocidas", () => {
  const equivalentValues = [
    "Las Campanales - SA",
    "LAS CAMPANALES - SA",
    "Las Campanales - S.A.",
    "Las Campanales - S. A.",
    "Las Campanales - Sociedad Anónima",
    "Las   Campanales - Sociedad Anónima",
  ];

  for (const value of equivalentValues) {
    assert.equal(
      normalizeProjectReference(value),
      normalizeProjectReference(projectCode),
    );
    assert.doesNotThrow(() => assertMixtoProjectReference(projectCode, value));
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
      () => assertMixtoProjectReference(projectCode, value),
      { message: mixtoProjectMismatchMessage(projectCode, value) },
    );
  }
});

test("rechaza destinatario vacío o campo no identificado", () => {
  assert.throws(
    () => assertMixtoProjectReference(projectCode, ""),
    { message: MIXTO_PROJECT_REFERENCE_MISSING_ERROR },
  );
});

test("rechaza un proyecto seleccionado sin código", () => {
  assert.throws(
    () => assertMixtoProjectReference("", "Las Campanales - SA"),
    { message: MIXTO_PROJECT_CODE_MISSING_ERROR },
  );
});

test("usa solo el código del proyecto seleccionado aunque el usuario tenga otros", () => {
  const selectedProjectCode = "Proyecto A - SA";
  const workbookProject = "Proyecto B - S.A.";
  assert.throws(
    () => assertMixtoProjectReference(selectedProjectCode, workbookProject),
    { message: mixtoProjectMismatchMessage(selectedProjectCode, workbookProject) },
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
