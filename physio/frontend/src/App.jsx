import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Camera,
  ChevronRight,
  Database,
  Dumbbell,
  FileText,
  FlaskConical,
  Pause,
  Play,
  Power,
  Square,
  Video
} from "lucide-react";
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
import ExercisePreview from "./components/ExercisePreview.jsx";
import LiveSession from "./components/LiveSession.jsx";
import ProgressDashboard from "./components/ProgressDashboard.jsx";
import SessionSummary from "./components/SessionSummary.jsx";
import { defaultExercise, exercises } from "./exercises/index.js";

const navItems = [
  { id: "exercises", label: "Exercises", icon: Dumbbell },
  { id: "live", label: "Live Session", icon: Camera },
  { id: "results", label: "Results", icon: FileText },
  { id: "progress", label: "Progress", icon: BarChart3 },
  { id: "debug", label: "Debug", icon: FlaskConical }
];

function initialSourceMode() {
  const requested = new URLSearchParams(window.location.search).get("source");
  if (requested === "python" || requested === "browser" || requested === "mock") return requested;
  return "browser";
}

export default function App() {
  const [activeTab, setActiveTab] = useState("exercises");
  const [selectedExercise, setSelectedExercise] = useState(defaultExercise);
  const [showExerciseDetail, setShowExerciseDetail] = useState(false);
  const [packet, setPacket] = useState(null);
  const [cue, setCue] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [live, setLive] = useState(true);
  const [sourceMode, setSourceMode] = useState(initialSourceMode);
  const [sourceStatus, setSourceStatus] = useState(null);
  const [frameTick, setFrameTick] = useState(Date.now());
  const [health, setHealth] = useState("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    getHealth()
      .then((data) => setHealth(data.status))
      .catch(() => setHealth("offline"));
    refreshSessions();
    getLiveSource()
      .then((status) => setSourceStatus(status))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      getLiveSource()
        .then((status) => {
          setSourceStatus(status);
          setFrameTick(Date.now());
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setPacket(null);
    setCue(null);
    setError("");
  }, [sourceMode]);

  useEffect(() => {
    if (!live || sourceMode === "browser") return undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const nextPacket = await getLatestPacket(sourceMode);
        if (cancelled) return;
        setPacket(nextPacket);
        setError("");
        if (sourceMode === "python") setFrameTick(Date.now());
        const nextCue = await getCoachCue(nextPacket);
        if (!cancelled) setCue(nextCue);
      } catch (err) {
        if (!cancelled) {
          const expectedPythonOffline =
            sourceMode === "python" && err.message.includes("Python OpenCV tracker not connected");
          setPacket(null);
          setCue(null);
          setError(expectedPythonOffline ? "" : err.message);
        }
      }
    };

    tick();
    const id = window.setInterval(tick, 500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [live, sourceMode]);

  const sessionLabel = useMemo(() => sessionId || packet?.session_id || "local-webcam-session", [packet, sessionId]);

  const handleBrowserPacket = useCallback(async (nextPacket) => {
    if (sourceMode !== "browser") return;
    setPacket(nextPacket);
    setError("");
    try {
      const nextCue = await getCoachCue(nextPacket);
      setCue(nextCue);
    } catch {
      setCue(null);
    }
  }, [sourceMode]);

  async function refreshSessions() {
    try {
      setSessions(await getSessions());
    } catch {
      setSessions([]);
    }
  }

  async function beginExercise() {
    setSourceMode("browser");
    const response = await startSession({
      user_id: "demo-user",
      exercise: selectedExercise.id,
      side: selectedExercise.side || "right",
      target_angle: selectedExercise.targetPosition?.elbowAngleMax || 90
    });
    setSessionId(response.session_id);
    setSummary(null);
    setLive(true);
    setActiveTab("live");
  }

  async function handleEnd() {
    const activeSession = sessionId || packet?.session_id || "local-webcam-session";
    const nextSummary = await endSession({
      session_id: activeSession,
      pain_level: 2,
      fatigue_level: 4
    });
    setSummary(nextSummary);
    setSessionId(null);
    setActiveTab("results");
    await refreshSessions();
  }

  function handleExerciseStart(exercise) {
    if (exercise.status !== "ready") return;
    setSelectedExercise(exercise);
    setShowExerciseDetail(true);
  }

  const pageTitle = {
    exercises: showExerciseDetail ? selectedExercise.name : "Choose an exercise",
    live: selectedExercise.name,
    results: "Session results",
    progress: "Progress",
    debug: "Developer debug"
  }[activeTab];

  const pageSubtitle = {
    exercises: showExerciseDetail
      ? "Review setup cues and begin live webcam analysis."
      : "A guided rehab flow focused on one reliable local movement demo.",
    live: "Live Webcam Analysis tracks your shoulder, elbow, and wrist landmarks in this browser.",
    results: "Most recent completed session summary.",
    progress: "Saved sessions and clearly labeled demo history.",
    debug: "Raw packet, source, and backend controls moved out of the patient flow."
  }[activeTab];

  return (
    <main className="app-frame">
      <div className="texture-field" aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Activity size={22} /></div>
          <div>
            <strong>Physio</strong>
            <span>Guided rehab</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={activeTab === item.id ? "active" : ""}
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id !== "exercises") setShowExerciseDetail(false);
                }}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <span className={`health-dot health-dot-${health}`} />
          <div>
            <strong>{health === "ok" ? "Backend connected" : "Backend offline"}</strong>
            <span>Live Webcam Analysis</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Physical therapy demo</p>
            <h1>{pageTitle}</h1>
            <p>{pageSubtitle}</p>
          </div>
          {activeTab === "live" && (
            <div className="session-actions">
              <button type="button" onClick={beginExercise}>
                <Play size={17} /> Restart
              </button>
              <button type="button" onClick={handleEnd}>
                <Square size={17} /> End Session
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setLive((value) => !value)}
                aria-label={live ? "Pause live updates" : "Resume live updates"}
                title={live ? "Pause live updates" : "Resume live updates"}
              >
                {live ? <Pause size={18} /> : <Power size={18} />}
              </button>
            </div>
          )}
        </header>

        {error && activeTab === "debug" && <div className="error-banner">{error}</div>}

        {activeTab === "exercises" && (
          showExerciseDetail ? (
            <ExercisePreview
              exercise={selectedExercise}
              onBack={() => setShowExerciseDetail(false)}
              onBegin={beginExercise}
            />
          ) : (
            <ExercisesPage exercises={exercises} onStart={handleExerciseStart} />
          )
        )}

        {activeTab === "live" && (
          <LiveSessionPage
            packet={packet}
            cue={cue}
            selectedExercise={selectedExercise}
            sourceStatus={sourceStatus}
            sessionLabel={sessionLabel}
            frameTick={frameTick}
            onBrowserPacket={handleBrowserPacket}
          />
        )}

        {activeTab === "results" && (
          <ResultsPage summary={summary} selectedExercise={selectedExercise} />
        )}

        {activeTab === "progress" && (
          <ProgressDashboard packet={packet} sessions={sessions} sourceMode={sourceMode} />
        )}

        {activeTab === "debug" && (
          <DebugPage
            packet={packet}
            health={health}
            sourceMode={sourceMode}
            setSourceMode={setSourceMode}
            sourceStatus={sourceStatus}
            sessions={sessions}
            summary={summary}
          />
        )}
        <footer className="footer-wordmark" aria-hidden="true">physio</footer>
      </section>
    </main>
  );
}

