/**
 * Decode a browser MediaRecorder blob to 16 kHz mono WAV for STT APIs.
 * Works without server-side ffmpeg.
 */

function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

export function encodeWavFromFloat32(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function measurePeak(samples) {
  if (!samples?.length) return 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i]);
    if (value > peak) peak = value;
  }
  return peak;
}

export async function convertBlobToMonoWav(blob, targetRate = 16000) {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeContext = new AudioContext();
  let audioBuffer;
  try {
    audioBuffer = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await decodeContext.close();
  }

  const durationSec = audioBuffer.duration;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(durationSec * targetRate)), targetRate);
  const source = offline.createBufferSource();

  const mono = offline.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
  const output = mono.getChannelData(0);

  if (audioBuffer.numberOfChannels === 1) {
    output.set(audioBuffer.getChannelData(0));
  } else {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0; i < output.length; i += 1) {
      output[i] = (left[i] + right[i]) / 2;
    }
  }

  source.buffer = mono;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  const peak = measurePeak(samples);

  return {
    wavBlob: encodeWavFromFloat32(samples, targetRate),
    peak,
    durationSec,
    originalBytes: blob.size,
    wavBytes: 44 + samples.length * 2,
  };
}
