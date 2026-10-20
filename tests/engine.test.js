import { test } from "node:test";
import assert from "node:assert/strict";
import {
  differential,
  frameFeatures,
  summarize,
  comparisonRows,
  csvExport,
  legacyScore,
} from "../src/engine.js";
test("relative engine preserves raw differences and clips only the display", () => {
  assert.deepEqual(differential(1656, 1200), {
    percent: 38,
    rawPercent: 38,
    clipped: false,
  });
  assert.equal(differential(3800, 1200).percent, 100);
  assert.ok(differential(3800, 1200).rawPercent > 216);
  assert.equal(differential(0, 100).percent, -100);
  assert.equal(differential(100, 100).percent, 0);
  for (const base of [0, -1, NaN, Infinity])
    assert.throws(() => differential(3, base));
});
test("known spectral peak yields expected frequency, RMS and harmonic ratio", () => {
  const wave = Float32Array.from(
    { length: 2048 },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * i * 8) / 2048),
  );
  const db = new Float32Array(1024).fill(-Infinity);
  db[8] = 0;
  db[16] = -6.0206;
  const f = frameFeatures(wave, db, 48000);
  assert.ok(Math.abs(f.rms - Math.sqrt(0.125)) < 1e-5);
  assert.equal(f.fundamental, 187.5);
  assert.ok(Math.abs(f.harmonicRatio - 0.5) < 1e-5);
  assert.ok(f.centroid > 187.5 && f.centroid < 375);
  assert.ok(f.crest > 1.41 && f.crest < 1.42);
});
test("silence does not manufacture a measurement", () => {
  const f = frameFeatures(
    new Float32Array(2048),
    new Float32Array(1024).fill(-Infinity),
    48000,
  );
  assert.equal(f.rms, 0);
  assert.equal(f.harmonicRatio, null);
  assert.throws(() => summarize(Array(20).fill(f), "texture"));
});
test("exports preserve baseline and unavailable telemetry", () => {
  const r = {
    label: 'Cotton, "white"',
    type: "texture",
    mode: "relative",
    demo: false,
    features: { value: 1656, centroid: 1656 },
    baseline: {
      features: { value: 1200, centroid: 1200 },
      label: "Skin",
      imu: { samples: 10 },
    },
    imu: { contactLagMs: null },
  };
  assert.equal(comparisonRows(r)[0].relativePercent, 38);
  assert.ok(csvExport(r).includes('Cotton, ""white""'));
  assert.ok(csvExport(r).includes("Baseline IMU metadata"));
  assert.equal(legacyScore("texture", 1), 1);
  assert.equal(legacyScore("texture", 100000), 10);
});