function ExercisesPage({ exercises: exerciseList, onStart }) {
  return (
    <>
      <section className="product-hero">
        <div className="hero-demo-panel">
          <span className="demo-pill">Live rehab demo</span>
          <strong>Webcam range-of-motion measurement</strong>
        </div>
        <div className="hero-copy">
          <p className="eyebrow">Guided motion analysis for home rehab</p>
          <h2>Practice elbow flexion with visible, repeatable feedback.</h2>
          <p>
            Physio uses shoulder, elbow, and wrist landmarks to estimate range of motion,
            then turns the session into simple cues and progress records.
          </p>
          <button type="button" onClick={() => onStart(exerciseList[0])}>
            Start elbow session <ChevronRight size={17} />
          </button>
        </div>
      </section>

      <section className="section-block">
        <p className="eyebrow">Exercise library</p>
        <h2 className="section-heading">Choose the motion you want to measure.</h2>
        <div className="exercise-grid">
          {exerciseList.map((exercise, index) => (
            <article key={exercise.id} className={`exercise-card exercise-card-${index + 1} ${exercise.status === "ready" ? "ready" : ""}`}>
              <div className="exercise-card-top">
                <span className="joint-pill">{exercise.joint}</span>
                <span className="status-pill">{exercise.status === "ready" ? "Ready" : "Coming soon"}</span>
              </div>
              <div className="exercise-mini-ui">
                <p>{exercise.status === "ready" ? "ANALYSIS READY" : "PLANNED MODULE"}</p>
                {exercise.metrics.slice(0, 3).map((metric) => <span key={metric}>{formatMetricLabel(metric)}</span>)}
              </div>
              <div>
                <h2>{exercise.name}</h2>
                <p>{exercise.description}</p>
              </div>
              <div className="metric-tags">
                {exercise.metrics.map((metric) => <span key={metric}>{formatMetricLabel(metric)}</span>)}
              </div>
              <button type="button" disabled={exercise.status !== "ready"} onClick={() => onStart(exercise)}>
                {exercise.status === "ready" ? "Start Exercise" : "Coming soon"}
                {exercise.status === "ready" && <ChevronRight size={17} />}
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function LiveSessionPage({ packet, cue, selectedExercise, sourceStatus, sessionLabel, frameTick, onBrowserPacket }) {
  return (
    <div className="live-session-layout">
      <section className="live-session-main">
        <LiveSession
          packet={packet}
          sourceMode="browser"
          sourceStatus={sourceStatus}
          sessionId={sessionLabel}
          frameTick={frameTick}
          onBrowserPacket={onBrowserPacket}
          showDebug={false}
          exerciseTitle={selectedExercise.name}
        />
      </section>
      <aside className="session-side">
        <CoachPanel packet={packet} cue={cue} />
        <section className="session-status-card">
          <p className="eyebrow">Session status</p>
          <h2>{selectedExercise.name}</h2>
          <div className="status-list">
            <span>Source <strong>Live Webcam Analysis</strong></span>
            <span>Rep goal <strong>{selectedExercise.repGoal}</strong></span>
            <span>Phase <strong>{packet?.rep_phase || "waiting"}</strong></span>
            <span>Confidence <strong>{packet ? packet.landmark_confidence.toFixed(3) : "--"}</strong></span>
          </div>
        </section>
      </aside>
    </div>
  );
}

function ResultsPage({ summary, selectedExercise }) {
  if (!summary) {
    return (
      <section className="empty-state">
        <FileText size={34} />
        <h2>No completed session yet.</h2>
        <p>Run {selectedExercise.name} and end the session to see a local summary here.</p>
      </section>
    );
  }
  return <SessionSummary summary={summary} />;
}

function DebugPage({ packet, health, sourceMode, setSourceMode, sourceStatus, sessions, summary }) {
  return (
    <div className="debug-layout">
      <section className="debug-card">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Source controls</p>
            <h2>Developer panel</h2>
          </div>
          <span className={`health health-${health}`}>{health}</span>
        </div>
        <div className="segmented-control segmented-control-wide" aria-label="Data source">
          <button type="button" className={sourceMode === "python" ? "active" : ""} onClick={() => setSourceMode("python")} title="Use Python OpenCV packets and overlay frames">
            <Video size={16} /> Python OpenCV
          </button>
          <button type="button" className={sourceMode === "browser" ? "active" : ""} onClick={() => setSourceMode("browser")} title="Use browser MediaPipe tracking">
            <Camera size={16} /> Live Webcam Analysis
          </button>
          <button type="button" className={sourceMode === "mock" ? "active" : ""} onClick={() => setSourceMode("mock")} title="Use generated mock packets">
            <Database size={16} /> Mock Demo
          </button>
        </div>
      </section>

      <section className="debug-card">
        <p className="eyebrow">Integration status</p>
        <IntegrationStatus health={health} packet={packet} sourceMode={sourceMode} sourceStatus={sourceStatus} />
      </section>

      <section className="debug-card">
        <p className="eyebrow">Pose booleans</p>
        <div className="analysis-debug-panel">
          <span>pose_detected: <strong>{boolText(packet?.pose_detected)}</strong></span>
          <span>shoulder_present: <strong>{boolText(packet?.shoulder_present)}</strong></span>
          <span>elbow_present: <strong>{boolText(packet?.elbow_present)}</strong></span>
          <span>wrist_present: <strong>{boolText(packet?.wrist_present)}</strong></span>
          <span>hip_present: <strong>{boolText(packet?.hip_present)}</strong></span>
          <span>landmark_confidence: <strong>{packet ? packet.landmark_confidence.toFixed(3) : "--"}</strong></span>
          <span>angle_valid: <strong>{boolText(packet?.angle_valid)}</strong></span>
        </div>
      </section>

      <section className="debug-card debug-json">
        <p className="eyebrow">Raw packet JSON</p>
        <pre>{JSON.stringify({ packet, sourceStatus, summary, sessions }, null, 2)}</pre>
      </section>
    </div>
  );
}

function IntegrationStatus({ health, packet, sourceMode, sourceStatus }) {
  const sensorOnline = packet?.source !== "mock" && packet?.sensor_status === "ok" && packet?.distance_cm != null;
  const browserActive = sourceMode === "browser" && sourceStatus?.browser_recent;
  return (
    <div className="integration-panel" aria-label="Integration status">
      <StatusItem label="Python OpenCV" value={sourceStatus?.python_recent ? "connected" : "offline"} tone={sourceStatus?.python_recent ? "good" : "warn"} />
      <StatusItem label="Live Webcam" value={browserActive ? "active" : "inactive"} tone={browserActive ? "good" : "neutral"} />
      <StatusItem label="Sensor" value={sensorOnline ? `${packet.distance_cm.toFixed(1)} cm` : "Sensor offline"} tone={sensorOnline ? "good" : "warn"} />
      <StatusItem label="Backend" value={health === "ok" ? "connected" : "offline"} tone={health === "ok" ? "good" : "warn"} />
      <StatusItem label="Packet source" value={packet?.source || sourceMode} tone={packet?.source === "mock" || sourceMode === "mock" ? "warn" : "good"} />
    </div>
  );
}

function StatusItem({ label, value, tone = "neutral" }) {
  return (
    <article className={`integration-item integration-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function boolText(value) {
  if (value == null) return "--";
  return value ? "true" : "false";
}

function formatMetricLabel(metric) {
  return metric.replaceAll("_", " ");
}
