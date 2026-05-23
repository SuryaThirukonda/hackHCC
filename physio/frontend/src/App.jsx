import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
  getCoachProviderStatus,
  getHealth,
  getLatestPacket,
  getLiveSource,
  getSessionResults,
  getSessions,
  listPresentationCaches,
  savePresentationCache,
  saveSessionResult,
  startSession
} from "./api/client.js";
import { getPresentationStatus } from "./api/sessionRecordingV2Client.js";
import { generateGeminiSessionAnalysis } from "./analysis/gemini/geminiSessionAnalysisClient.js";
import { buildFinalSessionAnalysisPacket } from "./analysis/session/buildFinalSessionAnalysisPacket.js";
import { buildPhysioAIPacket } from "./ai/buildPhysioAIPacket.js";
import {
  resolveOverlayCoachMessage,
  resolveSpokenCoachCue
} from "./ai/coachVoiceScript.js";
import { speakCoachCue } from "./ai/elevenLabsClient.js";
import CoachPanel from "./components/CoachPanel.jsx";
import BlobCoachCompanion from "./components/coach/BlobCoachCompanion.jsx";
import CountdownOverlay from "./components/CountdownOverlay.jsx";
import ExercisePreview from "./components/ExercisePreview.jsx";
import LiveSession from "./components/LiveSession.jsx";
import ProgressDashboard from "./components/ProgressDashboard.jsx";
import SessionSummary from "./components/SessionSummary.jsx";
import ResultsPresentationPanel from "./components/results/ResultsPresentationPanel.jsx";
import { defaultExercise, exercises } from "./exercises/index.js";
import { useSessionRecorder } from "./recording/useSessionRecorder.js";
import {
  RUNNER_EVENTS,
  RUNNER_STATES,
  createInitialExerciseRunnerState,
  exerciseRunnerReducer,
  isRecordingState,
  summarizeRunnerSession
} from "./state/exerciseRunner.js";

const navItems = [
  { id: "exercises", label: "Exercises", icon: Dumbbell },
  { id: "live", label: "Live Session", icon: Camera },
  { id: "results", label: "Results", icon: FileText },
  { id: "progress", label: "Progress", icon: BarChart3 },
  { id: "debug", label: "Debug", icon: FlaskConical }
];

