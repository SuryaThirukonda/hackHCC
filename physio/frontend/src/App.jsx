import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Pause, Play, Power, Square, Video } from "lucide-react";
import {
  endSession,
  getCoachCue,
  getHealth,
  getLatestPacket,
  getLiveSource,
  getSessions,
  startSession
} from "./api/client.js";
import CoachPanel from "./components/CoachPanel.jsx";
import LiveSession from "./components/LiveSession.jsx";
import ProgressDashboard from "./components/ProgressDashboard.jsx";
import SessionSummary from "./components/SessionSummary.jsx";

export default function App() {
  const [packet, setPacket] = useState(null);
  const [cue, setCue] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [live, setLive] = useState(true);
  const [dataSource, setDataSource] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("source");
    return requested === "real" ? "real" : "mock";
  });
  const [sourceStatus, setSourceStatus] = useState(null);
  const [health, setHealth] = useState("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    getHealth()
      .then((data) => setHealth(data.status))
      .catch(() => setHealth("offline"));
    refreshSessions();
  }, []);

  useEffect(() => {
    if (!live) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const nextPacket = await getLatestPacket(dataSource);
        if (cancelled) return;
        setPacket(nextPacket);
        setError("");
        getLiveSource().then((status) => {
          if (!cancelled) setSourceStatus(status);
        }).catch(() => {});
        if (nextPacket.device_id === "opencv-waiting") {
          setCue(null);
          return;
        }
        const nextCue = await getCoachCue(nextPacket);
        if (!cancelled) setCue(nextCue);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [live, dataSource]);

  const sessionLabel = useMemo(() => sessionId || packet?.session_id || "mock-session", [packet, sessionId]);
  const handleBrowserPacket = useCallback(async (nextPacket) => {
    setPacket(nextPacket);
    setError("");
    try {
      const nextCue = await getCoachCue(nextPacket);
      setCue(nextCue);
    } catch {
      setCue(null);
    }
  }, []);

  async function refreshSessions() {
    try {
      setSessions(await getSessions());
    } catch {
      setSessions([]);
    }
  }

  async function handleStart() {
    const response = await startSession({
      user_id: "demo-user",
      exercise: "right_arm_raise",
      side: "right",
      target_angle: 90
    });
    setSessionId(response.session_id);
    setSummary(null);
    setLive(true);
  }

  async function handleEnd() {
    const activeSession = sessionId || packet?.session_id || "mock-session";
    const nextSummary = await endSession({
      session_id: activeSession,
      pain_level: 2,
      fatigue_level: 4
    });
    setSummary(nextSummary);
    setSessionId(null);
    await refreshSessions();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Physio</p>
          <h1>Edge rehab control room</h1>
        </div>
        <div className="topbar-actions">
          <span className={`health health-${health}`}>{health}</span>
          <div className="segmented-control" aria-label="Data source">
            <button type="button" className={dataSource === "mock" ? "active" : ""} onClick={() => setDataSource("mock")} title="Use generated mock packets">
              <Database size={16} /> Mock
            </button>
            <button type="button" className={dataSource === "real" ? "active" : ""} onClick={() => setDataSource("real")} title="Use packets posted by vision/pose_tracker.py">
              <Video size={16} /> Real
            </button>
          </div>
          <button type="button" onClick={handleStart}>
            <Play size={17} /> Start
          </button>
          <button type="button" onClick={handleEnd}>
            <Square size={17} /> End
          </button>
          <button type="button" className="icon-button" onClick={() => setLive((value) => !value)} aria-label={live ? "Pause live updates" : "Resume live updates"} title={live ? "Pause live updates" : "Resume live updates"}>
            {live ? <Pause size={18} /> : <Power size={18} />}
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="session-strip">
        <span>Session</span>
        <strong>{sessionLabel}</strong>
        <span>{dataSource === "real" ? "real webcam mode" : "hardcoded mock mode"}</span>
        <span>{packet?.device_id || "no device"}</span>
        <span>{packet?.camera_status || "camera unknown"}</span>
        <span>{packet?.sensor_status || "sensor unknown"} sensor</span>
        {dataSource === "real" && sourceStatus?.real_age_sec != null && (
          <span>{sourceStatus.real_age_sec}s since real packet</span>
        )}
        <span>{packet?.rep_phase || "idle"}</span>
        <span>{packet?.pace || "unknown"} pace</span>
      </div>

      <div className="dashboard-grid">
        <LiveSession
          packet={packet}
          dataSource={dataSource}
          sessionId={sessionLabel}
          onBrowserPacket={handleBrowserPacket}
        />
        <CoachPanel packet={packet} cue={cue} />
        <ProgressDashboard packet={packet} sessions={sessions} />
        <SessionSummary summary={summary} />
      </div>
    </main>
  );
}
