export const TYPES = {
  texture: {
    name: "Texture",
    low: "Smoother",
    high: "Rougher",
    verb: "Slide",
    instruction:
      "Gently slide the case near your microphone across the surface at least 6 times.",
    feature: "Spectral centroid",
    unit: "Hz",
    anchors: ["Window glass", "Copy paper", "P40 sandpaper"],
  },
  hardness: {
    name: "Hardness",
    low: "Softer response",
    high: "Harder response",
    verb: "Tap",
    instruction:
      "Gently tap the case near your microphone against the surface 5 times.",
    feature: "Spectral centroid × crest factor",
    unit: "index",
    anchors: ["Soft rubber", "Window glass", "Diamond (conceptual)"],
  },
  density: {
    name: "Density",
    low: "Lower response",
    high: "Higher response",
    verb: "Hold",
    instruction:
      "Rest the case near your microphone on the surface for 8 seconds while it vibrates.",
    feature: "Second / fundamental harmonic",
    unit: "ratio",
    anchors: ["Styrofoam", "ABS plastic", "Steel"],
  },
};
export const BASELINE_KEY = "TouchGPT_v6_baseline";
export function differential(test, base) {
  if (
    !Number.isFinite(base) ||
    base <= 1e-9 ||
    !Number.isFinite(test) ||
    test < 0
  )
    throw new Error(
      "The reference signal is too weak. Please calibrate again.",
    );
  const raw = ((test - base) / base) * 100;
  return {
    percent: Math.max(-100, Math.min(100, raw)),
    rawPercent: raw,
    clipped: Math.abs(raw) > 100,
  };
}
export function frameFeatures(wave, db, sampleRate) {
  let sum = 0,
    peak = 0,
    crossings = 0;
  for (let i = 0; i < wave.length; i++) {
    sum += wave[i] ** 2;
    peak = Math.max(peak, Math.abs(wave[i]));
    if (i && wave[i] * wave[i - 1] < 0) crossings++;
  }
  const rms = Math.sqrt(sum / wave.length),
    step = sampleRate / (db.length * 2);
  const powers = Array.from(db, (x) =>
    Number.isFinite(x) ? 10 ** (x / 10) : 0,
  );
  let total = 0,
    weighted = 0,
    high = 0;
  powers.forEach((p, i) => {
    total += p;
    weighted += p * i * step;
    if (i * step > 3000) high += p;
  });
  let cumulative = 0,
    rolloff = 0;
  for (let i = 0; i < powers.length; i++) {
    cumulative += powers[i];
    if (cumulative >= total * 0.85) {
      rolloff = i * step;
      break;
    }
  }
  let fundamentalIndex = Math.max(1, Math.ceil(100 / step));
  for (
    let i = fundamentalIndex;
    i < Math.min(powers.length, Math.ceil(300 / step));
    i++
  )
    if (powers[i] > powers[fundamentalIndex]) fundamentalIndex = i;
  const band = (index) =>
    powers.slice(Math.max(0, index - 1), index + 2).reduce((a, b) => a + b, 0);
  const baseEnergy = band(fundamentalIndex);
  return {
    rms,
    peak,
    centroid: total ? weighted / total : 0,
    crest: rms ? peak / rms : 0,
    zcr: crossings / wave.length,
    rolloff,
    highRatio: total ? high / total : 0,
    fundamental: fundamentalIndex * step,
    harmonicRatio:
      baseEnergy > 1e-14
        ? Math.sqrt(band(fundamentalIndex * 2) / baseEnergy)
        : null,
  };
}
export function summarize(frames, type) {
  const active = frames.filter((f) => f.rms > 0.0002);
  if (active.length < 10)
    throw new Error(
      "Not enough sound was detected. Move closer to the microphone and try again.",
    );
  const features = {};
  for (const key of Object.keys(active[0])) {
    const values = active.map((f) => f[key]).filter(Number.isFinite);
    features[key] = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
  }
  features.value =
    type === "texture"
      ? features.centroid
      : type === "hardness"
        ? features.centroid * features.crest
        : features.harmonicRatio;
  if (!Number.isFinite(features.value) || features.value <= 1e-9)
    throw new Error("Signal is too weak for a comparison. Try again.");
  features.clippingFraction =
    frames.filter((f) => f.peak >= 0.99).length / frames.length;
  return features;
}
export function legacyScore(type, value) {
  const range =
    type === "texture"
      ? [300, 7000]
      : type === "hardness"
        ? [1000, 40000]
        : [0.02, 2];
  return Math.round(
    Math.max(
      1,
      Math.min(10, 1 + (9 * (value - range[0])) / (range[1] - range[0])),
    ),
  );
}
export function comparisonRows(record) {
  return [
    "value",
    "rms",
    "centroid",
    "crest",
    "rolloff",
    "highRatio",
    "fundamental",
    "harmonicRatio",
  ].map((parameter) => ({
    parameter,
    baseline: record.baseline?.features[parameter] ?? null,
    test: record.features[parameter] ?? null,
    relativePercent:
      record.baseline?.features[parameter] > 1e-9 &&
      Number.isFinite(record.features[parameter])
        ? ((record.features[parameter] - record.baseline.features[parameter]) /
            record.baseline.features[parameter]) *
          100
        : null,
  }));
}
export function csvExport(record) {
  const cell = (v) =>
    '"' + String(v ?? "Unavailable").replaceAll('"', '""') + '"';
  const rows = [
    ["TouchGPT experimental acoustic comparison"],
    ["Object", record.label],
    ["Measurement", record.type],
    ["Mode", record.mode],
    ["Demo", record.demo],
    ["Date", record.createdAt],
    ["Reference", record.baseline?.label ?? "None"],
    ["Displayed result", record.percent ?? record.legacy],
    ["Parameter", "Baseline", "Test", "Raw differential %"],
    ...comparisonRows(record).map((r) => [
      r.parameter,
      r.baseline,
      r.test,
      r.relativePercent,
    ]),
    ["IMU metadata (experimental)", JSON.stringify(record.imu)],
    ["Baseline IMU metadata", JSON.stringify(record.baseline?.imu ?? null)],
    [
      "Limitations",
      "Acoustic proxies; not physical roughness, hardness or density. IMU velocity is drift-prone; contact delay unavailable.",
    ],
  ];
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
