export function normalizeAddressIdentity(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type AddressComparisonResult =
  | "MATCH"
  | "REQUIRES_REVIEW"
  | "NO_MATCH";

export type AddressMatchMethod =
  | "EXACT"
  | "CANONICAL"
  | "TOLERANT"
  | "CRITICAL_CONFLICT"
  | "INSUFFICIENT_SIMILARITY";

export type AddressComparison = {
  result: AddressComparisonResult;
  matchMethod: AddressMatchMethod;
  confidence: number;
  criticalComponentsMatch: boolean;
  warnings: string[];
  differences: string[];
  normalizedExpected: string;
  normalizedActual: string;
};

export type AddressCandidate = {
  id: string;
  address: string | null | undefined;
};

export type AddressCandidateResolution = {
  result: AddressComparisonResult;
  selectedId: string | null;
  candidates: Array<{
    id: string;
    comparison: AddressComparison;
  }>;
};

const ADMINISTRATIVE_TOKENS = new Set(["DE", "DEL", "MUNICIPIO"]);
const ROUTE_TOKENS = new Set([
  "AVENIDA",
  "BOULEVARD",
  "CALLE",
  "CARRETERA",
  "KM",
  "RUTA",
]);

const TOKEN_ALIASES: Record<string, string> = {
  AV: "AVENIDA",
  AVE: "AVENIDA",
  BLVD: "BOULEVARD",
  BOULEBARD: "BOULEVARD",
  BOULEBART: "BOULEVARD",
  BOULBEARD: "BOULEVARD",
  BOULEVART: "BOULEVARD",
  BULEVAR: "BOULEVARD",
  CARR: "CARRETERA",
  CARRET: "CARRETERA",
  KILOMETRO: "KM",
  PRIMERA: "1RA",
  PRIMERO: "1RO",
  SEGUNDA: "2DA",
  SEGUNDO: "2DO",
  TERCERA: "3RA",
  TERCERO: "3RO",
  CUARTA: "4TA",
  CUARTO: "4TO",
  QUINTA: "5TA",
  QUINTO: "5TO",
};

// Calibrated by the representative cases in address-identity.test.mjs:
// minor spelling variants remain above 0.90, while missing descriptive
// segments fall into review. Critical numeric conflicts bypass scoring.
const AUTO_MATCH_THRESHOLD = 0.9;
const REVIEW_THRESHOLD = 0.76;
const AMBIGUITY_MARGIN = 0.04;

function canonicalAddressTokens(value: string | null | undefined) {
  const tokens = normalizeAddressIdentity(value).split(" ").filter(Boolean);
  return tokens
    .map((token, index) => {
      const alias = TOKEN_ALIASES[token];
      if (alias) return alias;
      if (/^\d+A$/u.test(token) && ROUTE_TOKENS.has(TOKEN_ALIASES[tokens[index + 1]] ?? tokens[index + 1])) {
        return `${token.slice(0, -1)}RA`;
      }
      return token;
    })
    .filter((token) => !ADMINISTRATIVE_TOKENS.has(token));
}

function sorted(values: string[]) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameValues(left: string[], right: string[]) {
  const orderedLeft = sorted(left);
  const orderedRight = sorted(right);
  return orderedLeft.length === orderedRight.length &&
    orderedLeft.every((value, index) => value === orderedRight[index]);
}

function criticalSignature(tokens: string[]) {
  const numeric = tokens.filter((token) => /\d/u.test(token));
  const routes = tokens.filter((token) => ROUTE_TOKENS.has(token));
  const labeled: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (["ZONA", "LOTE", "CASA", "NIVEL", "EDIFICIO", "KM"].includes(token)) {
      const value = tokens[index + 1];
      if (value && /\d/u.test(value)) labeled.push(`${token}:${value}`);
    }
    if (["CALLE", "AVENIDA"].includes(token)) {
      const value = tokens[index - 1];
      if (value && /\d/u.test(value)) labeled.push(`${token}:${value}`);
    }
  }
  return { numeric, routes, labeled };
}

