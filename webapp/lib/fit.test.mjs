import assert from "node:assert/strict";
import test from "node:test";
import { parseWeights, scoreFit } from "./fit.ts";

test("normalizes and deduplicates keyword weights", () => {
  assert.deepEqual(parseWeights([
    { term: " Kubernetes ", weight: 20 },
    { term: "kubernetes", weight: 80 },
    { term: "SRE", weight: 10 },
    { term: "invalid", weight: 101 },
  ]), [{ term: "kubernetes", weight: 80 }, { term: "SRE", weight: 10 }]);
});

test("scores whole terms and returns the contributing keywords", () => {
  const weights = parseWeights([{ term: "SRE", weight: 75 }, { term: "AWS", weight: 25 }]);
  const result = scoreFit({ title: "Senior SRE", description: "Kubernetes on awsome cloud", score: 0.2 }, weights);
  assert.equal(result.score, 75);
  assert.deepEqual(result.matches, [{ term: "SRE", weight: 75 }]);
});

test("retains scanner score until keyword preferences exist", () => {
  assert.deepEqual(scoreFit({ title: "DevOps", score: 0.63 }, []), { score: 0.63, matches: [] });
});