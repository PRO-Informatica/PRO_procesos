import assert from "node:assert/strict";
import test from "node:test";

import {
  addressesMatch,
  compareAddresses,
  resolveAddressCandidates,
} from "../src/lib/address-identity.ts";

const adoConfigured =
  "1RA CALLE BOULBEARD PRINCIPAL LABOR XELA ZONA 1 LA ESPERANZA QUETZALTENANGO";
const adoWorkbook =
  "1ra. Calle Boulebart Principal Labor Xela, Zona 1 del Municipio de la Ezperanza, Quetzaltenango";

test("acepta el caso ADO mediante tolerancia ortográfica controlada", () => {
  const comparison = compareAddresses(adoConfigured, adoWorkbook);

  assert.equal(comparison.result, "MATCH");
  assert.equal(comparison.matchMethod, "TOLERANT");
  assert.equal(comparison.criticalComponentsMatch, true);
  assert.ok(comparison.confidence >= 0.9);
  assert.match(comparison.differences.join(" "), /ESPERANZA ≈ EZPERANZA/u);
  assert.equal(addressesMatch(adoConfigured, adoWorkbook), true);
});

test("normaliza ordinales, vías conocidas y texto administrativo", () => {
  const comparison = compareAddresses(
    "PRIMERA CALLE BULEVAR PRINCIPAL ZONA 1 QUETZALTENANGO",
    "1A CALLE BLVD. PRINCIPAL, ZONA 1 DEL MUNICIPIO DE QUETZALTENANGO",
  );

  assert.equal(comparison.result, "MATCH");
  assert.equal(comparison.matchMethod, "CANONICAL");
});

test("una contradicción de zona nunca se compensa con similitud textual", () => {
  const comparison = compareAddresses(
    "1RA CALLE BOULEVARD PRINCIPAL ZONA 1 QUETZALTENANGO",
    "1RA CALLE BOULEVARD PRINCIPAL ZONA 10 QUETZALTENANGO",
  );

  assert.equal(comparison.result, "NO_MATCH");
  assert.equal(comparison.matchMethod, "CRITICAL_CONFLICT");
  assert.equal(comparison.criticalComponentsMatch, false);
});

test("no confunde primera calle con calle once", () => {
  assert.equal(
    compareAddresses(
      "1RA CALLE PRINCIPAL ZONA 1 QUETZALTENANGO",
      "11 CALLE PRINCIPAL ZONA 1 QUETZALTENANGO",
    ).result,
    "NO_MATCH",
  );
});

test("los identificadores de lote y casa deben coincidir estrictamente", () => {
  assert.equal(
    compareAddresses(
      "CALLE PRINCIPAL LOTE 2 CASA 18 ZONA 4",
      "CALLE PRINCIPAL LOTE 3 CASA 18 ZONA 4",
    ).matchMethod,
    "CRITICAL_CONFLICT",
  );
});

test("una dirección parcialmente cubierta requiere revisión y no se acepta sola", () => {
  const comparison = compareAddresses(
    "1RA CALLE BOULEVARD PRINCIPAL LABOR XELA ZONA 1 ESPERANZA QUETZALTENANGO",
    "1RA CALLE BOULEVARD ZONA 1 ESPERANZA QUETZALTENANGO",
  );

  assert.equal(comparison.result, "REQUIRES_REVIEW");
  assert.ok(comparison.confidence >= 0.76 && comparison.confidence < 0.9);
});

test("texto diferente con los mismos números no produce un match automático", () => {
  const comparison = compareAddresses(
    "1RA CALLE BOULEVARD PRINCIPAL LABOR XELA ZONA 1 QUETZALTENANGO",
    "1RA CALLE RESIDENCIAL LOS PINOS SECTOR NORTE ZONA 1 GUATEMALA",
  );

  assert.equal(comparison.result, "NO_MATCH");
});

test("dos proyectos con scores cercanos se consideran ambiguos", () => {
  const resolution = resolveAddressCandidates("9 CALLE 5A-62 ZONA 9", [
    { id: "project-a", address: "9 CALLE 5A 62 ZONA 9" },
    { id: "project-b", address: "9 CALLE 5A-62, ZONA 9" },
  ]);

  assert.equal(resolution.result, "REQUIRES_REVIEW");
  assert.equal(resolution.selectedId, null);
  assert.equal(resolution.candidates.length, 2);
});

test("un candidato claramente superior puede seleccionarse", () => {
  const resolution = resolveAddressCandidates(adoWorkbook, [
    { id: "ado", address: adoConfigured },
    {
      id: "other",
      address: "1RA CALLE BOULEVARD PRINCIPAL ZONA 1 ESPERANZA QUETZALTENANGO",
    },
  ]);

  assert.equal(resolution.result, "MATCH");
  assert.equal(resolution.selectedId, "ado");
});
