import assert from "node:assert/strict";
import test from "node:test";
import { validateProjectAddressInput } from "../src/features/platform/companies/project-address-input.ts";

test("un proyecto puede conservar una dirección o registrar varias", () => {
  assert.equal(validateProjectAddressInput("9 CALLE 5A-62 ZONA 9", []), null);
  assert.equal(validateProjectAddressInput("9 CALLE 5A-62 ZONA 9", ["1 CALLE ZONA 1", "2 CALLE ZONA 2"]), null);
});

test("una dirección adicional vacía o inválida no se guarda silenciosamente", () => {
  assert.match(validateProjectAddressInput("9 CALLE 5A-62 ZONA 9", [""]), /Cada dirección/u);
  assert.match(validateProjectAddressInput("", ["1 CALLE ZONA 1"]), /Cada dirección/u);
  assert.match(validateProjectAddressInput("9 CALLE 5A-62 ZONA 9", ["A".repeat(301)]), /300/u);
});

test("rechaza direcciones repetidas aunque cambien mayúsculas, puntuación o acentos", () => {
  assert.match(validateProjectAddressInput("ÁLDEA BETHANIA", ["aldea bethania"]), /repetidas/u);
  assert.match(validateProjectAddressInput("CALLE 1 ZONA 1", ["CALLE 2, ZONA 2", "calle 2 zona 2"]), /repetidas/u);
});