function editDistance(left: string, right: string) {
  if (left === right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function tokenSimilarity(left: string, right: string) {
  if (left === right) return 1;
  if (/\d/u.test(left) || /\d/u.test(right)) return 0;
  const longest = Math.max(left.length, right.length);
  const allowedDistance = longest >= 8 ? 2 : longest >= 5 ? 1 : 0;
  if (!allowedDistance) return 0;
  const distance = editDistance(left, right);
  return distance <= allowedDistance ? 1 - distance / longest : 0;
}

function tokenWeight(token: string) {
  if (ROUTE_TOKENS.has(token) || token === "ZONA") return 1.35;
  if (token.length >= 8) return 1.2;
  if (token === "LA" || token === "EL") return 0.35;
  return 1;
}

function textualScore(expected: string[], actual: string[]) {
  const available = new Set(actual.map((_, index) => index));
  let matchedWeight = 0;
  const fuzzyPairs: string[] = [];
  const missingExpected: string[] = [];

  for (const expectedToken of expected) {
    let bestIndex = -1;
    let bestSimilarity = 0;
    for (const actualIndex of available) {
      const similarity = tokenSimilarity(expectedToken, actual[actualIndex]);
      if (similarity > bestSimilarity) {
        bestIndex = actualIndex;
        bestSimilarity = similarity;
      }
    }
    if (bestIndex < 0 || bestSimilarity === 0) {
      missingExpected.push(expectedToken);
      continue;
    }
    available.delete(bestIndex);
    matchedWeight += Math.min(tokenWeight(expectedToken), tokenWeight(actual[bestIndex])) * bestSimilarity;
    if (expectedToken !== actual[bestIndex]) {
      fuzzyPairs.push(`${expectedToken} ≈ ${actual[bestIndex]}`);
    }
  }

  const expectedWeight = expected.reduce((total, token) => total + tokenWeight(token), 0);
  const actualWeight = actual.reduce((total, token) => total + tokenWeight(token), 0);
  const tokenCoverage = expectedWeight + actualWeight > 0
    ? (2 * matchedWeight) / (expectedWeight + actualWeight)
    : 0;
  const sequenceRows = Array.from(
    { length: expected.length + 1 },
    () => Array<number>(actual.length + 1).fill(0),
  );
  for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
    for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
      sequenceRows[expectedIndex][actualIndex] =
        tokenSimilarity(expected[expectedIndex - 1], actual[actualIndex - 1]) > 0
          ? sequenceRows[expectedIndex - 1][actualIndex - 1] + 1
          : Math.max(
              sequenceRows[expectedIndex - 1][actualIndex],
              sequenceRows[expectedIndex][actualIndex - 1],
            );
    }
  }
  const shortestLength = Math.min(expected.length, actual.length);
  const sequenceCoverage = shortestLength
    ? sequenceRows[expected.length][actual.length] / shortestLength
    : 0;
  const score = tokenCoverage * (0.5 + 0.5 * sequenceCoverage);
  return {
    score,
    sequenceCoverage,
    fuzzyPairs,
    missingExpected,
    extraActual: [...available].map((index) => actual[index]),
  };
}

