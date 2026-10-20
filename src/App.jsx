import React, { useState, useEffect, useRef } from "react";
import {
  Activity,
  ArrowRight,
  ArrowLeft,
  AudioLines,
  Camera,
  Check,
  ChevronDown,
  Cloud,
  Download,
  Fingerprint,
  FlaskConical,
  History,
  Layers,
  Mic,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { get, set } from "idb-keyval";
import {
  TYPES,
  BASELINE_KEY,
  differential,
  legacyScore,
  comparisonRows,
  csvExport,
} from "./engine";
import { capture, requestMotion } from "./capture";
const icons = { texture: Fingerprint, hardness: Layers, density: Waves };
const fmt = (v, d = 2) =>
  Number.isFinite(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: d })
    : "Unavailable";
const signed = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}%`;
function loadBaselines() {
  try {
    const v = JSON.parse(localStorage.getItem(BASELINE_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function Spectrum({ bins, active = false }) {
  return (
    <div
      className={`spectrum ${active ? "active" : ""}`}
      aria-label={
        active ? "Live audio frequency spectrum" : "Audio frequency spectrum"
      }
    >
      <div className="grid-lines" />
      {Array.from({ length: 64 }, (_, i) => {
        const value = bins?.[Math.floor(i * (bins.length / 64))];
        return (
          <i
            key={i}
            style={{
              height: `${bins ? Math.max(3, Math.min(90, (value + 100) * 1.4)) : 5 + Math.abs(Math.sin(i * 0.72) * Math.cos(i * 0.21)) * 20}%`,
              opacity: bins?.length ? 1 : 0.45,
            }}
          />
        );
      })}
    </div>
  );
}
function Scale({ value, mode, type, reference = "Reference" }) {
  const relative = mode === "relative";
  return (
    <div className="scale-wrap">
      <div className="scale-labels">
        <span>{TYPES[type].low}</span>
        <span>{TYPES[type].high}</span>
      </div>
      <div className="scale">
        <span className="center-tick" />
        {value != null && (
          <span
            className="scale-pin"
            style={{
              left: `${relative ? (value + 100) / 2 : ((value - 1) / 9) * 100}%`,
            }}
          />
        )}
      </div>
      <div className="scale-ticks">
        <span>{relative ? "−100%" : "1"}</span>
        <span>{relative ? `0% · ${reference}` : "5"}</span>
        <span>{relative ? "+100%" : "10"}</span>
      </div>
    </div>
  );
}
async function api(path, body) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r
    .json()
    .catch(() => ({ error: "Storage server is unavailable." }));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
function App() {
  const [tab, setTab] = useState("measure"),
    [type, setType] = useState("texture"),
    [mode, setMode] = useState(
      () => localStorage.getItem("TouchGPT_mode") || "relative",
    ),
    [baselines, setBaselines] = useState(loadBaselines),
    [label, setLabel] = useState(""),
    [photo, setPhoto] = useState(null),
    [reference, setReference] = useState("Forearm skin"),
    [calibrating, setCalibrating] = useState(false),
    [recording, setRecording] = useState(false),
    [progress, setProgress] = useState(0),
    [bins, setBins] = useState(null),
    [result, setResult] = useState(null),
    [records, setRecords] = useState([]),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(null),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [user, setUser] = useState(null),
    [authMode, setAuthMode] = useState("register"),
    [listening, setListening] = useState(false),
    [installPrompt, setInstallPrompt] = useState(null);
  const dialogRef = useRef(null),
    baselineFileRef = useRef(null);
  const abortRef = useRef(null),
    speechRef = useRef(null),
    cameraRef = useRef(null),
    fileRef = useRef(null),
    hiddenTimer = useRef(null);
  useEffect(() => {
    get("TouchGPT_records")
      .then((v) => setRecords(v || []))
      .catch(() => setError("Local history is unavailable in this browser."));
    api("session")
      .then((v) => setUser(v.user))
      .catch(() => {});
    const onInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    const onHidden = () => {
      if (document.hidden) {
        abortRef.current?.abort();
        speechRef.current?.stop();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      abortRef.current?.abort();
      speechRef.current?.stop();
      window.removeEventListener("beforeinstallprompt", onInstall);
      document.removeEventListener("visibilitychange", onHidden);
      clearTimeout(hiddenTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!modal) return;
    const before = document.activeElement;
    const dialog = dialogRef.current;
    const focusables = () =>
      Array.from(
        dialog.querySelectorAll(
          'button:not(:disabled), input, select, [tabindex="0"], summary',
        ),
      );
    focusables()[0]?.focus();
    const key = (e) => {
      if (e.key === "Escape" && !busy) setModal(null);
      if (e.key === "Tab") {
        const elements = focusables(),
          first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [modal, busy]);
  const toast = (text) => {
    setNotice(text);
    clearTimeout(hiddenTimer.current);
    hiddenTimer.current = setTimeout(() => setNotice(null), 4500);
  };
  const changeTab = (next) => {
    setTab(next);
    setResult(null);
    setError(null);
    setCalibrating(false);
  };
  const baseline = baselines[type],
    config = TYPES[type],
    TypeIcon = icons[type];
  async function start(isCalibration = false) {
    if (recording) return;
    setError(null);
    setResult(null);
    if (!isCalibration && mode === "relative" && !baseline) {
      setTab("calibration");
      toast(`First, record your ${type} reference.`);
      return;
    }
    if (!isCalibration && !label.trim()) {
      setError("Give your object a name before measuring.");
      return;
    }
    if (isCalibration && !reference.trim()) {
      setError("Name your reference material.");
      return;
    }
    speechRef.current?.stop();
    setListening(false);
    setCalibrating(isCalibration);
    setRecording(true);
    setProgress(0);
    setBins(null);
    abortRef.current = new AbortController();
    try {
      const motionPermission = await requestMotion();
      const data = await capture(
        type,
        setBins,
        setProgress,
        motionPermission,
        abortRef.current.signal,
      );
      if (isCalibration) {
        const next = {
          ...baselines,
          [type]: {
            ...data,
            label: reference.trim(),
            timestamp: new Date().toISOString(),
            id: crypto.randomUUID(),
          },
        };
        localStorage.setItem(BASELINE_KEY, JSON.stringify(next));
        setBaselines(next);
        toast("Reference recorded and saved on this device.");
        setTab("measure");
      } else {
        const relative =
          mode === "relative"
            ? differential(data.features.value, baseline.features.value)
            : {};
        setResult({
          ...data,
          ...relative,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          type,
          mode,
          label: label.trim(),
          photo,
          baseline: mode === "relative" ? structuredClone(baseline) : null,
          legacy: legacyScore(type, data.features.value),
          demo: false,
          methodVersion: "acoustic-proxy-1",
        });
      }
    } catch (e) {
      if (e.name === "AbortError") toast("Measurement cancelled.");
      else
        setError(
          e.message || "Recording failed. Please check microphone permissions.",
        );
    } finally {
      setRecording(false);
      setCalibrating(false);
      setBins(null);
    }
  }
  function demo() {
    const baseFeatures = {
      value: 1200,
      rms: 0.025,
      centroid: 1200,
      crest: 4,
      rolloff: 3200,
      highRatio: 0.12,
      fundamental: 187.5,
      harmonicRatio: 0.15,
    };
    if (type === "hardness") baseFeatures.value = 4800;
    if (type === "density") baseFeatures.value = 0.15;
    const features = {
      ...baseFeatures,
      value: baseFeatures.value * 1.38,
      centroid: 1656,
      rms: 0.0345,
      crest: 5.52,
      harmonicRatio: 0.207,
    };
    setResult({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      label: label.trim() || "Woven cotton",
      type,
      mode,
      features,
      baseline:
        mode === "relative"
          ? {
              label: "Forearm skin (sample)",
              features: baseFeatures,
              imu: null,
              timestamp: new Date().toISOString(),
            }
          : null,
      ...differential(features.value, baseFeatures.value),
      legacy: legacyScore(type, features.value),
      demo: true,
      photo,
      imu: {
        samples: 0,
        estimatedSpeed: null,
        contactLagMs: null,
        note: "Sample data; no sensors were recorded.",
      },
      methodVersion: "acoustic-proxy-1",
      durationSeconds: 8,
    });
    setTab("measure");
    setError(null);
  }
  async function saveLocal() {
    try {
      const next = [result, ...records.filter((r) => r.id !== result.id)];
      await set("TouchGPT_records", next);
      setRecords(next);
      toast("Saved in this browser · find it in History.");
    } catch {
      setError(
        "Device storage is full or unavailable. Download a copy instead.",
      );
    }
  }
  function exportBaselines() {
    const blob = new Blob(
      [JSON.stringify({ schema: "TouchGPT_v6_baseline", baselines }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "TouchGPT-baselines.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importBaselines(e) {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 100000) throw new Error("Reference backup is too large.");
      const data = JSON.parse(await file.text());
      if (
        data.schema !== "TouchGPT_v6_baseline" ||
        !data.baselines ||
        typeof data.baselines !== "object"
      )
        throw new Error("Choose a TouchGPT baseline backup.");
      const next = { ...baselines };
      for (const [key, value] of Object.entries(data.baselines)) {
        if (
          !TYPES[key] ||
          !value ||
          typeof value.label !== "string" ||
          value.label.length > 120 ||
          !Number.isFinite(value.features?.value) ||
          value.features.value <= 0 ||
          !Number.isFinite(Date.parse(value.timestamp))
        )
          throw new Error("Invalid baseline backup.");
        next[key] = value;
      }
      localStorage.setItem(BASELINE_KEY, JSON.stringify(next));
      setBaselines(next);
      toast("References restored. Saved results are unchanged.");
    } catch (e) {
      setError(e.message);
    } finally {
      e.target.value = "";
    }
  }
  function download(format) {
    const payload = {
      ...result,
      comparison: comparisonRows(result),
      limitations:
        "Experimental acoustic proxies, not physical material measurements. Uncalibrated legacy scale. IMU velocity is drift-prone.",
    };
    const blob = new Blob(
      [
        format === "json"
          ? JSON.stringify(payload, null, 2)
          : csvExport(result),
      ],
      {
        type: format === "json" ? "application/json" : "text/csv;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `TouchGPT-${result.type}-${result.id.slice(0, 8)}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Download requested · check your browser’s Downloads or Files app.");
  }
  async function cloudSave() {
    setBusy(true);
    setError(null);
    try {
      await api("records", {
        record: { ...result, comparison: comparisonRows(result) },
      });
      toast("Uploaded to your private cloud library.");
      setModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function speak() {
    setError(null);
    if (listening) {
      speechRef.current?.stop();
      return;
    }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) {
      setError(
        "Speech-to-text is unavailable here. Use your keyboard’s microphone or type a label.",
      );
      return;
    }
    const recognition = new Speech();
    speechRef.current = recognition;
    recognition.lang = navigator.language;
    recognition.onresult = (e) => setLabel(e.results[0][0].transcript);
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = (e) => {
      setListening(false);
      setError(`Speech input: ${e.error}. You can also type a label.`);
    };
    try {
      recognition.start();
    } catch {
      setError("Speech input could not start.");
    }
  }
  async function readPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      const ratio = Math.min(1, 900 / image.width, 900 / image.height),
        c = document.createElement("canvas");
      c.width = image.width * ratio;
      c.height = image.height * ratio;
      c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
      setPhoto(c.toDataURL("image/jpeg", 0.75));
    } catch {
      setError("This photo format cannot be read. Try JPEG or PNG.");
    } finally {
      URL.revokeObjectURL(url);
      e.target.value = "";
    }
  }
  async function recognize() {
    setBusy(true);
    setError(null);
    try {
      const data = await api("recognize", { image: photo });
      setLabel(data.label);
      toast("AI suggested a label. Check it before measuring.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function auth(e) {
    e.preventDefault();
    const data = new FormData(e.target);
    setBusy(true);
    setError(null);
    try {
      const response = await api(authMode, {
        email: data.get("email"),
        password: data.get("password"),
      });
      setUser(response.user);
      toast("Signed in. You can upload your result.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (!recording) changeTab("measure");
          }}
        >
          <span className="brand-mark">
            <AudioLines size={24} />
          </span>
          Touch<span>GPT</span>
        </a>
        <div className="workspace-label">YOUR MATERIAL LAB</div>
        <nav>
          {[
            ["measure", Fingerprint, "Measure"],
            ["calibration", SlidersHorizontal, "Calibration"],
            ["history", History, "History"],
          ].map(([key, Icon, text]) => (
            <button
              disabled={recording}
              className={tab === key ? "selected" : ""}
              key={key}
              onClick={() => changeTab(key)}
            >
              <Icon size={20} />
              <span>{text}</span>
              {key === "history" && records.length > 0 && (
                <small>{records.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="lab-note">
            <span className="tiny-orb" />
            <span>
              A little curiosity.
              <br />
              <strong>A whole new sense.</strong>
            </span>
          </div>
          <button
            className="settings-link"
            disabled={recording}
            onClick={() => setModal("settings")}
          >
            <Settings2 size={18} /> Settings & app info
          </button>
          <span className="version">TOUCHGPT · EXPERIMENTAL LAB</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <a
            className="brand mobile-brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              if (!recording) changeTab("measure");
            }}
          >
            <span className="brand-mark">
              <AudioLines size={22} />
            </span>
            Touch<span>GPT</span>
          </a>
          <span className="breadcrumb">
            Your workspace <span>/</span>{" "}
            {tab === "calibration"
              ? "Calibration"
              : tab === "history"
                ? "History"
                : "Material explorer"}
          </span>
          <span className="device-badge">
            <span /> On-device sensing
          </span>
          <button
            className="mobile-settings icon-button"
            disabled={recording}
            aria-label="Settings"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={20} />
          </button>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> EXPLORE THROUGH TOUCH
              </div>
              <h1>
                {tab === "calibration"
                  ? "Start with a familiar feel."
                  : tab === "history"
                    ? "Your discoveries, collected."
                    : result
                      ? "A closer look at your material."
                      : "Let’s train AI with a sense of touch."}
              </h1>
              <p>
                {tab === "calibration"
                  ? "Your reference makes every comparison personal."
                  : tab === "history"
                    ? "Revisit, compare, and take your findings with you."
                    : "Discover the hidden character of everyday materials."}
              </p>
            </div>
            <button
              className="text-button how-button"
              onClick={() => setModal("about")}
            >
              <FlaskConical size={17} /> How it works <ArrowRight size={16} />
            </button>
          </div>
          {error && (
            <div role="alert" className="message error">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={17} />
              </button>
            </div>
          )}
          {tab === "history" ? (
            <section className="card history-card">
              <div className="section-title">
                <h2>Saved on this device</h2>
                <span className="tag">{records.length} results</span>
              </div>
              {!records.length ? (
                <div className="empty">
                  <History size={36} />
                  <h3>A space for your discoveries</h3>
                  <p>Save a measurement and it will appear here.</p>
                  <button
                    className="primary"
                    onClick={() => changeTab("measure")}
                  >
                    Explore a material <ArrowRight size={17} />
                  </button>
                </div>
              ) : (
                records.map((record) => (
                  <div className="history-row" key={record.id}>
                    <button
                      onClick={() => {
                        setType(record.type);
                        setTab("measure");
                        setResult(record);
                      }}
                    >
                      <span className="history-icon">
                        {React.createElement(icons[record.type], { size: 22 })}
                      </span>
                      <span>
                        <strong>{record.label}</strong>
                        <small>
                          {TYPES[record.type].name} ·{" "}
                          {new Date(record.createdAt).toLocaleDateString()}
                          {record.demo ? " · Demo" : ""}
                        </small>
                      </span>
                      <b>
                        {record.mode === "relative"
                          ? signed(record.percent)
                          : `${record.legacy}/10`}
                      </b>
                      <ArrowRight size={18} />
                    </button>
                    <button
                      aria-label={`Delete ${record.label}`}
                      className="icon-button"
                      onClick={async () => {
                        try {
                          const next = records.filter(
                            (r) => r.id !== record.id,
                          );
                          await set("TouchGPT_records", next);
                          setRecords(next);
                        } catch {
                          setError("Could not delete this record.");
                        }
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))
              )}
              <button
                className="secondary cloud-history"
                onClick={() => setModal("library")}
              >
                <Cloud size={17} /> Open cloud library
              </button>
            </section>
          ) : result ? (
            <div className="measure-grid">
              <section className="card result-card">
                <div className="section-title">
                  <span className="step-label">
                    <span className="step-circle">
                      <Check size={15} />
                    </span>{" "}
                    YOUR RESULT
                  </span>
                  <span className="tag">
                    {result.demo ? "SAMPLE DATA" : "CAPTURE COMPLETE"}
                  </span>
                </div>
                <div className="result-object">
                  {result.photo ? (
                    <img src={result.photo} alt={result.label} />
                  ) : (
                    <div className="material-art mini">
                      <div />
                    </div>
                  )}
                  <span>
                    <h2>{result.label}</h2>
                    <p>
                      {TYPES[result.type].name} ·{" "}
                      {result.mode === "relative"
                        ? "Relative comparison"
                        : "Legacy estimate"}
                    </p>
                  </span>
                </div>
                <div className="big-result">
                  {result.mode === "relative"
                    ? signed(result.percent)
                    : result.legacy}
                  <span>
                    {result.mode === "relative"
                      ? "acoustic difference"
                      : " / 10 · heuristic"}
                  </span>
                </div>
                <p className="result-description">
                  {result.mode === "relative"
                    ? `${TYPES[result.type].feature} compared with ${result.baseline.label}.`
                    : "An illustrative acoustic score, not a calibrated material scale."}
                </p>
                <Scale
                  type={result.type}
                  mode={result.mode}
                  value={
                    result.mode === "relative" ? result.percent : result.legacy
                  }
                  reference={result.baseline?.label}
                />
                {result.clipped && (
                  <p className="fine-print">
                    Display capped at ±100%. Raw difference:{" "}
                    {signed(result.rawPercent)}.
                  </p>
                )}
                <div className="result-warning">
                  <FlaskConical size={17} /> Acoustic response is a proxy, not a
                  physical {result.type} measurement.
                </div>
                <details className="comparison" open>
                  <summary>
                    Baseline comparison <ChevronDown size={16} />
                  </summary>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Parameter</th>
                          <th>Reference</th>
                          <th>Object</th>
                          <th>Δ %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparisonRows(result).map((r) => (
                          <tr key={r.parameter}>
                            <td>{r.parameter}</td>
                            <td>{fmt(r.baseline)}</td>
                            <td>{fmt(r.test)}</td>
                            <td>{fmt(r.relativePercent, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <details className="comparison">
                  <summary>
                    IMU physics metadata <ChevronDown size={16} />
                  </summary>
                  <dl>
                    <dt>Motion samples</dt>
                    <dd>{result.imu.samples}</dd>
                    <dt>Estimated speed (drift-prone)</dt>
                    <dd>{fmt(result.imu.estimatedSpeed)} m/s</dd>
                    <dt>Peak acceleration</dt>
                    <dd>{fmt(result.imu.peakAcceleration)} m/s²</dd>
                    <dt>Peak angular velocity</dt>
                    <dd>{fmt(result.imu.peakAngularVelocity)} °/s</dd>
                    <dt>Contact delay</dt>
                    <dd>Unavailable</dd>
                    <dt>Normalization applied</dt>
                    <dd>No — unvalidated</dd>
                  </dl>
                  <p className="fine-print">{result.imu.note}</p>
                </details>
                <button
                  className="secondary full"
                  onClick={() => {
                    setResult(null);
                    setBins(null);
                  }}
                >
                  <RotateCcw size={17} /> Measure again
                </button>
              </section>
              <aside className="right-column">
                <section className="card save-card">
                  <div className="circle-icon">
                    <Download size={22} />
                  </div>
                  <h2>Keep your discovery</h2>
                  <p>
                    Save the result, reference, and sensor details together.
                  </p>
                  <button className="primary full" onClick={saveLocal}>
                    <Plus size={17} /> Save on this device
                  </button>
                  <button
                    className="secondary full"
                    onClick={() => setModal("export")}
                  >
                    <Download size={17} /> Download results
                  </button>
                  <button
                    className="secondary full"
                    onClick={() => setModal("cloud")}
                  >
                    <Cloud size={17} /> Upload to cloud
                  </button>
                  <p className="fine-print">
                    Device saves stay in this browser. Download a copy for a
                    lasting backup.
                  </p>
                </section>
                <div className="quiet-note">
                  <ShieldCheck size={19} />
                  <p>
                    {result.demo
                      ? "Demo results are always marked as sample data."
                      : "Nothing leaves your device until you choose to upload."}
                  </p>
                </div>
              </aside>
            </div>
          ) : (
            <>
              <div
                className="measurement-tabs"
                role="tablist"
                aria-label="Measurement type"
              >
                {Object.entries(TYPES).map(([key, c]) => {
                  const Icon = icons[key];
                  return (
                    <button
                      role="tab"
                      aria-selected={type === key}
                      disabled={recording}
                      key={key}
                      className={type === key ? "active" : ""}
                      onClick={() => {
                        setType(key);
                        setError(null);
                      }}
                    >
                      <Icon size={21} />
                      <span>{c.name}</span>
                      {type === key && <span className="selected-dot" />}
                    </button>
                  );
                })}
              </div>
              <div className="measure-grid">
                <div className="left-column">
                  <section className="card object-card">
                    <div className="section-title">
                      <span className="step-label">
                        <span className="step-circle">01</span>{" "}
                        {tab === "calibration"
                          ? "SET YOUR REFERENCE"
                          : "MEET YOUR MATERIAL"}
                      </span>
                      <span className="tag">
                        {tab === "calibration" ? "BASELINE" : "OBJECT DETAILS"}
                      </span>
                    </div>
                    <div className="object-body">
                      <button
                        disabled={recording}
                        className={`photo-target ${photo && tab !== "calibration" ? "has-photo" : ""}`}
                        aria-label="Take object photo"
                        onClick={() => cameraRef.current.click()}
                      >
                        {photo && tab !== "calibration" ? (
                          <img src={photo} alt="Object preview" />
                        ) : (
                          <>
                            <div className="material-art">
                              <div />
                            </div>
                            <span>
                              <Camera size={14} /> Add photo
                            </span>
                          </>
                        )}
                      </button>
                      <div className="object-fields">
                        <label htmlFor="object-name">
                          {tab === "calibration"
                            ? "Reference material"
                            : "What are you exploring?"}
                        </label>
                        <div className="input-with-icon">
                          <input
                            id="object-name"
                            maxLength={120}
                            disabled={recording}
                            placeholder="e.g. Cotton, oak, ceramic…"
                            value={tab === "calibration" ? reference : label}
                            onChange={(e) =>
                              tab === "calibration"
                                ? setReference(e.target.value)
                                : setLabel(e.target.value)
                            }
                          />
                          {tab !== "calibration" && (
                            <button
                              disabled={recording}
                              aria-label={
                                listening
                                  ? "Stop voice description"
                                  : "Describe object by voice"
                              }
                              onClick={speak}
                              className={listening ? "listening" : ""}
                            >
                              <Mic size={19} />
                            </button>
                          )}
                        </div>
                        <p>
                          {tab === "calibration"
                            ? "Forearm skin, or a material you know well."
                            : "Give it a name, say it, or snap a photo."}
                        </p>
                        {tab !== "calibration" && (
                          <div className="object-actions">
                            <button
                              disabled={recording}
                              onClick={() => fileRef.current.click()}
                            >
                              Choose photo
                            </button>
                            {photo && (
                              <>
                                <button
                                  disabled={busy || recording}
                                  onClick={() => setModal("recognize")}
                                >
                                  <Sparkles size={13} /> Identify with AI
                                </button>
                                <button
                                  aria-label="Remove photo"
                                  disabled={recording}
                                  onClick={() => setPhoto(null)}
                                >
                                  <X size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      hidden
                      ref={cameraRef}
                      onChange={readPhoto}
                    />
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      ref={fileRef}
                      onChange={readPhoto}
                    />
                  </section>
                  <section className="card sensing-card">
                    <div className="section-title">
                      <span className="step-label">
                        <span className="step-circle">02</span>{" "}
                        {tab === "calibration"
                          ? "CAPTURE YOUR BASELINE"
                          : "LISTEN TO THE SURFACE"}
                      </span>
                      <span className={`tag ${recording ? "live" : ""}`}>
                        <span />
                        {recording ? "RECORDING" : "8 SECOND CAPTURE"}
                      </span>
                    </div>
                    <div className="instruction-hero">
                      <div className={`gesture-art ${type}`}>
                        <div className="gesture-surface" />
                        <div className="phone">
                          <span />
                          <i />
                        </div>
                        <div className="motion-lines">
                          {type === "texture"
                            ? "↔"
                            : type === "hardness"
                              ? "↓"
                              : "≈"}
                        </div>
                        <span className="gesture-count">
                          {type === "texture"
                            ? "6×"
                            : type === "hardness"
                              ? "5×"
                              : "8s"}
                        </span>
                      </div>
                      <div>
                        <h2>{config.verb}. Listen. Discover.</h2>
                        <p>{config.instruction}</p>
                        <details className="instruction-details">
                          <summary>
                            Quick tips <ChevronDown size={13} />
                          </summary>
                          <p>
                            Use light contact and a quiet room. Keep the same
                            case, grip, and pressure as your reference. Avoid
                            sharp, dirty, or fragile surfaces; do not press on
                            or block the microphone opening.
                          </p>
                        </details>
                      </div>
                    </div>
                    <div className="audio-panel">
                      <div className="audio-heading">
                        <span>
                          <AudioLines size={15} /> Live audio spectrum
                        </span>
                        <span>
                          {recording
                            ? `${Math.ceil(progress * 8)} / 8 s`
                            : "MIC READY WHEN YOU ARE"}
                        </span>
                      </div>
                      <Spectrum bins={bins} active={recording} />
                      <div className="frequency-axis">
                        <span>0 Hz</span>
                        <span>Frequency →</span>
                        <span>Nyquist</span>
                      </div>
                    </div>
                    {recording ? (
                      <>
                        <div className="progress-track">
                          <span style={{ width: `${progress * 100}%` }} />
                        </div>
                        <button
                          className="primary full recording"
                          onClick={() => abortRef.current?.abort()}
                        >
                          <Square size={17} /> Cancel{" "}
                          {calibrating ? "calibration" : "measurement"}
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary full"
                        onClick={() =>
                          tab === "calibration" && baseline
                            ? setModal("recalibrate")
                            : start(tab === "calibration")
                        }
                      >
                        <Mic size={18} />
                        {tab === "calibration"
                          ? baseline
                            ? "Re-calibrate baseline"
                            : "Record baseline"
                          : "Start measurement"}
                        <ArrowRight size={18} />
                      </button>
                    )}
                    <div className="capture-footer">
                      <ShieldCheck size={14} /> Microphone access is requested
                      when you start.
                    </div>
                  </section>
                </div>
                <aside className="right-column">
                  <section className="card baseline-card">
                    <div className="section-title">
                      <h2>Your reference</h2>
                      <span
                        className={`status-dot ${baseline ? "ready" : ""}`}
                      />
                    </div>
                    <div className="reference-illustration">
                      <Fingerprint size={48} strokeWidth={1.2} />
                      <span className="reference-ring" />
                      <span className="reference-ring second" />
                    </div>
                    <h3>{baseline?.label || "Make it personal."}</h3>
                    <p>
                      {baseline
                        ? "Your baseline is ready for comparison."
                        : "Calibrate once. Compare everything to a familiar reference."}
                    </p>
                    <div className="baseline-status">
                      <span className={baseline ? "ready" : ""} />
                      {baseline ? "Baseline active" : "Not calibrated yet"}
                      {baseline && <Check size={14} />}
                    </div>
                    {baseline && (
                      <p className="fine-print">
                        Saved{" "}
                        {new Date(baseline.timestamp).toLocaleDateString()} ·{" "}
                        {config.name}
                      </p>
                    )}
                    <button
                      disabled={recording}
                      className="secondary full"
                      onClick={() => {
                        setTab(
                          tab === "calibration" ? "measure" : "calibration",
                        );
                        setError(null);
                      }}
                    >
                      <SlidersHorizontal size={16} />
                      {tab === "calibration"
                        ? "Back to measurement"
                        : baseline
                          ? "Manage calibration"
                          : "Set up calibration"}
                      <ArrowRight size={15} />
                    </button>
                  </section>
                  <section className="card preview-card">
                    <div className="section-title">
                      <h2>A feel for the difference</h2>
                      <Activity size={17} />
                    </div>
                    <p>
                      {mode === "relative"
                        ? "Your reference sits at the center. See how your material’s acoustic response compares."
                        : "Explore the original 1–10 illustrative acoustic scale."}
                    </p>
                    <Scale
                      type={type}
                      mode={mode}
                      reference={baseline?.label || "Reference"}
                    />
                    {mode === "legacy" && (
                      <p className="fine-print">
                        Examples: {config.anchors.join(" → ")}. Conceptual
                        anchors only.
                      </p>
                    )}
                    <span className="preview-caption">
                      {mode === "relative"
                        ? "RELATIVE ACOUSTIC RESPONSE"
                        : "LEGACY · UNCALIBRATED ESTIMATE"}
                    </span>
                  </section>
                  <button
                    disabled={recording}
                    className="demo-card"
                    onClick={demo}
                  >
                    <span className="demo-icon">
                      <Play size={18} fill="currentColor" />
                    </span>
                    <span>
                      <strong>Just looking around?</strong>
                      <small>Try a sample measurement</small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                  <div className="quiet-note">
                    <FlaskConical size={18} />
                    <p>
                      Made for curiosity. Experimental comparisons, not
                      laboratory measurements.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              <AudioLines size={15} /> SMALL TOUCHES. NEW DISCOVERIES.
            </span>
            <span>Designed for the curious.</span>
          </footer>
        </div>
      </main>
      <nav className="mobile-nav">
        {[
          ["measure", Fingerprint, "Measure"],
          ["calibration", SlidersHorizontal, "Calibrate"],
          ["history", History, "History"],
        ].map(([key, Icon, text]) => (
          <button
            disabled={recording}
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => changeTab(key)}
          >
            <Icon size={21} />
            {text}
          </button>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <section
            ref={dialogRef}
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-label={modal}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close-modal icon-button"
              aria-label="Close dialog"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "about" && (
              <>
                <div className="circle-icon">
                  <FlaskConical />
                </div>
                <h2>A new way to explore</h2>
                <p>
                  TouchGPT listens to the sound of gentle contact. Calibrate
                  with a familiar material, capture an object, then compare
                  acoustic features.
                </p>
                <ol>
                  <li>
                    <strong>Name it.</strong> Type, speak, or take a photo.
                  </li>
                  <li>
                    <strong>Feel it.</strong> Slide, tap, or hold for 8 seconds.
                  </li>
                  <li>
                    <strong>Keep it.</strong> Save your comparison and sensor
                    details.
                  </li>
                </ol>
                <p className="fine-print">
                  Results depend on the phone, case, contact force, material
                  shape, and room noise. Density cannot be uniquely inferred
                  from sound. These are acoustic feature differences, not
                  validated material properties. Motion timing is too coarse for
                  reliable millisecond contact measurements.
                </p>
                <button className="primary full" onClick={() => setModal(null)}>
                  Let’s explore <ArrowRight size={17} />
                </button>
              </>
            )}
            {modal === "settings" && (
              <>
                <h2>Your lab settings</h2>
                <label className="field-label">
                  Measurement mode
                  <select
                    value={mode}
                    onChange={(e) => {
                      setMode(e.target.value);
                      localStorage.setItem("TouchGPT_mode", e.target.value);
                      setResult(null);
                    }}
                  >
                    <option value="relative">
                      TouchGPT · Relative comparison (%)
                    </option>
                    <option value="legacy">
                      TouchGPT · Legacy estimate (1–10)
                    </option>
                  </select>
                </label>
                <p className="fine-print">
                  Switch modes anytime. Your saved results and baselines stay
                  unchanged. Legacy anchors are conceptual, not calibrated.
                </p>
                <h3>Back up your references</h3>
                <p>
                  Browser storage can be cleared. Keep a backup to retain your
                  calibration across devices.
                </p>
                <button className="secondary full" onClick={exportBaselines}>
                  Download baseline backup
                </button>
                <button
                  className="secondary full"
                  onClick={() => baselineFileRef.current.click()}
                >
                  Restore references from backup
                </button>
                <input
                  ref={baselineFileRef}
                  type="file"
                  accept="application/json"
                  hidden
                  onChange={importBaselines}
                />
                <h3>Install TouchGPT</h3>
                <p>
                  On iPhone: Share → Add to Home Screen. On Android: browser
                  menu → Install app.
                </p>
                {installPrompt && (
                  <button
                    className="secondary full"
                    onClick={async () => {
                      await installPrompt.prompt();
                      setInstallPrompt(null);
                    }}
                  >
                    Install app
                  </button>
                )}
                <h3>Privacy & storage</h3>
                <p>
                  Measurements and photos stay on your device until you upload.
                  AI identification sends only the selected photo to the
                  configured AI provider. Voice input may use your browser’s
                  speech service.
                </p>
                <p className="fine-print">
                  TouchGPT 1.0 · HTTPS is required on a phone. Vibration is
                  typically unavailable on iOS. Browser storage may be cleared;
                  export important baselines and results.
                </p>
                {user && (
                  <button
                    className="secondary full"
                    onClick={async () => {
                      try {
                        await api("logout", {});
                        setUser(null);
                        toast("Signed out.");
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Sign out · {user.email}
                  </button>
                )}
              </>
            )}
            {modal === "recalibrate" && (
              <>
                <h2>Replace this reference?</h2>
                <p>
                  Your existing {type} baseline stays active until a new
                  recording succeeds. Saved results keep their original
                  reference.
                </p>
                <button
                  className="primary full"
                  onClick={() => {
                    setModal(null);
                    start(true);
                  }}
                >
                  Record new baseline <Mic size={17} />
                </button>
                <button
                  className="secondary full"
                  onClick={() => setModal(null)}
                >
                  Keep existing reference
                </button>
              </>
            )}
            {modal === "recognize" && (
              <>
                <h2>Identify your object</h2>
                <p>
                  Send this photo to the configured AI provider for a suggested
                  label. Review the suggestion before measuring.
                </p>
                <button
                  className="primary full"
                  disabled={busy}
                  onClick={async () => {
                    if (!user) {
                      setModal("library");
                      return;
                    }
                    await recognize();
                    setModal(null);
                  }}
                >
                  <Sparkles size={17} />
                  {busy
                    ? "Identifying…"
                    : user
                      ? "Identify photo"
                      : "Sign in for AI identification"}
                </button>
              </>
            )}
            {modal === "export" && (
              <>
                <h2>Take your discovery with you</h2>
                <p>
                  Includes the object, baseline comparison, raw differential,
                  and available IMU metadata.
                </p>
                <button
                  className="primary full"
                  onClick={() => download("json")}
                >
                  <Download size={17} /> Download JSON · complete record
                </button>
                <button
                  className="secondary full"
                  onClick={() => download("csv")}
                >
                  <Download size={17} /> Download CSV · comparison table
                </button>
                <p className="fine-print">
                  Files go to your browser’s Downloads folder or Files app. Your
                  phone may offer a save-location picker.
                </p>
              </>
            )}
            {(modal === "cloud" || modal === "library") && (
              <>
                <div className="circle-icon">
                  <Cloud />
                </div>
                <h2>
                  {modal === "library"
                    ? "Your cloud library"
                    : "A home for your discoveries"}
                </h2>
                {!user ? (
                  <>
                    <p>
                      Create an account or sign in to your TouchGPT storage
                      server.
                    </p>
                    <form onSubmit={auth}>
                      <label className="field-label">
                        Email
                        <input
                          type="email"
                          name="email"
                          required
                          autoComplete="email"
                          maxLength={200}
                        />
                      </label>
                      <label className="field-label">
                        Password
                        <input
                          type="password"
                          name="password"
                          minLength={12}
                          maxLength={128}
                          required
                          autoComplete={
                            authMode === "register"
                              ? "new-password"
                              : "current-password"
                          }
                        />
                      </label>
                      <p className="fine-print">Use at least 12 characters.</p>
                      <button className="primary full" disabled={busy}>
                        {busy
                          ? "Please wait…"
                          : authMode === "register"
                            ? "Create account"
                            : "Sign in"}
                      </button>
                    </form>
                    <button
                      className="text-button"
                      onClick={() =>
                        setAuthMode(
                          authMode === "register" ? "login" : "register",
                        )
                      }
                    >
                      {authMode === "register"
                        ? "Already have an account? Sign in"
                        : "New here? Create an account"}
                    </button>
                  </>
                ) : modal === "cloud" ? (
                  <>
                    <p>
                      Upload this result and its photo to your private library
                      as {user.email}.
                    </p>
                    <button
                      className="primary full"
                      disabled={busy}
                      onClick={cloudSave}
                    >
                      <Cloud size={17} />
                      {busy ? "Uploading…" : "Upload result"}
                    </button>
                  </>
                ) : (
                  <CloudLibrary
                    onOpen={(r) => {
                      setResult(r);
                      setType(r.type);
                      setTab("measure");
                      setModal(null);
                    }}
                  />
                )}
              </>
            )}
            {error && (
              <p role="alert" className="modal-error">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function CloudLibrary({ onOpen }) {
  const [items, setItems] = useState(null),
    [error, setError] = useState(null),
    [nextOffset, setNextOffset] = useState(null),
    [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    api("records")
      .then((d) => {
        setItems(d.records);
        setNextOffset(d.nextOffset ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !items ? (
        <p>Loading…</p>
      ) : !items.length ? (
        <p>No uploads yet. Upload a measurement from its result screen.</p>
      ) : (
        items.map((r) => (
          <div className="history-row" key={r.id}>
            <button onClick={() => onOpen(r)}>
              <span>
                <strong>{r.label}</strong>
                <small>
                  {r.type}
                  {r.demo ? " · Demo" : ""}
                </small>
              </span>
              <ArrowRight size={17} />
            </button>
            <button
              aria-label={`Delete cloud result ${r.label}`}
              className="icon-button"
              onClick={async () => {
                try {
                  await api("records/delete", { id: r.id });
                  setItems(items.filter((i) => i.id !== r.id));
                  if (nextOffset !== null)
                    setNextOffset(Math.max(0, nextOffset - 1));
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))
      )}
      {nextOffset !== null && !error && (
        <button
          className="secondary full"
          disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true);
            try {
              const data = await api(`records?offset=${nextOffset}`);
              setItems((current) => {
                const existing = new Set(current.map((r) => r.id));
                return [
                  ...current,
                  ...data.records.filter((r) => !existing.has(r.id)),
                ];
              });
              setNextOffset(data.nextOffset ?? null);
            } catch (e) {
              setError(e.message);
            } finally {
              setLoadingMore(false);
            }
          }}
        >
          {loadingMore ? "Loading…" : "Load more results"}
        </button>
      )}
    </div>
  );
}
export default App;
