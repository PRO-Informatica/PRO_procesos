import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const motionPage = await read("../src/components/motion/motion-page.tsx");
const motionSection = await read("../src/components/motion/motion-section.tsx");
const motionCard = await read("../src/components/motion/motion-card.tsx");
const motionList = await read("../src/components/motion/motion-list.tsx");
const motionSwap = await read("../src/components/motion/motion-swap.tsx");
const motionVariants = await read("../src/lib/motion/variants.ts");
const motionTokens = await read("../src/lib/motion/tokens.ts");
const button = await read("../src/components/ui/button.tsx");
const iconButton = await read("../src/components/ui/icon-button.tsx");
const emptyState = await read("../src/components/feedback/empty-state.tsx");
const programming = await read("../src/features/programming/components/programming-workspace.tsx");
const universalBatches = await read("../src/features/batches/components/universal-batches-workspace.tsx");
const universalInvoices = await read("../src/features/invoices/universal/components/universal-invoices-workspace.tsx");
const globals = await read("../src/app/globals.css");

test("la aparición de contenido usa reveal por viewport sin cascadas", () => {
  for (const source of [motionPage, motionSection, motionCard, motionList, motionSwap, button, iconButton, emptyState]) {
    assert.match(source, /useReducedMotion/u);
  }
  assert.match(motionPage, /disableMotion \|\| reduceMotion/u);
  assert.doesNotMatch(motionVariants, /staggerChildren|delayChildren/u);
  assert.doesNotMatch(motionTokens, /stagger/u);
  assert.match(motionTokens, /route: 0\.22/u);
  assert.match(motionTokens, /content: 0\.22/u);
  for (const source of [motionSection, motionList]) {
    assert.match(source, /whileInView="visible"/u);
    assert.match(source, /once: true/u);
    assert.doesNotMatch(source, /delay:/u);
  }
  assert.doesNotMatch(motionList, /function MotionItem[\s\S]*?<motion\./u);
  assert.match(motionSwap, /AnimatePresence mode="wait" initial=\{false\}/u);
  assert.match(motionSwap, /panelTransition/u);
});

test("las vistas universales revelan bloques completos y no elementos por índice", () => {
  assert.doesNotMatch(universalBatches, /Math\.min\(index \*|delay:/u);
  assert.match(universalBatches, /key=\{selectedDetail\.id\}/u);
  assert.match(universalBatches, /variants=\{panelTransition\}/u);
  assert.doesNotMatch(universalInvoices, /<motion\.article layout/u);
  assert.match(universalInvoices, /key="invoice-results"/u);
});

test("los controles segmentados de Programación comunican su selección", () => {
  assert.match(programming, /aria-pressed=\{scope === "active"\}/u);
  assert.match(programming, /aria-pressed=\{scope === "history"\}/u);
  assert.match(programming, /aria-pressed=\{view === "calendar"\}/u);
  assert.match(programming, /aria-pressed=\{view === "kanban"\}/u);
});

test("Lotes Universal muestra estructura skeleton sin alterar la carga", () => {
  assert.match(universalBatches, /import \{ SkeletonBlock \}/u);
  assert.match(universalBatches, /Cargando detalle del lote/u);
  assert.match(universalBatches, /aria-busy="true"/u);
  assert.match(universalBatches, /loadCore\(next\)/u);
});

test("los temas y controles conservan feedback visual compartido", () => {
  assert.match(globals, /color-scheme: light/u);
  assert.match(globals, /color-scheme: dark/u);
  assert.match(globals, /\.form-input:hover:not\(:disabled\)/u);
  assert.match(globals, /\.success-button:active:not\(:disabled\)/u);
});
