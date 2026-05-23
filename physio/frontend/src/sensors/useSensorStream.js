import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_SENSOR_WS_URL = "ws://localhost:8765";
const SENSOR_URL_STORAGE_KEY = "physio_sensor_ws_url";
const MAX_RETAINED_SAMPLES = 600;
// Median window applied to raw distance readings before any downstream use.
// Eliminates single-sample spikes without adding lag to the trend signal.
const DISTANCE_MEDIAN_WINDOW = 7;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function rollingMedianDistance(rawSamples) {
  const recent = rawSamples
    .slice(-DISTANCE_MEDIAN_WINDOW)
    .map((s) => s._raw_distance_cm ?? s.distance_cm)
    .filter(Number.isFinite);
  if (!recent.length) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function configuredSensorUrl() {
  const envUrl = import.meta.env.VITE_SENSOR_WS_URL;
  if (envUrl) return envUrl;
  try {
    return window.localStorage.getItem(SENSOR_URL_STORAGE_KEY) || DEFAULT_SENSOR_WS_URL;
  } catch {
    return DEFAULT_SENSOR_WS_URL;
  }
}

function parseSensorMessage(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const distanceMatch = trimmed.match(/distance\s*:\s*(-?\d+(?:\.\d+)?)\s*cm/i);
  if (distanceMatch) {
    return {
      distance_cm: Number(distanceMatch[1]),
      timestamp_ms: Date.now(),
      source_format: "text_distance"
    };
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    if (trimmed === "streaming_started" || trimmed === "streaming_stopped") {
      return { status: trimmed };
    }
    return null;
  }
}

function sensorLinearityScore(samples) {
  const valid = samples
    .filter((sample) => Number.isFinite(sample.distance_cm) && Number.isFinite(sample.timestamp_ms))
    .slice(-24);
  if (valid.length < 4) return 0;

  const first = valid[0];
  const last = valid.at(-1);
  const durationMs = Math.max(last.timestamp_ms - first.timestamp_ms, 1);
  const netChange = last.distance_cm - first.distance_cm;
  const netDistance = Math.abs(netChange);

  let residualTotal = 0;
  for (const sample of valid) {
    const progress = (sample.timestamp_ms - first.timestamp_ms) / durationMs;
    const expected = first.distance_cm + netChange * progress;
    residualTotal += Math.abs(sample.distance_cm - expected);
  }
  const residualScore = clamp((residualTotal / valid.length) / Math.max(netDistance, 1.5), 0, 1);

  const velocities = [];
  for (let i = 1; i < valid.length; i += 1) {
    const previous = valid[i - 1];
    const current = valid[i];
    const dt = Math.max((current.timestamp_ms - previous.timestamp_ms) / 1000, 0.001);
    velocities.push((current.distance_cm - previous.distance_cm) / dt);
  }

  const velocityChanges = [];
  let signChanges = 0;
  for (let i = 1; i < velocities.length; i += 1) {
    velocityChanges.push(Math.abs(velocities[i] - velocities[i - 1]));
    if (Math.sign(velocities[i]) && Math.sign(velocities[i - 1]) && Math.sign(velocities[i]) !== Math.sign(velocities[i - 1])) {
      signChanges += 1;
    }
  }
  const averageVelocityChange = velocityChanges.reduce((sum, value) => sum + value, 0) / Math.max(velocityChanges.length, 1);
  const jerkScore = clamp(averageVelocityChange / 120, 0, 1);
  const wobbleScore = clamp(signChanges / Math.max(velocities.length - 1, 1), 0, 1);

  return clamp(residualScore * 0.45 + jerkScore * 0.4 + wobbleScore * 0.15, 0, 1);
}

export function useSensorStream({ active = false, url } = {}) {
  const resolvedUrl = useMemo(() => url || configuredSensorUrl(), [url]);
  const socketRef = useRef(null);
  const samplesRef = useRef([]);
  const latestSampleRef = useRef(null);
  const [snapshot, setSnapshot] = useState({
    status: "offline",
    commandStatus: "idle",
    url: resolvedUrl,
    error: "",
    latest: null,
    sampleCount: 0
  });

  useEffect(() => {
    if (!active) {
      setSnapshot((current) => ({
        ...current,
        status: "offline",
        commandStatus: "idle",
        error: "",
        url: resolvedUrl
      }));
      return undefined;
    }

    samplesRef.current = [];
    latestSampleRef.current = null;
    let cancelled = false;
    let closeTimer = 0;
    const socket = new WebSocket(resolvedUrl);
    socketRef.current = socket;

    const updateSnapshot = (partial) => {
      if (!cancelled) {
        setSnapshot((current) => ({ ...current, ...partial, url: resolvedUrl }));
      }
    };

    socket.addEventListener("open", () => {
      updateSnapshot({ status: "connecting", commandStatus: "starting", error: "" });
      socket.send(JSON.stringify({ command: "start" }));
    });

    socket.addEventListener("message", (event) => {
      const payload = parseSensorMessage(event.data);
      if (!payload) return;

      if (payload.status) {
        const streaming = payload.status === "streaming_started";
        updateSnapshot({
          status: streaming ? "ok" : "offline",
          commandStatus: payload.status,
          error: ""
        });
      }

      if (Number.isFinite(payload.distance_cm)) {
        const timestampMs = Number.isFinite(payload.timestamp_ms) ? payload.timestamp_ms : Date.now();
        // Store raw distance alongside smoothed so the median function can access it
        const sample = {
          timestamp_ms: timestampMs,
          _raw_distance_cm: payload.distance_cm,
          distance_cm: payload.distance_cm, // will be replaced below after push
          raw: payload
        };
        samplesRef.current.push(sample);
        while (samplesRef.current.length > MAX_RETAINED_SAMPLES) samplesRef.current.shift();

        // Apply rolling median to suppress single-sample spikes
        const smoothedDistance = rollingMedianDistance(samplesRef.current) ?? payload.distance_cm;
        sample.distance_cm = smoothedDistance;

        const computedJitter = sensorLinearityScore(samplesRef.current);
        const jitterScore = Number.isFinite(payload.sensor_jitter_score)
          ? clamp(Math.max(payload.sensor_jitter_score, computedJitter), 0, 1)
          : computedJitter;
        const latest = {
          timestamp_ms: timestampMs,
          distance_cm: smoothedDistance,
          _raw_distance_cm: payload.distance_cm,
          sensor_status: "ok",
          sensor_jitter_score: Number(jitterScore.toFixed(3)),
          sensor_jitter_detected: jitterScore > 0.55,
          sample_rate_hz: payload.sample_rate_hz ?? null,
          device_id: payload.device_id || "pi-distance-sensor",
          source_format: payload.source_format || "json",
          command_status: snapshot.commandStatus
        };
        latestSampleRef.current = latest;
        updateSnapshot({
          status: "ok",
          commandStatus: payload.status || "streaming_started",
          latest,
          sampleCount: samplesRef.current.length,
          error: ""
        });
      }
    });

    socket.addEventListener("error", () => {
      updateSnapshot({
        status: "error",
        commandStatus: "error",
        error: `Unable to connect to distance sensor at ${resolvedUrl}.`
      });
    });

    socket.addEventListener("close", () => {
      if (!cancelled) {
        updateSnapshot({ status: "offline", commandStatus: "closed" });
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(closeTimer);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ command: "stop" }));
        closeTimer = window.setTimeout(() => socket.close(), 150);
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [active, resolvedUrl]);

  return {
    ...snapshot,
    latestSampleRef,
    samplesRef
  };
}
