// audioEngine.js - Audio synthesis engines, clock swing, and modular FX routing chain (v1.2.0)
import { initPluginBridge } from './WebPluginBridge';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.analyser = null;
    this.sessionRecorder = null; // Session recorder reference
    
    
    // Shared white noise buffer
    this.noiseBuffer = null;
    
    // Sequencer State
    this.isPlaying = false;
    this.bpm = 120;
    this.stepsCount = 16;
    this.currentStep = 0;
    this.gridData = []; // Live pointer to sequence grid
    this.swing = 0.0;   // Swing amount (0.0 to 1.0)
    
    // Clock Variables
    this.timerId = null;
    this.nextNoteTime = 0.0;
    this.lookahead = 25.0; // ms
    this.scheduleAheadTime = 0.1; // seconds
    
    // Callbacks
    this.onStepTrigger = null;
    this.onInstrumentTrigger = null;
    this.onTick = null;
    this.onLog = null; // Stream logs to renderer session logger
    
    // Parameter values for each channel
    this.channelParams = {};
    
    // Recordable automation variables (pitch bends per step 0-1)
    this.tomStepPitches = new Array(64).fill(0.5);
    this.beepStepPitches = new Array(64).fill(0.5);
    this.blipStepPitches = new Array(64).fill(0.5);
    this.bloopStepPitches = new Array(64).fill(0.5);
    this.isRecordingPitch = false;
    
    // Velocity tracking (12 channels x 64 steps)
    this.stepVelocities = Array.from({ length: 12 }, () => new Array(64).fill(0.5));

    // FX automation variables (64 steps)
    this.fxAutomation = {
      enabled: {
        distortion: new Array(64).fill(null),
        filter: new Array(64).fill(null),
        delay: new Array(64).fill(null),
        reverb: new Array(64).fill(null),
        bitcrusher: new Array(64).fill(null)
      },
      params: {
        distortion: {
          drive: new Array(64).fill(null)
        },
        filter: {
          cutoff: new Array(64).fill(null),
          resonance: new Array(64).fill(null),
          type: new Array(64).fill(null)
        },
        delay: {
          time: new Array(64).fill(null),
          feedback: new Array(64).fill(null),
          mix: new Array(64).fill(null)
        },
        reverb: {
          decay: new Array(64).fill(null),
          mix: new Array(64).fill(null)
        },
        bitcrusher: {
          bits: new Array(64).fill(null),
          downsample: new Array(64).fill(null)
        }
      }
    };
    
    // Mute States
    this.mutes = new Array(12).fill(false);
    this.sampleBuffer = null;
    this.fillActive = false;
    this.fillPattern = 'traditional_a';
    this.activeOpenHatGains = [];

    // ==========================================
    // FX AND ROUTING NETWORK VARIABLES
    // ==========================================
    this.dryBus = null;           // Clean bypass bus
    this.crunchBus = null;        // Bitcrusher feeding bus
    this.fxInputBus = null;       // Mixed pre-effects bus
    
    // Channel-specific bitcrusher bypass flags
    this.channelCrunchBypass = new Array(12).fill(true);
    
    // Bitcrusher params
    this.bitcrusherNode = null;
    this.bitcrusherBits = 8;       // 1 to 16 bits
    this.bitcrusherDownsample = 1; // 1 to 32 downsampling
    this.bitcrusherEnabled = true;

    // Modular Effects Modules
    this.fxChainOrder = ['distortion', 'filter', 'delay', 'reverb', 'sidechain'];
    this.fxEnabled = {
      distortion: false,
      filter: false,
      delay: false,
      reverb: false,
      sidechain: false
    };

    // Effect Parameters
    this.fxParams = {
      distortion: { drive: 0.3 },
      filter: { cutoff: 1200, resonance: 2.0, type: 'lowpass' },
      delay: { time: 0.3, feedback: 0.4, mix: 0.3 },
      reverb: { decay: 1.2, mix: 0.2 },
      sidechain: { ratio: 0.8, release: 0.15, attack: 0.01 }
    };

    // FX Audio Nodes
    this.distNode = null;
    this.sidechainNode = null;
    
    this.filterNode = null;
    
    this.delayInput = null;
    this.delayNode = null;
    this.delayFeedback = null;
    this.delayWet = null;
    this.delayDry = null;
    this.delayOutput = null;
    
    this.reverbInput = null;
    this.reverbConvolver = null;
    this.reverbWet = null;
    this.reverbDry = null;
    this.reverbOutput = null;
    this.bitcrusherEnabled = true;
    this.bitcrusherMix = 1.0;
    this.crunchBus = null;        // Bitcrusher feeding bus
    this.crunchBypass = new Array(12).fill(false); // channel-specific bitcrusher bypass
    this.fxInputBus = null;

    // Generic knob motion automation (12 channels, each has step arrays)
    this.instrumentAutomation = {};
    for (let c = 0; c < 12; c++) {
      this.instrumentAutomation[c] = {};
    }
    
    // Slam the Door state
    this.isSlamTheDoorActive = false;
    this.isSlamPending = false;
    this.timeSignature = '4/4';
    this.slamMix = 1.0;
    this.doorType = 0;
  }

  log(msg, lvl = 'INFO') {
    if (this.onLog) {
      this.onLog(msg, lvl);
    } else {
      console.log(`[AudioEngine] [${lvl}] ${msg}`);
    }
  }

  init() {
    if (this.ctx) return;
    
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();
    
    this.log("Initializing AudioContext, Gain Nodes, Routing Buses, and DSP Effects Chain.");
    
    // 1. Create Master Output Node & Analyser
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.75, this.ctx.currentTime);
    
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    
    // Door Slam neomorphic FX nodes and dry/wet gain routing
    this.slamFilterNode = this.ctx.createBiquadFilter();
    this.slamFilterNode.type = 'lowpass';
    this.slamFilterNode.frequency.setValueAtTime(450, this.ctx.currentTime); // muffled lowpass

    this.slamCompressorNode = this.ctx.createDynamicsCompressor();
    this.slamCompressorNode.threshold.setValueAtTime(-32, this.ctx.currentTime); // squashed threshold
    this.slamCompressorNode.knee.setValueAtTime(8, this.ctx.currentTime);
    this.slamCompressorNode.ratio.setValueAtTime(8, this.ctx.currentTime); // moderate compression ratio
    this.slamCompressorNode.attack.setValueAtTime(0.005, this.ctx.currentTime);
    this.slamCompressorNode.release.setValueAtTime(0.080, this.ctx.currentTime);

    this.slamDryGain = this.ctx.createGain();
    this.slamWetGain = this.ctx.createGain();
    this.slamDryGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    this.slamWetGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    // Routings
    this.masterGain.connect(this.slamDryGain);
    this.slamDryGain.connect(this.analyser);

    this.masterGain.connect(this.slamFilterNode);
    this.slamFilterNode.connect(this.slamCompressorNode);
    this.slamCompressorNode.connect(this.slamWetGain);
    this.slamWetGain.connect(this.analyser);

    this.analyser.connect(this.ctx.destination);

    // 3-Band Audio-Reactive Visualizer Crossover Network
    this.lowsFilter = this.ctx.createBiquadFilter();
    this.lowsFilter.type = 'lowpass';
    this.lowsFilter.frequency.setValueAtTime(180, this.ctx.currentTime);

    this.midsFilter = this.ctx.createBiquadFilter();
    this.midsFilter.type = 'bandpass';
    this.midsFilter.frequency.setValueAtTime(1000, this.ctx.currentTime);
    this.midsFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

    this.highsFilter = this.ctx.createBiquadFilter();
    this.highsFilter.type = 'highpass';
    this.highsFilter.frequency.setValueAtTime(3500, this.ctx.currentTime);

    this.lowsAnalyser = this.ctx.createAnalyser();
    this.lowsAnalyser.fftSize = 256;

    this.midsAnalyser = this.ctx.createAnalyser();
    this.midsAnalyser.fftSize = 256;

    this.highsAnalyser = this.ctx.createAnalyser();
    this.highsAnalyser.fftSize = 256;

    this.masterGain.connect(this.lowsFilter);
    this.lowsFilter.connect(this.lowsAnalyser);

    this.masterGain.connect(this.midsFilter);
    this.midsFilter.connect(this.midsAnalyser);

    this.masterGain.connect(this.highsFilter);
    this.highsFilter.connect(this.highsAnalyser);
    
    // 2. Create Audio Input Buses
    this.dryBus = this.ctx.createGain();
    this.crunchBus = this.ctx.createGain();
    this.fxInputBus = this.ctx.createGain();

    this.dryBus.connect(this.fxInputBus);
    
    // 3. Build & Connect Universal Bitcrusher
    this.buildBitcrusher();

    // 4. Build Universal FX Modules
    this.buildFXNodes();
    
    // 5. Pre-wire the FX Routing chain
    this.rebuildFXChain();

    // 6. Build white noise buffer
    this.buildNoiseBuffer();

    // 7. Connect DAW plug-in host capture bridge
    initPluginBridge(this);
  }

  // Quantizing downsampler bitcrusher
  buildBitcrusher() {
    this.bitcrusherNode = this.ctx.createScriptProcessor(256, 1, 1);
    this.bitcrusherNode.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const output = e.outputBuffer.getChannelData(0);
      
      if (!this.bitcrusherEnabled) {
        for (let i = 0; i < input.length; i++) {
          output[i] = input[i];
        }
        return;
      }

      const bits = this.bitcrusherBits;
      const norm = Math.pow(2, bits - 1);
      const step = this.bitcrusherDownsample;
      
      let lastVal = 0;
      const mix = this.bitcrusherMix !== undefined ? this.bitcrusherMix : 1.0;
      for (let i = 0; i < input.length; i++) {
        if (i % step === 0) {
          const val = input[i];
          lastVal = Math.round(val * norm) / norm;
        }
        output[i] = (1.0 - mix) * input[i] + mix * lastVal;
      }
    };

    // Routing: crunchBus -> bitcrusher -> fxInputBus
    this.crunchBus.connect(this.bitcrusherNode);
    this.bitcrusherNode.connect(this.fxInputBus);
  }

  // Instantiate all effect DSP nodes
  buildFXNodes() {
    // A. Wave Saturation Distortion
    this.distNode = this.ctx.createWaveShaper();
    this.updateDistortionDrive();

    // B. Resonant Sweeper Filter
    this.filterInput = this.ctx.createGain();
    this.filterOutput = this.ctx.createGain();
    this.filterNode = this.ctx.createBiquadFilter();
    this.updateFilter();

    // C. Echo Feedback Delay Block
    this.delayInput = this.ctx.createGain();
    this.delayNode = this.ctx.createDelay(2.0); // max delay 2s
    this.delayFeedback = this.ctx.createGain();
    this.delayWet = this.ctx.createGain();
    this.delayDry = this.ctx.createGain();
    this.delayOutput = this.ctx.createGain();

    // Delay internal wiring
    this.delayInput.connect(this.delayDry);
    this.delayInput.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode); // feedback loop
    this.delayNode.connect(this.delayWet);
    this.delayDry.connect(this.delayOutput);
    this.delayWet.connect(this.delayOutput);
    this.updateDelay();

    // D. Room Convolution Reverb Block
    this.reverbInput = this.ctx.createGain();
    this.reverbConvolver = this.ctx.createConvolver();
    this.reverbWet = this.ctx.createGain();
    this.reverbDry = this.ctx.createGain();
    this.reverbOutput = this.ctx.createGain();

    // Reverb internal wiring
    this.reverbInput.connect(this.reverbDry);
    this.reverbInput.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbWet);
    this.reverbDry.connect(this.reverbOutput);
    this.reverbWet.connect(this.reverbOutput);
    this.updateReverbImpulse();

    // E. Sidechain ducking GainNode
    this.sidechainNode = this.ctx.createGain();
    this.sidechainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);
  }

  // Dynaimcally re-patch effect wiring in real-time
  rebuildFXChain() {
    if (!this.ctx) return;

    // Disconnect outputs only
    this.fxInputBus.disconnect();
    this.distNode.disconnect();
    if (this.filterOutput) this.filterOutput.disconnect();
    this.delayOutput.disconnect();
    this.reverbOutput.disconnect();
    if (this.sidechainNode) this.sidechainNode.disconnect();

    let lastNode = this.fxInputBus;

    // Connect enabled modules in fxChainOrder sequence
    for (let i = 0; i < this.fxChainOrder.length; i++) {
      const effectKey = this.fxChainOrder[i];
      const isEnabled = this.fxEnabled[effectKey];

      if (isEnabled) {
        if (effectKey === 'distortion') {
          lastNode.connect(this.distNode);
          lastNode = this.distNode;
        } else if (effectKey === 'filter') {
          lastNode.connect(this.filterInput);
          lastNode = this.filterOutput;
        } else if (effectKey === 'delay') {
          lastNode.connect(this.delayInput);
          lastNode = this.delayOutput;
        } else if (effectKey === 'reverb') {
          lastNode.connect(this.reverbInput);
          lastNode = this.reverbOutput;
        } else if (effectKey === 'sidechain' && this.sidechainNode) {
          lastNode.connect(this.sidechainNode);
          lastNode = this.sidechainNode;
        }
      }
    }

    // Connect final node in chain to master output
    lastNode.connect(this.masterGain);
    
    const activeChainStr = this.fxChainOrder.filter(k => this.fxEnabled[k]).join(" -> ").toUpperCase() || "DIRECT OUT";
    this.log(`Rebuilt modular FX routing chain: ${activeChainStr}`);
  }

  // Pre-generate white noise buffer to save CPU
  buildNoiseBuffer() {
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  // Resume context if suspended (browser security)
  async resumeContext() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  // Set master output volume
  setMasterVolume(val) {
    if (!this.masterGain) return;
    this.masterGain.gain.setValueAtTime(Math.max(0.0, Math.min(1.5, val)), this.ctx?.currentTime || 0);
  }

  // Set individual channel parameters
  updateParams(channelId, params) {
    this.channelParams[channelId] = { ...this.channelParams[channelId], ...params };
  }

  // Mute/Unmute track
  setMute(channelIdx, isMuted) {
    this.mutes[channelIdx] = isMuted;
  }

  // Set bitcrusher bypass route
  setCrunchBypass(channelIdx, bypass) {
    this.channelCrunchBypass[channelIdx] = bypass;
  }

  // Helper to connect synth voice output to the chosen dry/wet routing bus
  connectSynthNode(node, channelIdx) {
    const destBus = this.channelCrunchBypass[channelIdx] ? this.dryBus : this.crunchBus;
    node.connect(destBus);
  }

  // Trigger sound instantly based on instrument channel index
  triggerInstrument(index, time = this.ctx.currentTime, pitchOverride = null, velocity = 0.5, stepIdx = null) {
    this.resumeContext();
    if (!this.ctx) return;
    if (this.mutes[index]) return;

    if (this.onInstrumentTrigger) {
      const delayMs = Math.max(0, (time - this.ctx.currentTime) * 1000);
      if (delayMs > 5) {
        setTimeout(() => {
          if (this.onInstrumentTrigger) this.onInstrumentTrigger(index);
        }, delayMs);
      } else {
        this.onInstrumentTrigger(index);
      }
    }

    let params = { ...(this.channelParams[index] || {}) };

    // Merge neomorphic step-automation parameters for this step index if present
    if (stepIdx !== null && this.instrumentAutomation && this.instrumentAutomation[index]) {
      Object.keys(this.instrumentAutomation[index]).forEach(paramKey => {
        const autoVal = this.instrumentAutomation[index][paramKey][stepIdx];
        if (autoVal !== null && autoVal !== undefined) {
          params[paramKey] = autoVal;
        }
      });
    }
    
    switch (index) {
      case 0: // Kick
        this.synthKick(time, params, velocity);
        break;
      case 1: // Snare
        this.synthSnare(time, params, velocity);
        break;
      case 2: // Closed Hat
        this.synthHihat(time, params, false, velocity);
        break;
      case 3: // Open Hat
        this.synthHihat(time, params, true, velocity);
        break;
      case 4: // Ride
        this.synthRide(time, params, velocity);
        break;
      case 5: // Clap
        this.synthClap(time, params, velocity);
        break;
      case 6: // Tom
        this.synthTom(time, params, pitchOverride !== null ? pitchOverride : 0.5, velocity);
        break;
      case 7: // Beep
        this.synthBeep(time, params, pitchOverride !== null ? pitchOverride : 0.5, velocity);
        break;
      case 8: // Blip
        this.synthBlip(time, params, pitchOverride !== null ? pitchOverride : 0.5, velocity);
        break;
      case 9: // Bloop
        this.synthBloop(time, params, pitchOverride !== null ? pitchOverride : 0.5, velocity);
        break;
      case 10: // Crunch
        this.synthCrunch(time, params, velocity);
        break;
      case 11: // Custom Sample
        this.synthSample(time, params, velocity);
        break;
      default:
        break;
    }
  }

  // ==========================================
  // INSTRUMENT SYNTHESIS ENGINES
  // ==========================================

  // 1. KICK DRUM
  synthKick(time, p, velocity = 0.5) {
    this.triggerSidechain(time);
    const useAlt = p.useAltSound === true || p.useAltSound === 'true' || p.useAltSound === 1;
    if (useAlt) {
      this.synthKickAlt(time, p, velocity);
      return;
    }

    const decay = parseFloat(p.decay) || 0.25;
    const tone = parseFloat(p.tone) || 55;
    const distortion = parseFloat(p.distortion) || 0.1;
    const volume = parseFloat(p.volume) || 0.8;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'sine';
    
    osc.frequency.setValueAtTime(tone * 3.5, time);
    osc.frequency.exponentialRampToValueAtTime(tone, time + 0.08);

    gainNode.gain.setValueAtTime(volume * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    if (distortion > 0.05) {
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = this.makeDistortionCurve(distortion * 80);
      shaper.oversample = '4x';
      
      osc.connect(shaper);
      shaper.connect(gainNode);
    } else {
      osc.connect(gainNode);
    }

    this.connectSynthNode(gainNode, 0);

    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  synthKickAlt(time, p, velocity) {
    const decay = parseFloat(p.decay) || 0.25;
    const tone = parseFloat(p.tone) || 55;
    const punch = parseFloat(p.distortion) || 0.1; // Repurposed Drive as Click/Punch
    const volume = parseFloat(p.volume) || 0.8;

    const subDecay = decay * 5.0; // Extreme long decay capability

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(tone * 1.5, time);
    osc.frequency.exponentialRampToValueAtTime(tone, time + 0.1);

    gainNode.gain.setValueAtTime(volume * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + subDecay);

    if (punch > 0.05) {
      const clickOsc = this.ctx.createOscillator();
      const clickGain = this.ctx.createGain();
      clickOsc.type = 'triangle';
      
      clickOsc.frequency.setValueAtTime(1500, time);
      clickOsc.frequency.exponentialRampToValueAtTime(tone, time + 0.02);

      clickGain.gain.setValueAtTime(volume * punch * 1.5 * velocity, time);
      clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);

      clickOsc.connect(clickGain);
      this.connectSynthNode(clickGain, 0);

      clickOsc.start(time);
      clickOsc.stop(time + 0.03);
    }

    osc.connect(gainNode);
    this.connectSynthNode(gainNode, 0);

    osc.start(time);
    osc.stop(time + subDecay + 0.01);
  }

  // 2. SNARE DRUM
  synthSnare(time, p, velocity = 0.5) {
    const useAlt = p.useAltSound === true || p.useAltSound === 'true' || p.useAltSound === 1;
    if (useAlt) {
      this.synthSnareAlt(time, p, velocity);
      return;
    }

    const decay = parseFloat(p.decay) || 0.2;
    const tone = parseFloat(p.tone) || 180;
    const snappy = parseFloat(p.snappy) || 0.5;
    const volume = parseFloat(p.volume) || 0.7;

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(tone * 1.8, time);
    osc.frequency.exponentialRampToValueAtTime(tone, time + 0.07);
    oscGain.gain.setValueAtTime(volume * (1 - snappy * 0.4) * velocity, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    
    osc.connect(oscGain);
    this.connectSynthNode(oscGain, 1);

    if (snappy > 0.05 && this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1000 + snappy * 1000, time);
      filter.Q.setValueAtTime(1.5, time);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(volume * snappy * 1.2 * velocity, time);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

      noise.connect(filter);
      filter.connect(noiseGain);
      this.connectSynthNode(noiseGain, 1);

      noise.start(time);
      noise.stop(time + decay + 0.01);
    }

    osc.start(time);
    osc.stop(time + 0.15);
  }

  synthSnareAlt(time, p, velocity) {
    const decay = parseFloat(p.decay) || 0.2;
    const tone = parseFloat(p.tone) || 180;
    const volume = parseFloat(p.volume) || 0.7;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    const gain2 = this.ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(tone * 2.2, time);
    osc1.frequency.exponentialRampToValueAtTime(tone * 1.5, time + 0.03);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(tone * 3.5, time);
    osc2.frequency.exponentialRampToValueAtTime(tone * 2.5, time + 0.015);

    gain1.gain.setValueAtTime(volume * 0.7 * velocity, time);
    gain1.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.4);

    gain2.gain.setValueAtTime(volume * 0.3 * velocity, time);
    gain2.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.15);

    osc1.connect(gain1);
    osc2.connect(gain2);

    this.connectSynthNode(gain1, 1);
    this.connectSynthNode(gain2, 1);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + decay * 0.45);
    osc2.stop(time + decay * 0.2);
  }

  chokeOpenHats(time) {
    this.activeOpenHatGains.forEach(gainNode => {
      try {
        gainNode.gain.cancelScheduledValues(time);
        gainNode.gain.linearRampToValueAtTime(0.0, time + 0.015);
      } catch (e) {}
    });
    this.activeOpenHatGains = [];
  }

  // 3 & 4. HI-HATS (CLOSED & OPEN)
  synthHihat(time, p, isOpen = false, velocity = 0.5) {
    if (!isOpen) {
      this.chokeOpenHats(time);
    }

    const useAlt = p.useAltSound === true || p.useAltSound === 'true' || p.useAltSound === 1;
    if (useAlt) {
      this.synthHihatAlt(time, p, isOpen, velocity);
      return;
    }

    const decay = parseFloat(p.decay) || (isOpen ? 0.35 : 0.06);
    const tone = parseFloat(p.tone) || 8000;
    const pitch = parseFloat(p.pitch) || 1.0;
    const volume = parseFloat(p.volume) || 0.5;

    if (!this.noiseBuffer) return;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.playbackRate.setValueAtTime(pitch, time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(tone, time);
    filter.Q.setValueAtTime(2.0, time);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(volume * 0.9 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(filter);
    filter.connect(gainNode);
    this.connectSynthNode(gainNode, isOpen ? 3 : 2);

    if (isOpen) {
      this.activeOpenHatGains.push(gainNode);
      setTimeout(() => {
        const idx = this.activeOpenHatGains.indexOf(gainNode);
        if (idx > -1) this.activeOpenHatGains.splice(idx, 1);
      }, (decay + 0.15) * 1000);
    }

    noise.start(time);
    noise.stop(time + decay + 0.01);
  }

  synthHihatAlt(time, p, isOpen, velocity) {
    const decay = parseFloat(p.decay) || (isOpen ? 0.35 : 0.06);
    const tone = parseFloat(p.tone) || 8000;
    const volume = parseFloat(p.volume) || 0.5;

    if (!this.noiseBuffer) return;

    if (isOpen) {
      this.synthOpenHihatAlt(time, p, velocity);
      return;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(tone * 0.8, time);
    filter.Q.setValueAtTime(1.0, time);

    const gainNode = this.ctx.createGain();
    
    gainNode.gain.setValueAtTime(0, time);
    gainNode.gain.linearRampToValueAtTime(volume * 0.9 * velocity, time + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(filter);
    filter.connect(gainNode);
    this.connectSynthNode(gainNode, 2);

    noise.start(time);
    noise.stop(time + decay + 0.02);
  }

  synthOpenHihatAlt(time, p, velocity) {
    const decay = parseFloat(p.decay) || 0.35;
    const tone = parseFloat(p.tone) || 8000;
    const volume = parseFloat(p.volume) || 0.5;

    if (!this.noiseBuffer) return;

    const stepSecs = 60.0 / this.bpm / 4.0;
    const stepsCountForLength = Math.max(1, Math.round(decay * 4));
    const duration = stepsCountForLength * stepSecs;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(tone, time);

    const gainNode = this.ctx.createGain();

    gainNode.gain.setValueAtTime(0.0001, time);
    gainNode.gain.linearRampToValueAtTime(volume * 1.2 * velocity, time + duration - 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    noise.connect(filter);
    filter.connect(gainNode);
    this.connectSynthNode(gainNode, 3);

    this.activeOpenHatGains.push(gainNode);
    setTimeout(() => {
      const idx = this.activeOpenHatGains.indexOf(gainNode);
      if (idx > -1) this.activeOpenHatGains.splice(idx, 1);
    }, (duration + 0.15) * 1000);

    noise.start(time);
    noise.stop(time + duration + 0.01);
  }

  // 5. RIDE CYMBAL
  synthRide(time, p, velocity = 0.5) {
    const useAlt = p.useAltSound === true || p.useAltSound === 'true' || p.useAltSound === 1;
    if (useAlt) {
      this.synthRideAlt(time, p, velocity);
      return;
    }

    const decay = parseFloat(p.decay) || 0.8;
    const tone = parseFloat(p.tone) || 350;
    const ring = parseFloat(p.ring) || 0.4;
    const volume = parseFloat(p.volume) || 0.4;

    const ratios = [2.0, 3.0, 4.15, 5.43, 6.79, 8.21];
    const oscs = [];
    const mix = this.ctx.createGain();

    ratios.forEach((ratio) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(tone * ratio, time);
      osc.connect(mix);
      oscs.push(osc);
    });

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(9000, time);
    filter.Q.setValueAtTime(1.8 + ring * 5, time);

    const hpFilter = this.ctx.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.setValueAtTime(7000, time);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(volume * 0.5 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    mix.connect(filter);
    filter.connect(hpFilter);
    hpFilter.connect(gainNode);
    this.connectSynthNode(gainNode, 4);

    oscs.forEach((osc) => {
      osc.start(time);
      osc.stop(time + decay + 0.05);
    });
  }

  synthRideAlt(time, p, velocity) {
    const decay = parseFloat(p.decay) || 0.8;
    const tone = parseFloat(p.tone) || 350;
    const ring = parseFloat(p.ring) || 0.4;
    const volume = parseFloat(p.volume) || 0.4;

    const carrier = this.ctx.createOscillator();
    const modulator = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const gainNode = this.ctx.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(tone, time);

    modulator.type = 'sine';
    modulator.frequency.setValueAtTime(tone * 0.35, time);

    modGain.gain.setValueAtTime(tone * 1.5 * ring, time);
    modGain.gain.exponentialRampToValueAtTime(0.1, time + decay * 0.7);

    gainNode.gain.setValueAtTime(volume * 0.6 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    const bpFilter = this.ctx.createBiquadFilter();
    bpFilter.type = 'bandpass';
    bpFilter.frequency.setValueAtTime(tone * 1.8, time);
    bpFilter.Q.setValueAtTime(3.0, time);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(bpFilter);
    bpFilter.connect(gainNode);

    this.connectSynthNode(gainNode, 4);

    carrier.start(time);
    modulator.start(time);
    carrier.stop(time + decay + 0.02);
    modulator.stop(time + decay + 0.02);
  }

  // 6. CLAPS
  synthClap(time, p, velocity = 0.5) {
    const useAlt = p.useAltSound === true || p.useAltSound === 'true' || p.useAltSound === 1;
    if (useAlt) {
      this.synthClapAlt(time, p, velocity);
      return;
    }

    const decay = parseFloat(p.decay) || 0.22;
    const tone = parseFloat(p.tone) || 1200;
    const spread = parseFloat(p.spread) || 12;
    const volume = parseFloat(p.volume) || 0.6;

    if (!this.noiseBuffer) return;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(tone, time);
    filter.Q.setValueAtTime(2.0, time);

    const gainNode = this.ctx.createGain();
    gainNode.connect(filter);
    this.connectSynthNode(filter, 5);

    const burstCount = 3;
    const spacing = spread / 1000.0;
    
    let currentBurstTime = time;
    for (let i = 0; i < burstCount; i++) {
      gainNode.gain.setValueAtTime(volume * 0.7 * velocity, currentBurstTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, currentBurstTime + 0.008);
      currentBurstTime += spacing;
    }

    gainNode.gain.setValueAtTime(volume * velocity, currentBurstTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, currentBurstTime + decay);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.connect(gainNode);

    noise.start(time);
    noise.stop(time + decay + (burstCount * spacing) + 0.02);
  }

  synthClapAlt(time, p, velocity) {
    const decay = parseFloat(p.decay) || 0.22;
    const tone = parseFloat(p.tone) || 1200;
    const volume = parseFloat(p.volume) || 0.6;
    const spread = parseFloat(p.spread) || 12; // Repurposed as Highpass (5 to 30)

    if (!this.noiseBuffer) return;

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(tone * 1.8, time);
    osc.frequency.exponentialRampToValueAtTime(tone * 0.9, time + 0.015);

    oscGain.gain.setValueAtTime(volume * 0.8 * velocity, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    const hpFreq = 500 + spread * 80;
    filter.frequency.setValueAtTime(hpFreq, time);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(volume * 0.45 * velocity, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.35);

    osc.connect(oscGain);
    this.connectSynthNode(oscGain, 5);

    noise.connect(filter);
    filter.connect(noiseGain);
    this.connectSynthNode(noiseGain, 5);

    osc.start(time);
    noise.start(time);
    osc.stop(time + 0.03);
    noise.stop(time + decay * 0.4);
  }

  // 7. TOMS (Tuned per step)
  synthTom(time, p, stepPitch = 0.5, velocity = 0.5) {
    const useAlt = p.useAltSound === true || p.useAltSound === 'true' || p.useAltSound === 1;
    if (useAlt) {
      this.synthTomAlt(time, p, stepPitch, velocity);
      return;
    }

    const decay = parseFloat(p.decay) || 0.35;
    const baseTone = parseFloat(p.tone) || 90;
    const sweep = parseFloat(p.sweep) || 0.45;
    const volume = parseFloat(p.volume) || 0.65;

    const stepPitchFreq = 50 + (stepPitch * 300);
    const startFreq = stepPitchFreq * (1.5 + sweep * 1.5);
    const endFreq = stepPitchFreq;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = 'triangle';
    
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + decay * 0.5);

    gainNode.gain.setValueAtTime(volume * 0.9 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(baseTone * 5, time);

    osc.connect(lowpass);
    lowpass.connect(gainNode);
    this.connectSynthNode(gainNode, 6);

    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  synthTomAlt(time, p, stepPitch, velocity) {
    const decay = parseFloat(p.decay) || 0.35;
    const sweep = parseFloat(p.sweep) || 0.45;
    const volume = parseFloat(p.volume) || 0.65;

    const stepPitchFreq = 50 + (stepPitch * 300);
    const startFreq = stepPitchFreq * (2.0 + sweep * 1.5);
    const endFreq = stepPitchFreq;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + decay * 0.4);

    gainNode.gain.setValueAtTime(volume * 0.9 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    const resonantFilter = this.ctx.createBiquadFilter();
    resonantFilter.type = 'bandpass';
    resonantFilter.frequency.setValueAtTime(startFreq * 1.2, time);
    resonantFilter.frequency.exponentialRampToValueAtTime(endFreq * 0.9, time + decay * 0.5);
    resonantFilter.Q.setValueAtTime(8.0, time);

    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(volume * 0.25 * velocity, time);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.015);

      noise.connect(resonantFilter);
      resonantFilter.connect(noiseGain);
      this.connectSynthNode(noiseGain, 6);

      noise.start(time);
      noise.stop(time + 0.035);
    }

    osc.connect(resonantFilter);
    resonantFilter.connect(gainNode);
    this.connectSynthNode(gainNode, 6);

    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  // 8. BEEP (Tuned per step)
  synthBeep(time, p, stepPitch = 0.5, velocity = 0.5) {
    const useAlt = p.useAltSound === true || p.useAltSound === 'true' || p.useAltSound === 1;
    if (useAlt) {
      this.synthBeepAlt(time, p, stepPitch, velocity);
      return;
    }

    const decay = parseFloat(p.decay) || 0.15;
    const pulseWidth = parseFloat(p.pulseWidth) || 0.0;
    const volume = parseFloat(p.volume) || 0.5;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = pulseWidth > 0.5 ? 'square' : 'triangle';
    
    const frequency = 200 + (stepPitch * 2800);
    osc.frequency.setValueAtTime(frequency, time);

    gainNode.gain.setValueAtTime(volume * 0.7 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gainNode);
    this.connectSynthNode(gainNode, 7);

    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  synthBeepAlt(time, p, stepPitch, velocity) {
    const decay = parseFloat(p.decay) || 0.15;
    const volume = parseFloat(p.volume) || 0.5;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'square';
    
    const frequency = 200 + (stepPitch * 2800);
    osc.frequency.setValueAtTime(frequency * 2.5, time);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.15, time + decay * 0.7);

    gainNode.gain.setValueAtTime(volume * 0.7 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gainNode);
    this.connectSynthNode(gainNode, 7);

    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  // 9. BLIP (Tuned per step)
  synthBlip(time, p, stepPitch = 0.5, velocity = 0.5) {
    const useAlt = p.useAltSound === true || p.useAltSound === 'true' || p.useAltSound === 1;
    if (useAlt) {
      this.synthBlipAlt(time, p, stepPitch, velocity);
      return;
    }

    const decay = parseFloat(p.decay) || 0.04;
    const sweep = parseFloat(p.sweep) || 0.5;
    const volume = parseFloat(p.volume) || 0.6;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'sine';
    
    const startFreq = 500 + (stepPitch * 4500);
    osc.frequency.setValueAtTime(startFreq, time);
    
    const minFreq = 100;
    const sweepDuration = 0.01 + (1 - sweep) * 0.05;
    osc.frequency.exponentialRampToValueAtTime(minFreq, time + sweepDuration);

    gainNode.gain.setValueAtTime(volume * 0.8 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gainNode);
    this.connectSynthNode(gainNode, 8);

    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  synthBlipAlt(time, p, stepPitch, velocity) {
    const decay = parseFloat(p.decay) || 0.04;
    const volume = parseFloat(p.volume) || 0.6;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'sine';
    const startFreq = 80;
    osc.frequency.setValueAtTime(startFreq, time);
    
    const endFreq = 600 + (stepPitch * 3500);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + decay * 0.85);

    gainNode.gain.setValueAtTime(volume * 0.85 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gainNode);
    this.connectSynthNode(gainNode, 8);

    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  // 10. BLOOP (Tuned per step)
  synthBloop(time, p, stepPitch = 0.5, velocity = 0.5) {
    const useAlt = p.useAltSound === true || p.useAltSound === 'true' || p.useAltSound === 1;
    if (useAlt) {
      this.synthBloopAlt(time, p, stepPitch, velocity);
      return;
    }

    const decay = parseFloat(p.decay) || 0.18;
    const speed = parseFloat(p.speed) || 0.4;
    const volume = parseFloat(p.volume) || 0.55;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'sine';
    const startFreq = 60;
    osc.frequency.setValueAtTime(startFreq, time);
    
    const endFreq = 150 + (stepPitch * 1650);
    
    const sweepDuration = 0.02 + speed * 0.12;
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + sweepDuration);

    gainNode.gain.setValueAtTime(volume * 0.9 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gainNode);
    this.connectSynthNode(gainNode, 9);

    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  synthBloopAlt(time, p, stepPitch, velocity) {
    const decay = parseFloat(p.decay) || 0.18;
    const volume = parseFloat(p.volume) || 0.55;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'triangle';
    
    const frequency = 150 + (stepPitch * 1650);
    osc.frequency.setValueAtTime(frequency * 1.5, time);
    osc.frequency.linearRampToValueAtTime(frequency * 0.5, time + decay * 0.3);
    osc.frequency.exponentialRampToValueAtTime(frequency * 2.2, time + decay * 0.85);

    gainNode.gain.setValueAtTime(volume * 0.9 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gainNode);
    this.connectSynthNode(gainNode, 9);

    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  // 11. NOISY CRUNCH
  synthCrunch(time, p, velocity = 0.5) {
    const useAlt = p.useAltSound === true || p.useAltSound === 'true' || p.useAltSound === 1;
    if (useAlt) {
      this.synthCrunchAlt(time, p, velocity);
      return;
    }

    const decay = parseFloat(p.decay) || 0.4;
    const tone = parseFloat(p.tone) || 1200;
    const crunch = parseFloat(p.crunch) || 0.6;
    const volume = parseFloat(p.volume) || 0.5;

    if (!this.noiseBuffer) return;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(tone, time);
    filter.Q.setValueAtTime(2.5 + crunch * 4, time);

    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.makeDistortionCurve(crunch * 180);
    shaper.oversample = '4x';

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(volume * 0.8 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(filter);
    filter.connect(shaper);
    shaper.connect(gainNode);
    this.connectSynthNode(gainNode, 10);

    noise.start(time);
    noise.stop(time + decay + 0.01);
  }

  synthCrunchAlt(time, p, velocity) {
    const decay = parseFloat(p.decay) || 0.4;
    const tone = parseFloat(p.tone) || 1200;
    const crunch = parseFloat(p.crunch) || 0.6;
    const volume = parseFloat(p.volume) || 0.5;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(tone * 0.35, time);

    const bpFilter = this.ctx.createBiquadFilter();
    bpFilter.type = 'bandpass';
    
    bpFilter.frequency.setValueAtTime(tone * 0.5, time);
    bpFilter.frequency.exponentialRampToValueAtTime(tone * 3.5, time + decay * 0.35);
    bpFilter.frequency.exponentialRampToValueAtTime(tone * 0.8, time + decay * 0.85);
    bpFilter.Q.setValueAtTime(5.0 + crunch * 12.0, time);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(volume * 0.8 * velocity, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(bpFilter);
    bpFilter.connect(gainNode);
    this.connectSynthNode(gainNode, 10);

    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  // 12. CUSTOM SAMPLE & MICROPHONE RECORDER
  synthSample(time, p, velocity = 0.5) {
    const decay = parseFloat(p.decay) !== undefined ? parseFloat(p.decay) : 1.5;
    const tone = parseFloat(p.tone) !== undefined ? parseFloat(p.tone) : 1.0;
    const volume = parseFloat(p.volume) !== undefined ? parseFloat(p.volume) : 0.7;
    const startPoint = parseFloat(p.startPoint) !== undefined ? parseFloat(p.startPoint) : 0.0;
    const endPoint = parseFloat(p.endPoint) !== undefined ? parseFloat(p.endPoint) : 1.0;

    if (!this.sampleBuffer) {
      this.synthRimshotFallback(time, volume * velocity, decay, tone);
      return;
    }

    try {
      const source = this.ctx.createBufferSource();
      source.buffer = this.sampleBuffer;
      source.playbackRate.setValueAtTime(tone, time);

      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(volume * velocity, time);

      const sampleDuration = this.sampleBuffer.duration;
      const startOffset = sampleDuration * startPoint;
      const playbackEnd = sampleDuration * endPoint;
      const sliceDuration = Math.max(0.01, (playbackEnd - startOffset) / tone);

      const fadeDuration = Math.min(sliceDuration, decay);
      gainNode.gain.setValueAtTime(volume * velocity, time);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + fadeDuration);

      source.connect(gainNode);
      this.connectSynthNode(gainNode, 11);

      source.start(time, startOffset, sliceDuration);
      source.stop(time + sliceDuration + 0.01);
    } catch (e) {
      console.warn("Error triggering custom sample node:", e);
      this.synthRimshotFallback(time, volume * velocity, decay, tone);
    }
  }

  synthRimshotFallback(time, volume, decay, tone) {
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800 * tone, time);
    osc.frequency.exponentialRampToValueAtTime(400 * tone, time + 0.03);
    
    gainNode.gain.setValueAtTime(volume * 0.6, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.06 * decay);
    
    osc.connect(gainNode);
    this.connectSynthNode(gainNode, 11);
    
    osc.start(time);
    osc.stop(time + 0.07 * decay);
  }

  makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // ==========================================
  // INDIVIDUAL FX UPGRADE UPDATE HOOKS
  // ==========================================
  
  updateDistortionDrive() {
    if (!this.distNode) return;
    const drive = this.fxParams.distortion.drive;
    if (drive > 0.01) {
      this.distNode.curve = this.makeDistortionCurve(drive * 250);
    } else {
      this.distNode.curve = null;
    }
  }

  updateFilter() {
    if (!this.ctx || !this.filterInput || !this.filterOutput) return;

    const { cutoff, resonance, type } = this.fxParams.filter;
    const time = this.ctx.currentTime;

    // 1. Cleanup existing sub-graph
    if (this.filterNode) {
      try { this.filterNode.disconnect(); } catch (e) {}
    }
    if (this.combDelay) {
      try { this.combDelay.disconnect(); } catch (e) {}
      this.combDelay = null;
    }
    if (this.combFeedback) {
      try { this.combFeedback.disconnect(); } catch (e) {}
      this.combFeedback = null;
    }
    if (this.formantFilters) {
      this.formantFilters.forEach(f => {
        try { f.disconnect(); } catch (e) {}
      });
      this.formantFilters = null;
    }
    if (this.ringOsc) {
      try { this.ringOsc.stop(); } catch (e) {}
      try { this.ringOsc.disconnect(); } catch (e) {}
      this.ringOsc = null;
    }
    if (this.ringGain) {
      try { this.ringGain.disconnect(); } catch (e) {}
      this.ringGain = null;
    }
    if (this.phaserFilters) {
      this.phaserFilters.forEach(f => {
        try { f.disconnect(); } catch (e) {}
      });
      this.phaserFilters = null;
    }
    if (this.lp24Filters) {
      this.lp24Filters.forEach(f => {
        try { f.disconnect(); } catch (e) {}
      });
      this.lp24Filters = null;
    }
    try { this.filterInput.disconnect(); } catch (e) {}

    // Safe clamped parameters
    const safeCutoff = Math.max(50, Math.min(20000, cutoff));
    const safeResonance = Math.max(0.1, Math.min(25, resonance));

    // 2. Build and route based on filter type
    if (type === 'comb') {
      // Comb Filter: Delay + Feedback loop
      const delayTime = Math.max(0.0005, Math.min(0.02, 1.0 / safeCutoff));
      this.combDelay = this.ctx.createDelay(0.05);
      this.combDelay.delayTime.setValueAtTime(delayTime, time);

      this.combFeedback = this.ctx.createGain();
      const fbVal = Math.min(0.95, (safeResonance / 25.0) * 0.9);
      this.combFeedback.gain.setValueAtTime(fbVal, time);

      // Connect input to delay and output (dry + wet mix)
      this.filterInput.connect(this.combDelay);
      this.filterInput.connect(this.filterOutput);

      this.combDelay.connect(this.combFeedback);
      this.combFeedback.connect(this.combDelay);
      this.combDelay.connect(this.filterOutput);

    } else if (type === 'formant') {
      // Formant Filter: Parallel Bandpass filters
      const fRatio = safeCutoff / 1000.0;
      const formants = [
        { f: 730 * fRatio, q: 12 },
        { f: 1090 * fRatio, q: 10 },
        { f: 2440 * fRatio, q: 8 }
      ];

      this.formantFilters = [];
      formants.forEach(cfg => {
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(Math.max(50, Math.min(20000, cfg.f)), time);
        bp.Q.setValueAtTime(cfg.q * (safeResonance / 2.0), time);
        
        this.filterInput.connect(bp);
        bp.connect(this.filterOutput);
        this.formantFilters.push(bp);
      });

    } else if (type === 'ringmod') {
      // Ring Modulator
      this.ringGain = this.ctx.createGain();
      this.ringGain.gain.setValueAtTime(0.0, time);

      this.ringOsc = this.ctx.createOscillator();
      this.ringOsc.type = 'sine';
      this.ringOsc.frequency.setValueAtTime(safeCutoff, time);

      this.filterInput.connect(this.ringGain);
      this.ringOsc.connect(this.ringGain.gain);
      this.ringGain.connect(this.filterOutput);

      // Dry mix
      this.filterInput.connect(this.filterOutput);
      this.ringOsc.start(time);

    } else if (type === 'phaser') {
      // Phaser
      this.phaserFilters = [];
      let lastNode = this.filterInput;
      for (let i = 0; i < 4; i++) {
        const ap = this.ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.setValueAtTime(safeCutoff, time);
        ap.Q.setValueAtTime(safeResonance, time);
        lastNode.connect(ap);
        lastNode = ap;
        this.phaserFilters.push(ap);
      }
      lastNode.connect(this.filterOutput);
      this.filterInput.connect(this.filterOutput);

    } else if (type === 'lowpass24') {
      // 24dB Lowpass
      const lp1 = this.ctx.createBiquadFilter();
      lp1.type = 'lowpass';
      lp1.frequency.setValueAtTime(safeCutoff, time);
      lp1.Q.setValueAtTime(Math.sqrt(safeResonance), time);

      const lp2 = this.ctx.createBiquadFilter();
      lp2.type = 'lowpass';
      lp2.frequency.setValueAtTime(safeCutoff, time);
      lp2.Q.setValueAtTime(Math.sqrt(safeResonance), time);

      this.filterInput.connect(lp1);
      lp1.connect(lp2);
      lp2.connect(this.filterOutput);

      this.lp24Filters = [lp1, lp2];

    } else {
      // Standard Biquad Types
      if (!this.filterNode) {
        this.filterNode = this.ctx.createBiquadFilter();
      }
      let biquadType = type;
      if (biquadType !== 'lowpass' && biquadType !== 'highpass' && biquadType !== 'bandpass' && biquadType !== 'notch' && biquadType !== 'peaking') {
        biquadType = 'lowpass';
      }
      this.filterNode.type = biquadType;
      this.filterNode.frequency.setValueAtTime(safeCutoff, time);
      this.filterNode.Q.setValueAtTime(safeResonance, time);

      this.filterInput.connect(this.filterNode);
      this.filterNode.connect(this.filterOutput);
    }
  }

  updateDelay() {
    if (!this.delayNode) return;
    const { time, feedback, mix } = this.fxParams.delay;
    this.delayNode.delayTime.setValueAtTime(Math.max(0.01, Math.min(2.0, time)), this.ctx?.currentTime || 0);
    this.delayFeedback.gain.setValueAtTime(Math.max(0.0, Math.min(0.95, feedback)), this.ctx?.currentTime || 0);
    
    // Wet/dry mix
    this.delayWet.gain.setValueAtTime(mix, this.ctx?.currentTime || 0);
    this.delayDry.gain.setValueAtTime(1.0 - mix * 0.5, this.ctx?.currentTime || 0); // pad dry signal slightly
  }

  triggerSidechain(time) {
    if (!this.ctx || !this.sidechainNode) return;
    if (!this.fxEnabled.sidechain) return;

    const { ratio, release, attack } = this.fxParams.sidechain;
    const duckedVolume = Math.max(0.0, 1.0 - ratio); // ratio 0.8 ducks to 0.2

    this.sidechainNode.gain.cancelScheduledValues(time);
    this.sidechainNode.gain.setValueAtTime(1.0, time);
    // Attack phase (ducking down)
    this.sidechainNode.gain.linearRampToValueAtTime(duckedVolume, time + Math.max(0.002, attack));
    // Release phase (recovering up)
    this.sidechainNode.gain.exponentialRampToValueAtTime(1.0, time + Math.max(0.002, attack) + Math.max(0.01, release));
  }

  updateSidechain() {
    if (!this.fxParams.sidechain) return;
    const { ratio, release, attack } = this.fxParams.sidechain;
    this.log(`Updated Sidechain Compressor: ratio ${Math.round(ratio*100)}%, attack ${Math.round(attack*1000)}ms, release ${Math.round(release*1000)}ms`);
  }

  updateReverbImpulse() {
    if (!this.ctx) return;
    const { decay, mix } = this.fxParams.reverb;
    
    this.log(`Hot-swapping ConvolverNode: decay ${decay.toFixed(1)}s, mix ${Math.round(mix * 100)}%`);
    
    // 1. Synthesize lush white noise decay response
    const rate = this.ctx.sampleRate;
    const length = rate * decay;
    const impulse = this.ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    
    for (let i = 0; i < length; i++) {
      const decayFactor = Math.exp(-i / (rate * (decay / 4.5)));
      left[i] = (Math.random() * 2 - 1) * decayFactor;
      right[i] = (Math.random() * 2 - 1) * decayFactor;
    }
    
    // 2. Create a new ConvolverNode (Web Audio convolver buffer can only be set once!)
    const newConvolver = this.ctx.createConvolver();
    newConvolver.buffer = impulse;
    
    // 3. Disconnect the old convolver safely if it exists
    if (this.reverbConvolver) {
      try {
        this.reverbInput.disconnect(this.reverbConvolver);
        this.reverbConvolver.disconnect();
      } catch (e) {
        // Safe catch if not already wired
      }
    }
    
    // 4. Re-wire new convolver inside Reverb dry/wet parallel block
    this.reverbConvolver = newConvolver;
    this.reverbInput.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbWet);
    
    // 5. Update wet/dry gains
    if (this.reverbWet && this.reverbDry) {
      this.reverbWet.gain.setValueAtTime(mix, this.ctx.currentTime);
      this.reverbDry.gain.setValueAtTime(1.0 - mix * 0.5, this.ctx.currentTime);
    }
  }

  // ==========================================
  // SEQUENCER SCHEDULER (CLOCK) WITH SWING
  // ==========================================

  // Start the sequencer
  async start(gridData) {
    if (this.isPlaying) return;
    this.init();
    await this.resumeContext();
    
    this.gridData = gridData;
    this.isPlaying = true;
    
    // Set nextNoteTime slightly in the future (50ms) to allow the scheduler
    // to schedule the first step in advance, eliminating startup jitter
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    
    this.log(`Sequencer clock started: ${this.bpm} BPM, ${this.stepsCount} steps, Swing: ${Math.round(this.swing * 100)}%`);
    
    // Run scheduler synchronously once immediately to schedule step 0
    this.scheduler();
    
    // Start clock thread
    this.timerId = setInterval(() => {
      this.scheduler();
    }, this.lookahead);
    
    if (this.onTick) this.onTick(true);
  }

  // Update grid data live
  updateGridData(gridData) {
    this.gridData = gridData;
  }

  // Stop the sequencer
  stop() {
    if (!this.isPlaying) return;
    
    this.isPlaying = false;
    this.log("Sequencer clock stopped.");
    clearInterval(this.timerId);
    this.timerId = null;
    
    if (this.onTick) this.onTick(false);
  }

  // Set grid step configurations
  setStepsCount(count) {
    this.stepsCount = count;
    if (this.currentStep >= count) {
      this.currentStep = 0;
    }
  }

  // Precision lookahead scheduler
  scheduler() {
    // Throttling or lag recovery: if nextNoteTime falls behind currentTime by more than 100ms,
    // catch up nextNoteTime to currentTime to prevent audio bursts/glitches.
    if (this.nextNoteTime < this.ctx.currentTime - 0.1) {
      this.nextNoteTime = this.ctx.currentTime;
    }
    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
      this.scheduleNote(this.currentStep, this.nextNoteTime);
      this.advanceNote();
    }
  }

  // Advance clock with SWING Timing calculation
  advanceNote() {
    const secondsPerBeat = 60.0 / this.bpm;
    const stepDuration = secondsPerBeat / 4.0; // 16th note steps

    // Swing delays offbeats (odd 0-indexed steps: 1, 3, 5...)
    // swing parameter 0 to 1 delays even steps by up to half step duration
    const swingFactor = this.swing * 0.55; 
    
    // Half-tempo break doubles the step duration, slowing playback by 50%
    const speedMultiplier = (this.fillActive && this.fillPattern === 'half_tempo') ? 2.0 : 1.0;
    
    const duration = ((this.currentStep % 2 === 0) 
      ? stepDuration * (1 + swingFactor) 
      : stepDuration * (1 - swingFactor)) * speedMultiplier;

    this.nextNoteTime += duration;
    
    // Advance current step count loop
    this.currentStep = (this.currentStep + 1) % this.stepsCount;
  }

  // Schedule triggering nodes in advance
  scheduleNote(step, time) {
    if (!this.gridData || this.gridData.length === 0) return;

    // Apply real-time FX automation curves
    this.applyFxAutomationForStep(step, time);

    // Handle pending Slam the Door trigger on next beat boundary
    if (this.isSlamPending && this.isBeatBoundary(step)) {
      this.isSlamPending = false;
      this.isSlamTheDoorActive = true;
      const mixVal = this.slamMix !== undefined ? this.slamMix : 1.0;
      this.slamDryGain.gain.cancelScheduledValues(time);
      this.slamWetGain.gain.cancelScheduledValues(time);
      this.slamDryGain.gain.linearRampToValueAtTime(1.0 - mixVal, time + 0.15); // gentle 150ms transition
      this.slamWetGain.gain.linearRampToValueAtTime(mixVal, time + 0.15);
      this.log(`Pending Slam the Door engaged at step ${step} (time: ${time.toFixed(3)})`);
      if (this.isBarStart(step)) {
        this.synthSlamTheDoorNote(time);
      }
    } else if (this.isSlamTheDoorActive && this.isBarStart(step)) {
      // Slam the Door automatic bass note triggering on bar starts
      this.synthSlamTheDoorNote(time);
    }

    // Divert normal scheduling to drum fill logic if momentary fill is active
    if (this.fillActive && this.fillPattern !== 'half_tempo') {
      this.triggerFillPattern(step, time);
      return;
    }

    for (let trackIdx = 0; trackIdx < this.gridData.length; trackIdx++) {
      const track = this.gridData[trackIdx];
      
      if (track[step]) {
        const vel = (this.stepVelocities && this.stepVelocities[trackIdx]) 
          ? this.stepVelocities[trackIdx][step] 
          : 0.5;

        const rollValue = parseInt(track[step]) || 1;

        // Schedule stutters/rolls if subdivision active
        if (rollValue > 1) {
          const stepDuration = (60.0 / this.bpm) / 4.0;
          const subStepDuration = stepDuration / rollValue;
          for (let r = 0; r < rollValue; r++) {
            const hitTime = time + r * subStepDuration;
            if (trackIdx === 6) {
              this.triggerInstrument(trackIdx, hitTime, this.tomStepPitches[step], vel, step);
            } else if (trackIdx === 7) {
              this.triggerInstrument(trackIdx, hitTime, this.beepStepPitches[step], vel, step);
            } else if (trackIdx === 8) {
              this.triggerInstrument(trackIdx, hitTime, this.blipStepPitches[step], vel, step);
            } else if (trackIdx === 9) {
              this.triggerInstrument(trackIdx, hitTime, this.bloopStepPitches[step], vel, step);
            } else {
              this.triggerInstrument(trackIdx, hitTime, null, vel, step);
            }
          }
        } else {
          // Standard single hit trigger
          if (trackIdx === 6) {
            this.triggerInstrument(trackIdx, time, this.tomStepPitches[step], vel, step);
          } else if (trackIdx === 7) {
            this.triggerInstrument(trackIdx, time, this.beepStepPitches[step], vel, step);
          } else if (trackIdx === 8) {
            this.triggerInstrument(trackIdx, time, this.blipStepPitches[step], vel, step);
          } else if (trackIdx === 9) {
            this.triggerInstrument(trackIdx, time, this.bloopStepPitches[step], vel, step);
          } else {
            this.triggerInstrument(trackIdx, time, null, vel, step);
          }
        }
      }
    }
    
    // Synchronize UI steps change
    if (this.onStepTrigger) {
      const delayMs = (time - this.ctx.currentTime) * 1000;
      setTimeout(() => {
        if (this.isPlaying) {
          this.onStepTrigger(step);
        }
      }, Math.max(0, delayMs));
    }
  }

  // Generate real-time fills on active tracks based on selected fill pattern
  triggerFillPattern(step, time) {
    const stepDuration = (60.0 / this.bpm) / 4.0;
    
    switch (this.fillPattern) {
      case 'traditional_a':
        // SN roll on every step, Kick on every 4th step
        this.triggerInstrument(1, time); // Snare
        if (step % 4 === 0) {
          this.triggerInstrument(0, time); // Kick
        }
        break;
      
      case 'traditional_b': {
        // Toms and Snare build-up ending on a Crash (Crunch channel)
        const moduloStep = step % 16;
        if (moduloStep < 8) {
          this.triggerInstrument(1, time); // Snare
        } else if (moduloStep < 12) {
          this.triggerInstrument(6, time, 0.4); // Tom mid-pitch
        } else if (moduloStep < 15) {
          this.triggerInstrument(1, time); // Snare
          this.triggerInstrument(6, time, 0.6); // Tom high-pitch
        } else {
          this.triggerInstrument(0, time); // Kick
          this.triggerInstrument(10, time); // Crunch (Crash proxy)
        }
        break;
      }
      
      case 'glitch': {
        // Randomized sounds on every 16th and 32nd note step
        const randomInst1 = Math.floor(Math.random() * 12);
        const randomInst2 = Math.floor(Math.random() * 12);
        const randomPitch1 = 0.2 + Math.random() * 0.8;
        const randomPitch2 = 0.2 + Math.random() * 0.8;
        
        this.triggerInstrument(randomInst1, time, randomPitch1);
        
        // Rapid 32nd note micro-stutter
        setTimeout(() => {
          if (this.fillActive && this.isPlaying) {
            this.triggerInstrument(randomInst2, this.ctx.currentTime, randomPitch2);
          }
        }, stepDuration * 500);
        break;
      }
      
      case 'stutter': {
        // High-speed 32nd note stuttering of the currently focused instrument
        const focusedInst = this.activeInstrumentIndex || 0;
        this.triggerInstrument(focusedInst, time);
        
        setTimeout(() => {
          if (this.fillActive && this.isPlaying) {
            this.triggerInstrument(focusedInst, this.ctx.currentTime);
          }
        }, stepDuration * 500);
        break;
      }

      case 'crescendo': {
        const modulo = step % 16;
        const vol = 0.15 + 0.85 * (modulo / 15);
        this.triggerInstrument(1, time, null, vol);
        if (modulo % 4 === 0) {
          this.triggerInstrument(6, time, 0.5, vol);
        }
        break;
      }

      case 'pitch_rise': {
        const modulo = step % 16;
        const pitch = 0.5 + 1.5 * (modulo / 15);
        this.triggerInstrument(1, time, pitch, 0.7);
        break;
      }

      case 'melodic_run': {
        const modulo = step % 16;
        const degrees = [0, 2, 4, 5, 7, 9, 11, 12, 14, 12, 11, 9, 7, 5, 4, 2];
        const degree = degrees[modulo];
        const pitch = Math.pow(2, degree / 12) * 0.5;
        this.triggerInstrument(7, time, pitch, 0.8);
        this.triggerInstrument(2, time, null, 0.3);
        break;
      }

      case 'drum_n_bass_crossover': {
        const modulo = step % 16;
        if (modulo === 0 || modulo === 6 || modulo === 10) {
          this.triggerInstrument(0, time, null, 0.9);
        } else if (modulo === 4 || modulo === 12 || modulo === 14) {
          this.triggerInstrument(1, time, null, 0.85);
        } else {
          this.triggerInstrument(2, time, null, 0.5);
        }
        break;
      }

      case 'dynamic_decay': {
        const modulo = step % 16;
        const pct = modulo / 15;
        if (this.filterNode && this.fxEnabled['filter']) {
          const targetCutoff = 300 + 4000 * pct;
          this.filterNode.frequency.setValueAtTime(targetCutoff, time);
        }
        this.triggerInstrument(1, time, null, 0.8);
        if (modulo % 2 === 0) {
          this.triggerInstrument(6, time, 0.4 + 0.4 * pct, 0.7);
        }
        break;
      }

      case 'chaos_sweep': {
        const modulo = step % 16;
        const pct = modulo / 15;
        if (this.filterNode && this.fxEnabled['filter']) {
          this.filterNode.type = 'bandpass';
          this.filterNode.frequency.setValueAtTime(200 + 8000 * pct, time);
          this.filterNode.Q.setValueAtTime(5.0, time);
        }
        const randIdx = Math.floor(Math.random() * 6) + 6;
        this.triggerInstrument(randIdx, time, 0.5 + Math.random() * 1.0, 0.7);
        break;
      }
      
      default:
        break;
    }
  }

  // Record automations for Toms, Beeps, Blips, Bloops
  recordPitchForInstrument(instrumentIdx, step, val) {
    if (!this.isRecordingPitch) return;
    
    if (instrumentIdx === 6) {
      this.tomStepPitches[step] = val;
    } else if (instrumentIdx === 7) {
      this.beepStepPitches[step] = val;
    } else if (instrumentIdx === 8) {
      this.blipStepPitches[step] = val;
    } else if (instrumentIdx === 9) {
      this.bloopStepPitches[step] = val;
    }
  }

  // Record FX automations per step
  recordFxAutomation(type, paramOrState, step, value) {
    if (!this.isRecordingPitch) return;
    if (paramOrState === 'enabled') {
      this.fxAutomation.enabled[type][step] = value;
    } else {
      if (!this.fxAutomation.params[type]) {
        this.fxAutomation.params[type] = {};
      }
      this.fxAutomation.params[type][paramOrState][step] = value;
    }
  }

  // Apply real-time FX automation curves
  applyFxAutomationForStep(step, time) {
    if (!this.ctx) return;
    
    // 1. Bitcrusher enabled / disabled
    const bcEnabled = this.fxAutomation.enabled.bitcrusher[step];
    if (bcEnabled !== null && bcEnabled !== undefined) {
      this.bitcrusherEnabled = bcEnabled;
    }
    const bcBits = this.fxAutomation.params.bitcrusher.bits[step];
    if (bcBits !== null && bcBits !== undefined) {
      this.bitcrusherBits = bcBits;
    }
    const bcDS = this.fxAutomation.params.bitcrusher.downsample[step];
    if (bcDS !== null && bcDS !== undefined) {
      this.bitcrusherDownsample = bcDS;
    }

    // 2. Modular FX modules toggles
    let chainChanged = false;
    for (const key of ['distortion', 'filter', 'delay', 'reverb']) {
      const enabled = this.fxAutomation.enabled[key][step];
      if (enabled !== null && enabled !== undefined) {
        if (this.fxEnabled[key] !== enabled) {
          this.fxEnabled[key] = enabled;
          chainChanged = true;
        }
      }
    }
    if (chainChanged) {
      this.rebuildFXChain();
    }

    // 3. Modular FX knobs
    // Distortion
    const distDrive = this.fxAutomation.params.distortion.drive[step];
    if (distDrive !== null && distDrive !== undefined) {
      this.fxParams.distortion.drive = distDrive;
      if (this.distNode) {
        this.updateDistortionDrive();
      }
    }

    // Filter
    const filtCutoff = this.fxAutomation.params.filter.cutoff[step];
    if (filtCutoff !== null && filtCutoff !== undefined) {
      this.fxParams.filter.cutoff = filtCutoff;
    }
    const filtRes = this.fxAutomation.params.filter.resonance[step];
    if (filtRes !== null && filtRes !== undefined) {
      this.fxParams.filter.resonance = filtRes;
    }
    const filtType = this.fxAutomation.params.filter.type[step];
    if (filtType !== null && filtType !== undefined) {
      this.fxParams.filter.type = filtType;
    }
    if (this.filterNode && (filtCutoff !== null || filtRes !== null || filtType !== null)) {
      this.updateFilter();
    }

    // Delay
    const delayTime = this.fxAutomation.params.delay.time[step];
    if (delayTime !== null && delayTime !== undefined) {
      this.fxParams.delay.time = delayTime;
    }
    const delayFeedback = this.fxAutomation.params.delay.feedback[step];
    if (delayFeedback !== null && delayFeedback !== undefined) {
      this.fxParams.delay.feedback = delayFeedback;
    }
    const delayMix = this.fxAutomation.params.delay.mix[step];
    if (delayMix !== null && delayMix !== undefined) {
      this.fxParams.delay.mix = delayMix;
    }
    if (this.delayNode && (delayTime !== null || delayFeedback !== null || delayMix !== null)) {
      this.updateDelay();
    }

    // Reverb
    const reverbDecay = this.fxAutomation.params.reverb.decay[step];
    if (reverbDecay !== null && reverbDecay !== undefined) {
      this.fxParams.reverb.decay = reverbDecay;
    }
    const reverbMix = this.fxAutomation.params.reverb.mix[step];
    if (reverbMix !== null && reverbMix !== undefined) {
      this.fxParams.reverb.mix = reverbMix;
    }
    if (reverbDecay !== null && reverbDecay !== undefined) {
      this.updateReverbImpulse();
    } else if (reverbMix !== null && reverbMix !== undefined) {
      if (this.reverbWet && this.reverbDry) {
        this.reverbWet.gain.setValueAtTime(reverbMix, time);
        this.reverbDry.gain.setValueAtTime(1.0 - reverbMix * 0.5, time);
      }
    }
  }

  isBeatBoundary(step) {
    const sig = this.timeSignature || '4/4';
    if (sig === '6/8') {
      return step % 3 === 0;
    }
    return step % 4 === 0;
  }

  isBarStart(step) {
    const sig = this.timeSignature || '4/4';
    if (sig === '4/4') {
      return step % 16 === 0;
    } else if (sig === '3/4') {
      return step % 12 === 0;
    } else if (sig === '5/4') {
      return step % 20 === 0;
    } else if (sig === '6/8') {
      return step % 12 === 0;
    }
    return step === 0;
  }

  // Slam the Door neomorphic FX dry/wet routing
  setSlamTheDoor(active, time = null) {
    this.init();
    if (time === null && this.ctx) {
      time = this.ctx.currentTime;
    }
    if (!this.ctx) return;
    
    const mixVal = this.slamMix !== undefined ? this.slamMix : 1.0;
    if (active) {
      if (!this.isPlaying) {
        // Trigger instantly if stationary
        this.isSlamTheDoorActive = true;
        this.isSlamPending = false;
        this.slamDryGain.gain.cancelScheduledValues(time);
        this.slamWetGain.gain.cancelScheduledValues(time);
        this.slamDryGain.gain.linearRampToValueAtTime(1.0 - mixVal, time + 0.15); // gentle 150ms transition
        this.slamWetGain.gain.linearRampToValueAtTime(mixVal, time + 0.15);
        this.synthSlamTheDoorNote(time);
      } else {
        // Quantize delay until the next beat boundary
        this.isSlamPending = true;
      }
    } else {
      this.isSlamTheDoorActive = false;
      this.isSlamPending = false;
      this.slamDryGain.gain.cancelScheduledValues(time);
      this.slamWetGain.gain.cancelScheduledValues(time);
      this.slamDryGain.gain.linearRampToValueAtTime(1.0, time + 0.15); // gentle 150ms transition
      this.slamWetGain.gain.linearRampToValueAtTime(0.0, time + 0.15);
    }
  }

  setSlamMix(mix, time = null) {
    this.slamMix = mix;
    if (this.isSlamTheDoorActive && !this.isSlamPending && this.ctx) {
      const t = time || this.ctx.currentTime;
      this.slamDryGain.gain.cancelScheduledValues(t);
      this.slamWetGain.gain.cancelScheduledValues(t);
      this.slamDryGain.gain.linearRampToValueAtTime(1.0 - mix, t + 0.05);
      this.slamWetGain.gain.linearRampToValueAtTime(mix, t + 0.05);
    }
  }

  setDoorType(type) {
    this.doorType = type;
    this.updateSlamFilterType();
  }

  updateSlamFilterType() {
    if (!this.ctx || !this.slamFilterNode) return;
    const type = this.doorType || 0;
    let cutoff = 450;
    let Q = 1.0;
    let filterType = 'lowpass';
    
    if (type === 1) { // Heavy Oak
      cutoff = 250; Q = 1.5; filterType = 'lowpass';
    } else if (type === 2) { // Aluminum
      cutoff = 600; Q = 2.0; filterType = 'bandpass';
    } else if (type === 3) { // Steel Vault
      cutoff = 150; Q = 2.5; filterType = 'lowpass';
    } else if (type === 4) { // Glass Door
      cutoff = 1500; Q = 0.8; filterType = 'highpass';
    } else if (type === 5) { // Submarine Hatch
      cutoff = 200; Q = 3.0; filterType = 'bandpass';
    } else if (type === 6) { // Sci-Fi Airlock
      cutoff = 800; Q = 4.0; filterType = 'bandpass';
    } else if (type === 7) { // Cathedral Gate
      cutoff = 350; Q = 0.7; filterType = 'lowpass';
    }
    
    const time = this.ctx.currentTime;
    this.slamFilterNode.type = filterType;
    this.slamFilterNode.frequency.setValueAtTime(cutoff, time);
    this.slamFilterNode.Q.setValueAtTime(Q, time);
  }

  // Booming, ultra-long decay bass note (Sine sweep 55Hz -> 30Hz)
  synthSlamTheDoorNote(time) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(this.masterGain); // feed into muffled door slam filter/comp!
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(55, time); // A1 bass drop
    osc.frequency.exponentialRampToValueAtTime(30, time + 2.0);
    
    gainNode.gain.setValueAtTime(0.0, time);
    gainNode.gain.linearRampToValueAtTime(0.35, time + 0.10); // slightly gentler attack (100ms) for the sub-bass sweep
    gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 2.8); // booming 2.8s decay
    
    osc.start(time);
    osc.stop(time + 2.9);
  }

  // Generic instrument knob automation recorder
  recordInstrumentAutomation(channelIdx, paramKey, step, value) {
    if (!this.instrumentAutomation[channelIdx]) {
      this.instrumentAutomation[channelIdx] = {};
    }
    if (!this.instrumentAutomation[channelIdx][paramKey]) {
      this.instrumentAutomation[channelIdx][paramKey] = new Array(64).fill(null);
    }
    this.instrumentAutomation[channelIdx][paramKey][step] = value;
  }

  // Session Recording Methods
  startSessionRecording() {
    this.init();
    if (!this.ctx || !this.analyser) return;
    if (this.sessionRecorder) {
      this.sessionRecorder.stop();
    }
    this.sessionRecorder = new SessionRecorder(this.ctx, this.analyser);
    this.sessionRecorder.start();
  }

  stopSessionRecording() {
    if (!this.sessionRecorder) return null;
    const blob = this.sessionRecorder.stop();
    this.sessionRecorder = null;
    return blob;
  }
}

// Custom Session Recorder utility using standard ScriptProcessorNode to collect Float32 PCM samples and generate WAV Blob
class SessionRecorder {
  constructor(audioContext, sourceNode) {
    this.ctx = audioContext;
    this.source = sourceNode;
    this.isRecording = false;
    this.recordingBufferL = [];
    this.recordingBufferR = [];
    this.recorderNode = null;
  }

  start() {
    this.recordingBufferL = [];
    this.recordingBufferR = [];
    this.recorderNode = this.ctx.createScriptProcessor(4096, 2, 2);
    this.recorderNode.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      const inputL = e.inputBuffer.getChannelData(0);
      const inputR = e.inputBuffer.getChannelData(1);
      
      this.recordingBufferL.push(new Float32Array(inputL));
      this.recordingBufferR.push(new Float32Array(inputR));
      
      const outputL = e.outputBuffer.getChannelData(0);
      const outputR = e.outputBuffer.getChannelData(1);
      outputL.set(inputL);
      outputR.set(inputR);
    };
    
    this.source.connect(this.recorderNode);
    this.recorderNode.connect(this.ctx.destination);
    this.isRecording = true;
  }

  stop() {
    if (!this.isRecording) return null;
    this.isRecording = false;
    
    if (this.recorderNode) {
      this.recorderNode.disconnect();
      this.source.disconnect(this.recorderNode);
      this.recorderNode = null;
    }
    
    return this.exportWAV();
  }

  exportWAV() {
    const bufferL = this.flattenBuffer(this.recordingBufferL);
    const bufferR = this.flattenBuffer(this.recordingBufferR);
    const length = bufferL.length;
    
    const wavBuffer = new ArrayBuffer(44 + length * 2 * 2);
    const view = new DataView(wavBuffer);
    
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + length * 2 * 2, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    
    const sampleRate = this.ctx.sampleRate;
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, length * 2 * 2, true);
    
    let offset = 44;
    for (let i = 0; i < length; i++) {
      let sL = Math.max(-1, Math.min(1, bufferL[i]));
      view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
      offset += 2;
      
      let sR = Math.max(-1, Math.min(1, bufferR[i]));
      view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
      offset += 2;
    }
    
    return new Blob([view], { type: 'audio/wav' });
  }

  flattenBuffer(channelBuffer) {
    const totalLength = channelBuffer.reduce((acc, buf) => acc + buf.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (let i = 0; i < channelBuffer.length; i++) {
      result.set(channelBuffer[i], offset);
      offset += channelBuffer[i].length;
    }
    return result;
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}

export const audioEngine = new AudioEngine();