function roundConfidence(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

export function compareAddresses(
  expected: string | null | undefined,
  actual: string | null | undefined,
): AddressComparison {
  const normalizedExpected = normalizeAddressIdentity(expected);
  const normalizedActual = normalizeAddressIdentity(actual);
  const base = { normalizedExpected, normalizedActual };
  if (!normalizedExpected || !normalizedActual) {
    return {
      ...base,
      result: "NO_MATCH",
      matchMethod: "INSUFFICIENT_SIMILARITY",
      confidence: 0,
      criticalComponentsMatch: false,
      warnings: [],
      differences: ["Una de las direcciones está vacía."],
    };
  }
  if (normalizedExpected === normalizedActual) {
    return {
      ...base,
      result: "MATCH",
      matchMethod: "EXACT",
      confidence: 1,
      criticalComponentsMatch: true,
      warnings: [],
      differences: [],
    };
  }

  const expectedTokens = canonicalAddressTokens(expected);
  const actualTokens = canonicalAddressTokens(actual);
  const expectedCritical = criticalSignature(expectedTokens);
  const actualCritical = criticalSignature(actualTokens);
  const criticalComponentsMatch =
    sameValues(expectedCritical.numeric, actualCritical.numeric) &&
    sameValues(expectedCritical.routes, actualCritical.routes) &&
    sameValues(expectedCritical.labeled, actualCritical.labeled);
  if (!criticalComponentsMatch) {
    return {
      ...base,
      result: "NO_MATCH",
      matchMethod: "CRITICAL_CONFLICT",
      confidence: 0,
      criticalComponentsMatch: false,
      warnings: [],
      differences: ["Los números o componentes críticos de la dirección no coinciden."],
    };
  }
  if (expectedTokens.join(" ") === actualTokens.join(" ")) {
    return {
      ...base,
      result: "MATCH",
      matchMethod: "CANONICAL",
      confidence: 0.98,
      criticalComponentsMatch: true,
      warnings: ["Dirección reconocida mediante abreviaciones o redacción equivalente."],
      differences: [],
    };
  }

  const textual = textualScore(expectedTokens, actualTokens);
  const confidence = roundConfidence(textual.score);
  const differences = [
    textual.fuzzyPairs.length ? `Variaciones ortográficas: ${textual.fuzzyPairs.join(", ")}.` : null,
    textual.missingExpected.length ? `No se reconoció en el archivo: ${textual.missingExpected.join(", ")}.` : null,
    textual.extraActual.length ? `Texto adicional detectado: ${textual.extraActual.join(", ")}.` : null,
    textual.sequenceCoverage < 0.85 ? "El orden de varios componentes es diferente." : null,
  ].filter((value): value is string => Boolean(value));
  const enoughContext = Math.min(expectedTokens.length, actualTokens.length) >= 4;
  if (enoughContext && confidence >= AUTO_MATCH_THRESHOLD) {
    return {
      ...base,
      result: "MATCH",
      matchMethod: "TOLERANT",
      confidence,
      criticalComponentsMatch: true,
      warnings: ["Dirección reconocida con pequeñas diferencias de escritura."],
      differences,
    };
  }
  if (enoughContext && confidence >= REVIEW_THRESHOLD) {
    return {
      ...base,
      result: "REQUIRES_REVIEW",
      matchMethod: "TOLERANT",
      confidence,
      criticalComponentsMatch: true,
      warnings: ["La dirección es similar, pero necesita revisión antes de asociarse."],
      differences,
    };
  }
  return {
    ...base,
    result: "NO_MATCH",
    matchMethod: "INSUFFICIENT_SIMILARITY",
    confidence,
    criticalComponentsMatch: true,
    warnings: [],
    differences: differences.length
      ? differences
      : ["La cobertura textual de la dirección es insuficiente."],
  };
}

export function resolveAddressCandidates(
  actual: string | null | undefined,
  candidates: AddressCandidate[],
): AddressCandidateResolution {
  const ranked = candidates
    .map((candidate) => ({
      id: candidate.id,
      comparison: compareAddresses(candidate.address, actual),
    }))
    .filter(({ comparison }) => comparison.result !== "NO_MATCH")
    .sort((left, right) => right.comparison.confidence - left.comparison.confidence);
  const matches = ranked.filter(({ comparison }) => comparison.result === "MATCH");
  if (matches.length) {
    const first = matches[0];
    const second = matches[1];
    if (second && first.comparison.confidence - second.comparison.confidence <= AMBIGUITY_MARGIN) {
      return { result: "REQUIRES_REVIEW", selectedId: null, candidates: ranked };
    }
    return { result: "MATCH", selectedId: first.id, candidates: ranked };
  }
  return {
    result: ranked.length ? "REQUIRES_REVIEW" : "NO_MATCH",
    selectedId: null,
    candidates: ranked,
  };
}

export function addressesMatch(
  expected: string | null | undefined,
  actual: string | null | undefined,
) {
  return compareAddresses(expected, actual).result === "MATCH";
}
