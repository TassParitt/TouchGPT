import { frameFeatures, summarize } from "./engine";
export async function requestMotion() {
  try {
    if (typeof DeviceMotionEvent === "undefined") return false;
    if (typeof DeviceMotionEvent.requestPermission === "function")
      return (await DeviceMotionEvent.requestPermission()) === "granted";
    return true;
  } catch {
    return false;
  }
}
export async function capture(
  type,
  onFrame,
  onProgress,
  motionAllowed,
  signal,
) {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("Microphone requires HTTPS and a supported browser.");
  if (type === "density" && !navigator.vibrate)
    throw new Error(
      "This browser cannot control the vibration motor. Try supported Android hardware; density capture is unavailable here.",
    );
  let stream, ctx, animation, motionHandler;
  const frames = [],
    imu = {
      samples: 0,
      gyroSamples: 0,
      peakAcceleration: null,
      peakAngularVelocity: null,
      estimatedSpeed: null,
      meanDirection: null,
      contactLagMs: null,
      normalizationApplied: false,
      note: "Experimental browser motion telemetry; velocity drifts. No validated force or speed normalization. Contact timing cannot be resolved reliably.",
    };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    ctx = new AudioContext();
    await ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const wave = new Float32Array(analyser.fftSize),
      db = new Float32Array(analyser.frequencyBinCount);
    let previous = null,
      velocity = [0, 0, 0],
      speedSum = 0,
      direction = [0, 0, 0];
    motionHandler = (e) => {
      const a = e.acceleration;
      const now = performance.now();
      if (a && [a.x, a.y, a.z].every(Number.isFinite)) {
        const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
        previous = now;
        const axes = [a.x, a.y, a.z];
        velocity = velocity.map((v, i) => (v + axes[i] * dt) * 0.98);
        direction = direction.map((v, i) => v + axes[i]);
        const speed = Math.hypot(...velocity);
        speedSum += speed;
        imu.samples++;
        imu.peakAcceleration = Math.max(
          imu.peakAcceleration ?? 0,
          Math.hypot(...axes),
        );
        imu.estimatedSpeed = speedSum / imu.samples;
        imu.meanDirection = direction.map((v) => v / imu.samples);
      }
      const r = e.rotationRate;
      if (r && [r.alpha, r.beta, r.gamma].every(Number.isFinite)) {
        imu.gyroSamples++;
        imu.peakAngularVelocity = Math.max(
          imu.peakAngularVelocity ?? 0,
          Math.hypot(r.alpha, r.beta, r.gamma),
        );
      }
    };
    if (motionAllowed) window.addEventListener("devicemotion", motionHandler);
    if (
      type === "density" &&
      !navigator.vibrate([
        1000, 20, 1000, 20, 1000, 20, 1000, 20, 1000, 20, 1000, 20, 1000, 20,
        1000,
      ])
    )
      throw new Error(
        "Vibration was refused by this browser. Density measurement is unavailable.",
      );
    const started = performance.now();
    await new Promise((resolve, reject) => {
      const abort = () => {
        cancelAnimationFrame(animation);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      const tick = () => {
        if (signal.aborted) return abort();
        analyser.getFloatTimeDomainData(wave);
        analyser.getFloatFrequencyData(db);
        frames.push(frameFeatures(wave, db, ctx.sampleRate));
        onFrame(Array.from(db));
        const p = Math.min(1, (performance.now() - started) / 8000);
        onProgress(p);
        if (p < 1) animation = requestAnimationFrame(tick);
        else {
          signal.removeEventListener("abort", abort);
          resolve();
        }
      };
      tick();
    });
    return {
      features: summarize(frames, type),
      imu,
      sampleRate: ctx.sampleRate,
      durationSeconds: 8,
      audioSettings: stream.getAudioTracks()[0].getSettings(),
    };
  } finally {
    cancelAnimationFrame(animation);
    window.removeEventListener("devicemotion", motionHandler);
    navigator.vibrate?.(0);
    stream?.getTracks().forEach((t) => t.stop());
    await ctx?.close();
  }
}