const LOCAL_SESSION_HISTORY_KEY = "physio_elbow_completed_sessions";
const GEMINI_SESSION_CACHE_KEY = "physio_gemini_session_analysis_cache";
const VOICE_MIN_GAP_MS = 4500;
const IMPORTANT_VOICE_STATES = new Set([
  "too_fast",
  "too_jittery",
  "rep_complete",
  "session_complete",
  "straighten_more",
  "bend_more",
  "hold_longer"
]);

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
  const [sessionResults, setSessionResults] = useState([]);
  const [presentationCaches, setPresentationCaches] = useState({});
  const [localSessions, setLocalSessions] = useState(() => loadLocalSessionHistory());
  const [summary, setSummary] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [live, setLive] = useState(true);
  const [sourceMode, setSourceMode] = useState(initialSourceMode);
  const [sourceStatus, setSourceStatus] = useState(null);
  const [frameTick, setFrameTick] = useState(Date.now());
  const [health, setHealth] = useState("checking");
  const [error, setError] = useState("");
  const [runner, dispatchRunner] = useReducer(
    exerciseRunnerReducer,
    createInitialExerciseRunnerState(defaultExercise)
  );
  const [countdownValue, setCountdownValue] = useState(null);
  const sessionStartTokenRef = useRef(0);
  const sessionVoicePrimedRef = useRef(false);
  const [aiCue, setAiCue] = useState({
    text: "",
    status: "idle",
    source: "local",
    error: "",
    lastCoachState: "",
    lastRepCount: 0
  });
  const [aiSummaryText, setAiSummaryText] = useState("");
  const [aiHealthReport, setAiHealthReport] = useState("");
  const [latestAiPacket, setLatestAiPacket] = useState(null);
  const [finalAnalysisPacket, setFinalAnalysisPacket] = useState(null);
  const [geminiSessionAnalysis, setGeminiSessionAnalysis] = useState(null);
  const [geminiSessionStatus, setGeminiSessionStatus] = useState("idle");
  const [geminiSessionError, setGeminiSessionError] = useState("");
  const [geminiAnalysisCache, setGeminiAnalysisCache] = useState(() => loadGeminiSessionAnalysisCache());
  const [presentationStatus, setPresentationStatus] = useState(null);
  const [sessionRecording, setSessionRecording] = useState(null);
  const [providerStatus, setProviderStatus] = useState(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [voiceError, setVoiceError] = useState("");
  const [resultsVoiceStatus, setResultsVoiceStatus] = useState("idle");
  const [blobMinimized, setBlobMinimized] = useState(false);
  const [bonusRepRequested, setBonusRepRequested] = useState(false);
  const voiceThrottleRef = useRef({ lastSpeakAt: 0, lastText: "", lastPhase: "" });
  const audioRef = useRef(null);
  const pendingAudioRef = useRef(null); // queued URL to play once current clip ends
  const recorder = useSessionRecorder({
    sessionId,
    exerciseId: selectedExercise?.id,
    active: isRecordingState(runner.status)
  });

  useEffect(() => {
    getHealth()
      .then((data) => setHealth(data.status))
      .catch(() => setHealth("offline"));
    refreshSessions();
    getLiveSource()
      .then((status) => setSourceStatus(status))
      .catch(() => {});
    getCoachProviderStatus()
      .then((status) => setProviderStatus(status))
      .catch((err) => setProviderStatus({ error: err.message }));
    getPresentationStatus()
      .then((status) => setPresentationStatus(status))
      .catch(() => {});
  }, []);

  // Reload session data from DB whenever user switches to the results tab
  useEffect(() => {
    if (activeTab === "results") refreshSessions();
    if (activeTab !== "results") setResultsVoiceStatus("idle");
  }, [activeTab]);

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

  useEffect(() => {
    if (runner.status !== RUNNER_STATES.COUNTDOWN) {
      setCountdownValue(null);
      return undefined;
    }

    const sequence = ["3", "2", "1", "Go"];
    let index = 0;
    setCountdownValue(sequence[index]);
    const id = window.setInterval(() => {
      index += 1;
      if (index >= sequence.length) {
        window.clearInterval(id);
        setCountdownValue(null);
        dispatchRunner({ type: RUNNER_EVENTS.COUNTDOWN_COMPLETE, startedAt: new Date().toISOString() });
        return;
      }
      setCountdownValue(sequence[index]);
    }, 900);

    return () => window.clearInterval(id);
  }, [runner.status]);

  const handleBrowserPacket = useCallback(async (nextPacket) => {
    if (sourceMode !== "browser") return;
    setPacket(nextPacket);
    setError("");
    if (isRecordingState(runner.status) && nextPacket.calibration_complete !== false) {
      dispatchRunner({
        type: "PACKET_RECORDED",
        packet: nextPacket,
        analyzerOutput: nextPacket.analyzer_output || null,
        completedRep: nextPacket.completed_rep || null
      });
      recorder.recordPacket(nextPacket, nextPacket.smoothed_frame || null);
    }
    setCue({
      message: nextPacket.local_coach_message,
      source: "local",
      voice_status: "idle",
      avatar_status: "disabled",
      should_speak: false,
      reason: "local_browser_packet"
    });
  }, [recorder, runner.status, sourceMode]);

  const handleRoutineBegin = useCallback(() => {
    setLive(true);
    setActiveTab("live");
    if (!isRecordingState(runner.status)) {
      dispatchRunner({
        type: RUNNER_EVENTS.START_SESSION,
        startedAt: new Date().toISOString()
      });
    }
  }, [runner.status]);

  useEffect(() => {
    if (runner.status !== RUNNER_STATES.ACTIVE) return;
    const analyzerOutput = packet?.analyzer_output || runner.latestAnalyzerOutput;
    if (!packet && !analyzerOutput) return;

    const aiPacket = buildPhysioAIPacket({
      exercise: selectedExercise,
      analyzerOutput,
      packet,
      mode: "live_coaching"
    });
    setLatestAiPacket(aiPacket);

    const spoken = resolveSpokenCoachCue({ aiCue: null, packet, analyzerOutput });
    setAiCue({
      text: spoken.text,
      status: "ready",
      source: spoken.source,
      error: "",
      lastCoachState: aiPacket.coach_state,
      lastRepCount: aiPacket.rep_count,
      lastPhase: aiPacket.phase
    });
  }, [packet, runner.latestAnalyzerOutput, runner.status, selectedExercise]);

  useEffect(() => {
    if (runner.status !== RUNNER_STATES.ACTIVE) return undefined;
    const analyzerOutput = packet?.analyzer_output || runner.latestAnalyzerOutput;
    const spoken = resolveSpokenCoachCue({ aiCue, packet, analyzerOutput });
    const text = spoken.text;
    const coachState = aiCue.lastCoachState || packet?.coach_state;
    const phase = analyzerOutput?.phase || aiCue.lastPhase;
    if (!voiceEnabled || voiceMuted || !text) return undefined;
    const now = Date.now();
    const phaseChanged = phase && phase !== voiceThrottleRef.current.lastPhase;
    if (phaseChanged) voiceThrottleRef.current.lastText = "";
    const shouldSpeak =
      phaseChanged ||
      repCompletedVoice(coachState, aiCue) ||
      IMPORTANT_VOICE_STATES.has(coachState) ||
      now - voiceThrottleRef.current.lastSpeakAt >= VOICE_MIN_GAP_MS;
    if (!shouldSpeak || voiceThrottleRef.current.lastText === text) return undefined;

    voiceThrottleRef.current = { lastSpeakAt: now, lastText: text, lastPhase: phase };
    setVoiceStatus("loading");
    setVoiceError("");
    speakCoachCue(text)
      .then(async (result) => {
        if (!result.audio_url) {
          setVoiceStatus(result.status || "unavailable");
          if (result.error) setVoiceError(result.error);
          return;
        }

        const playUrl = (url) => {
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => {
            const next = pendingAudioRef.current;
            if (next) {
              pendingAudioRef.current = null;
              playUrl(next);
              setVoiceStatus("playing");
            } else {
              setVoiceStatus("idle");
            }
          };
          audio.play().then(() => {
            setVoiceStatus(result.status || "playing");
          }).catch(() => {
            setVoiceStatus("blocked");
            setVoiceError("Click Speak AI cues to enable browser audio.");
          });
        };

        // If audio is currently mid-playback, queue the new URL (latest wins)
        if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
          pendingAudioRef.current = result.audio_url;
        } else {
          audioRef.current = null;
          pendingAudioRef.current = null;
          playUrl(result.audio_url);
        }
      })
      .catch((err) => {
        setVoiceStatus("error");
        setVoiceError(err.message);
      });
  }, [aiCue, packet, runner.latestAnalyzerOutput, runner.status, voiceEnabled, voiceMuted]);

  useEffect(() => {
    if (runner.status === RUNNER_STATES.ACTIVE && !sessionVoicePrimedRef.current) {
      sessionVoicePrimedRef.current = true;
      setVoiceEnabled(true);
    }
    if (runner.status === RUNNER_STATES.SELECTED || runner.status === RUNNER_STATES.IDLE) {
      sessionVoicePrimedRef.current = false;
    }
  }, [runner.status]);

  const overlayCoachMessage = useMemo(() => {
    const analyzerOutput = packet?.analyzer_output || runner.latestAnalyzerOutput;
    return resolveOverlayCoachMessage({ aiCue, packet, analyzerOutput });
  }, [aiCue, packet, runner.latestAnalyzerOutput]);

  const blobCoachMessage = useMemo(() => {
    if (activeTab === "results") {
      const cached = summary?.session_id ? presentationCaches[summary.session_id] : null;
      const cachedAnalysis = cached?.gemini_result?.analysis;
      const written = geminiSessionAnalysis?.analysis?.written_summary || cachedAnalysis?.written_summary || "";
      const spoken = geminiSessionAnalysis?.analysis?.spoken_summary || cachedAnalysis?.spoken_summary || "";
      if (written || spoken) return written || spoken;
      if (geminiSessionStatus === "loading") return "Preparing your AI summary…";
      if (summary?.recommendation_text) return summary.recommendation_text;
      if (cached?.summary?.recommendation_text) return cached.summary.recommendation_text;
      if (!summary) {
        const latestCache = Object.values(presentationCaches)[0];
        const latestAnalysis = latestCache?.gemini_result?.analysis;
        if (latestAnalysis?.written_summary || latestAnalysis?.spoken_summary) {
          return latestAnalysis.written_summary || latestAnalysis.spoken_summary;
        }
        if (latestCache?.summary?.recommendation_text) return latestCache.summary.recommendation_text;
      }
      return "Complete a session to see your coach summary.";
    }
    if (runner.status === RUNNER_STATES.COUNTDOWN) return "Get ready…";
    if (runner.status === RUNNER_STATES.ACTIVE) {
      return overlayCoachMessage || aiCue?.text || packet?.local_coach_message || "Follow the movement cues.";
    }
    if (activeTab === "live") return "Select an exercise and start your session.";
    if (activeTab === "exercises") {
      return showExerciseDetail
        ? "Review the setup, then begin when you're ready."
        : "Choose an exercise to begin.";
    }
    return "Your coach is here when you need guidance.";
  }, [
    activeTab,
    runner.status,
    overlayCoachMessage,
    aiCue,
    packet,
    geminiSessionAnalysis,
    geminiSessionStatus,
    summary,
    showExerciseDetail,
    presentationCaches
  ]);

  const blobCoachStatus = useMemo(() => {
    if (activeTab === "results") {
      if (resultsVoiceStatus === "playing") return "speaking";
      if (resultsVoiceStatus === "loading" || geminiSessionStatus === "loading") return "thinking";
      return "idle";
    }
    if (voiceStatus === "playing") return "speaking";
    if (voiceStatus === "loading") return "thinking";
    if (runner.status === RUNNER_STATES.COUNTDOWN) return "thinking";
    return "idle";
  }, [activeTab, voiceStatus, resultsVoiceStatus, geminiSessionStatus, runner.status]);

  async function refreshSessions() {
    const [basicResult, richResult, cacheResult] = await Promise.allSettled([
      getSessions(),
      getSessionResults(),
      listPresentationCaches()
    ]);
    if (basicResult.status === "fulfilled") setSessions(basicResult.value);
    if (richResult.status === "fulfilled") setSessionResults(richResult.value);
    if (cacheResult.status === "fulfilled") {
      const map = {};
      for (const item of cacheResult.value || []) {
        if (item?.session_id) map[item.session_id] = item;
      }
      setPresentationCaches(map);
    }
  }

  async function persistPresentationCache(activeSessionId, partial) {
    if (!activeSessionId) return;
    try {
      const response = await savePresentationCache({ session_id: activeSessionId, ...partial });
      const cache = response?.cache || { session_id: activeSessionId, ...partial };
      setPresentationCaches((prev) => ({
        ...prev,
        [activeSessionId]: { ...prev[activeSessionId], ...cache }
      }));
    } catch {
      // Non-fatal — results UI can still use in-memory state.
    }
  }

  async function beginExercise() {
    setSourceMode("browser");
    const sessionToken = sessionStartTokenRef.current + 1;
    sessionStartTokenRef.current = sessionToken;
    const provisionalSessionId = `browser-webcam-${Date.now()}`;
    const targetAngle = selectedExercise.targetPosition
      ? (selectedExercise.targetPosition.elbowAngleMin + selectedExercise.targetPosition.elbowAngleMax) / 2
      : 90;
    setSessionId(provisionalSessionId);
    setSummary(null);
    setPacket(null);
    setCue(null);
    setError("");
    setBonusRepRequested(false);
    setFinalAnalysisPacket(null);
    setGeminiSessionAnalysis(null);
    setGeminiSessionStatus("idle");
    setGeminiSessionError("");
    setSessionRecording(null);
    setLive(true);
    setActiveTab("live");
    dispatchRunner({
      type: RUNNER_EVENTS.START_COUNTDOWN,
      sessionId: provisionalSessionId
    });

    try {
      const response = await startSession({
        user_id: "demo-user",
        exercise: selectedExercise.id,
        side: selectedExercise.side || "right",
        target_angle: targetAngle
      });
      if (sessionStartTokenRef.current === sessionToken) {
        setSessionId(response.session_id);
      }
    } catch (err) {
      if (sessionStartTokenRef.current === sessionToken) {
        setError(err.message);
      }
    }
  }

  async function handleEnd() {
    const activeSession = sessionId || packet?.session_id || "local-webcam-session";
    const localSummary = summarizeRunnerSession(runner, {
      sessionId: activeSession,
      exercise: selectedExercise,
      painLevel: 2,
      fatigueLevel: 4
    });
    setSummary(localSummary);
    setLocalSessions((items) => {
      const next = [localSummary, ...items.filter((item) => item.session_id !== localSummary.session_id)].slice(0, 12);
      saveLocalSessionHistory(next);
      return next;
    });
    // Persist the full rich summary (with completed_reps) to SQLite immediately
    saveSessionResult(localSummary).catch(() => {});
    setSessionId(null);
    setActiveTab("results");
    dispatchRunner({ type: RUNNER_EVENTS.END_SESSION });
    setAiSummaryText(localSummary.recommendation_text);
    setAiHealthReport("");
    const finalPacket = buildFinalSessionAnalysisPacket({
      runner,
      exercise: selectedExercise,
      sessionId: activeSession,
      painLevel: 2,
      fatigueLevel: 4
    });
    setFinalAnalysisPacket(finalPacket);
    setLatestAiPacket(finalPacket);
    persistPresentationCache(activeSession, {
      summary: localSummary,
      final_analysis_packet: finalPacket
    });
    setGeminiSessionAnalysis(null);
    setGeminiSessionStatus("loading");
    setGeminiSessionError("");
    generateGeminiSessionAnalysis(finalPacket)
      .then((result) => {
        const status = result.fallback_used ? "fallback" : "ready";
        const cacheEntry = saveGeminiSessionAnalysisCache({
          sessionId: activeSession,
          packet: finalPacket,
          result,
          status,
          error: result.error_message_sanitized || ""
        });
        setGeminiSessionAnalysis(result);
        setGeminiSessionStatus(status);
        setAiSummaryText(result.analysis?.written_summary || localSummary.recommendation_text);
        setAiHealthReport(result.analysis?.focus_next_time || "");
        setGeminiSessionError(result.error_message_sanitized || "");
        setGeminiAnalysisCache(cacheEntry);
        persistPresentationCache(activeSession, {
          summary: localSummary,
          final_analysis_packet: finalPacket,
          gemini_result: result,
          gemini_status: status,
          gemini_error: result.error_message_sanitized || "",
          gemini_cache: cacheEntry
        });
      })
      .catch((err) => {
        const cacheEntry = saveGeminiSessionAnalysisCache({
          sessionId: activeSession,
          packet: finalPacket,
          result: null,
          status: "error",
          error: err.message
        });
        setGeminiSessionStatus("error");
        setGeminiSessionError(err.message);
        setAiSummaryText(localSummary.recommendation_text);
        setAiHealthReport("");
        setAiCue((current) => ({ ...current, error: err.message }));
        setGeminiAnalysisCache(cacheEntry);
        persistPresentationCache(activeSession, {
          summary: localSummary,
          final_analysis_packet: finalPacket,
          gemini_result: null,
          gemini_status: "error",
          gemini_error: err.message,
          gemini_cache: cacheEntry
        });
      });
    recorder.stopAndSave()
      .then((recording) => {
        if (recording) {
          setSessionRecording(recording);
          persistPresentationCache(activeSession, { recording });
        }
      })
      .catch(() => {});
    try {
      await endSession({
        session_id: activeSession,
        pain_level: 2,
        fatigue_level: 4
      });
      await refreshSessions();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleExerciseStart(exercise) {
    if (exercise.status !== "ready") return;
    setSelectedExercise(exercise);
    setShowExerciseDetail(true);
    dispatchRunner({ type: RUNNER_EVENTS.SELECT_EXERCISE, exercise });
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
            onRoutineBegin={handleRoutineBegin}
            runnerStatus={runner.status}
            completedReps={runner.completedReps}
            countdownValue={countdownValue}
            aiCue={aiCue}
            voiceEnabled={voiceEnabled}
            voiceMuted={voiceMuted}
            voiceStatus={voiceStatus}
            voiceError={voiceError}
            overlayCoachMessage={overlayCoachMessage}
            bonusRepRequested={bonusRepRequested}
            onBonusRep={() => setBonusRepRequested(true)}
            onEndSession={handleEnd}
            onToggleVoiceEnabled={() => setVoiceEnabled((value) => !value)}
            onToggleVoiceMuted={() => setVoiceMuted((value) => !value)}
          />
        )}

        {activeTab === "results" && (
          <ResultsPage
            summary={summary}
            selectedExercise={selectedExercise}
            aiSummaryText={aiSummaryText}
            aiHealthReport={aiHealthReport}
            finalAnalysisPacket={finalAnalysisPacket}
            geminiSessionAnalysis={geminiSessionAnalysis}
            geminiSessionStatus={geminiSessionStatus}
            geminiSessionError={geminiSessionError}
            geminiAnalysisCache={geminiAnalysisCache}
            sessionRecording={sessionRecording}
            presentationStatus={presentationStatus}
            sessionId={sessionLabel}
            sessionResults={sessionResults}
            sessions={sessions}
            presentationCaches={presentationCaches}
            onRefresh={refreshSessions}
            onResultsVoiceStatusChange={setResultsVoiceStatus}
          />
        )}

        {activeTab === "progress" && (
          <ProgressDashboard packet={packet} sessions={sessions} localSessions={localSessions} sourceMode={sourceMode} />
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
            runner={runner}
            localSessions={localSessions}
            latestAiPacket={latestAiPacket}
            finalAnalysisPacket={finalAnalysisPacket}
            geminiSessionAnalysis={geminiSessionAnalysis}
            geminiSessionStatus={geminiSessionStatus}
            geminiSessionError={geminiSessionError}
            geminiAnalysisCache={geminiAnalysisCache}
            sessionRecording={sessionRecording}
            presentationStatus={presentationStatus}
            aiCue={aiCue}
            voiceStatus={voiceStatus}
            voiceError={voiceError}
            providerStatus={providerStatus}
          />
        )}
        <footer className="footer-wordmark" aria-hidden="true">physio</footer>
      </section>

      <BlobCoachCompanion
        message={blobCoachMessage}
        status={blobCoachStatus}
        minimized={blobMinimized}
        onToggleMinimize={() => setBlobMinimized((value) => !value)}
      />
    </main>
  );
}

