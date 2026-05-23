/**
 * Capture mic PCM via Web Audio (bypasses MediaRecorder/WebM silence bugs).
 */

import { encodeWavFromFloat32, measurePeak } from "./audioConvert.js";

export async function resamplePcmToWav(samples, sampleRate, targetRate = 16000) {
  if (!samples.length) {
    return {
      wavBlob: encodeWavFromFloat32(new Float32Array(0), targetRate),
      peak: 0,
      durationSec: 0,
      wavBytes: 44,
      sampleRate: targetRate,
    };
  }

  const offline = new OfflineAudioContext(
    1,
    Math.max(1, Math.ceil((samples.length * targetRate) / sampleRate)),
    targetRate,
  );
  const buffer = offline.createBuffer(1, samples.length, sampleRate);
  buffer.getChannelData(0).set(samples);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const output = rendered.getChannelData(0);
  const peak = measurePeak(output);

  return {
    wavBlob: encodeWavFromFloat32(output, targetRate),
    peak,
    durationSec: output.length / targetRate,
    wavBytes: 44 + output.length * 2,
    sampleRate: targetRate,
  };
}

export class PcmMicRecorder {
  constructor() {
    this.stream = null;
    this.audioContext = null;
    this.source = null;
    this.processor = null;
    this.analyser = null;
    this.muteGain = null;
    this.chunks = [];
    this.capturePeak = 0;
    this.trackLabel = "";
    this.trackMuted = false;
    this.sampleRate = 48000;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
    });

    const track = this.stream.getAudioTracks()[0];
    this.trackLabel = track?.label || "unknown";
    this.trackMuted = Boolean(track?.muted);

    this.audioContext = new AudioContext();
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
    this.sampleRate = this.audioContext.sampleRate;

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.muteGain = this.audioContext.createGain();
    this.muteGain.gain.value = 0;

    this.chunks = [];
    this.capturePeak = 0;

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.chunks.push(copy);
      for (let i = 0; i < input.length; i += 1) {
        this.capturePeak = Math.max(this.capturePeak, Math.abs(input[i]));
      }
    };

    this.source.connect(this.analyser);
    this.analyser.connect(this.processor);
    this.processor.connect(this.muteGain);
    this.muteGain.connect(this.audioContext.destination);
  }

  getLivePeak() {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) {
      peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
    }
    return peak;
  }

  async stop() {
    this.processor?.disconnect();
    this.analyser?.disconnect();
    this.source?.disconnect();
    this.muteGain?.disconnect();
    this.stream?.getTracks?.().forEach((track) => track.stop());

    const sampleRate = this.sampleRate;
    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];

    if (this.audioContext) {
      await this.audioContext.close();
    }
    this.audioContext = null;

    const wav = await resamplePcmToWav(merged, sampleRate, 16000);
    return {
      ...wav,
      capturePeak: this.capturePeak,
      pcmPeak: measurePeak(merged),
      trackLabel: this.trackLabel,
      trackMuted: this.trackMuted,
      pcmSamples: merged.length,
      captureMode: "web-audio-pcm",
    };
  }

  abort() {
    try {
      this.processor?.disconnect();
      this.analyser?.disconnect();
      this.source?.disconnect();
      this.muteGain?.disconnect();
    } catch {
      // ignore
    }
    this.stream?.getTracks?.().forEach((track) => track.stop());
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    this.chunks = [];
  }
}
