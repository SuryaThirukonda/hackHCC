let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ok: ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

const supported = typeof navigator !== "undefined"
  && Boolean(navigator.mediaDevices?.getUserMedia)
  && typeof MediaRecorder !== "undefined";

console.log("voice recording support check");
assert(supported === false, "MediaRecorder unavailable in Node");
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
