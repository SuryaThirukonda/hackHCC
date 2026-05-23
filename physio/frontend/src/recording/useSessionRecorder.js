import { useCallback, useEffect, useRef } from "react";
import { createSessionRecorder } from "./sessionRecorder.js";
import { saveRecordingV2 } from "../api/sessionRecordingV2Client.js";

/**
 * React hook for session recording lifecycle.
 *
 * Usage:
 *   const recorder = useSessionRecorder({ sessionId, exerciseId, active });
 *   recorder.recordPacket(packet, smoothedFrame);   // call per frame
 *   const recording = await recorder.stopAndSave(); // on session end
 */
export function useSessionRecorder({ sessionId, exerciseId, active }) {
  const recorderRef = useRef(null);

  // Create or reset recorder when session starts
  useEffect(() => {
    if (!sessionId) return;
    if (!recorderRef.current) {
      recorderRef.current = createSessionRecorder(sessionId, exerciseId);
    } else {
      recorderRef.current.reset(sessionId, exerciseId);
    }
  }, [sessionId, exerciseId]);

  // Auto start/stop based on active flag
  useEffect(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (active) {
      rec.start();
    } else if (!active && rec.isActive()) {
      rec.stop();
    }
  }, [active]);

  const recordPacket = useCallback((packet, smoothedFrame = null) => {
    recorderRef.current?.recordPacket(packet, smoothedFrame);
  }, []);

  const addEvent = useCallback((type, detail = {}) => {
    recorderRef.current?.addEvent(type, detail);
  }, []);

  const stopAndSave = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return null;
    if (rec.isActive()) rec.stop();
    const recording = rec.getRecording();
    try {
      await saveRecordingV2(recording);
    } catch (err) {
      // Non-fatal — recording save failure must not block results
      console.warn("[useSessionRecorder] Failed to save recording:", err.message);
    }
    return recording;
  }, []);

  const getRecording = useCallback(() => {
    return recorderRef.current?.getRecording() ?? null;
  }, []);

  return { recordPacket, addEvent, stopAndSave, getRecording };
}
