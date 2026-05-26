// Sprint 24a — TRACKER latency-spike AudioWorklet processor.
//
// Faithful port of the expensive bits of c:\source\tracker\src\engine\voice303.rs
// + dsp\ladder.rs. Strips out chorus / wobble / LFO / pan / noise — those are
// polish, not the load-bearing DSP. What remains is what the WASM port would
// have to run inside an AudioWorklet callback for the real TRACKER player:
//
//   PolyBLEP saw oscillator
//   ↓
//   pre-saturation (cheap asym soft)
//   ↓
//   Huovilainen-style 4-pole nonlinear ladder, 2× oversampled,
//   8 tanh evaluations per output sample
//   ↓
//   post-saturation cascade (3 stages of tanh)
//   ↓
//   AD amp envelope
//   ↓
//   output
//
// No allocations in process(). Single voice (polyphony of 1 — the soak test
// just needs one voice running continuously). Reports per-buffer timing back
// to the main thread via port messages.

const TWO_PI = Math.PI * 2;
const VT = 0.40;
const OS = 2;             // ladder oversample factor (matches the Rust)
const REPORT_EVERY = 50;  // post stats to main thread every N buffers

// Fast bounded tanh — same rational approximation as dsp/ladder.rs tanh_fast.
function tanhFast(x) {
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

// Symmetric soft drive — same as dsp/drive.rs soft_drive's effect.
function softDrive(x, amount) {
  return tanhFast(x * amount) / Math.max(1, tanhFast(amount));
}

// Asymmetric soft drive — adds 2nd-harmonic warmth (the "warmth" Ted mentions).
function asymSoft(x, amount) {
  const k = 1 + amount;
  return (x > 0) ? tanhFast(x * k) : tanhFast(x * k * 0.85);
}

// 3-stage tanh cascade — replaces dsp/drive.rs cascade_drive(filt, 3, ...).
function cascadeDrive(x, amount) {
  let y = x;
  for (let i = 0; i < 3; i++) y = tanhFast(y * (1 + amount));
  return y / (1 + amount * 0.5);
}

class Voice303Bench extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'cutoff',    defaultValue: 0.42, minValue: 0.0,  maxValue: 1.0,  automationRate: 'k-rate' },
      { name: 'resonance', defaultValue: 0.85, minValue: 0.0,  maxValue: 1.0,  automationRate: 'k-rate' },
      { name: 'drive',     defaultValue: 0.6,  minValue: 0.0,  maxValue: 1.0,  automationRate: 'k-rate' },
      { name: 'envAmount', defaultValue: 0.95, minValue: 0.0,  maxValue: 1.0,  automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.osSr = this.sr * OS;

    // Oscillator
    this.phase = 0.0;
    this.freqHz = 110;   // ~A2

    // Ladder integrator + saturated states
    this.z = new Float32Array(4);
    this.y = new Float32Array(4);
    this.lastIn = 0.0;

    // AD envelope (amp + filter share for simplicity here)
    this.envState = 0; // 0 idle, 1 attack, 2 decay
    this.envValue = 0.0;
    this.attackInc = 1.0 / (this.sr * 0.003);   // 3 ms attack
    this.decayCoef = Math.exp(-1.0 / (this.sr * 0.45)); // 450 ms decay tau

    // Stats
    this.buffersProcessed = 0;
    this.bufferStartTime = 0;
    this.firstProcessTimeMs = null;
    this.maxCallbackMs = 0;
    this.cumulativeCallbackMs = 0;
    this.lastCurrentTime = -1;
    this.glitchCount = 0;

    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _onMessage(msg) {
    if (msg.type === 'note_on') {
      this.envState = 1;
      this.envValue = 0.0;
      this.phase = 0.0;
      this.z.fill(0); this.y.fill(0); this.lastIn = 0;
      this.freqHz = msg.hz || 110;
      // Tell the main thread which currentTime this note started at.
      // Main thread combines that with its own press timestamp to compute
      // input-to-audio latency.
      this.port.postMessage({ type: 'noted_on', currentTime, freqHz: this.freqHz });
    } else if (msg.type === 'note_off') {
      this.envState = 0;
    } else if (msg.type === 'reset_stats') {
      this.buffersProcessed = 0;
      this.maxCallbackMs = 0;
      this.cumulativeCallbackMs = 0;
      this.firstProcessTimeMs = null;
      this.glitchCount = 0;
    } else if (msg.type === 'set_freq') {
      this.freqHz = msg.hz;
    }
  }

  // PolyBLEP saw — anti-aliased saw, lifted from dsp/osc.rs PolyBlepOsc::next_saw.
  _polyBlepSaw() {
    const dt = this.freqHz / this.sr;
    let v = 2 * this.phase - 1;
    let t = this.phase;
    // PolyBLEP correction around the discontinuity
    if (t < dt)      { t = t / dt;              v -= (t + t - t * t - 1.0); }
    else if (t > 1 - dt) { t = (t - 1) / dt;     v -= (t * t + t + t + 1.0); }
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }

  // 4-pole nonlinear ladder, 2× oversampled. One tanh per stage per OS step
  // = 8 tanh calls per output sample. This is the dominant DSP cost.
  _ladder(x, cutoffHz, resScaled, drive) {
    const g = 1.0 - Math.exp(-TWO_PI * cutoffHz / this.osSr);
    let out = 0.0;
    for (let i = 0; i < OS; i++) {
      // linear interp between previous and current sample
      const t = (i + 0.5) / OS;
      const xi = this.lastIn + (x - this.lastIn) * t;
      const xd = xi * drive;
      const fb = resScaled * this.y[3];
      const input = xd - fb;

      const t0 = tanhFast(input / (2 * VT));
      this.z[0] += g * (t0 - this.y[0]);
      this.y[0] = tanhFast(this.z[0] / (2 * VT));

      this.z[1] += g * (this.y[0] - this.y[1]);
      this.y[1] = tanhFast(this.z[1] / (2 * VT));

      this.z[2] += g * (this.y[1] - this.y[2]);
      this.y[2] = tanhFast(this.z[2] / (2 * VT));

      this.z[3] += g * (this.y[2] - this.y[3]);
      this.y[3] = tanhFast(this.z[3] / (2 * VT));

      out = this.y[3];
    }
    this.lastIn = x;
    return out * (1.0 + resScaled * 0.35);
  }

  process(_inputs, outputs, parameters) {
    const startNs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    this.bufferStartTime = startNs;

    // Underrun detection: if currentTime advanced by more than one buffer's
    // worth of samples since our last process() call, we missed a buffer.
    if (this.lastCurrentTime >= 0) {
      const out0 = outputs[0];
      const bufSamples = out0[0].length;
      const expectedDeltaSec = bufSamples / this.sr;
      const actualDeltaSec = currentTime - this.lastCurrentTime;
      if (actualDeltaSec > expectedDeltaSec * 1.8) {
        this.glitchCount++;
      }
    }
    this.lastCurrentTime = currentTime;

    const out0 = outputs[0];
    if (!out0 || out0.length === 0) return true;
    const left = out0[0];
    const right = out0.length > 1 ? out0[1] : null;
    const N = left.length;

    // Cutoff in Hz from the 0..1 input — log-ish like Rust voice303.rs:
    //   base_hz = 40 * 350^cutoff01
    const cutoff01 = parameters.cutoff[0];
    const baseHz = 40 * Math.pow(350, Math.max(0, Math.min(1, cutoff01)));
    // env opens the filter ~5 octaves at peak * envAmount
    const envAmount = parameters.envAmount[0];
    const resScaled = parameters.resonance[0] * 4.2;
    const baseDrive = parameters.drive[0];
    const driveAmt = 1 + baseDrive * 5; // ladder input drive
    const ampGain = 0.30;               // overall amp scale — keep speakers safe

    for (let i = 0; i < N; i++) {
      // envelope step
      if (this.envState === 1) {
        this.envValue += this.attackInc;
        if (this.envValue >= 1.0) { this.envValue = 1.0; this.envState = 2; }
      } else if (this.envState === 2) {
        this.envValue *= this.decayCoef;
        if (this.envValue < 1e-5) { this.envValue = 0; this.envState = 0; }
      }

      // cutoff dynamic: opens with envelope
      const envOct = this.envValue * envAmount * 5;
      const fc = Math.min(this.sr * 0.45, baseHz * Math.pow(2, envOct));

      // signal path
      const raw = this._polyBlepSaw();
      const pre = asymSoft(raw, 1 + baseDrive * 0.5);
      const filtered = this._ladder(pre, fc, resScaled, driveAmt);
      const driven = cascadeDrive(filtered, 0.18 + baseDrive * 0.55);
      const post = softDrive(driven, 1.0);
      const sample = post * this.envValue * ampGain;

      left[i] = sample;
      if (right) right[i] = sample;
    }

    // bookkeeping
    const endNs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    const callbackMs = endNs - startNs;
    if (callbackMs > this.maxCallbackMs) this.maxCallbackMs = callbackMs;
    this.cumulativeCallbackMs += callbackMs;
    this.buffersProcessed++;
    if (this.firstProcessTimeMs === null) {
      this.firstProcessTimeMs = endNs;
      this.port.postMessage({ type: 'first_process', currentTime, performanceNow: endNs });
    }

    if (this.buffersProcessed % REPORT_EVERY === 0) {
      const bufSamples = left.length;
      const bufDurMs = (bufSamples / this.sr) * 1000;
      this.port.postMessage({
        type: 'stats',
        buffers: this.buffersProcessed,
        meanCallbackMs: this.cumulativeCallbackMs / this.buffersProcessed,
        maxCallbackMs: this.maxCallbackMs,
        bufDurMs,
        // CPU% inside the worklet = (callback wall time) / (buffer audio time)
        worklet_cpu_pct: 100 * (this.cumulativeCallbackMs / this.buffersProcessed) / bufDurMs,
        glitches: this.glitchCount,
        currentTime,
      });
    }

    return true; // keep the processor alive
  }
}

registerProcessor('voice303-bench', Voice303Bench);