function repCompletedVoice(coachState, aiCue) {
  return coachState === "rep_complete" || aiCue.lastCoachState === "rep_complete";
}

function loadLocalSessionHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_SESSION_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalSessionHistory(items) {
  try {
    window.localStorage.setItem(LOCAL_SESSION_HISTORY_KEY, JSON.stringify(items));
  } catch {
    // Local history is a convenience for the demo; failing to persist should not block the session.
  }
}

function loadGeminiSessionAnalysisCache() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GEMINI_SESSION_CACHE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveGeminiSessionAnalysisCache({ sessionId, packet, result, status, error }) {
  const entry = {
    session_id: sessionId,
    cached_at_ms: Date.now(),
    status,
    fallback_used: Boolean(result?.fallback_used),
    provider: result?.provider || null,
    model: result?.model || null,
    error_message_sanitized: error || result?.error_message_sanitized || "",
    analysis: result?.analysis || null,
    result,
    packet
  };
  try {
    window.localStorage.setItem(GEMINI_SESSION_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Cache is only for demo visibility; the UI should keep working without localStorage.
  }
  return entry;
}

function resolveFeaturedPresentation({
  featuredSession,
  summary,
  presentationCaches,
  geminiSessionAnalysis,
  geminiSessionStatus,
  geminiSessionError,
  geminiAnalysisCache,
  sessionRecording,
  finalAnalysisPacket
}) {
  if (!featuredSession) return null;

  const isLive = summary?.session_id === featuredSession.session_id;
  const cache = presentationCaches?.[featuredSession.session_id];

  if (isLive) {
    return {
      sessionId: featuredSession.session_id,
      summary: featuredSession,
      geminiResult: geminiSessionAnalysis,
      geminiStatus: geminiSessionStatus,
      geminiError: geminiSessionError,
      geminiCache: geminiAnalysisCache,
      recording: sessionRecording,
      finalAnalysisPacket
    };
  }

  if (!cache) return null;

  return {
    sessionId: featuredSession.session_id,
    summary: cache.summary || featuredSession,
    geminiResult: cache.gemini_result || null,
    geminiStatus: cache.gemini_status || (cache.gemini_result ? "ready" : "idle"),
    geminiError: cache.gemini_error || "",
    geminiCache: cache.gemini_cache || null,
    recording: cache.recording || null,
    finalAnalysisPacket: cache.final_analysis_packet || null
  };
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

function LiveSessionPage({
  packet,
  cue,
  selectedExercise,
  sourceStatus,
  sessionLabel,
  frameTick,
  onBrowserPacket,
  onRoutineBegin,
  runnerStatus,
  completedReps,
  countdownValue,
  aiCue,
  voiceEnabled,
  voiceMuted,
  voiceStatus,
  voiceError,
  overlayCoachMessage,
  bonusRepRequested,
  onBonusRep,
  onEndSession,
  onToggleVoiceEnabled,
  onToggleVoiceMuted
}) {
  const recordingActive = runnerStatus === RUNNER_STATES.ACTIVE;
  const sessionComplete = packet?.coach_state === "session_complete" && runnerStatus === RUNNER_STATES.ACTIVE;
  const showBonusBanner = sessionComplete && selectedExercise.bonusRepAvailable && !bonusRepRequested;
  const currentPhase = packet?.analyzer_phase_label || {
    idle: "Start straight",
    resting: "Ready",
    raising: "Bending",
    holding: "Hold",
    lowering: "Straighten",
    rep_complete: "Rep complete"
  }[packet?.rep_phase] || packet?.rep_phase || "waiting";
  return (
    <div className="live-session-layout">
      <CountdownOverlay value={countdownValue} variant="page" />
      {showBonusBanner && (
        <div className="bonus-rep-banner">
          <div className="bonus-rep-content">
            <strong>Great work! Session complete.</strong>
            <p>If you feel comfortable, try one bonus rep.</p>
            <div className="bonus-rep-actions">
              <button type="button" className="bonus-rep-yes" onClick={onBonusRep}>
                Try a bonus rep
              </button>
              <button type="button" className="bonus-rep-end" onClick={onEndSession}>
                End session
              </button>
            </div>
          </div>
        </div>
      )}
      <section className="live-session-main">
        <LiveSession
          packet={packet}
          sourceMode="browser"
          sourceStatus={sourceStatus}
          sessionId={sessionLabel}
          frameTick={frameTick}
          onBrowserPacket={onBrowserPacket}
          onRoutineBegin={onRoutineBegin}
          showDebug={false}
          exercise={selectedExercise}
          exerciseTitle={selectedExercise.name}
          recordingActive={recordingActive}
          overlayCoachMessage={overlayCoachMessage}
          bonusRepRequested={bonusRepRequested}
        />
      </section>
      <aside className="session-side">
        <CoachPanel
          packet={packet}
          cue={cue}
          aiCue={aiCue}
          overlayCoachMessage={overlayCoachMessage}
          voiceEnabled={voiceEnabled}
          voiceMuted={voiceMuted}
          voiceStatus={voiceStatus}
          voiceError={voiceError}
          onToggleVoiceEnabled={onToggleVoiceEnabled}
          onToggleVoiceMuted={onToggleVoiceMuted}
        />
        <section className="session-status-card">
          <p className="eyebrow">Session status</p>
          <h2>{selectedExercise.name}</h2>
          <div className="status-list">
            <span>Source <strong>Live Webcam Analysis</strong></span>
            <span>Reps completed <strong>{packet?.rep_count ?? completedReps.length}/{bonusRepRequested ? selectedExercise.repGoal + 1 : selectedExercise.repGoal}</strong></span>
            <span>Runner <strong>{runnerStatus}</strong></span>
            <span>Phase <strong>{currentPhase}</strong></span>
            <span>Confidence <strong>{packet ? packet.landmark_confidence.toFixed(3) : "--"}</strong></span>
          </div>
        </section>
        <RepTimingPanel reps={completedReps} exercise={selectedExercise} />
      </aside>
    </div>
  );
}

function RepTimingPanel({ reps = [], exercise }) {
  const forwardPress = exercise?.movementType === "forward_press";
  return (
    <section className="session-status-card">
      <p className="eyebrow">{forwardPress ? "Press timing" : "Rep timing"}</p>
      <h2>{reps.length} completed</h2>
      {reps.length ? (
        <div className="rep-timing-list">
          {reps.slice(-6).map((rep) => (
            <article key={rep.rep_index} className="rep-timing-row">
              <strong>Rep {rep.rep_index}</strong>
              <span>{formatSeconds(rep.rep_duration_sec)} total</span>
              <span>{formatSeconds(rep.hold_time_sec)} hold</span>
              <span>
                {forwardPress && Number.isFinite(rep.push_depth_cm)
                  ? `${formatMaybe(rep.push_depth_cm)} cm press`
                  : `${formatMaybe(rep.range_of_motion)} deg ROM`}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">
          {forwardPress
            ? "Complete a press, hold, and return cycle to log timing."
            : "Complete a bend, hold, and straighten cycle to log rep timing."}
        </p>
      )}
    </section>
  );
}

function ResultsPage({
  summary,
  selectedExercise,
  aiSummaryText,
  aiHealthReport,
  finalAnalysisPacket,
  geminiSessionAnalysis,
  geminiSessionStatus,
  geminiSessionError,
  geminiAnalysisCache,
  sessionRecording,
  presentationStatus,
  sessionId,
  sessionResults,
  sessions,
  presentationCaches,
  onRefresh,
  onResultsVoiceStatusChange
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const dbRows = sessionResults.length > 0 ? sessionResults : sessions;

  const allResults = summary
    ? [summary, ...dbRows.filter((r) => r.session_id !== summary.session_id)]
    : dbRows;

  const featuredSession = allResults[0] || null;
  const historyRows = allResults.slice(1);
  const featuredPresentation = resolveFeaturedPresentation({
    featuredSession,
    summary,
    presentationCaches,
    geminiSessionAnalysis,
    geminiSessionStatus,
    geminiSessionError,
    geminiAnalysisCache,
    sessionRecording,
    finalAnalysisPacket
  });

  async function handleRefresh() {
    setRefreshing(true);
    try { await onRefresh(); } catch { /* ignore */ }
    setRefreshing(false);
  }

  return (
    <div className="results-page">
      <div className="results-page-header">
        <div>
          <p className="eyebrow">Physical Therapy Demo</p>
          <h1>Session results</h1>
          <p className="muted-sub">All completed sessions stored in the database.</p>
        </div>
        <button
          type="button"
          className="refresh-btn"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshIcon spinning={refreshing} />
          {refreshing ? "Loading…" : "Refresh"}
        </button>
      </div>

      {!featuredSession ? (
        <section className="empty-state">
          <FileText size={34} />
          <h2>No completed sessions yet.</h2>
          <p>Run {selectedExercise?.name || "an exercise"} and end the session to see results here.</p>
        </section>
      ) : (
        <>
          {featuredPresentation && (
            <ResultsPresentationPanel
              geminiResult={featuredPresentation.geminiResult}
              geminiStatus={featuredPresentation.geminiStatus}
              sessionId={featuredPresentation.sessionId}
              summary={featuredPresentation.summary}
              recording={featuredPresentation.recording}
              finalAnalysisPacket={featuredPresentation.finalAnalysisPacket}
              geminiError={featuredPresentation.geminiError}
              geminiCache={featuredPresentation.geminiCache}
              onVoiceStatusChange={onResultsVoiceStatusChange}
            />
          )}
          <SessionSummary
            summary={featuredSession}
            aiSummaryText={
              featuredPresentation?.geminiResult?.analysis?.written_summary
              || (featuredSession.session_id === summary?.session_id ? aiSummaryText : "")
            }
            aiHealthReport={
              featuredPresentation?.geminiResult?.analysis?.focus_next_time
              || (featuredSession.session_id === summary?.session_id ? aiHealthReport : "")
            }
          />

          {historyRows.length > 0 && (
            <section className="session-history">
              <div className="session-history-heading">
                <p className="eyebrow">Session history</p>
                <span className="history-count">{historyRows.length} previous {historyRows.length === 1 ? "session" : "sessions"}</span>
              </div>
              <div className="history-list">
                {historyRows.map((sess) => (
                  <HistoryCard
                    key={sess.session_id}
                    session={sess}
                    expanded={expandedId === sess.session_id}
                    onToggle={() => setExpandedId(expandedId === sess.session_id ? null : sess.session_id)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function HistoryCard({ session, expanded, onToggle }) {
  const date = session.ended_at_ms
    ? new Date(session.ended_at_ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "—";
  const time = session.ended_at_ms
    ? new Date(session.ended_at_ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";

  const bestRom = session.best_range_of_motion ?? session.best_angle;
  const avgRom = session.average_range_of_motion ?? session.average_angle;
  const isForwardPressSession = session.exercise === "seated_one_arm_forward_press";
  const bestPushDepth = session.best_push_depth_cm;

  return (
    <div className={`history-card${expanded ? " history-card--open" : ""}`}>
      <button type="button" className="history-card-row" onClick={onToggle}>
        <div className="history-card-date">
          <span className="history-date-main">{date}</span>
          <span className="history-date-time">{time}</span>
        </div>
        <div className="history-card-exercise">{exerciseLabelShort(session.exercise)}</div>
        <div className="history-card-stat">
          <span className="hstat-value">{session.total_reps ?? "—"}</span>
          <span className="hstat-label">reps</span>
        </div>
        <div className="history-card-stat">
          <span className="hstat-value">
            {isForwardPressSession && Number.isFinite(bestPushDepth)
              ? bestPushDepth.toFixed(0)
              : Number.isFinite(bestRom) ? bestRom.toFixed(0) : "—"}
          </span>
          <span className="hstat-label">{isForwardPressSession ? "best cm" : "best ROM°"}</span>
        </div>
        <div className="history-card-stat">
          <span className="hstat-value">{session.average_physio_score ?? "—"}</span>
          <span className="hstat-label">score</span>
        </div>
        <div className="history-card-stat">
          <span className="hstat-value">{session.duration_sec ?? "—"}</span>
          <span className="hstat-label">sec</span>
        </div>
        <span className="history-chevron">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="history-card-detail">
          {/* recommendation blurb */}
          {session.recommendation_text && (
            <p className="hdetail-blurb">{session.recommendation_text}</p>
          )}

          {/* wide stat grid */}
          <div className="hdetail-stat-grid">
            <div className="hdetail-stat">
              <span className="hds-label">Exercise</span>
              <span className="hds-value">{exerciseLabelShort(session.exercise)}</span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Duration</span>
              <span className="hds-value">{session.duration_sec ?? "—"}<small> s</small></span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Total reps</span>
              <span className="hds-value">{session.total_reps ?? "—"}</span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Clean reps</span>
              <span className="hds-value">{session.clean_reps ?? "—"}</span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">{isForwardPressSession ? "Best press" : "Best ROM"}</span>
              <span className="hds-value">
                {isForwardPressSession && Number.isFinite(bestPushDepth)
                  ? bestPushDepth.toFixed(1)
                  : Number.isFinite(bestRom) ? bestRom.toFixed(1) : "—"}
                <small>{isForwardPressSession ? " cm" : "°"}</small>
              </span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">{isForwardPressSession ? "Avg press" : "Avg ROM"}</span>
              <span className="hds-value">
                {isForwardPressSession && Number.isFinite(session.average_push_depth_cm)
                  ? session.average_push_depth_cm.toFixed(1)
                  : Number.isFinite(avgRom) ? avgRom.toFixed(1) : "—"}
                <small>{isForwardPressSession ? " cm" : "°"}</small>
              </span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Avg hold</span>
              <span className="hds-value">{Number.isFinite(session.average_hold_time_sec) ? session.average_hold_time_sec.toFixed(1) : "—"}<small> s</small></span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Score</span>
              <span className="hds-value">{session.average_physio_score ?? "—"}</span>
            </div>
            <div className="hdetail-stat">
              <span className="hds-label">Avg jitter</span>
              <span className="hds-value">{Number.isFinite(session.average_jitter_score) ? session.average_jitter_score.toFixed(2) : "—"}</span>
            </div>
          </div>

          {/* rep-by-rep table */}
          {Array.isArray(session.completed_reps) && session.completed_reps.length > 0 && (
            <div className="hdetail-reps">
              <p className="eyebrow hdetail-reps-heading">Rep-by-rep breakdown</p>
              <div className="hdetail-rep-table">
                <span className="hdr-head">Rep</span>
                <span className="hdr-head">{isForwardPressSession ? "Press cm" : "ROM°"}</span>
                <span className="hdr-head">Hold</span>
                <span className="hdr-head">Duration</span>
                <span className="hdr-head">Score</span>
                <span className="hdr-head">Pace</span>
                <span className="hdr-head">Issue</span>
                {session.completed_reps.map((rep) => (
                  <React.Fragment key={rep.rep_index}>
                    <span className="hdr-num">#{rep.rep_index}</span>
                    <span>
                      {isForwardPressSession && Number.isFinite(rep.push_depth_cm)
                        ? rep.push_depth_cm.toFixed(1)
                        : Number.isFinite(rep.range_of_motion) ? rep.range_of_motion.toFixed(0) : "—"}
                    </span>
                    <span>{Number.isFinite(rep.hold_time_sec) ? `${rep.hold_time_sec.toFixed(1)}s` : "—"}</span>
                    <span>{Number.isFinite(rep.rep_duration_sec) ? `${rep.rep_duration_sec.toFixed(1)}s` : "—"}</span>
                    <span className={rep.physio_score >= 70 ? "hdr-good" : rep.physio_score >= 50 ? "hdr-ok" : "hdr-bad"}>{rep.physio_score ?? "—"}</span>
                    <span>{rep.pace || "—"}</span>
                    <span className={rep.issue === "none" ? "hdr-clean" : "hdr-issue"}>{issueShort(rep.issue)}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function issueShort(issue) {
  return {
    did_not_bend_enough: "bend deeper",
    short_push_depth: "short press",
    did_not_hold_long_enough: "hold longer",
    moved_too_fast: "too fast",
    too_jittery: "jittery",
    shoulder_compensation: "arm drift",
    low_confidence: "tracking",
    none: "clean",
  }[issue] ?? issue ?? "—";
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, animation: spinning ? "spin 0.8s linear infinite" : "none" }}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function exerciseLabelShort(id) {
  return {
    elbow_flexion_extension: "Elbow Flexion",
    seated_one_arm_forward_press: "Forward Press"
  }[id] || id || "—";
}

function DebugPage({
  packet,
  health,
  sourceMode,
  setSourceMode,
  sourceStatus,
  sessions,
  summary,
  runner,
  localSessions,
  latestAiPacket,
  finalAnalysisPacket,
  geminiSessionAnalysis,
  geminiSessionStatus,
  geminiSessionError,
  geminiAnalysisCache,
  sessionRecording,
  presentationStatus,
  aiCue,
  voiceStatus,
  voiceError,
  providerStatus
}) {
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
        <p className="eyebrow">Latest analyzer output</p>
        <pre>{JSON.stringify(runner.latestAnalyzerOutput || packet?.analyzer_output || null, null, 2)}</pre>
      </section>

      <section className="debug-card debug-json">
        <p className="eyebrow">Latest AI packet</p>
        <pre>{JSON.stringify(latestAiPacket, null, 2)}</pre>
      </section>

      <section className="debug-card debug-json">
        <p className="eyebrow">Final session analysis V2</p>
        <pre>{JSON.stringify({
          status: geminiSessionStatus,
          error: geminiSessionError,
          finalAnalysisPacket,
          geminiSessionAnalysis,
          geminiAnalysisCache,
          recording_summary: sessionRecording
            ? {
              sample_count: sessionRecording.sample_count,
              event_count: sessionRecording.event_count,
              rep_count: sessionRecording.rep_count
            }
            : null,
          presentationStatus
        }, null, 2)}</pre>
      </section>

      <section className="debug-card debug-json">
        <p className="eyebrow">AI / voice status</p>
        <pre>{JSON.stringify({
          aiCue,
          voiceStatus,
          voiceError,
          gemini_vertex: providerStatus?.gemini || null,
          elevenlabs_key_present: Boolean(providerStatus?.env?.elevenlabs_key_configured),
          elevenlabs_voice_present: Boolean(providerStatus?.env?.elevenlabs_voice_configured),
          providers: providerStatus?.providers || null,
          provider_error: providerStatus?.error || null
        }, null, 2)}</pre>
      </section>

      <section className="debug-card debug-json">
        <p className="eyebrow">Completed reps JSON</p>
        <pre>{JSON.stringify(runner.completedReps, null, 2)}</pre>
      </section>

      <section className="debug-card debug-json">
        <p className="eyebrow">Raw tracking packet / session state</p>
        <pre>{JSON.stringify({ packet, sourceStatus, summary, sessions, localSessions, runner }, null, 2)}</pre>
      </section>
    </div>
  );
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}s` : "--";
}

function formatMaybe(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "--";
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
