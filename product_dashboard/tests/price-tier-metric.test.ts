import assert from "node:assert/strict"
import test from "node:test"

import { resolvePriceTierMetric } from "../lib/price-tier-metric.ts"

test("code reader keeps a units selection", () => {
  assert.equal(resolvePriceTierMetric(true, "units"), "units")
})

test("code reader keeps a revenue selection", () => {
  assert.equal(resolvePriceTierMetric(true, "revenue"), "revenue")
})

test("non-code categories force revenue even when units is selected", () => {
  assert.equal(resolvePriceTierMetric(false, "units"), "revenue")
  assert.equal(resolvePriceTierMetric(false, "revenue"), "revenue")
})
