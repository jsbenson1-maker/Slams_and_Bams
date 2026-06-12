import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Square, 
  Trash2, 
  Sliders, 
  Volume2, 
  VolumeX, 
  Activity,
  Radio,
  RotateCcw,
  Sparkles,
  HelpCircle,
  ArrowLeft,
  ArrowRight,
  Filter,
  Layers,
  Settings,
  Shuffle,
  Minimize2,
  Maximize2,
  Download,
  Upload
} from 'lucide-react';
import { audioEngine } from './audioEngine';
import { midiManager } from './midi';
import Knob from './Knob';
import { exportToMidi } from './midiExport';

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const SCALE_INTERVALS = {
  "Chromatic": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  "Major": [0, 2, 4, 5, 7, 9, 11],
  "Minor": [0, 2, 3, 5, 7, 8, 10],
  "Dorian": [0, 2, 3, 5, 7, 9, 10],
  "Phrygian": [0, 1, 3, 5, 7, 8, 10],
  "Lydian": [0, 2, 4, 6, 7, 9, 11],
  "Mixolydian": [0, 2, 4, 5, 7, 9, 10],
  "Locrian": [0, 1, 3, 5, 6, 8, 10],
  "Pentatonic Maj": [0, 2, 4, 7, 9],
  "Pentatonic Min": [0, 3, 5, 7, 10]
};

function isSemitoneInScale(semitone, keyRoot, intervals) {
  let noteInOctave = (60 + semitone - keyRoot) % 12;
  if (noteInOctave < 0) noteInOctave += 12;
  return intervals.includes(noteInOctave);
}

function snapSemitoneToScale(semitone, keyRoot, intervals) {
  let bestSemitone = semitone;
  let minDistance = 100;
  for (let candidate = -24; candidate <= 24; ++candidate) {
    if (isSemitoneInScale(candidate, keyRoot, intervals)) {
      let dist = Math.abs(candidate - semitone);
      if (dist < minDistance) {
        minDistance = dist;
        bestSemitone = candidate;
      }
    }
  }
  return bestSemitone;
}

function getNoteName(semitone) {
  const midiNote = 60 + semitone;
  const octave = Math.floor(midiNote / 12) - 1;
  let noteIdx = midiNote % 12;
  if (noteIdx < 0) noteIdx += 12;
  return NOTE_NAMES[noteIdx] + octave;
}

// 12 Synthesized Instruments definition
const INSTRUMENTS = [
  { id: 'kick', name: 'Kick', type: 'Analog Sub', color: '#e06c43', glow: 'rgba(224,108,67,0.25)' },
  { id: 'snare', name: 'Snare', type: 'Analog Noise', color: '#e08643', glow: 'rgba(224,134,67,0.25)' },
  { id: 'ch', name: 'Closed Hat', type: 'Analog Metal', color: '#e0a043', glow: 'rgba(224,160,67,0.25)' },
  { id: 'oh', name: 'Open Hat', type: 'Analog Metal', color: '#ebd043', glow: 'rgba(235,208,67,0.25)' },
  { id: 'ride', name: 'Ride', type: 'FM Metal', color: '#8dbd43', glow: 'rgba(141,189,67,0.25)' },
  { id: 'clap', name: 'Clap', type: 'Analog Burst', color: '#43bd5f', glow: 'rgba(67,189,95,0.25)' },
  { id: 'tom', name: 'Toms', type: 'Pitch Swept', color: '#43bda6', glow: 'rgba(67,189,166,0.25)' },
  { id: 'beep', name: 'Beep', type: 'Digital Sine', color: '#439ebd', glow: 'rgba(67,158,189,0.25)' },
  { id: 'blip', name: 'Blip', type: 'FM Sweep Down', color: '#4361bd', glow: 'rgba(67,97,189,0.25)' },
  { id: 'bloop', name: 'Bloop', type: 'FM Sweep Up', color: '#6d43bd', glow: 'rgba(109,67,189,0.25)' },
  { id: 'crunch', name: 'Crunch', type: 'Resonant Dist', color: '#b643bd', glow: 'rgba(182,67,189,0.25)' },
  { id: 'sample', name: 'Sample/Record', type: 'Sampler Track', color: '#ec4899', glow: 'rgba(236,72,153,0.25)' }
];

const KNOB_DEFS = {
  0: [ // Kick
    { key: 'decay', label: 'Decay', min: 0.05, max: 0.8, defaultValue: 0.25, formatter: v => `${Math.round(v * 1000)}ms`, tooltip: "Decay envelope duration of the sub bass oscillator sweep." },
    { key: 'tone', label: 'Tone', min: 30, max: 100, defaultValue: 55, formatter: v => `${Math.round(v)}Hz`, tooltip: "Starting frequency of the kick sub pitch sweep." },
    { key: 'distortion', label: 'Drive', min: 0.0, max: 1.0, defaultValue: 0.1, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Waveshaping tube-style overdrive level on the sub wave." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.8, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Master volume level of the kick drum synthesizer." }
  ],
  1: [ // Snare
    { key: 'decay', label: 'Decay', min: 0.05, max: 0.8, defaultValue: 0.2, formatter: v => `${Math.round(v * 1000)}ms`, tooltip: "Decay of the snap envelope and white noise body." },
    { key: 'tone', label: 'Tone', min: 100, max: 300, defaultValue: 180, formatter: v => `${Math.round(v)}Hz`, tooltip: "Center bandpass filter frequency of the snare drum shell tone." },
    { key: 'snappy', label: 'Snappy', min: 0.0, max: 1.0, defaultValue: 0.5, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Mix ratio of white noise rattle versus resonant shell tone." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.7, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Master volume level of the snare drum synthesizer." }
  ],
  2: [ // Closed Hat
    { key: 'decay', label: 'Decay', min: 0.02, max: 0.2, defaultValue: 0.06, formatter: v => `${Math.round(v * 1000)}ms`, tooltip: "Ring envelope duration of the high closed hi-hat metal noise." },
    { key: 'tone', label: 'Tone', min: 5000, max: 12000, defaultValue: 8000, formatter: v => `${Math.round(v / 100) / 10}kHz`, tooltip: "Highpass crossover frequency filtering out lower frequencies." },
    { key: 'pitch', label: 'Speed', min: 0.2, max: 2.0, defaultValue: 1.0, formatter: v => `${v.toFixed(1)}x`, tooltip: "FM metallic ring modulation multiplier rate." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.5, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Volume level of the closed hi-hat voice." }
  ],
  3: [ // Open Hat
    { key: 'decay', label: 'Decay', min: 0.1, max: 1.0, defaultValue: 0.35, formatter: v => `${Math.round(v * 1000)}ms`, tooltip: "Envelope ring sustain time of the open metal cymbal." },
    { key: 'tone', label: 'Tone', min: 5000, max: 12000, defaultValue: 8000, formatter: v => `${Math.round(v / 100) / 10}kHz`, tooltip: "Highpass crossover frequency filtering out lower frequencies." },
    { key: 'pitch', label: 'Speed', min: 0.2, max: 2.0, defaultValue: 1.0, formatter: v => `${v.toFixed(1)}x`, tooltip: "FM metallic ring modulation multiplier rate." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.5, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Volume level of the open hi-hat voice." }
  ],
  4: [ // Ride
    { key: 'decay', label: 'Decay', min: 0.2, max: 2.0, defaultValue: 0.8, formatter: v => `${v.toFixed(2)}s`, tooltip: "Bell sustain ring duration of the cymbal body." },
    { key: 'tone', label: 'Tone', min: 200, max: 800, defaultValue: 350, formatter: v => `${Math.round(v)}Hz`, tooltip: "Carrier fundamental frequency of multi-oscillator FM cluster." },
    { key: 'ring', label: 'Ring', min: 0.0, max: 1.0, defaultValue: 0.4, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Frequency modulation depth ratio adding harmonic grit." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.4, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Volume level of the ride cymbal." }
  ],
  5: [ // Clap
    { key: 'decay', label: 'Decay', min: 0.05, max: 0.8, defaultValue: 0.22, formatter: v => `${Math.round(v * 1000)}ms`, tooltip: "Sustain decay envelope duration of clustered clap reverberation." },
    { key: 'tone', label: 'Tone', min: 600, max: 2000, defaultValue: 1200, formatter: v => `${Math.round(v)}Hz`, tooltip: "Center bandpass filter frequency of clustered bursts." },
    { key: 'spread', label: 'Spread', min: 5, max: 30, defaultValue: 12, formatter: v => `${Math.round(v)}ms`, tooltip: "Micro-delay timing interval spacing the hand-clap bursts." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.6, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Volume level of the hand-clap synthesizer." }
  ],
  6: [ // Tom
    { key: 'decay', label: 'Decay', min: 0.1, max: 1.2, defaultValue: 0.35, formatter: v => `${Math.round(v * 1000)}ms`, tooltip: "Sustain decay envelope duration of pitch sweeps." },
    { key: 'tone', label: 'Tone', min: 50, max: 200, defaultValue: 90, formatter: v => `${Math.round(v)}Hz`, tooltip: "Fundamental starting center frequency of the tom sweep." },
    { key: 'sweep', label: 'Sweep', min: 0.0, max: 1.0, defaultValue: 0.45, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Depth amount of downward pitch sweep." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.65, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Volume level of the swept tom synthesizer." }
  ],
  7: [ // Beep
    { key: 'decay', label: 'Decay', min: 0.05, max: 0.8, defaultValue: 0.15, formatter: v => `${Math.round(v * 1000)}ms`, tooltip: "Envelope decay duration of sine beep tone." },
    { key: 'pitch', label: 'Pitch', min: 200, max: 3000, defaultValue: 880, formatter: v => `${Math.round(v)}Hz`, tooltip: "Fundamental center oscillator frequency of sine sweep." },
    { key: 'pulseWidth', label: 'Shape', min: 0.0, max: 1.0, defaultValue: 0.0, formatter: v => v > 0.5 ? 'Square' : 'Triangle', tooltip: "Toggles wave profile shape between pure Triangle and hollow Square." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.5, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Volume level of the digital beep synthesizer." }
  ],
  8: [ // Blip
    { key: 'decay', label: 'Decay', min: 0.01, max: 0.2, defaultValue: 0.04, formatter: v => `${Math.round(v * 1000)}ms`, tooltip: "Envelope decay duration of downward sweep." },
    { key: 'pitch', label: 'Pitch', min: 1000, max: 5000, defaultValue: 2500, formatter: v => `${Math.round(v)}Hz`, tooltip: "Fundamental starting frequency of rapid downward pitch sweep." },
    { key: 'sweep', label: 'Speed', min: 0.0, max: 1.0, defaultValue: 0.5, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Pitch sweep decay rate speed multiplier." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.6, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Volume level of the downward sweep blip." }
  ],
  9: [ // Bloop
    { key: 'decay', label: 'Decay', min: 0.05, max: 0.6, defaultValue: 0.18, formatter: v => `${Math.round(v * 1000)}ms`, tooltip: "Envelope decay duration of upward sweep." },
    { key: 'pitch', label: 'Pitch', min: 200, max: 1500, defaultValue: 800, formatter: v => `${Math.round(v)}Hz`, tooltip: "Fundamental starting frequency of upward pitch sweep." },
    { key: 'speed', label: 'Speed', min: 0.0, max: 1.0, defaultValue: 0.4, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Pitch sweep rise rate speed multiplier." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.55, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Volume level of the upward sweep bloop." }
  ],
  10: [ // Crunch
    { key: 'decay', label: 'Decay', min: 0.1, max: 1.2, defaultValue: 0.4, formatter: v => `${Math.round(v * 1000)}ms`, tooltip: "Envelope decay duration of resonant noise sweep." },
    { key: 'tone', label: 'Tone', min: 100, max: 4000, defaultValue: 1200, formatter: v => `${Math.round(v)}Hz`, tooltip: "Lowpass resonant filter cutoff frequency threshold." },
    { key: 'crunch', label: 'Drive', min: 0.0, max: 1.0, defaultValue: 0.6, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Extreme digital clipping waveshaping distortion drive." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.5, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Volume level of the crunch noise synthesizer." }
  ],
  11: [ // Custom Sampler
    { key: 'decay', label: 'Decay', min: 0.1, max: 5.0, defaultValue: 1.5, formatter: v => `${v.toFixed(1)}s`, tooltip: "Decay envelope duration of the custom audio sample." },
    { key: 'tone', label: 'Pitch', min: 0.25, max: 4.0, defaultValue: 1.0, formatter: v => `${v.toFixed(2)}x`, tooltip: "Playback speed / pitch rate of the sample." },
    { key: 'startPoint', label: 'Start', min: 0.0, max: 0.95, defaultValue: 0.0, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Sample playback slice starting boundary position." },
    { key: 'endPoint', label: 'End', min: 0.05, max: 1.0, defaultValue: 1.0, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Sample playback slice ending boundary position." },
    { key: 'volume', label: 'Vol', min: 0.0, max: 1.0, defaultValue: 0.7, formatter: v => `${Math.round(v * 100)}%`, tooltip: "Master volume level of the custom sampler track." }
  ]
};

const INITIAL_GRID = () => {
  const grid = [];
  for (let i = 0; i < 12; i++) {
    const row = new Array(64).fill(false);
    if (i === 0) { // Kick
      row[0] = row[4] = row[8] = row[12] = true;
    } else if (i === 1) { // Snare
      row[4] = row[12] = true;
    } else if (i === 2) { // Closed Hat
      row[2] = row[6] = row[10] = row[14] = true;
    } else if (i === 5) { // Clap
      row[14] = true;
    } else if (i === 6) { // Toms
      row[7] = row[11] = true;
    }
    grid.push(row);
  }
  return grid;
};const ensureTwelveTracksGrid = (grid) => {
  if (!Array.isArray(grid)) return INITIAL_GRID();
  const newGrid = [...grid];
  while (newGrid.length < 12) {
    newGrid.push(new Array(64).fill(false));
  }
  return newGrid.map(row => {
    if (!Array.isArray(row)) return new Array(64).fill(false);
    if (row.length < 64) {
      const paddedRow = [...row];
      while (paddedRow.length < 64) {
        paddedRow.push(false);
      }
      return paddedRow;
    }
    return row;
  });
};

const ensureTwelveTracksVelocity = (vel) => {
  if (!Array.isArray(vel)) return Array.from({ length: 12 }, () => new Array(64).fill(0.5));
  const newVel = [...vel];
  while (newVel.length < 12) {
    newVel.push(new Array(64).fill(0.5));
  }
  return newVel.map(row => {
    if (!Array.isArray(row)) return new Array(64).fill(0.5);
    if (row.length < 64) {
      const paddedRow = [...row];
      while (paddedRow.length < 64) {
        paddedRow.push(0.5);
      }
      return paddedRow;
    }
    return row;
  });
};

const ALTS_SUBLINES = {
  0: { A: 'Analog Sub', B: 'Ate Oh Ate' },
  1: { A: 'Analog Noise', B: 'Sidestick Rim' },
  2: { A: 'Analog Metal', B: 'Diffuse Shaker' },
  3: { A: 'Analog Metal', B: 'Reverse Quant' },
  4: { A: 'FM Metal', B: 'Metallic Gong' },
  5: { A: 'Analog Burst', B: 'Acoustic Snap' },
  6: { A: 'Pitch Swept', B: 'Resonant Bomba' },
  7: { A: 'Digital Sine', B: 'Retro Laser' },
  8: { A: 'FM Sweep Down', B: 'Water Drop Plop' },
  9: { A: 'FM Sweep Up', B: 'Spring Bloop' },
  10: { A: 'Resonant Dist', B: 'Guitar Wah' }
};

const getOverriddenKnobDef = (idx, k, useAlt) => {
  if (!useAlt) return k;
  
  if (idx === 0) { // Kick B Mode
    if (k.key === 'decay') {
      return {
        ...k,
        label: 'SubDecay',
        tooltip: 'Sustain ring duration of the 808 sub bass (up to 4 seconds).'
      };
    }
    if (k.key === 'distortion') {
      return {
        ...k,
        label: 'Click',
        tooltip: 'Adds a sharp percussive click transient to the leading edge of the kick.'
      };
    }
  }
  if (idx === 3) { // Open Hat B Mode
    if (k.key === 'decay') {
      return {
        ...k,
        label: 'Steps',
        formatter: v => `${Math.max(1, Math.round(v * 4))} steps`,
        tooltip: 'Quantized length of the reverse Open Hat in sequencer steps.'
      };
    }
  }
  if (idx === 4) { // Ride B Mode
    if (k.key === 'decay') {
      return {
        ...k,
        label: 'GongDecay',
        tooltip: 'Sustain duration of the FM cluster gong.'
      };
    }
    if (k.key === 'ring') {
      return {
        ...k,
        label: 'FM Mod',
        tooltip: 'Frequency modulation index adding metallic cluster resonance.'
      };
    }
  }
  if (idx === 5) { // Clap B Mode
    if (k.key === 'decay') {
      return {
        ...k,
        label: 'SnapDecay',
        tooltip: 'Sustain envelope decay duration of the acoustic snap.'
      };
    }
    if (k.key === 'spread') {
      return {
        ...k,
        label: 'Highpass',
        formatter: v => `${Math.round(500 + v * 80)}Hz`,
        tooltip: 'Highpass filter cutoff frequency threshold for a crisp snap tail.'
      };
    }
  }
  if (idx === 6) { // Toms B Mode
    if (k.key === 'sweep') {
      return {
        ...k,
        label: 'Resonance',
        tooltip: 'Sweeping bandpass filter resonance depth of the Bomba skin drum.'
      };
    }
  }
  if (idx === 10) { // Crunch B Mode
    if (k.key === 'crunch') {
      return {
        ...k,
        label: 'Wah Depth',
        tooltip: 'Wah-Wah filter envelope depth of the funk guitar chop.'
      };
    }
  }

  return k;
};

// Factory drum patterns generator helper
const makeFactoryPresetGrid = (kicks = [], snares = [], closedHats = [], openHats = [], rides = [], claps = [], toms = [], beeps = [], blips = [], bloops = [], crunch = [], sample = []) => {
  const grid = Array.from({ length: 12 }, () => new Array(64).fill(false));
  kicks.forEach(s => { if (s < 64) grid[0][s] = true; });
  snares.forEach(s => { if (s < 64) grid[1][s] = true; });
  closedHats.forEach(s => { if (s < 64) grid[2][s] = true; });
  openHats.forEach(s => { if (s < 64) grid[3][s] = true; });
  rides.forEach(s => { if (s < 64) grid[4][s] = true; });
  claps.forEach(s => { if (s < 64) grid[5][s] = true; });
  toms.forEach(s => { if (s < 64) grid[6][s] = true; });
  beeps.forEach(s => { if (s < 64) grid[7][s] = true; });
  blips.forEach(s => { if (s < 64) grid[8][s] = true; });
  bloops.forEach(s => { if (s < 64) grid[9][s] = true; });
  crunch.forEach(s => { if (s < 64) grid[10][s] = true; });
  sample.forEach(s => { if (s < 64) grid[11][s] = true; });
  
  // Replicate the first 16 steps to fill the rest of the 64 steps
  for (let ch = 0; ch < 12; ch++) {
    for (let s = 16; s < 64; s++) {
      grid[ch][s] = grid[ch][s % 16];
    }
  }
  return grid;
};

// 14 Premium Factory Drum Patterns
const FACTORY_PRESETS = [
  {
    name: "Classic Techno (126 BPM)",
    bpm: 126,
    stepsCount: 64,
    swing: 0.0,
    gridData: makeFactoryPresetGrid(
      [0, 4, 8, 12],          // Kick
      [4, 12],                // Snare
      [0, 2, 4, 6, 8, 10, 12, 14], // Closed Hat
      [2, 6, 10, 14],         // Open Hat
      [8, 14],                // Ride
      [], [], [], [], [], [], []
    )
  },
  {
    name: "Dusty Boom-Bap (90 BPM)",
    bpm: 90,
    stepsCount: 64,
    swing: 0.15,
    gridData: makeFactoryPresetGrid(
      [0, 8, 11],             // Kick
      [4, 12],                // Snare
      [0, 2, 4, 6, 8, 10, 12, 14], // Closed Hat
      [6, 14],                // Open Hat
      [], [12], [], [], [], [], [], []
    )
  },
  {
    name: "Liquid Drum & Bass (174 BPM)",
    bpm: 174,
    stepsCount: 64,
    swing: 0.0,
    gridData: makeFactoryPresetGrid(
      [0, 10],                // Kick
      [4, 12],                // Snare
      [0, 2, 4, 6, 8, 10, 12, 14], // Closed Hat
      [2, 6, 14],             // Open Hat
      [0, 8], [], [], [], [], [], [], []
    )
  },
  {
    name: "Neon Synthwave (112 BPM)",
    bpm: 112,
    stepsCount: 64,
    swing: 0.0,
    gridData: makeFactoryPresetGrid(
      [0, 4, 8, 12],          // Kick
      [4, 12],                // Snare
      [2, 6, 10, 14],         // Closed Hat
      [0, 8], [], [4, 12], [], [], [], [], [], []
    )
  },
  {
    name: "Rattling Trap (140 BPM)",
    bpm: 140,
    stepsCount: 64,
    swing: 0.0,
    gridData: makeFactoryPresetGrid(
      [0, 6, 8],              // Kick
      [4, 12],                // Snare
      [0, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 14, 15], // Closed Hat rolls
      [2, 10], [], [], [], [], [], [], [], []
    )
  },
  {
    name: "Sleek Deep House (122 BPM)",
    bpm: 122,
    stepsCount: 64,
    swing: 0.08,
    gridData: makeFactoryPresetGrid(
      [0, 4, 8, 12],          // Kick
      [4, 12],                // Snare
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // Closed Hat
      [2, 6, 10, 14], [14], [12], [], [], [], [], [], []
    )
  },
  {
    name: "Industrial EBM (120 BPM)",
    bpm: 120,
    stepsCount: 64,
    swing: 0.0,
    gridData: makeFactoryPresetGrid(
      [0, 4, 8, 12],          // Kick
      [4, 12],                // Snare
      [2, 6, 10, 14],         // Closed Hat
      [0, 8], [], [], [], [], [], [],
      [2, 6, 10, 14], []      // Crunch
    )
  },
  {
    name: "Ambient Dub Space (80 BPM)",
    bpm: 80,
    stepsCount: 64,
    swing: 0.2,
    gridData: makeFactoryPresetGrid(
      [0, 11],                // Kick
      [4, 12],                // Snare
      [0, 4, 8, 12],          // Closed Hat
      [6, 14], [], [], [], [], [], [], [], []
    )
  },
  {
    name: "Latin Samba (110 BPM)",
    bpm: 110,
    stepsCount: 64,
    swing: 0.35,
    gridData: makeFactoryPresetGrid(
      [0, 3, 6, 8, 11, 14],   // Kick syncopations
      [4, 12],                // Snare
      [0, 2, 4, 6, 8, 10, 12, 14], // Closed Hat
      [2, 10], [], [], [], [], [], [], [], []
    )
  },
  {
    name: "Minimal Glitch (125 BPM)",
    bpm: 125,
    stepsCount: 64,
    swing: 0.05,
    gridData: makeFactoryPresetGrid(
      [0, 8],                 // Kick
      [4, 12],                // Snare
      [2, 6, 10, 14],         // Closed Hat
      [], [], [], [], [], 
      [5, 13],                // Blips
      [7, 15],                // Bloops
      [], []
    )
  },
  {
    name: "Organic Funk Break (105 BPM)",
    bpm: 105,
    stepsCount: 64,
    swing: 0.22,
    gridData: makeFactoryPresetGrid(
      [0, 6, 8, 14],          // Kick
      [4, 9, 12, 15],         // Snare ghost-rolls
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // Closed Hat
      [2, 10], [], [], [], [], [], [], [], []
    )
  },
  {
    name: "Future Bass Half-Time (140 BPM)",
    bpm: 140,
    stepsCount: 64,
    swing: 0.0,
    gridData: makeFactoryPresetGrid(
      [0, 8, 14],             // Kick
      [8],                    // Snare
      [0, 2, 4, 6, 8, 10, 12, 14], // Closed Hat
      [6, 14], [], [8], [], [], [], [], [], []
    )
  },
  {
    name: "Melodic Hip-Hop (92 BPM)",
    bpm: 92,
    stepsCount: 64,
    swing: 0.12,
    gridData: makeFactoryPresetGrid(
      [0, 8, 11],                                    // Kick
      [4, 12],                                       // Snare
      [0, 2, 4, 6, 8, 10, 12, 14],                   // Closed Hat
      [6, 14],                                       // Open Hat
      [], [],
      [0, 4, 8, 12],                                 // Toms (bass melody)
      [2, 6, 10, 14, 15],                            // Beep (lead melody)
      [], [], [], []
    ),
    tomPitches: [0.0167, 0.5, 0.0513, 0.5, 0.078, 0.5, 0.160, 0.108],
    beepPitches: [0.5, 0.0857, 0.1155, 0.5, 0.1383, 0.0686, 0.0857, 0.5, 0.1155, 0.5, 0.1640, 0.1383, 0.5, 0.5, 0.5, 0.5]
  },
  {
    name: "Ethnic Drill (142 BPM)",
    bpm: 142,
    stepsCount: 64,
    swing: 0.0,
    gridData: makeFactoryPresetGrid(
      [0, 8, 10],                                    // Kick
      [6, 14],                                       // Snare
      [0, 3, 6, 8, 11, 14],                          // Closed Hat
      [2, 10],                                       // Open Hat
      [], [], [],
      [3, 7, 11, 15],                                // Beep (secondary melody)
      [],
      [0, 2, 4, 8, 10, 12],                          // Bloop (main melody)
      [], []
    ),
    bloopPitches: [0.2, 0.5, 0.3, 0.25, 0.5, 0.4, 0.35, 0.3, 0.5, 0.2, 0.5, 0.3],
    beepPitches: [0.5, 0.55, 0.6, 0.45, 0.5, 0.55, 0.6, 0.45, 0.5, 0.55, 0.6, 0.45]
  },
  {
    name: "Ambient Pluck (90 BPM)",
    bpm: 90,
    stepsCount: 64,
    swing: 0.1,
    gridData: makeFactoryPresetGrid(
      [0, 8],                                        // Kick
      [4, 12],                                       // Snare
      [0, 2, 4, 6, 8, 10, 12, 14],                   // Closed Hat
      [6, 14],                                       // Open Hat
      [], [],
      [0, 2, 4, 6, 8, 10, 12, 14],                   // Tom (pluck melody)
      [], [], [], [], []
    ),
    tomPitches: new Array(64).fill(0.5).map((v, i) => [0.3, 0.4, 0.5, 0.6, 0.4, 0.5, 0.7, 0.5][i % 8])
  },
  {
    name: "Chiptune Dance (128 BPM)",
    bpm: 128,
    stepsCount: 64,
    swing: 0.0,
    gridData: makeFactoryPresetGrid(
      [0, 4, 8, 12],                                 // Kick
      [4, 12],                                       // Snare
      [0, 2, 4, 6, 8, 10, 12, 14],                   // Closed Hat
      [2, 6, 10, 14],                                // Open Hat
      [], [], [],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // Beep (chiptune arpeggio)
      [], [], [], []
    ),
    beepPitches: new Array(64).fill(0.5).map((v, i) => [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45][i % 16])
  },
  {
    name: "Afrobeat Melodic (105 BPM)",
    bpm: 105,
    stepsCount: 64,
    swing: 0.2,
    gridData: makeFactoryPresetGrid(
      [0, 6, 10],                                    // Kick
      [4, 12],                                       // Snare
      [0, 2, 4, 6, 8, 10, 12, 14],                   // Closed Hat
      [6, 14],                                       // Open Hat
      [], [], [], [], [],
      [0, 3, 5, 8, 10, 13, 15],                      // Bloop (ethnic melody)
      [], []
    ),
    bloopPitches: new Array(64).fill(0.5).map((v, i) => [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7][i % 8])
  },
  {
    name: "Lofi Piano Chill (80 BPM)",
    bpm: 80,
    stepsCount: 64,
    swing: 0.18,
    gridData: makeFactoryPresetGrid(
      [0, 8, 11],                                    // Kick
      [4, 12],                                       // Snare
      [0, 2, 4, 6, 8, 10, 12, 14],                   // Closed Hat
      [6, 14],                                       // Open Hat
      [], [], [],
      [0, 4, 8, 12],                                 // Beep (chord root)
      [2, 6, 10, 14],                                // Blip (chord third)
      [], [], []
    ),
    beepPitches: new Array(64).fill(0.5).map((v, i) => [0.3, 0.35, 0.4, 0.35][i % 4]),
    blipPitches: new Array(64).fill(0.5).map((v, i) => [0.5, 0.55, 0.6, 0.55][i % 4])
  },
  {
    name: "Turkish Saz Trap (140 BPM)",
    bpm: 140,
    stepsCount: 64,
    swing: 0.05,
    gridData: makeFactoryPresetGrid(
      [0, 8, 10],                                    // Kick
      [6, 14],                                       // Snare
      [0, 2, 4, 6, 8, 10, 12, 14],                   // Closed Hat
      [10],                                          // Open Hat
      [], [], [], [], [],
      [2, 5, 8, 11, 14],                             // Bloop (slide melody)
      [], []
    ),
    bloopPitches: new Array(64).fill(0.5).map((v, i) => [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6][i % 8])
  },
  {
    name: "Symphonic Trap (130 BPM)",
    bpm: 130,
    stepsCount: 64,
    swing: 0.0,
    gridData: makeFactoryPresetGrid(
      [0, 8, 11],                                    // Kick
      [4, 12],                                       // Snare
      [0, 2, 4, 6, 8, 10, 12, 14],                   // Closed Hat
      [6, 14],                                       // Open Hat
      [], [], [],
      [0, 4, 8, 12],                                 // Beep (high lead)
      [],
      [0, 2, 4, 6, 8, 10, 12, 14],                   // Bloop (mid lead)
      [], []
    ),
    beepPitches: new Array(64).fill(0.5).map((v, i) => [0.6, 0.65, 0.7, 0.65, 0.8, 0.75, 0.7, 0.75][i % 8]),
    bloopPitches: new Array(64).fill(0.5).map((v, i) => [0.4, 0.45, 0.5, 0.45, 0.6, 0.55, 0.5, 0.55][i % 8])
  }
];

export default function App() {
  const lowsCanvasRef = useRef(null);
  const midsCanvasRef = useRef(null);
  const highsCanvasRef = useRef(null);
  
  // Page selector ('grid' or 'fx')
  const [activePage, setActivePage] = useState('grid');
  const [showManual, setShowManual] = useState(false);
  const [isSessionRecording, setIsSessionRecording] = useState(false);
  const [manualTab, setManualTab] = useState('quickstart');

  // Mobile navigation and view support
  const [isMobile, setIsMobile] = useState(false);
  const [mobileActiveFx, setMobileActiveFx] = useState('bitcrusher');

  useEffect(() => {
    const handleResize = () => {
      const isAndroidApp = navigator.userAgent.includes("PhyzixAndroidApp");
      const mobile = window.innerWidth <= 1024 || isAndroidApp;
      setIsMobile(mobile);
      // Auto-switch to drums tab on mobile if currently on unsupported tab
      if (mobile && activePage !== 'grid' && activePage !== 'piano' && activePage !== 'fx' && activePage !== 'drums') {
        setActivePage('drums');
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activePage]);

  // Active instrument edit selection index
  const [selectedInstrument, setSelectedInstrument] = useState(0);

  // App States
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [stepsCount, setStepsCount] = useState(16);
  const [currentStep, setCurrentStep] = useState(0);
  const [isStepRecording, setIsStepRecording] = useState(false);
  const [isRecordingPitch, setIsRecordingPitch] = useState(false);
  const [timeSignature, setTimeSignature] = useState('4/4');
  const [paintRollValue, setPaintRollValue] = useState(1);
  const [isSlamActive, setIsSlamActive] = useState(false);
  const [isSlamPending, setIsSlamPending] = useState(false);
  const [isSlamLatched, setIsSlamLatched] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isEditorCollapsed, setIsEditorCollapsed] = useState(false);
  const [swing, setSwing] = useState(0.0);
  
  // Grid sequence tracks state
  const [gridData, setGridData] = useState(INITIAL_GRID);
  
  // Tunable Instrument Knob Parameters State
  const [params, setParams] = useState(() => {
    const initial = {};
    for (let c = 0; c < 12; c++) {
      const pMap = {};
      KNOB_DEFS[c].forEach(k => {
        pMap[k.key] = k.defaultValue;
      });
      pMap['endPoint'] = 1.0; 
      initial[c] = pMap;
    }
    return initial;
  });

  // Track mutes & bitcrusher bypass states
  const [mutes, setMutes] = useState(new Array(12).fill(false));
  const [crunchBypass, setCrunchBypass] = useState(new Array(12).fill(true));
  
  // Instrument pitch automation states (64 steps)
  const [tomPitches, setTomPitches] = useState(new Array(64).fill(0.5));
  const [beepPitches, setBeepPitches] = useState(new Array(64).fill(0.5));
  const [blipPitches, setBlipPitches] = useState(new Array(64).fill(0.5));
  const [bloopPitches, setBloopPitches] = useState(new Array(64).fill(0.5));
  
  // Pad triggers triggers state for visual pad flash
  const [padTrigger, setPadTrigger] = useState(new Array(12).fill(false));

  // Velocity state (12 channels x 64 steps)
  const [velocityData, setVelocityData] = useState(() => Array.from({ length: 12 }, () => new Array(64).fill(0.5)));

  // Custom upgrades states
  const [fillActive, setFillActive] = useState(false);
  const [fillPattern, setFillPattern] = useState('traditional_a');
  const [sampleName, setSampleName] = useState('Rimshot Fallback Synth');
  const [sampleBufferLoaded, setSampleBufferLoaded] = useState(false);
  const [userPatterns, setUserPatterns] = useState([]);
  const [patternInputName, setPatternInputName] = useState('');
  const [isRecordingMic, setIsRecordingMic] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  
  // Refs for custom sampler
  const fileInputRef = useRef(null);
  const psnbInputRef = useRef(null);
  const waveformCanvasRef = useRef(null);
  const recordingTimerRef = useRef(null);
  
  // MIDI States
  const [midiStatus, setMidiStatus] = useState("Scan MIDI Devices");
  const [midiConnected, setMidiConnected] = useState(false);
  const [midiTrigger, setMidiTrigger] = useState(false);
  const [midiLearnTarget, setMidiLearnTarget] = useState(null); // { channelId, paramKey }

  // ==========================================
  // PAGE 2 EFFECTS BANK STATES
  // ==========================================
  const [bitcrusherEnabled, setBitcrusherEnabled] = useState(true);
  const [bitcrusherBits, setBitcrusherBits] = useState(8);
  const [bitcrusherDownsample, setBitcrusherDownsample] = useState(1);
  const [bitcrusherMix, setBitcrusherMix] = useState(1.0);
  const [slamMix, setSlamMix] = useState(1.0);
  const [doorType, setDoorType] = useState(0);
  const [showMidiCcOverlay, setShowMidiCcOverlay] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, channelId, paramKey }
  const [pitchKey, setPitchKey] = useState("C");
  const [pitchScale, setPitchScale] = useState("Chromatic");
  const svgRef = useRef(null);
  const [isSvgDragging, setIsSvgDragging] = useState(false);
  const [hoveredSvgStep, setHoveredSvgStep] = useState(null);
  const [hoveredSvgSemitone, setHoveredSvgSemitone] = useState(null);

  const [fxEnabled, setFxEnabled] = useState({
    distortion: false,
    filter: false,
    delay: false,
    reverb: false,
    sidechain: false
  });

  const [fxChainOrder, setFxChainOrder] = useState(['distortion', 'filter', 'delay', 'reverb', 'sidechain']);
  
  const [fxParams, setFxParams] = useState({
    distortion: { drive: 0.3 },
    filter: { cutoff: 1200, resonance: 2.0, type: 'lowpass' },
    delay: { time: 0.3, feedback: 0.4, mix: 0.3 },
    reverb: { decay: 1.2, mix: 0.2 },
    sidechain: { ratio: 0.8, release: 0.15, attack: 0.01 }
  });

  const [masterVolume, setMasterVolume] = useState(0.75);

  // Animate knobs based on recorded motion loops
  const getAutomatedFxValue = (fxKey, paramKey, baseValue) => {
    if (isPlaying && audioEngine && audioEngine.fxAutomation && audioEngine.fxAutomation.params[fxKey] && audioEngine.fxAutomation.params[fxKey][paramKey]) {
      const autoVal = audioEngine.fxAutomation.params[fxKey][paramKey][currentStep];
      if (autoVal !== null && autoVal !== undefined) {
        return autoVal;
      }
    }
    return baseValue;
  };

  const getBeatInfo = (stepIdx) => {
    let stepsPerBeat = 4;
    if (timeSignature === '6/8') {
      stepsPerBeat = 3;
    }
    const isBeatEnd = stepIdx % stepsPerBeat === stepsPerBeat - 1;
    const isBeatStart = stepIdx % stepsPerBeat === 0;
    const beatIdx = Math.floor(stepIdx / stepsPerBeat);
    const isOddBeat = beatIdx % 2 === 1;
    return { isBeatEnd, isBeatStart, isOddBeat };
  };

  const getAutomatedInstrumentValue = (channelId, paramKey, baseValue) => {
    if (isPlaying && audioEngine) {
      // Check generic neomorphic knob automation first
      if (audioEngine.instrumentAutomation && audioEngine.instrumentAutomation[channelId] && audioEngine.instrumentAutomation[channelId][paramKey]) {
        const autoVal = audioEngine.instrumentAutomation[channelId][paramKey][currentStep];
        if (autoVal !== null && autoVal !== undefined) {
          return autoVal;
        }
      }

      if (channelId === 6 && paramKey === 'tone') {
        const autoVal = tomPitches[currentStep];
        if (autoVal !== null && autoVal !== undefined && autoVal !== 0.5) {
          const def = KNOB_DEFS[6].find(k => k.key === 'tone');
          return def.min + autoVal * (def.max - def.min);
        }
      } else if (channelId === 7 && paramKey === 'pitch') {
        const autoVal = beepPitches[currentStep];
        if (autoVal !== null && autoVal !== undefined && autoVal !== 0.5) {
          const def = KNOB_DEFS[7].find(k => k.key === 'pitch');
          return def.min + autoVal * (def.max - def.min);
        }
      } else if (channelId === 8 && paramKey === 'pitch') {
        const autoVal = blipPitches[currentStep];
        if (autoVal !== null && autoVal !== undefined && autoVal !== 0.5) {
          const def = KNOB_DEFS[8].find(k => k.key === 'pitch');
          return def.min + autoVal * (def.max - def.min);
        }
      } else if (channelId === 9 && paramKey === 'pitch') {
        const autoVal = bloopPitches[currentStep];
        if (autoVal !== null && autoVal !== undefined && autoVal !== 0.5) {
          const def = KNOB_DEFS[9].find(k => k.key === 'pitch');
          return def.min + autoVal * (def.max - def.min);
        }
      }
    }
    return baseValue;
  };

  const getInstrumentAutomationInfo = (channelId, paramKey) => {
    // 1. Check generic neomorphic knob step-automation in audio engine
    if (audioEngine && audioEngine.instrumentAutomation && audioEngine.instrumentAutomation[channelId] && audioEngine.instrumentAutomation[channelId][paramKey]) {
      const isAutomated = audioEngine.instrumentAutomation[channelId][paramKey].some(v => v !== null && v !== undefined);
      if (isAutomated) {
        return {
          isAutomated: true,
          onClearAutomation: () => {
            audioEngine.instrumentAutomation[channelId][paramKey].fill(null);
            logSession(`Instrument ${INSTRUMENTS[channelId].name} parameter ${paramKey} motion automation cleared.`, "INFO");
            setParams(prev => ({ ...prev }));
          }
        };
      }
    }

    if (channelId === 6 && paramKey === 'tone') {
      return {
        isAutomated: tomPitches.some(v => v !== 0.5 && v !== null && v !== undefined),
        onClearAutomation: () => {
          const cleared = new Array(64).fill(0.5);
          setTomPitches(cleared);
          audioEngine.tomStepPitches.fill(0.5);
          localStorage.setItem("phyzix_tompitches", JSON.stringify(cleared));
          logSession("Tom pitch automation cleared.", "INFO");
        }
      };
    }
    if (channelId === 7 && paramKey === 'pitch') {
      return {
        isAutomated: beepPitches.some(v => v !== 0.5 && v !== null && v !== undefined),
        onClearAutomation: () => {
          const cleared = new Array(64).fill(0.5);
          setBeepPitches(cleared);
          audioEngine.beepStepPitches.fill(0.5);
          localStorage.setItem("phyzix_beeppitches", JSON.stringify(cleared));
          logSession("Beep pitch automation cleared.", "INFO");
        }
      };
    }
    if (channelId === 8 && paramKey === 'pitch') {
      return {
        isAutomated: blipPitches.some(v => v !== 0.5 && v !== null && v !== undefined),
        onClearAutomation: () => {
          const cleared = new Array(64).fill(0.5);
          setBlipPitches(cleared);
          audioEngine.blipStepPitches.fill(0.5);
          localStorage.setItem("phyzix_blippitches", JSON.stringify(cleared));
          logSession("Blip pitch automation cleared.", "INFO");
        }
      };
    }
    if (channelId === 9 && paramKey === 'pitch') {
      return {
        isAutomated: bloopPitches.some(v => v !== 0.5 && v !== null && v !== undefined),
        onClearAutomation: () => {
          const cleared = new Array(64).fill(0.5);
          setBloopPitches(cleared);
          audioEngine.bloopStepPitches.fill(0.5);
          localStorage.setItem("phyzix_blooppitches", JSON.stringify(cleared));
          logSession("Bloop pitch automation cleared.", "INFO");
        }
      };
    }
    return { isAutomated: false, onClearAutomation: null };
  };

  const getFxAutomationInfo = (fxKey, paramKey) => {
    if (audioEngine && audioEngine.fxAutomation && audioEngine.fxAutomation.params[fxKey] && audioEngine.fxAutomation.params[fxKey][paramKey]) {
      const isAutomated = audioEngine.fxAutomation.params[fxKey][paramKey].some(v => v !== null && v !== undefined);
      return {
        isAutomated,
        onClearAutomation: () => {
          audioEngine.fxAutomation.params[fxKey][paramKey].fill(null);
          logSession(`FX ${fxKey} ${paramKey} automation cleared.`, "INFO");
          // Force a state update to redraw the Knob immediately
          setFxParams(prev => ({ ...prev }));
        }
      };
    }
    return { isAutomated: false, onClearAutomation: null };
  };

  const handleClearInstrumentMotion = (channelId) => {
    if (audioEngine && audioEngine.instrumentAutomation && audioEngine.instrumentAutomation[channelId]) {
      Object.keys(audioEngine.instrumentAutomation[channelId]).forEach(paramKey => {
        audioEngine.instrumentAutomation[channelId][paramKey].fill(null);
      });
    }
    if (channelId === 6) { setTomPitches(new Array(64).fill(0.5)); audioEngine.tomStepPitches.fill(0.5); }
    if (channelId === 7) { setBeepPitches(new Array(64).fill(0.5)); audioEngine.beepStepPitches.fill(0.5); }
    if (channelId === 8) { setBlipPitches(new Array(64).fill(0.5)); audioEngine.blipStepPitches.fill(0.5); }
    if (channelId === 9) { setBloopPitches(new Array(64).fill(0.5)); audioEngine.bloopStepPitches.fill(0.5); }

    setParams(prev => ({ ...prev }));
    logSession(`Cleared all motion automation for instrument: ${INSTRUMENTS[channelId].name}`, "INFO");
  };

  const handleClearFxModuleMotion = (fxKey) => {
    if (audioEngine && audioEngine.fxAutomation && audioEngine.fxAutomation.params[fxKey]) {
      Object.keys(audioEngine.fxAutomation.params[fxKey]).forEach(paramKey => {
        audioEngine.fxAutomation.params[fxKey][paramKey].fill(null);
      });
    }
    setFxParams(prev => ({ ...prev }));
    logSession(`Cleared all motion automation for FX module: ${fxKey}`, "INFO");
  };

  const handleClearAllMotion = () => {
    // 1. Clear generic neomorphic instrument motion
    if (audioEngine && audioEngine.instrumentAutomation) {
      for (let c = 0; c < 12; c++) {
        if (audioEngine.instrumentAutomation[c]) {
          Object.keys(audioEngine.instrumentAutomation[c]).forEach(paramKey => {
            audioEngine.instrumentAutomation[c][paramKey].fill(null);
          });
        }
      }
    }
    
    // 2. Clear pitch automation arrays
    const clearedPitches = new Array(64).fill(0.5);
    setTomPitches(clearedPitches);
    setBeepPitches(clearedPitches);
    setBlipPitches(clearedPitches);
    setBloopPitches(clearedPitches);
    
    if (audioEngine) {
      audioEngine.tomStepPitches.fill(0.5);
      audioEngine.beepStepPitches.fill(0.5);
      audioEngine.blipStepPitches.fill(0.5);
      audioEngine.bloopStepPitches.fill(0.5);
      
      // 3. Clear all FX automation
      for (const fxKey in audioEngine.fxAutomation.params) {
        Object.keys(audioEngine.fxAutomation.params[fxKey]).forEach(paramKey => {
          audioEngine.fxAutomation.params[fxKey][paramKey].fill(null);
        });
      }
    }
    
    setParams(prev => ({ ...prev }));
    setFxParams(prev => ({ ...prev }));
    logSession("Cleared ALL parameter and pitch motion automation across the entire project!", "INFO");
  };

  // Safe refs for access within asynchronous clock loops
  const currentStepRef = useRef(0);
  const stepsCountRef = useRef(16);
  const isRecordingPitchRef = useRef(false);
  const isStepRecordingRef = useRef(false);
  const selectedInstRef = useRef(0);
  const gridDataRef = useRef(gridData);

  // Sync refs on state edits
  useEffect(() => {
    gridDataRef.current = gridData;
  }, [gridData]);

  useEffect(() => {
    stepsCountRef.current = stepsCount;
  }, [stepsCount]);

  useEffect(() => {
    isRecordingPitchRef.current = isRecordingPitch;
    audioEngine.isRecordingPitch = isRecordingPitch;
  }, [isRecordingPitch]);

  useEffect(() => {
    isStepRecordingRef.current = isStepRecording;
  }, [isStepRecording]);

  useEffect(() => {
    selectedInstRef.current = selectedInstrument;
    audioEngine.activeInstrumentIndex = selectedInstrument;
  }, [selectedInstrument]);

  // Direct FS Session Logging Helper (Electron native)
  const logSession = (message, level = 'INFO') => {
    const timeStr = new Date().toISOString();
    const logLine = `[${timeStr}] [${level}] ${message}`;
    console.log(logLine);
    
    try {
      if (window.require) {
        const fs = window.require('fs');
        const logFilePath = 'session_logs.txt';
        fs.appendFileSync(logFilePath, logLine + '\n', 'utf-8');
      }
    } catch (e) {
      // safe fallback if running in generic web browser
    }
  };

  // Wire up audio engine logging callback on mount
  useEffect(() => {
    audioEngine.onLog = (msg, lvl) => logSession(msg, lvl);
    logSession("Phyzix Slams and Bams application initialized. Node/Electron FS support active.", "INFO");

    const handleDawParam = (e) => {
      const { channelId, paramKey, value } = e.detail;
      setParams(prev => ({
        ...prev,
        [channelId]: {
          ...prev[channelId],
          [paramKey]: value
        }
      }));
    };
    window.addEventListener('daw-param-update', handleDawParam);
    return () => {
      window.removeEventListener('daw-param-update', handleDawParam);
    };
  }, []);

  // Propagate master volume level to the audio engine MasterGainNode
  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  // LIVE AUDIO ENGINE GRID UPDATE: Propagate any gridData updates instantly to the audio scheduler
  useEffect(() => {
    audioEngine.updateGridData(gridData);
  }, [gridData]);

  // Load saved local storage pattern/state
  useEffect(() => {
    const savedGrid = localStorage.getItem("phyzix_grid");
    const savedParams = localStorage.getItem("phyzix_params");
    
    const savedTomPitches = localStorage.getItem("phyzix_tompitches");
    const savedBeepPitches = localStorage.getItem("phyzix_beeppitches");
    const savedBlipPitches = localStorage.getItem("phyzix_blippitches");
    const savedBloopPitches = localStorage.getItem("phyzix_blooppitches");
    const savedBypass = localStorage.getItem("phyzix_crunchbypass");
    const savedSwing = localStorage.getItem("phyzix_swing");
    
    const savedSettings = localStorage.getItem("phyzix_settings");
    const savedFxState = localStorage.getItem("phyzix_fx_state");

    if (savedGrid) {
      try {
        setGridData(ensureTwelveTracksGrid(JSON.parse(savedGrid)));
      } catch (e) {}
    }
    if (savedParams) {
      try {
        const parsedParams = JSON.parse(savedParams);
        // Fallback safety to inject sample track parameters if loading older presets
        if (!parsedParams[11]) {
          parsedParams[11] = { decay: 1.5, tone: 1.0, startPoint: 0.0, endPoint: 1.0, volume: 0.7 };
        }
        setParams(parsedParams);
        for (const c in parsedParams) {
          audioEngine.updateParams(parseInt(c, 10), parsedParams[c]);
        }
      } catch (e) {}
    } else {
      // Feed defaults
      for (let c = 0; c < 12; c++) {
        const pMap = {};
        KNOB_DEFS[c].forEach(k => {
          pMap[k.key] = k.defaultValue;
        });
        pMap['endPoint'] = 1.0;
        audioEngine.updateParams(c, pMap);
      }
    }

    // Step pitches loaders
    if (savedTomPitches) {
      try {
        const parsed = JSON.parse(savedTomPitches);
        setTomPitches(parsed);
        audioEngine.tomStepPitches = parsed;
      } catch (e) {}
    }
    if (savedBeepPitches) {
      try {
        const parsed = JSON.parse(savedBeepPitches);
        setBeepPitches(parsed);
        audioEngine.beepStepPitches = parsed;
      } catch (e) {}
    }
    if (savedBlipPitches) {
      try {
        const parsed = JSON.parse(savedBlipPitches);
        setBlipPitches(parsed);
        audioEngine.blipStepPitches = parsed;
      } catch (e) {}
    }
    if (savedBloopPitches) {
      try {
        const parsed = JSON.parse(savedBloopPitches);
        setBloopPitches(parsed);
        audioEngine.bloopStepPitches = parsed;
      } catch (e) {}
    }

    if (savedBypass) {
      try {
        const parsed = JSON.parse(savedBypass);
        setCrunchBypass(parsed);
        parsed.forEach((b, i) => audioEngine.setCrunchBypass(i, b));
      } catch (e) {}
    }

    if (savedSwing) {
      const val = parseFloat(savedSwing);
      setSwing(val);
      audioEngine.swing = val;
    }

    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        if (parsed.bpm) {
          setBpm(parsed.bpm);
          audioEngine.bpm = parsed.bpm;
        }
        if (parsed.stepsCount) {
          setStepsCount(parsed.stepsCount);
          audioEngine.setStepsCount(parsed.stepsCount);
        }
        if (parsed.masterVolume !== undefined) {
          setMasterVolume(parsed.masterVolume);
          audioEngine.setMasterVolume(parsed.masterVolume);
        }
      } catch (e) {}
    }

    // FX State Loader
    if (savedFxState) {
      try {
        const parsed = JSON.parse(savedFxState);
        if (parsed.fxEnabled) {
          const mergedEnabled = {
            distortion: false,
            filter: false,
            delay: false,
            reverb: false,
            sidechain: false,
            ...parsed.fxEnabled
          };
          setFxEnabled(mergedEnabled);
          audioEngine.fxEnabled = mergedEnabled;
        }
        if (parsed.fxChainOrder) {
          const mergedOrder = [...parsed.fxChainOrder];
          if (!mergedOrder.includes('sidechain')) {
            mergedOrder.push('sidechain');
          }
          setFxChainOrder(mergedOrder);
          audioEngine.fxChainOrder = mergedOrder;
        }
        if (parsed.fxParams) {
          const mergedParams = {
            distortion: { drive: 0.3 },
            filter: { cutoff: 1200, resonance: 2.0, type: 'lowpass' },
            delay: { time: 0.3, feedback: 0.4, mix: 0.3 },
            reverb: { decay: 1.2, mix: 0.2 },
            sidechain: { ratio: 0.8, release: 0.15, attack: 0.01 },
            ...parsed.fxParams
          };
          if (!mergedParams.sidechain) {
            mergedParams.sidechain = { ratio: 0.8, release: 0.15, attack: 0.01 };
          }
          setFxParams(mergedParams);
          audioEngine.fxParams = mergedParams;
        }
        if (parsed.bitcrusherEnabled !== undefined) {
          setBitcrusherEnabled(parsed.bitcrusherEnabled);
          audioEngine.bitcrusherEnabled = parsed.bitcrusherEnabled;
        }
        if (parsed.bitcrusherBits !== undefined) {
          setBitcrusherBits(parsed.bitcrusherBits);
          audioEngine.bitcrusherBits = parsed.bitcrusherBits;
        }
        if (parsed.bitcrusherDownsample !== undefined) {
          setBitcrusherDownsample(parsed.bitcrusherDownsample);
          audioEngine.bitcrusherDownsample = parsed.bitcrusherDownsample;
        }
      } catch (e) {}
    }

    const savedVelocity = localStorage.getItem("phyzix_velocity");
    if (savedVelocity) {
      try {
        const parsed = ensureTwelveTracksVelocity(JSON.parse(savedVelocity));
        setVelocityData(parsed);
        audioEngine.stepVelocities = parsed;
      } catch (e) {}
    } else {
      audioEngine.stepVelocities = Array.from({ length: 12 }, () => new Array(64).fill(0.5));
    }
  }, []);

  // Save changes to localStorage helper
  const autoSave = (grid, p, tPitches, settings, bPitches, blPitches, blpPitches, bypass, swingVal, fxState, vData = velocityData) => {
    localStorage.setItem("phyzix_grid", JSON.stringify(grid));
    localStorage.setItem("phyzix_params", JSON.stringify(p));
    localStorage.setItem("phyzix_tompitches", JSON.stringify(tPitches));
    
    const settingsPayload = { ...settings, masterVolume };
    localStorage.setItem("phyzix_settings", JSON.stringify(settingsPayload));

    localStorage.setItem("phyzix_beeppitches", JSON.stringify(bPitches));
    localStorage.setItem("phyzix_blippitches", JSON.stringify(blPitches));
    localStorage.setItem("phyzix_blooppitches", JSON.stringify(blpPitches));
    localStorage.setItem("phyzix_crunchbypass", JSON.stringify(bypass));
    localStorage.setItem("phyzix_swing", swingVal.toString());
    localStorage.setItem("phyzix_fx_state", JSON.stringify(fxState));
    localStorage.setItem("phyzix_velocity", JSON.stringify(vData));
  };

  const getFxSaveState = (override = {}) => {
    return {
      fxEnabled,
      fxChainOrder,
      fxParams,
      bitcrusherEnabled,
      bitcrusherBits,
      bitcrusherDownsample,
      ...override
    };
  };

  // MIDI triggers & learn listener
  useEffect(() => {
    midiManager.onNoteOn = (instrumentIdx) => {
      triggerSound(instrumentIdx);
      
      // Step Record implementation
      if (isStepRecordingRef.current) {
        setGridData(prev => {
          const next = prev.map((track, trackIdx) => {
            if (trackIdx === instrumentIdx) {
              const newTrack = [...track];
              newTrack[currentStepRef.current] = true;
              return newTrack;
            }
            return track;
          });
          autoSave(next, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
          return next;
        });

        // Advance active step
        const nextStep = (currentStepRef.current + 1) % stepsCountRef.current;
        setCurrentStep(nextStep);
        currentStepRef.current = nextStep;
        audioEngine.currentStep = nextStep;
      }
    };

    midiManager.onCcValueChange = (channelId, paramKey, normalizedVal) => {
      if (channelId === -1) {
        if (paramKey === 'fill') {
          const active = normalizedVal > 0;
          setFillActive(active);
          audioEngine.fillActive = active;
          logSession(`MIDI Triggered Fill: ${active ? 'ACTIVE' : 'DEACTIVATED'}`, "INFO");
          return;
        }
        
        let realVal = normalizedVal;
        if (paramKey === 'bpm') {
          realVal = Math.round(20.0 + normalizedVal * 220.0);
          setBpm(realVal);
          audioEngine.bpm = realVal;
        } else if (paramKey === 'swing') {
          realVal = normalizedVal;
          setSwing(realVal);
          audioEngine.swing = realVal;
        } else if (paramKey === 'masterVolume') {
          realVal = normalizedVal * 1.5;
          setMasterVolume(realVal);
          audioEngine.setMasterVolume(realVal);
        } else if (paramKey === 'slamMix') {
          realVal = normalizedVal;
          setSlamMix(realVal);
          audioEngine.setSlamMix(realVal);
        } else if (paramKey === 'bitcrusherBits') {
          realVal = Math.round(1.0 + normalizedVal * 15.0);
          setBitcrusherBits(realVal);
          audioEngine.bitcrusherBits = realVal;
        } else if (paramKey === 'bitcrusherDownsample') {
          realVal = Math.round(1.0 + normalizedVal * 31.0);
          setBitcrusherDownsample(realVal);
          audioEngine.bitcrusherDownsample = realVal;
        } else if (paramKey === 'bitcrusherMix') {
          realVal = normalizedVal;
          setBitcrusherMix(realVal);
          audioEngine.bitcrusherMix = realVal;
        } else if (paramKey === 'distDrive') {
          setFxParams(prev => ({ ...prev, distortion: { ...prev.distortion, drive: realVal } }));
          audioEngine.updateFx('distortion', 'drive', realVal);
        } else if (paramKey === 'filterCutoff') {
          realVal = 60 + normalizedVal * 17940;
          setFxParams(prev => ({ ...prev, filter: { ...prev.filter, cutoff: realVal } }));
          audioEngine.updateFx('filter', 'cutoff', realVal);
        } else if (paramKey === 'filterResonance') {
          realVal = 0.1 + normalizedVal * 9.9;
          setFxParams(prev => ({ ...prev, filter: { ...prev.filter, resonance: realVal } }));
          audioEngine.updateFx('filter', 'resonance', realVal);
        } else if (paramKey === 'delayTime') {
          realVal = 0.05 + normalizedVal * 1.95;
          setFxParams(prev => ({ ...prev, delay: { ...prev.delay, time: realVal } }));
          audioEngine.updateFx('delay', 'time', realVal);
        } else if (paramKey === 'delayFeedback') {
          realVal = normalizedVal * 0.95;
          setFxParams(prev => ({ ...prev, delay: { ...prev.delay, feedback: realVal } }));
          audioEngine.updateFx('delay', 'feedback', realVal);
        } else if (paramKey === 'delayMix') {
          setFxParams(prev => ({ ...prev, delay: { ...prev.delay, mix: realVal } }));
          audioEngine.updateFx('delay', 'mix', realVal);
        } else if (paramKey === 'reverbDecay') {
          realVal = 0.1 + normalizedVal * 4.9;
          setFxParams(prev => ({ ...prev, reverb: { ...prev.reverb, decay: realVal } }));
          audioEngine.updateFx('reverb', 'decay', realVal);
        } else if (paramKey === 'reverbMix') {
          setFxParams(prev => ({ ...prev, reverb: { ...prev.reverb, mix: realVal } }));
          audioEngine.updateFx('reverb', 'mix', realVal);
        } else if (paramKey === 'sidechainRatio') {
          setFxParams(prev => ({ ...prev, sidechain: { ...prev.sidechain, ratio: realVal } }));
          audioEngine.updateFx('sidechain', 'ratio', realVal);
        } else if (paramKey === 'sidechainAttack') {
          realVal = 0.001 + normalizedVal * 0.099;
          setFxParams(prev => ({ ...prev, sidechain: { ...prev.sidechain, attack: realVal } }));
          audioEngine.updateFx('sidechain', 'attack', realVal);
        } else if (paramKey === 'sidechainRelease') {
          realVal = 0.01 + normalizedVal * 0.99;
          setFxParams(prev => ({ ...prev, sidechain: { ...prev.sidechain, release: realVal } }));
          audioEngine.updateFx('sidechain', 'release', realVal);
        }
        
        autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
        return;
      }

      const knobDef = KNOB_DEFS[channelId]?.find(k => k.key === paramKey);
      if (!knobDef) return;

      const realVal = knobDef.min + normalizedVal * (knobDef.max - knobDef.min);
      
      setParams(prev => {
        const next = { ...prev, [channelId]: { ...prev[channelId], [paramKey]: realVal } };
        autoSave(gridData, next, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
        return next;
      });
      audioEngine.updateParams(channelId, { [paramKey]: realVal });

      if (isRecordingPitchRef.current && isPlaying) {
        audioEngine.recordInstrumentAutomation(channelId, paramKey, currentStepRef.current, realVal);
      }

      // Live record pitch on Toms, Beeps, Blips, Bloops
      const activeIdx = selectedInstRef.current;
      const isPitchEligible = [6, 7, 8, 9].includes(activeIdx);
      const isCorrespondingParam = (activeIdx === 6 && paramKey === 'tone') || ([7, 8, 9].includes(activeIdx) && paramKey === 'pitch');
      
      if (channelId === activeIdx && isCorrespondingParam && isRecordingPitchRef.current) {
        audioEngine.recordPitchForInstrument(activeIdx, currentStepRef.current, normalizedVal);
        
        if (activeIdx === 6) {
          setTomPitches(prev => {
            const next = [...prev]; next[currentStepRef.current] = normalizedVal;
            autoSave(gridData, params, next, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
            return next;
          });
        } else if (activeIdx === 7) {
          setBeepPitches(prev => {
            const next = [...prev]; next[currentStepRef.current] = normalizedVal;
            autoSave(gridData, params, tomPitches, { bpm, stepsCount }, next, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
            return next;
          });
        } else if (activeIdx === 8) {
          setBlipPitches(prev => {
            const next = [...prev]; next[currentStepRef.current] = normalizedVal;
            autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, next, bloopPitches, crunchBypass, swing, getFxSaveState());
            return next;
          });
        } else if (activeIdx === 9) {
          setBloopPitches(prev => {
            const next = [...prev]; next[currentStepRef.current] = normalizedVal;
            autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, next, crunchBypass, swing, getFxSaveState());
            return next;
          });
        }
      }
    };

    midiManager.onStatusChange = (status, isConnected) => {
      setMidiStatus(status);
      setMidiConnected(isConnected);
      setMidiLearnTarget(null);
    };

    midiManager.onMidiActivity = () => {
      setMidiTrigger(true);
      setTimeout(() => setMidiTrigger(false), 80);
    };

    midiManager.init();
  }, [gridData, params, tomPitches, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, bpm, stepsCount, fxEnabled, fxChainOrder, fxParams, bitcrusherEnabled, bitcrusherBits, bitcrusherDownsample]);

  // Hook audioEngine step callback to React UI step tracking
  useEffect(() => {
    audioEngine.onStepTrigger = (step) => {
      setCurrentStep(step);
      currentStepRef.current = step;
      
      setIsSlamActive(audioEngine.isSlamTheDoorActive);
      setIsSlamPending(audioEngine.isSlamPending);
      
      // If live pitch recording is active
      if (isRecordingPitchRef.current) {
        const activeIdx = selectedInstRef.current;
        const isPitchEligible = [6, 7, 8, 9].includes(activeIdx);
        
        if (isPitchEligible) {
          const paramKey = activeIdx === 6 ? 'tone' : 'pitch';
          const rawVal = params[activeIdx][paramKey];
          
          const def = KNOB_DEFS[activeIdx].find(k => k.key === paramKey);
          const normalized = (rawVal - def.min) / (def.max - def.min);
          
          audioEngine.recordPitchForInstrument(activeIdx, step, normalized);
          
          if (activeIdx === 6) {
            setTomPitches(prev => {
              const next = [...prev]; next[step] = normalized;
              localStorage.setItem("phyzix_tompitches", JSON.stringify(next)); return next;
            });
          } else if (activeIdx === 7) {
            setBeepPitches(prev => {
              const next = [...prev]; next[step] = normalized;
              localStorage.setItem("phyzix_beeppitches", JSON.stringify(next)); return next;
            });
          } else if (activeIdx === 8) {
            setBlipPitches(prev => {
              const next = [...prev]; next[step] = normalized;
              localStorage.setItem("phyzix_blippitches", JSON.stringify(next)); return next;
            });
          } else if (activeIdx === 9) {
            setBloopPitches(prev => {
              const next = [...prev]; next[step] = normalized;
              localStorage.setItem("phyzix_blooppitches", JSON.stringify(next)); return next;
            });
          }
        }
      }
    };

    audioEngine.onInstrumentTrigger = (idx) => {
      flashPad(idx);
    };

    audioEngine.onTick = (playing) => {
      setIsPlaying(playing);
    };

    return () => {
      audioEngine.onStepTrigger = null;
      audioEngine.onInstrumentTrigger = null;
      audioEngine.onTick = null;
    };
  }, [params]);

  // Audio-reactive HSL background & 3-Band crossover visualizer canvas loop
  useEffect(() => {
    let animationId;
    const fftArray = new Uint8Array(256);
    const timeArray = new Uint8Array(256);

    const drawBandWaveform = (canvasRef, analyser, baseHue, minSaturation = 60, minLightness = 45) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const rect = canvas.getBoundingClientRect();
      
      // Sync resolution to match display bounds fluidly
      const w = rect.width;
      const h = rect.height;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      // Draw semi-opaque background trail for modern phosphor decay effect
      ctx.fillStyle = 'rgba(247, 246, 240, 0.4)';
      ctx.fillRect(0, 0, w, h);

      let intensity = 0.0;
      let hasData = false;

      if (audioEngine.ctx && analyser) {
        analyser.getByteTimeDomainData(timeArray);
        hasData = true;

        // Calculate average amplitude intensity (RMS-like peak deviation)
        let deviationSum = 0;
        for (let i = 0; i < timeArray.length; i++) {
          deviationSum += Math.abs(timeArray[i] - 128);
        }
        intensity = deviationSum / timeArray.length; // Max range roughly 0 to 128
      }

      // Standby default state
      const samples = hasData ? timeArray : new Uint8Array(128).map(() => 128);
      const normIntensity = Math.min(1.0, intensity / 32.0); // Normalize range to 0.0 - 1.0

      // Dynamic color: shifts hue slightly, boosts saturation/lightness, and increases opacity under high intensity
      const hue = baseHue - normIntensity * 15;
      const sat = minSaturation + normIntensity * (100 - minSaturation);
      const light = minLightness + normIntensity * 12;
      const alpha = 0.65 + normIntensity * 0.35;
      const lineWidth = 2.0 + normIntensity * 2.2;

      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
      
      // Render subtle background glow for high intensity hits
      if (normIntensity > 0.15) {
        ctx.shadowBlur = 4 + normIntensity * 8;
        ctx.shadowColor = `hsla(${hue}, ${sat}%, ${light}%, ${alpha * 0.4})`;
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      const sliceWidth = w / samples.length;
      let x = 0;

      for (let i = 0; i < samples.length; i++) {
        const v = samples[i] / 128.0;
        const y = (v * h) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Reset shadow effects
      ctx.shadowBlur = 0;
    };

    const runLoop = () => {
      // 1. Update Master Background HSL reactiveness
      if (audioEngine.ctx && audioEngine.analyser) {
        audioEngine.analyser.getByteFrequencyData(fftArray);

        let sum = 0;
        for (let i = 0; i < fftArray.length; i++) {
          sum += fftArray[i];
        }
        const avg = sum / fftArray.length;
        const normalized = avg / 255.0; // 0.0 to 1.0

        // Subtly shift main layout background HSL variables
        const targetHue = 24 - normalized * 15;
        const targetSat = 15 + normalized * 24;
        const targetLight = 96 - normalized * 5;
        
        document.documentElement.style.setProperty('--react-hue', `${targetHue}`);
        document.documentElement.style.setProperty('--react-sat', `${targetSat}%`);
        document.documentElement.style.setProperty('--react-light', `${targetLight}%`);
      }

      // 2. Render Crossover Visualizers (Lows: 22 Hue (Amber/Red), Mids: 155 Hue (Jade/Teal), Highs: 235 Hue (Indigo/Violet))
      drawBandWaveform(lowsCanvasRef, audioEngine.lowsAnalyser, 22, 60, 46);
      drawBandWaveform(midsCanvasRef, audioEngine.midsAnalyser, 155, 55, 42);
      drawBandWaveform(highsCanvasRef, audioEngine.highsAnalyser, 235, 65, 48);

      animationId = requestAnimationFrame(runLoop);
    };

    runLoop();
    return () => cancelAnimationFrame(animationId);
  }, []);

  // Visual Flash Pad Trigger Helper
  const flashPad = (index) => {
    setPadTrigger(prev => {
      const next = [...prev]; next[index] = true; return next;
    });
    setTimeout(() => {
      setPadTrigger(prev => {
        const next = [...prev]; next[index] = false; return next;
      });
    }, 100);
  };

  // Play/Stop Trigger
  const togglePlay = async () => {
    audioEngine.init();
    await audioEngine.resumeContext();
    if (isPlaying) {
      audioEngine.stop();
      setIsPlaying(false);
    } else {
      // Re-trigger FX setups on startup
      audioEngine.updateDistortionDrive();
      audioEngine.updateFilter();
      audioEngine.updateDelay();
      audioEngine.updateReverbImpulse();
      audioEngine.rebuildFXChain();
      
      await audioEngine.start(gridData);
      setIsPlaying(true);
    }
  };

  const toggleSessionRecording = () => {
    audioEngine.init();
    if (isSessionRecording) {
      const blob = audioEngine.stopSessionRecording();
      setIsSessionRecording(false);
      logSession("Session recording stopped.", "INFO");
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `phyzix-session-${Date.now()}.wav`;
        a.click();
        URL.revokeObjectURL(url);
        logSession("Session WAV exported successfully.", "SUCCESS");
      }
    } else {
      audioEngine.startSessionRecording();
      setIsSessionRecording(true);
      logSession("Session recording started. Play some patterns to record...", "INFO");
    }
  };

  // Trigger sound manually
  const triggerSound = async (index) => {
    audioEngine.init();
    await audioEngine.resumeContext();
    const isPitchEligible = [6, 7, 8, 9].includes(index);
    
    if (isPitchEligible) {
      const paramKey = index === 6 ? 'tone' : 'pitch';
      const rawVal = params[index][paramKey];
      const def = KNOB_DEFS[index].find(k => k.key === paramKey);
      const normalized = (rawVal - def.min) / (def.max - def.min);
      
      audioEngine.triggerInstrument(index, audioEngine.ctx.currentTime, normalized);
    } else {
      audioEngine.triggerInstrument(index);
    }
    flashPad(index);
  };

  // Change individual knob settings
  const handleKnobChange = (channelId, key, value) => {
    setParams(prev => {
      const next = { ...prev, [channelId]: { ...prev[channelId], [key]: value } };
      autoSave(gridData, next, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
      return next;
    });
    audioEngine.updateParams(channelId, { [key]: value });
  };

  // Change BPM
  const handleBpmChange = (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val)) {
      const bounded = Math.max(40, Math.min(240, val));
      setBpm(bounded);
      audioEngine.bpm = bounded;
      autoSave(gridData, params, tomPitches, { bpm: bounded, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
    }
  };

  // Set sequencer steps count 1-64
  const handleStepsCountChange = (count) => {
    const bounded = Math.max(1, Math.min(64, count));
    setStepsCount(bounded);
    audioEngine.setStepsCount(bounded);
    autoSave(gridData, params, tomPitches, { bpm, stepsCount: bounded }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
  };

  // ==========================================
  // CUSTOM STUDIO UTILITIES (Fills, Randomizer, MIDI Export, Sampler)
  // ==========================================

  const randomizePattern = () => {
    let nextGrid;
    setGridData(prev => {
      nextGrid = prev.map(() => {
        const newRow = new Array(64).fill(false);
        for (let step = 0; step < stepsCount; step++) {
          newRow[step] = Math.random() < 0.22; // 22% hit probability per step
        }
        return newRow;
      });
      return nextGrid;
    });

    const newTom = new Array(64).fill(0).map(() => Math.random());
    const newBeep = new Array(64).fill(0).map(() => Math.random());
    const newBlip = new Array(64).fill(0).map(() => Math.random());
    const newBloop = new Array(64).fill(0).map(() => Math.random());

    setTomPitches(newTom);
    setBeepPitches(newBeep);
    setBlipPitches(newBlip);
    setBloopPitches(newBloop);

    audioEngine.tomStepPitches = newTom;
    audioEngine.beepStepPitches = newBeep;
    audioEngine.blipStepPitches = newBlip;
    audioEngine.bloopStepPitches = newBloop;

    setTimeout(() => {
      autoSave(nextGrid, params, newTom, { bpm, stepsCount }, newBeep, newBlip, newBloop, crunchBypass, swing, getFxSaveState());
    }, 50);

    logSession("Randomized grid sequencer hits and pitch arrays globally for ALL tracks", "INFO");
  };

  const recallFactoryPreset = (presetIdx) => {
    const pat = FACTORY_PRESETS[presetIdx];
    if (!pat) return;

    setBpm(pat.bpm);
    audioEngine.bpm = pat.bpm;

    setStepsCount(pat.stepsCount);
    audioEngine.setStepsCount(pat.stepsCount);

    setSwing(pat.swing);
    audioEngine.swing = pat.swing;

    const safeGrid = ensureTwelveTracksGrid(pat.gridData);
    setGridData(safeGrid);
    audioEngine.gridData = safeGrid;

    const tomP = pat.tomPitches ? [...pat.tomPitches] : new Array(64).fill(0.5);
    const beepP = pat.beepPitches ? [...pat.beepPitches] : new Array(64).fill(0.5);
    const blipP = pat.blipPitches ? [...pat.blipPitches] : new Array(64).fill(0.5);
    const bloopP = pat.bloopPitches ? [...pat.bloopPitches] : new Array(64).fill(0.5);

    const expandPitches = (arr) => {
      const next = [...arr];
      while (next.length < 64) {
        for (let i = 0; i < arr.length && next.length < 64; i++) {
          next.push(arr[i]);
        }
      }
      return next.slice(0, 64);
    };

    const finalTomP = expandPitches(tomP);
    const finalBeepP = expandPitches(beepP);
    const finalBlipP = expandPitches(blipP);
    const finalBloopP = expandPitches(bloopP);

    setTomPitches(finalTomP);
    setBeepPitches(finalBeepP);
    setBlipPitches(finalBlipP);
    setBloopPitches(finalBloopP);

    audioEngine.tomStepPitches = [...finalTomP];
    audioEngine.beepStepPitches = [...finalBeepP];
    audioEngine.blipStepPitches = [...finalBlipP];
    audioEngine.bloopStepPitches = [...finalBloopP];

    // Wipe generic motion automations
    if (audioEngine && audioEngine.instrumentAutomation) {
      for (let c = 0; c < 12; c++) {
        if (audioEngine.instrumentAutomation[c]) {
          Object.keys(audioEngine.instrumentAutomation[c]).forEach(paramKey => {
            audioEngine.instrumentAutomation[c][paramKey].fill(null);
          });
        }
      }
    }

    setParams(INITIAL_PARAMS);
    for (let c = 0; c < 12; c++) {
      audioEngine.updateParams(c, INITIAL_PARAMS[c]);
    }

    logSession(`Loaded factory drum preset: "${pat.name}"`, "INFO");
  };

  const handleTimeSignatureChange = (sig) => {
    setTimeSignature(sig);
    audioEngine.timeSignature = sig;
    let newSteps = 16;
    if (sig === '4/4') newSteps = 16;
    else if (sig === '3/4') newSteps = 12;
    else if (sig === '5/4') newSteps = 20;
    else if (sig === '6/8') newSteps = 12;
    
    setStepsCount(newSteps);
    audioEngine.setStepsCount(newSteps);
    autoSave(gridData, params, tomPitches, { bpm, stepsCount: newSteps }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
    logSession(`Time signature changed to ${sig}, stepsCount adjusted to ${newSteps}`, "INFO");
  };

  // Door Slam UI handlers
  const handleSlamMouseDown = async (e) => {
    if (isSlamLatched) return;
    audioEngine.init();
    await audioEngine.resumeContext();
    audioEngine.setSlamTheDoor(true);
    setIsSlamActive(audioEngine.isSlamTheDoorActive);
    setIsSlamPending(audioEngine.isSlamPending);
    logSession(audioEngine.isSlamPending ? "Door Slam pending..." : "Momentary Door Slam engaged!", "INFO");
  };

  const handleSlamMouseUp = () => {
    if (isSlamLatched) return;
    audioEngine.setSlamTheDoor(false);
    setIsSlamActive(audioEngine.isSlamTheDoorActive);
    setIsSlamPending(audioEngine.isSlamPending);
    logSession("Momentary Door Slam disengaged.", "INFO");
  };

  const handleSlamMouseLeave = () => {
    if (isSlamLatched) return;
    if (isSlamActive || isSlamPending) {
      audioEngine.setSlamTheDoor(false);
      setIsSlamActive(audioEngine.isSlamTheDoorActive);
      setIsSlamPending(audioEngine.isSlamPending);
      logSession("Momentary Door Slam disengaged.", "INFO");
    }
  };

  const handleSlamTouchStart = async (e) => {
    e.preventDefault();
    if (isSlamLatched) return;
    audioEngine.init();
    await audioEngine.resumeContext();
    audioEngine.setSlamTheDoor(true);
    setIsSlamActive(audioEngine.isSlamTheDoorActive);
    setIsSlamPending(audioEngine.isSlamPending);
  };

  const handleSlamTouchEnd = (e) => {
    e.preventDefault();
    if (isSlamLatched) return;
    audioEngine.setSlamTheDoor(false);
    setIsSlamActive(audioEngine.isSlamTheDoorActive);
    setIsSlamPending(audioEngine.isSlamPending);
  };

  const handleSlamClick = async () => {
    if (!isSlamLatched) return;
    audioEngine.init();
    await audioEngine.resumeContext();
    const next = !isSlamActive;
    audioEngine.setSlamTheDoor(next);
    setIsSlamActive(audioEngine.isSlamTheDoorActive);
    setIsSlamPending(audioEngine.isSlamPending);
    logSession(audioEngine.isSlamPending ? "Latched Door Slam pending..." : `Latched Door Slam: ${next ? "engaged" : "disengaged"}`, "INFO");
  };

  // Load user patterns on component mount
  useEffect(() => {
    const saved = localStorage.getItem("phyzix_user_patterns");
    if (saved) {
      try {
        setUserPatterns(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  // Momentary Drum Fill triggers
  const startFill = () => {
    setFillActive(true);
    audioEngine.fillActive = true;
    logSession(`Momentary Drum Fill active: ${fillPattern}`, "INFO");
  };

  const stopFill = () => {
    setFillActive(false);
    audioEngine.fillActive = false;
    logSession("Momentary Drum Fill deactivated.", "INFO");
  };

  // Randomized sequencer pattern generator for selected instrument
  const randomizeFocusedTrack = () => {
    const instIdx = selectedInstrument;
    setGridData(prev => {
      const next = prev.map((row, idx) => {
        if (idx === instIdx) {
          const newRow = new Array(64).fill(false);
          for (let step = 0; step < stepsCount; step++) {
            newRow[step] = Math.random() < 0.25; // 25% probability hit gates
          }
          return newRow;
        }
        return row;
      });
      autoSave(next, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
      return next;
    });

    // Also randomize steps pitch values if pitchable
    if (instIdx === 6) {
      setTomPitches(prev => {
        const next = prev.map(() => Math.random());
        audioEngine.tomStepPitches = next;
        return next;
      });
    } else if (instIdx === 7) {
      setBeepPitches(prev => {
        const next = prev.map(() => Math.random());
        audioEngine.beepStepPitches = next;
        return next;
      });
    } else if (instIdx === 8) {
      setBlipPitches(prev => {
        const next = prev.map(() => Math.random());
        audioEngine.blipStepPitches = next;
        return next;
      });
    } else if (instIdx === 9) {
      setBloopPitches(prev => {
        const next = prev.map(() => Math.random());
        audioEngine.bloopStepPitches = next;
        return next;
      });
    }
    logSession(`Randomized grid sequencer hits and pitch arrays for track ${INSTRUMENTS[instIdx].name}`, "INFO");
  };

  // Binary MIDI File exporter trigger
  const triggerMidiExport = () => {
    try {
      const bytes = exportToMidi(gridData, bpm, stepsCount, tomPitches, beepPitches, blipPitches, bloopPitches, velocityData);
      const blob = new Blob([bytes], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `phyzix-pattern-${bpm}bpm.mid`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      logSession(`Successfully generated and exported Standard MIDI File: phyzix-pattern-${bpm}bpm.mid`, "INFO");
    } catch (e) {
      console.error("MIDI Export failed:", e);
      logSession(`MIDI Export failed: ${e.message}`, "ERROR");
    }
  };

  // User Preset Pattern Saving to localStorage
  const triggerSavePattern = () => {
    const name = patternInputName.trim() || `Pattern ${userPatterns.length + 1}`;
    const patternState = {
      name,
      bpm,
      stepsCount,
      swing,
      gridData,
      params,
      tomPitches,
      beepPitches,
      blipPitches,
      bloopPitches,
      mutes,
      crunchBypass,
      sampleName
    };

    const nextList = [...userPatterns, patternState];
    setUserPatterns(nextList);
    localStorage.setItem("phyzix_user_patterns", JSON.stringify(nextList));
    setPatternInputName('');
    logSession(`Saved user pattern preset: "${name}"`, "INFO");
  };

  // Recall pattern preset
  const recallUserPattern = (idx) => {
    const pat = userPatterns[idx];
    if (!pat) return;

    setBpm(pat.bpm);
    audioEngine.bpm = pat.bpm;

    setStepsCount(pat.stepsCount);
    audioEngine.setStepsCount(pat.stepsCount);

    setSwing(pat.swing);
    audioEngine.swing = pat.swing;

    const safeGrid = ensureTwelveTracksGrid(pat.gridData);
    setGridData(safeGrid);
    audioEngine.gridData = safeGrid;

    // Fallback safety to inject sample track parameters if missing from older saved presets
    const safeParams = { ...pat.params };
    if (!safeParams[11]) {
      safeParams[11] = { decay: 1.5, tone: 1.0, startPoint: 0.0, endPoint: 1.0, volume: 0.7 };
    }
    setParams(safeParams);
    for (let c = 0; c < 12; c++) {
      if (safeParams[c]) {
        audioEngine.updateParams(c, safeParams[c]);
      }
    }

    if (pat.tomPitches) { setTomPitches(pat.tomPitches); audioEngine.tomStepPitches = pat.tomPitches; }
    if (pat.beepPitches) { setBeepPitches(pat.beepPitches); audioEngine.beepStepPitches = pat.beepPitches; }
    if (pat.blipPitches) { setBlipPitches(pat.blipPitches); audioEngine.blipStepPitches = pat.blipPitches; }
    if (pat.bloopPitches) { setBloopPitches(pat.bloopPitches); audioEngine.bloopStepPitches = pat.bloopPitches; }
    if (pat.mutes) { setMutes(pat.mutes); audioEngine.mutes = pat.mutes; }
    if (pat.crunchBypass) { setCrunchBypass(pat.crunchBypass); audioEngine.channelCrunchBypass = pat.crunchBypass; }
    if (pat.sampleName) { setSampleName(pat.sampleName); }

    logSession(`Loaded user pattern preset: "${pat.name}"`, "INFO");
  };

  // Proprietary Format Preset Pattern Exporter (.PSNB)
  const exportPatternPSNB = () => {
    try {
      const name = patternInputName.trim() || `Pattern_${Date.now()}`;
      
      // Grab all detailed state including velocity and FX automation
      const exportState = {
        format: "PSNB",
        version: "1.4.3",
        name,
        bpm,
        stepsCount,
        swing,
        gridData,
        stepVelocities: audioEngine.stepVelocities, // From audio engine
        params,
        tomPitches,
        beepPitches,
        blipPitches,
        bloopPitches,
        mutes,
        crunchBypass,
        sampleName,
        // FX save state
        fxEnabled,
        fxChainOrder,
        fxParams,
        bitcrusherEnabled,
        bitcrusherBits,
        bitcrusherDownsample,
        // Recorded Motion FX automation
        fxAutomation: {
          enabled: {
            distortion: Array.from(audioEngine.fxAutomation.enabled.distortion),
            filter: Array.from(audioEngine.fxAutomation.enabled.filter),
            delay: Array.from(audioEngine.fxAutomation.enabled.delay),
            reverb: Array.from(audioEngine.fxAutomation.enabled.reverb),
            bitcrusher: Array.from(audioEngine.fxAutomation.enabled.bitcrusher),
          },
          params: {
            distortion: {
              drive: Array.from(audioEngine.fxAutomation.params.distortion.drive)
            },
            filter: {
              cutoff: Array.from(audioEngine.fxAutomation.params.filter.cutoff),
              resonance: Array.from(audioEngine.fxAutomation.params.filter.resonance),
              type: Array.from(audioEngine.fxAutomation.params.filter.type)
            },
            delay: {
              time: Array.from(audioEngine.fxAutomation.params.delay.time),
              feedback: Array.from(audioEngine.fxAutomation.params.delay.feedback),
              mix: Array.from(audioEngine.fxAutomation.params.delay.mix)
            },
            reverb: {
              decay: Array.from(audioEngine.fxAutomation.params.reverb.decay),
              mix: Array.from(audioEngine.fxAutomation.params.reverb.mix)
            },
            bitcrusher: {
              bits: Array.from(audioEngine.fxAutomation.params.bitcrusher.bits),
              downsample: Array.from(audioEngine.fxAutomation.params.bitcrusher.downsample)
            }
          }
        }
      };

      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportState, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `${name.replace(/\s+/g, '_')}.psnb`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      
      logSession(`Exported pattern Preset: "${name}.psnb" successfully.`, "INFO");
    } catch (e) {
      console.error("PSNB Export failed:", e);
      alert("Failed to export pattern: " + e.message);
    }
  };

  // Import Pattern Preset from local .PSNB file
  const handleImportPSNB = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const pat = JSON.parse(event.target.result);
        if (pat.format !== "PSNB") {
          throw new Error("Invalid file format. File must be a Phyzix .PSNB file!");
        }

        // Apply global variables
        setBpm(pat.bpm);
        audioEngine.bpm = pat.bpm;

        setStepsCount(pat.stepsCount);
        audioEngine.setStepsCount(pat.stepsCount);

        setSwing(pat.swing);
        audioEngine.swing = pat.swing;

        const safeGrid = ensureTwelveTracksGrid(pat.gridData);
        setGridData(safeGrid);
        audioEngine.gridData = safeGrid;

        // Apply params
        const safeParams = { ...pat.params };
        if (!safeParams[11]) {
          safeParams[11] = { decay: 1.5, tone: 1.0, startPoint: 0.0, endPoint: 1.0, volume: 0.7 };
        }
        setParams(safeParams);
        for (let c = 0; c < 12; c++) {
          if (safeParams[c]) {
            audioEngine.updateParams(c, safeParams[c]);
          }
        }

        // Apply velocities
        if (pat.stepVelocities) {
          audioEngine.stepVelocities = pat.stepVelocities.map(arr => Array.from(arr));
        }

        // Apply Pitches
        if (pat.tomPitches) { setTomPitches(pat.tomPitches); audioEngine.tomStepPitches = pat.tomPitches; }
        if (pat.beepPitches) { setBeepPitches(pat.beepPitches); audioEngine.beepStepPitches = pat.beepPitches; }
        if (pat.blipPitches) { setBlipPitches(pat.blipPitches); audioEngine.blipStepPitches = pat.blipPitches; }
        if (pat.bloopPitches) { setBloopPitches(pat.bloopPitches); audioEngine.bloopStepPitches = pat.bloopPitches; }
        if (pat.mutes) { setMutes(pat.mutes); audioEngine.mutes = pat.mutes; }
        if (pat.crunchBypass) { setCrunchBypass(pat.crunchBypass); audioEngine.channelCrunchBypass = pat.crunchBypass; }
        if (pat.sampleName) { setSampleName(pat.sampleName); }

        // FX states
        if (pat.fxEnabled) { setFxEnabled(pat.fxEnabled); audioEngine.fxEnabled = pat.fxEnabled; }
        if (pat.fxChainOrder) { setFxChainOrder(pat.fxChainOrder); audioEngine.fxChainOrder = pat.fxChainOrder; }
        if (pat.fxParams) { setFxParams(pat.fxParams); audioEngine.fxParams = pat.fxParams; }
        if (pat.bitcrusherEnabled !== undefined) { setBitcrusherEnabled(pat.bitcrusherEnabled); audioEngine.bitcrusherEnabled = pat.bitcrusherEnabled; }
        if (pat.bitcrusherBits !== undefined) { setBitcrusherBits(pat.bitcrusherBits); audioEngine.bitcrusherBits = pat.bitcrusherBits; }
        if (pat.bitcrusherDownsample !== undefined) { setBitcrusherDownsample(pat.bitcrusherDownsample); audioEngine.bitcrusherDownsample = pat.bitcrusherDownsample; }

        // Recorded Motion / Automation curves
        if (pat.fxAutomation) {
          for (const key in pat.fxAutomation.enabled) {
            audioEngine.fxAutomation.enabled[key] = Array.from(pat.fxAutomation.enabled[key]);
          }
          for (const fxKey in pat.fxAutomation.params) {
            for (const paramKey in pat.fxAutomation.params[fxKey]) {
              audioEngine.fxAutomation.params[fxKey][paramKey] = Array.from(pat.fxAutomation.params[fxKey][paramKey]);
            }
          }
        }

        // Rebuild FX chain and sidechain
        audioEngine.rebuildFXChain();
        audioEngine.updateDistortionDrive();
        audioEngine.updateFilter();
        audioEngine.updateDelay();
        audioEngine.updateReverbImpulse();
        audioEngine.updateSidechain();

        logSession(`Imported .PSNB pattern Preset: "${pat.name}" successfully.`, "INFO");
        alert(`Successfully imported pattern "${pat.name}"!`);
      } catch (err) {
        console.error("PSNB Import failed:", err);
        alert("Failed to import .PSNB file: " + err.message);
      }
    };
    reader.readAsText(file);
    // Reset file input value
    e.target.value = "";
  };


  // Web Audio microphone recorder trigger
  const triggerRecordMic = async () => {
    if (isRecordingMic) {
      if (mediaRecorder) {
        mediaRecorder.stop();
      }
      setIsRecordingMic(false);
      clearInterval(recordingTimerRef.current);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks = [];

        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const arrayBuf = await blob.arrayBuffer();
          audioEngine.ctx.decodeAudioData(arrayBuf, decodedBuffer => {
            audioEngine.sampleBuffer = decodedBuffer;
            setSampleName("Recorded Mic Sample");
            setSampleBufferLoaded(true);
            logSession("Decoded and loaded recorded mic sample.", "INFO");
          }, (err) => {
            console.error("Audio decoding error:", err);
            logSession("Failed to decode mic recorded buffer.", "ERROR");
          });
          stream.getTracks().forEach(t => t.stop());
        };

        setMediaRecorder(recorder);
        recorder.start();
        setIsRecordingMic(true);
        setRecTime(0);

        recordingTimerRef.current = setInterval(() => {
          setRecTime(prev => prev + 1);
        }, 1000);

        logSession("Recording microphone audio stream...", "INFO");
      } catch (err) {
        console.error("Microphone access failed:", err);
        logSession(`Microphone recording error: ${err.message}`, "ERROR");
        alert("Failed to access system microphone device. Please check OS security guidelines.");
      }
    }
  };

  const handleMidiLearn = (channelId, paramKey) => {
    midiManager.startLearning(channelId, paramKey);
    setMidiLearnTarget({ channelId, paramKey });
    logSession(`Entered MIDI CC Learn mode for track ${channelId} param ${paramKey}`, "INFO");
  };

  const handleMidiUnbind = (channelId, paramKey) => {
    midiManager.unbindKnob(channelId, paramKey);
    setMidiLearnTarget(null);
    logSession(`Cleared MIDI CC binding for track ${channelId} param ${paramKey}`, "INFO");
  };

  const handleKnobContextMenu = (e, channelId, paramKey) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      channelId,
      paramKey
    });
  };

  const applyPitchPreset = (presetName, keyRootIdx, scaleName) => {
    if (!activePitches || !setActivePitches) return;
    const intervals = SCALE_INTERVALS[scaleName] || SCALE_INTERVALS["Chromatic"];
    
    let nextPitches = Array.from({ length: 64 }, () => 0.5);
    
    if (presetName === 'arpeggio_up') {
      const pattern = [0, 4, 7, 12];
      for (let s = 0; s < 64; ++s) {
        const semitone = pattern[s % 4] + 12 * Math.floor((s % 16) / 4);
        const snapped = snapSemitoneToScale(semitone, keyRootIdx, intervals);
        nextPitches[s] = 0.5 + snapped / 48.0;
      }
    } else if (presetName === 'descending') {
      for (let s = 0; s < 64; ++s) {
        const semitone = 12 - (s % 16);
        const snapped = snapSemitoneToScale(semitone, keyRootIdx, intervals);
        nextPitches[s] = 0.5 + snapped / 48.0;
      }
    } else if (presetName === 'pentatonic') {
      const pattern = [0, 3, 5, 7, 10, 7, 5, 3];
      for (let s = 0; s < 64; ++s) {
        const semitone = pattern[s % 8];
        const snapped = snapSemitoneToScale(semitone, keyRootIdx, intervals);
        nextPitches[s] = 0.5 + snapped / 48.0;
      }
    } else if (presetName === 'octave') {
      for (let s = 0; s < 64; ++s) {
        const semitone = (s % 2 === 0) ? 0 : 12;
        const snapped = snapSemitoneToScale(semitone, keyRootIdx, intervals);
        nextPitches[s] = 0.5 + snapped / 48.0;
      }
    } else if (presetName === 'chaos') {
      for (let s = 0; s < 64; ++s) {
        const semitone = Math.floor(Math.random() * 25) - 12;
        const snapped = snapSemitoneToScale(semitone, keyRootIdx, intervals);
        nextPitches[s] = 0.5 + snapped / 48.0;
      }
    } else if (presetName === 'flat') {
      for (let s = 0; s < 64; ++s) {
        nextPitches[s] = 0.5;
      }
    }
    
    setActivePitches(nextPitches);
    
    if (selectedInstrument === 6) audioEngine.tomStepPitches = nextPitches;
    else if (selectedInstrument === 7) audioEngine.beepStepPitches = nextPitches;
    else if (selectedInstrument === 8) audioEngine.blipStepPitches = nextPitches;
    else if (selectedInstrument === 9) audioEngine.bloopStepPitches = nextPitches;
    
    autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
  };

  const handleSvgInteraction = (e) => {
    if (!svgRef.current || !activePitches || !setActivePitches) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const graphWidth = rect.width - 120;
    if (x < 120) return;
    
    const stepWidth = graphWidth / stepsCount;
    let step = Math.floor((x - 120) / stepWidth);
    step = Math.max(0, Math.min(stepsCount - 1, step));
    
    let val = 1.0 - (y / rect.height);
    val = Math.max(0.0, Math.min(1.0, val));
    
    const keyRootIdx = NOTE_NAMES.indexOf(pitchKey);
    const intervals = SCALE_INTERVALS[pitchScale] || SCALE_INTERVALS["Chromatic"];
    const semitone = Math.round((val - 0.5) * 48.0);
    const snapped = snapSemitoneToScale(semitone, keyRootIdx, intervals);
    const snappedVal = 0.5 + snapped / 48.0;
    
    setActivePitches(prev => {
      const next = [...prev];
      next[step] = snappedVal;
      if (selectedInstrument === 6) audioEngine.tomStepPitches = next;
      else if (selectedInstrument === 7) audioEngine.beepStepPitches = next;
      else if (selectedInstrument === 8) audioEngine.blipStepPitches = next;
      else if (selectedInstrument === 9) audioEngine.bloopStepPitches = next;
      return next;
    });
    
    setHoveredSvgStep(step);
    setHoveredSvgSemitone(snapped);
  };

  const handleSvgMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const graphWidth = rect.width - 120;
    if (x < 120) {
      setHoveredSvgStep(null);
      setHoveredSvgSemitone(null);
      return;
    }
    
    const stepWidth = graphWidth / stepsCount;
    let step = Math.floor((x - 120) / stepWidth);
    step = Math.max(0, Math.min(stepsCount - 1, step));
    
    let val = 1.0 - (y / rect.height);
    val = Math.max(0.0, Math.min(1.0, val));
    
    const keyRootIdx = NOTE_NAMES.indexOf(pitchKey);
    const intervals = SCALE_INTERVALS[pitchScale] || SCALE_INTERVALS["Chromatic"];
    const semitone = Math.round((val - 0.5) * 48.0);
    const snapped = snapSemitoneToScale(semitone, keyRootIdx, intervals);
    
    setHoveredSvgStep(step);
    setHoveredSvgSemitone(snapped);
    
    if (isSvgDragging) {
      handleSvgInteraction(e);
    }
  };

  // Custom audio file loading handler
  const handleFileLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const arrayBuf = event.target.result;
      try {
        audioEngine.ctx.decodeAudioData(arrayBuf, decodedBuffer => {
          audioEngine.sampleBuffer = decodedBuffer;
          setSampleName(file.name);
          setSampleBufferLoaded(true);
          logSession(`Loaded custom audio file: ${file.name}`, "INFO");
        }, (err) => {
          console.error("Audio file decoding failed:", err);
          logSession(`Failed to decode audio file: ${file.name}`, "ERROR");
          alert("Error decoding file. Please verify it is a valid WAV/MP3/M4A sound.");
        });
      } catch (err) {
        console.error("Audio buffer decode error:", err);
        logSession(`Error processing sample file: ${err.message}`, "ERROR");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Render raw wave data on canvas
  const drawSampleWaveform = () => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!audioEngine.sampleBuffer) {
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return;
    }

    const buffer = audioEngine.sampleBuffer;
    const channelData = buffer.getChannelData(0);
    const step = Math.ceil(channelData.length / width);

    ctx.beginPath();
    ctx.strokeStyle = '#ec4899'; // Sampler track signature pink color
    ctx.lineWidth = 1.5;

    for (let i = 0; i < width; i++) {
      const idx = i * step;
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step && (idx + j) < channelData.length; j++) {
        const val = channelData[idx + j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      
      const x = i;
      const yMin = ((min + 1) * height) / 2;
      const yMax = ((max + 1) * height) / 2;
      
      ctx.moveTo(x, yMin);
      ctx.lineTo(x, yMax);
    }
    ctx.stroke();
  };

  // Live waveform redrawing hook
  useEffect(() => {
    drawSampleWaveform();
  }, [sampleName, sampleBufferLoaded, selectedInstrument]);

  // Clear entire sequencer grid
  const handleClearGrid = () => {
    if (confirm("Are you sure you want to clear the entire sequencer grid?")) {
      const cleared = gridData.map(() => new Array(64).fill(false));
      setGridData(cleared);
      autoSave(cleared, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
      logSession("Sequencer grid cleared manually.", "INFO");
    }
  };

  // Clear FX automation curves
  const handleClearFxAutomation = () => {
    if (confirm("Clear all recorded FX automation loops?")) {
      for (const key in audioEngine.fxAutomation.enabled) {
        audioEngine.fxAutomation.enabled[key].fill(null);
      }
      for (const fxKey in audioEngine.fxAutomation.params) {
        for (const paramKey in audioEngine.fxAutomation.params[fxKey]) {
          audioEngine.fxAutomation.params[fxKey][paramKey].fill(null);
        }
      }
      logSession("All FX automation step arrays wiped.", "INFO");
    }
  };

  // Restore knob presets
  const handleResetKnobs = () => {
    if (confirm("Reset all instrument dials to factory defaults?")) {
      const initial = {};
      for (let c = 0; c < 11; c++) {
        const pMap = {};
        KNOB_DEFS[c].forEach(k => {
          pMap[k.key] = k.defaultValue;
          audioEngine.updateParams(c, { [k.key]: k.defaultValue });
        });
        initial[c] = pMap;
      }
      setParams(initial);
      autoSave(gridData, initial, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
      logSession("Instrument dials reset to factory defaults.", "INFO");
    }
  };

  // Toggle alternate sound A/B mode
  const handleAltSoundToggle = (channelId, useAlt) => {
    setParams(prev => {
      const next = {
        ...prev,
        [channelId]: {
          ...prev[channelId],
          useAltSound: useAlt
        }
      };
      autoSave(gridData, next, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
      return next;
    });
    audioEngine.updateParams(channelId, { useAltSound: useAlt });
    logSession(`Toggled track ${INSTRUMENTS[channelId].name} mode to: ${useAlt ? 'ALTERNATE (B)' : 'ANALOG (A)'}`, "INFO");
  };

  // Toggle Mute channels
  const toggleMute = (index) => {
    const next = [...mutes];
    next[index] = !next[index];
    setMutes(next);
    audioEngine.setMute(index, next[index]);
    logSession(`Track ${INSTRUMENTS[index].name} mute state toggled to: ${next[index] ? 'MUTED' : 'UNMUTED'}`, "INFO");
  };

  // Toggle Bitcrusher bypass channels
  const toggleCrunchBypass = (index) => {
    const next = [...crunchBypass];
    next[index] = !next[index];
    setCrunchBypass(next);
    audioEngine.setCrunchBypass(index, next[index]);
    autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, next, swing, getFxSaveState());
    logSession(`Track ${INSTRUMENTS[index].name} Bitcrusher bypass set to: ${next[index] ? 'BYPASSED (DRY)' : 'CRUNCHED (WET)'}`, "INFO");
  };

  // Select focus instrument
  const handleInstrumentSelect = (index) => {
    setSelectedInstrument(index);
    if (!isPlaying) {
      triggerSound(index);
    } else {
      flashPad(index);
    }
    logSession(`Selected instrument edit target: ${INSTRUMENTS[index].name}`, "INFO");

    // Add step record on click if Step Record is active
    if (isStepRecording) {
      setGridData(prev => {
        const next = prev.map((track, trackIdx) => {
          if (trackIdx === index) {
            const newTrack = [...track];
            newTrack[currentStep] = true;
            return newTrack;
          }
          return track;
        });
        autoSave(next, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
        return next;
      });

      // Advance active step
      const nextStep = (currentStep + 1) % stepsCount;
      setCurrentStep(nextStep);
      currentStepRef.current = nextStep;
      audioEngine.currentStep = nextStep;
    }
  };

  // ==========================================
  // PAGE 2 EFFECTS ACTIONS & HANDLERS
  // ==========================================
  const handleBitcrusherToggle = () => {
    audioEngine.init();
    const next = !bitcrusherEnabled;
    setBitcrusherEnabled(next);
    audioEngine.bitcrusherEnabled = next;
    
    if (isRecordingPitchRef.current && isPlaying) {
      audioEngine.recordFxAutomation('bitcrusher', 'enabled', currentStepRef.current, next);
    }
    
    autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState({ bitcrusherEnabled: next }));
    logSession(`Master Bitcrusher toggled: ${next ? 'ENABLED' : 'DISABLED'}`, "INFO");
  };

  const handleBitcrusherBits = (val) => {
    audioEngine.init();
    const bounded = Math.max(1, Math.min(16, Math.round(val)));
    setBitcrusherBits(bounded);
    audioEngine.bitcrusherBits = bounded;
    
    if (isRecordingPitchRef.current && isPlaying) {
      audioEngine.recordFxAutomation('bitcrusher', 'bits', currentStepRef.current, bounded);
    }
    
    autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState({ bitcrusherBits: bounded }));
  };

  const handleBitcrusherDownsample = (val) => {
    audioEngine.init();
    const bounded = Math.max(1, Math.min(32, Math.round(val)));
    setBitcrusherDownsample(bounded);
    audioEngine.bitcrusherDownsample = bounded;
    
    if (isRecordingPitchRef.current && isPlaying) {
      audioEngine.recordFxAutomation('bitcrusher', 'downsample', currentStepRef.current, bounded);
    }
    
    autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState({ bitcrusherDownsample: bounded }));
  };

  const handleBitcrusherMix = (val) => {
    audioEngine.init();
    const bounded = Math.max(0.0, Math.min(1.0, val));
    setBitcrusherMix(bounded);
    audioEngine.bitcrusherMix = bounded;
    
    if (isRecordingPitchRef.current && isPlaying) {
      audioEngine.recordFxAutomation('bitcrusher', 'mix', currentStepRef.current, bounded);
    }
    
    autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState({ bitcrusherMix: bounded }));
  };

  const handleFxToggle = (key) => {
    audioEngine.init();
    const nextEnabled = { ...fxEnabled, [key]: !fxEnabled[key] };
    setFxEnabled(nextEnabled);
    audioEngine.fxEnabled = nextEnabled;
    audioEngine.rebuildFXChain();
    
    if (isRecordingPitchRef.current && isPlaying) {
      audioEngine.recordFxAutomation(key, 'enabled', currentStepRef.current, nextEnabled[key]);
    }
    
    autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState({ fxEnabled: nextEnabled }));
    logSession(`FX module ${key.toUpperCase()} toggle status: ${nextEnabled[key] ? 'ON' : 'OFF'}`, "INFO");
  };

  const handleFxParamChange = (fxKey, paramKey, val) => {
    audioEngine.init();
    const nextParams = { 
      ...fxParams, 
      [fxKey]: { ...fxParams[fxKey], [paramKey]: val } 
    };
    setFxParams(nextParams);
    audioEngine.fxParams = nextParams;

    if (fxKey === 'distortion') audioEngine.updateDistortionDrive();
    else if (fxKey === 'filter') audioEngine.updateFilter();
    else if (fxKey === 'delay') audioEngine.updateDelay();
    else if (fxKey === 'reverb') audioEngine.updateReverbImpulse();
    else if (fxKey === 'sidechain') audioEngine.updateSidechain();

    if (isRecordingPitchRef.current && isPlaying) {
      audioEngine.recordFxAutomation(fxKey, paramKey, currentStepRef.current, val);
    }

    autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState({ fxParams: nextParams }));
  };

  const handleFilterTypeChange = (type) => {
    audioEngine.init();
    const nextParams = {
      ...fxParams,
      filter: { ...fxParams.filter, type }
    };
    setFxParams(nextParams);
    audioEngine.fxParams = nextParams;
    audioEngine.updateFilter();
    autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState({ fxParams: nextParams }));
    logSession(`Filter topology changed to: ${type.toUpperCase()}`, "INFO");
  };

  const handleSwapEffects = (index, direction) => {
    audioEngine.init();
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= fxChainOrder.length) return;

    const nextOrder = [...fxChainOrder];
    const temp = nextOrder[index];
    nextOrder[index] = nextOrder[nextIndex];
    nextOrder[nextIndex] = temp;

    setFxChainOrder(nextOrder);
    audioEngine.fxChainOrder = nextOrder;
    audioEngine.rebuildFXChain();
    autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState({ fxChainOrder: nextOrder }));
  };

  // Step vertical pitch dragging helpers
  const getStepPitchForInst = (instIdx, stepIdx) => {
    if (instIdx === 6) return tomPitches[stepIdx];
    if (instIdx === 7) return beepPitches[stepIdx];
    if (instIdx === 8) return blipPitches[stepIdx];
    if (instIdx === 9) return bloopPitches[stepIdx];
    return null;
  };

  const handleStepMouseDown = (stepIdx, e) => {
    if (e) e.preventDefault();
    const isPitchInstrument = [6, 7, 8, 9].includes(selectedInstrument);
    const wasActive = gridData[selectedInstrument][stepIdx];
    
    // Toggle active state with selected paint roll value
    const nextActive = wasActive ? false : paintRollValue;
    
    // Update the grid cell state
    const newGrid = gridData.map((track, trackIdx) => {
      if (trackIdx === selectedInstrument) {
        const newTrack = [...track];
        newTrack[stepIdx] = nextActive;
        return newTrack;
      }
      return track;
    });
    setGridData(newGrid);
    
    if (nextActive) {
      triggerSound(selectedInstrument);
    }
    
    // Auto-save the new grid state
    autoSave(newGrid, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
    
    logSession(`Toggled step ${stepIdx} for ${INSTRUMENTS[selectedInstrument].name} to ${nextActive ? 'ON' : 'OFF'}`, "INFO");

    // If it's a pitch-eligible instrument and we turned the step ON, enable vertical drag pitch shifting!
    if (isPitchInstrument && nextActive) {
      const startY = e.clientY;
      const initialPitch = getStepPitchForInst(selectedInstrument, stepIdx) ?? 0.5;

      const handleMouseMove = (moveEvent) => {
        const deltaY = startY - moveEvent.clientY; // Dragging UP increases pitch (positive delta)
        const pitchRange = 150; // pixels to go from 0.0 to 1.0
        let newPitch = initialPitch + deltaY / pitchRange;
        newPitch = Math.max(0.0, Math.min(1.0, newPitch));
        
        // Update the pitch array for the selected instrument
        if (selectedInstrument === 6) {
          setTomPitches(prev => {
            const next = [...prev];
            next[stepIdx] = newPitch;
            audioEngine.tomStepPitches = next;
            autoSave(newGrid, params, next, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
            return next;
          });
        } else if (selectedInstrument === 7) {
          setBeepPitches(prev => {
            const next = [...prev];
            next[stepIdx] = newPitch;
            audioEngine.beepStepPitches = next;
            autoSave(newGrid, params, tomPitches, { bpm, stepsCount }, next, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
            return next;
          });
        } else if (selectedInstrument === 8) {
          setBlipPitches(prev => {
            const next = [...prev];
            next[stepIdx] = newPitch;
            audioEngine.blipStepPitches = next;
            autoSave(newGrid, params, tomPitches, { bpm, stepsCount }, beepPitches, next, bloopPitches, crunchBypass, swing, getFxSaveState());
            return next;
          });
        } else if (selectedInstrument === 9) {
          setBloopPitches(prev => {
            const next = [...prev];
            next[stepIdx] = newPitch;
            audioEngine.bloopStepPitches = next;
            autoSave(newGrid, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, next, crunchBypass, swing, getFxSaveState());
            return next;
          });
        }
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        logSession(`Set custom step pitch automation at step ${stepIdx} for instrument ${INSTRUMENTS[selectedInstrument].name}`, "INFO");
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
  };

  const isPitchEligible = [6, 7, 8, 9].includes(selectedInstrument);
  const activeColor = INSTRUMENTS[selectedInstrument].color;
  const activeGlow = INSTRUMENTS[selectedInstrument].glow;

  // Immersive touch-optimized mobile page layout
  const renderMobileLayout = () => {
    // Pitch automation mapping
    const activePitches = selectedInstrument === 6 ? tomPitches : selectedInstrument === 7 ? beepPitches : selectedInstrument === 8 ? blipPitches : selectedInstrument === 9 ? bloopPitches : null;
    const setActivePitches = selectedInstrument === 6 ? setTomPitches : selectedInstrument === 7 ? setBeepPitches : selectedInstrument === 8 ? setBlipPitches : selectedInstrument === 9 ? setBloopPitches : null;
    const pitchLabel = selectedInstrument === 6 ? 'Tom Pitch' : selectedInstrument === 7 ? 'Beep Pitch' : selectedInstrument === 8 ? 'Blip Speed' : selectedInstrument === 9 ? 'Bloop Speed' : '';

    const fxKeys = ['bitcrusher', 'distortion', 'filter', 'delay', 'reverb', 'sidechain'];
    const fxLabels = {
      bitcrusher: 'Bitcrusher',
      distortion: 'Saturator',
      filter: 'Filter',
      delay: 'Delay',
      reverb: 'Reverb',
      sidechain: 'Sidechain'
    };

    return (
      <div className="mobile-app-container">
        {/* Responsive sound-reactive mini visualizer ribbon */}
        <div className="mobile-visualizers-ribbon">
          <canvas ref={lowsCanvasRef} className="mobile-vis-canvas" />
          <canvas ref={midsCanvasRef} className="mobile-vis-canvas" />
          <canvas ref={highsCanvasRef} className="mobile-vis-canvas" />
        </div>

        {/* Full-bleed responsive header */}
        <header className="mobile-header">
          <div className="mobile-header-brand">
            <Radio size={16} color="var(--accent-orange)" />
            <span className="mobile-brand-text">PHYZIX S&B</span>
          </div>
          <div className="mobile-header-actions">
            <button
              onClick={() => {
                setShowManual(true);
                logSession("Opened operations manual overlay modal.", "INFO");
              }}
              className="mobile-header-btn"
              title="Help Manual"
            >
              <HelpCircle size={13} />
            </button>
            <button onClick={handleResetKnobs} className="mobile-header-btn" title="Reset All Dials">
              <RotateCcw size={13} />
            </button>
            <button onClick={handleClearGrid} className="mobile-header-btn" title="Clear Sequencer Steps">
              <Trash2 size={13} />
            </button>
          </div>
        </header>

        {/* Premium tactile mobile transport row */}
        <section className="mobile-transport-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button
              onClick={togglePlay}
              className={`mobile-play-btn ${isPlaying ? 'playing' : ''}`}
            >
              {isPlaying ? <Square size={10} fill="#ffffff" color="#ffffff" /> : <Play size={10} fill="var(--accent-teal)" color="var(--accent-teal)" />}
              <span>{isPlaying ? 'STOP' : 'PLAY'}</span>
            </button>
            <button
              onClick={toggleSessionRecording}
              className={`mobile-play-btn ${isSessionRecording ? 'playing' : ''}`}
              style={{
                background: isSessionRecording ? 'var(--accent-orange)' : 'rgba(0,0,0,0.05)',
                color: isSessionRecording ? 'white' : 'var(--text-primary)'
              }}
            >
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: isSessionRecording ? '#ffffff' : '#e74c3c' }}></span>
              <span>{isSessionRecording ? 'STOP' : 'REC'}</span>
            </button>
            
            <div className="mobile-bpm-control">
              <span className="mobile-bpm-label">BPM</span>
              <input
                type="number"
                value={bpm}
                onChange={(e) => {
                  const val = Math.min(240, Math.max(40, parseInt(e.target.value) || 120));
                  setBpm(val);
                  audioEngine.updateBPM(val);
                }}
                className="mobile-bpm-input"
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button
              className={`mobile-toggle-btn ${isStepRecording ? 'active' : ''}`}
              onClick={() => setIsStepRecording(!isStepRecording)}
              title="Toggle Step Recording"
            >
              STEP REC
            </button>
            <button
              className={`mobile-toggle-btn ${isRecordingPitch ? 'active' : ''}`}
              onClick={() => setIsRecordingPitch(!isRecordingPitch)}
              title="Toggle Motion Automation Recording"
            >
              MOTION REC
            </button>
          </div>
        </section>

        {/* Premium local presetting panel */}
        <section className="mobile-presets-bar">
          <button onClick={exportPatternPSNB} className="mobile-preset-btn premium">
            <Download size={10} />
            <span>EXPORT PATTERN</span>
          </button>
          <button onClick={() => psnbInputRef.current && psnbInputRef.current.click()} className="mobile-preset-btn">
            <Upload size={10} />
            <span>IMPORT PATTERN</span>
          </button>
          <input
            type="file"
            ref={psnbInputRef}
            onChange={handleImportPSNB}
            accept=".psnb"
            style={{ display: 'none' }}
          />
        </section>

        {/* Tactile main tabs switcher */}
        <nav className="mobile-tabs-nav">
          <button className={`mobile-tab-btn ${activePage === 'drums' ? 'active' : ''}`} onClick={() => setActivePage('drums')}>DRUMS</button>
          <button className={`mobile-tab-btn ${activePage === 'grid' ? 'active' : ''}`} onClick={() => setActivePage('grid')}>SEQUENCER</button>
          <button className={`mobile-tab-btn ${activePage === 'piano' ? 'active' : ''}`} onClick={() => setActivePage('piano')}>PIANO ROLL</button>
          <button className={`mobile-tab-btn ${activePage === 'fx' ? 'active' : ''}`} onClick={() => setActivePage('fx')}>EFFECTS</button>
        </nav>

        {/* Responsive screen wrapper */}
        <main className="mobile-main-content">
          
          {/* ========================================== */}
          {/* 1. DRUMS TABS PAGE */}
          {activePage === 'drums' && (
            <div className="mobile-page-wrapper">
              <div className="mobile-instrument-selector">
                {INSTRUMENTS.map((inst, idx) => {
                  const isSelected = selectedInstrument === idx;
                  const isTriggered = padTrigger[idx];
                  return (
                    <button
                      key={inst.id}
                      onClick={() => setSelectedInstrument(idx)}
                      className={`mobile-selector-pad ${isSelected ? 'active' : ''} ${isTriggered ? 'triggered' : ''}`}
                      style={{
                        borderColor: isTriggered ? inst.color : isSelected ? inst.color : 'rgba(0,0,0,0.06)',
                        boxShadow: isTriggered ? `0 0 10px ${inst.color}88` : isSelected ? `0 4px 10px ${inst.glow}` : 'none',
                        color: isTriggered ? '#ffffff' : 'var(--text-primary)',
                        background: isTriggered ? inst.color : isSelected ? `${inst.color}15` : '#ffffff',
                      }}
                    >
                      {inst.name}
                    </button>
                  );
                })}
              </div>

              {/* Display exactly one beautiful active card to prevent overflow */}
              {(() => {
                const inst = INSTRUMENTS[selectedInstrument];
                const idx = selectedInstrument;
                return (
                  <div 
                    className="mobile-focused-instrument-card"
                    style={{ '--card-accent-color': inst.color }}
                  >
                    <div className="mobile-card-header">
                      <div className="mobile-card-title">{inst.name.toUpperCase()}</div>
                      <div className="mobile-card-sub">
                        {idx < 11 
                          ? (params[idx]?.useAltSound ? ALTS_SUBLINES[idx].B : ALTS_SUBLINES[idx].A)
                          : inst.type
                        }
                      </div>
                    </div>

                    {idx < 11 && (
                      <div className="mobile-alt-switch-row">
                        <span className="mobile-switch-label">MODE:</span>
                        <div style={{ display: 'flex', gap: '0.2rem' }}>
                          <button
                            className={`mobile-switch-btn ${!params[idx].useAltSound ? 'active' : ''}`}
                            onClick={() => handleAltSoundToggle(idx, false)}
                            style={{
                              background: !params[idx].useAltSound ? inst.color : 'transparent',
                              color: !params[idx].useAltSound ? 'white' : 'var(--text-secondary)'
                            }}
                          >
                            A
                          </button>
                          <button
                            className={`mobile-switch-btn ${params[idx].useAltSound ? 'active' : ''}`}
                            onClick={() => handleAltSoundToggle(idx, true)}
                            style={{
                              background: params[idx].useAltSound ? inst.color : 'transparent',
                              color: params[idx].useAltSound ? 'white' : 'var(--text-secondary)'
                            }}
                          >
                            B
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="mobile-card-dials-grid">
                      {KNOB_DEFS[idx].map((k) => {
                        const isLearning = midiLearnTarget && midiLearnTarget.channelId === idx && midiLearnTarget.paramKey === k.key;
                        const midiCc = midiManager.getCcMappingForParam(idx, k.key);
                        const overriddenK = getOverriddenKnobDef(idx, k, params[idx]?.useAltSound);
                        return (
                          <Knob
                            key={k.key}
                            label={overriddenK.label}
                            value={getAutomatedInstrumentValue(idx, k.key, params[idx][k.key])}
                            min={k.min}
                            max={k.max}
                            defaultValue={k.defaultValue}
                            onChange={(val) => handleKnobChange(idx, k.key, val)}
                            onMidiLearn={() => handleMidiLearn(idx, k.key)}
                            isLearning={isLearning}
                            midiCc={midiCc}
                            onMidiUnbind={() => handleMidiUnbind(idx, k.key)}
                            valueDisplayFormatter={overriddenK.formatter}
                            tooltip={overriddenK.tooltip}
                            isAutomated={getInstrumentAutomationInfo(idx, k.key).isAutomated}
                            onClearAutomation={getInstrumentAutomationInfo(idx, k.key).onClearAutomation}
                            showMidiCcOverlay={showMidiCcOverlay}
                            onContextMenu={(e) => handleKnobContextMenu(e, idx, k.key)}
                          />
                        );
                      })}
                    </div>

                    <div className="mobile-card-utilities">
                      <button 
                        className={`mobile-util-btn ${mutes[idx] ? 'muted' : ''}`}
                        onClick={() => toggleMute(idx)}
                      >
                        {mutes[idx] ? <VolumeX size={12} /> : <Volume2 size={12} />}
                        <span>{mutes[idx] ? 'MUTED' : 'MUTE'}</span>
                      </button>
                      <button 
                        className={`mobile-util-btn ${crunchBypass[idx] ? '' : 'crunched'}`}
                        onClick={() => toggleCrunchBypass(idx)}
                      >
                        <span>{crunchBypass[idx] ? 'CLEAN' : 'CRUNCHED'}</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ========================================== */}
          {/* 2. SEQUENCER TABS PAGE */}
          {activePage === 'grid' && (
            <div className="mobile-page-wrapper">
              <div className="mobile-instrument-selector">
                {INSTRUMENTS.map((inst, idx) => {
                  const isSelected = selectedInstrument === idx;
                  const isTriggered = padTrigger[idx];
                  return (
                    <button
                      key={inst.id}
                      onClick={() => setSelectedInstrument(idx)}
                      className={`mobile-selector-pad ${isSelected ? 'active' : ''} ${isTriggered ? 'triggered' : ''}`}
                      style={{
                        borderColor: isTriggered ? inst.color : isSelected ? inst.color : 'rgba(0,0,0,0.06)',
                        boxShadow: isTriggered ? `0 0 10px ${inst.color}88` : isSelected ? `0 4px 10px ${inst.glow}` : 'none',
                        color: isTriggered ? '#ffffff' : 'var(--text-primary)',
                        background: isTriggered ? inst.color : isSelected ? `${inst.color}15` : '#ffffff',
                      }}
                    >
                      {inst.name}
                    </button>
                  );
                })}
              </div>

              <div className="mobile-sequencer-box">
                <div className="mobile-sequencer-header" style={{ borderColor: activeColor }}>
                  <span className="mobile-sec-title" style={{ color: activeColor }}>
                    ACTIVE STEP SEQUENCER: {INSTRUMENTS[selectedInstrument].name.toUpperCase()}
                  </span>
                </div>

                <div className="mobile-sequencer-grid">
                  {Array.from({ length: stepsCount }).map((_, stepIdx) => {
                    const isActive = gridData[selectedInstrument][stepIdx];
                    const isStepPlaying = isPlaying && currentStep === stepIdx;
                    const isBeatStart = stepIdx % 4 === 0;
                    return (
                      <button
                        key={stepIdx}
                        onClick={() => {
                          const newGrid = gridData.map((row, rIdx) => {
                            if (rIdx === selectedInstrument) {
                              const next = [...row];
                              next[stepIdx] = !next[stepIdx];
                              return next;
                            }
                            return row;
                          });
                          setGridData(newGrid);
                          audioEngine.updateStep(selectedInstrument, stepIdx, !isActive);
                          if (!isActive) {
                            audioEngine.triggerInstrument(selectedInstrument);
                            flashPad(selectedInstrument);
                          }
                        }}
                        className={`mobile-step-cell ${isActive ? 'active' : ''} ${isBeatStart ? 'beat-start' : ''} ${isStepPlaying ? 'playing' : ''}`}
                        style={{
                          borderColor: isActive ? activeColor : '',
                          boxShadow: isActive ? `0 0 6px ${activeColor}88` : '',
                          backgroundColor: isStepPlaying ? 'rgba(0,0,0,0.08)' : isActive ? `${activeColor}22` : '#ffffff',
                          color: isActive ? activeColor : 'var(--text-secondary)'
                        }}
                      >
                        {stepIdx + 1}
                      </button>
                    );
                  })}
                </div>

                {/* Highly intuitive touch pitch-bend slider row on active sequencer hits */}
                {isPitchEligible && activePitches && (
                  <div className="mobile-pitch-automation-pane">
                    <div className="mobile-pane-title">PITCH BEND STEP AUTOMATION ({pitchLabel.toUpperCase()})</div>
                    <div className="mobile-sliders-row">
                      {Array.from({ length: stepsCount }).map((_, stepIdx) => {
                        const hasHit = gridData[selectedInstrument][stepIdx];
                        if (!hasHit) return null;
                        
                        const pitchVal = activePitches[stepIdx];
                        const sliderVal = Math.round(pitchVal * 100);

                        return (
                          <div key={stepIdx} className="mobile-slider-col">
                            <span className="mobile-step-num">Step {stepIdx + 1}</span>
                            <input
                              type="range"
                              min="25"
                              max="400"
                              value={sliderVal}
                              onChange={(e) => {
                                const newPitch = parseFloat(e.target.value) / 100;
                                const newGrid = [...gridData];
                                setActivePitches(prev => {
                                  const next = [...prev];
                                  next[stepIdx] = newPitch;
                                  if (selectedInstrument === 6) audioEngine.tomStepPitches = next;
                                  else if (selectedInstrument === 7) audioEngine.beepStepPitches = next;
                                  else if (selectedInstrument === 8) audioEngine.blipStepPitches = next;
                                  else if (selectedInstrument === 9) audioEngine.bloopStepPitches = next;
                                  autoSave(newGrid, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
                                  return next;
                                });
                              }}
                              className="mobile-vertical-slider"
                            />
                            <span className="mobile-pitch-text">{pitchVal.toFixed(2)}x</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================== */}
          {/* 3. PIANO ROLL TABS PAGE */}
          {activePage === 'piano' && (
            <div className="mobile-page-wrapper">
              <div className="mobile-scroll-container">
                <div style={{ minWidth: '680px', padding: '0.4rem' }}>
                  <div className="master-grid-container" style={{ gridTemplateColumns: `85px repeat(${stepsCount}, 1fr)` }}>
                    <div className="corner-label" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }}>VOICE</div>
                    {Array.from({ length: stepsCount }).map((_, stepIdx) => (
                      <div key={stepIdx} className={`header-step ${currentStep === stepIdx && isPlaying ? 'playing' : ''}`} style={{ fontSize: '0.65rem' }}>
                        {stepIdx + 1}
                      </div>
                    ))}

                    {/* Clean compact track rendering */}
                    {INSTRUMENTS.map((inst, trackIdx) => {
                      const isFocused = selectedInstrument === trackIdx;
                      return (
                        <React.Fragment key={inst.id}>
                          <div 
                            className={`piano-row-header ${isFocused ? 'focused' : ''}`}
                            onClick={() => setSelectedInstrument(trackIdx)}
                            style={{ 
                              color: isFocused ? inst.color : '',
                              borderLeft: isFocused ? `4px solid ${inst.color}` : '',
                              fontSize: '0.7rem',
                              fontFamily: 'var(--font-mono)',
                              height: '32px'
                            }}
                          >
                            ● {inst.name}
                          </div>
                          {Array.from({ length: stepsCount }).map((_, stepIdx) => {
                            const isActive = gridData[trackIdx][stepIdx];
                            const isStepPlaying = isPlaying && currentStep === stepIdx;
                            return (
                              <div
                                key={stepIdx}
                                className={`piano-grid-cell ${isActive ? 'active-cell' : ''} ${stepIdx % 4 === 0 ? 'beat-border' : ''} ${isStepPlaying ? 'playing-cell' : ''}`}
                                onClick={() => {
                                  const newGrid = gridData.map((row, rIdx) => {
                                    if (rIdx === trackIdx) {
                                      const next = [...row];
                                      next[stepIdx] = !next[stepIdx];
                                      return next;
                                    }
                                    return row;
                                  });
                                  setGridData(newGrid);
                                  audioEngine.updateStep(trackIdx, stepIdx, !isActive);
                                  if (!isActive) {
                                    audioEngine.triggerInstrument(trackIdx);
                                    flashPad(trackIdx);
                                  }
                                }}
                                style={{
                                  backgroundColor: isActive ? inst.color : '',
                                  boxShadow: isActive ? `inset 0 0 6px rgba(0,0,0,0.15), 0 0 8px ${inst.color}55` : '',
                                  opacity: isStepPlaying && !isActive ? 0.35 : 1,
                                  height: '32px'
                                }}
                              />
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Tactile velocity accents lane */}
              <div className="mobile-velocity-pane">
                <div className="mobile-pane-title">
                  MIDI VELOCITY ACCENT VOLUME ({INSTRUMENTS[selectedInstrument].name.toUpperCase()})
                </div>
                <div className="mobile-sliders-row">
                  {Array.from({ length: stepsCount }).map((_, stepIdx) => {
                    const hasHit = gridData[selectedInstrument][stepIdx];
                    if (!hasHit) return null;

                    const velocity = velocityData[selectedInstrument][stepIdx];
                    const percent = Math.round(velocity * 100);

                    return (
                      <div key={stepIdx} className="mobile-slider-col">
                        <span className="mobile-step-num">Step {stepIdx + 1}</span>
                        <input
                          type="range"
                          min="5"
                          max="100"
                          value={percent}
                          onChange={(e) => {
                            const nextVal = parseInt(e.target.value) / 100;
                            const newGrid = [...gridData];
                            setVelocityData(prev => {
                              const next = prev.map((row, rIdx) => {
                                if (rIdx === selectedInstrument) {
                                  const nextRow = [...row];
                                  nextRow[stepIdx] = nextVal;
                                  return nextRow;
                                }
                                return row;
                              });
                              audioEngine.updateStepVelocity(selectedInstrument, stepIdx, nextVal);
                              autoSave(newGrid, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
                              return next;
                            });
                          }}
                          className="mobile-vertical-slider velocity"
                        />
                        <span className="mobile-pitch-text">{percent}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ========================================== */}
          {/* 4. EFFECTS TABS PAGE */}
          {activePage === 'fx' && (
            <div className="mobile-page-wrapper">
              
              {/* Modular Flow Chain row wrapped cleanly */}
              <div className="mobile-fx-chain-box">
                <div className="mobile-pane-title">MODULAR DSP FLOW ORDER (TAP ARROWS TO RE-ROUTE)</div>
                <div className="mobile-fx-chain-row">
                  {fxChainOrder.map((key, idx) => {
                    const enabled = fxEnabled[key];
                    const label = fxLabels[key];
                    return (
                      <React.Fragment key={key}>
                        <div className={`mobile-fx-block ${enabled ? 'enabled' : ''}`}>
                          <input 
                            type="checkbox" 
                            checked={enabled} 
                            onChange={() => handleFxToggle(key)}
                            className="mobile-fx-checkbox"
                          />
                          <span className="mobile-fx-block-title">{label.toUpperCase()}</span>
                          <div className="mobile-fx-arrows">
                            {idx > 0 && (
                              <button className="mobile-arrow-btn" onClick={() => handleSwapEffects(idx, -1)}>◀</button>
                            )}
                            {idx < fxChainOrder.length - 1 && (
                              <button className="mobile-arrow-btn" onClick={() => handleSwapEffects(idx, 1)}>▶</button>
                            )}
                          </div>
                        </div>
                        {idx < fxChainOrder.length - 1 && <span className="mobile-fx-arrow">➔</span>}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {/* Sub-page selector to display exactly one active effect module card */}
              <div className="mobile-fx-selector">
                {fxKeys.map((key) => {
                  const isActive = mobileActiveFx === key;
                  const isEnabled = key === 'bitcrusher' ? bitcrusherEnabled : fxEnabled[key];
                  return (
                    <button
                      key={key}
                      onClick={() => setMobileActiveFx(key)}
                      className={`mobile-fx-tab-btn ${isActive ? 'active' : ''} ${isEnabled ? 'enabled' : ''}`}
                    >
                      {fxLabels[key] || 'Bitcrusher'}
                    </button>
                  );
                })}
              </div>

              {/* Display Focused Active FX Card */}
              <div className="mobile-focused-fx-card">
                {mobileActiveFx === 'bitcrusher' && (
                  <div className="mobile-fx-module">
                    <div className="mobile-fx-header">
                      <span>BIT CRUNCHER DSP</span>
                      <button 
                        className={`mobile-fx-bypass-btn ${bitcrusherEnabled ? 'active' : ''}`}
                        onClick={handleBitcrusherToggle}
                      >
                        {bitcrusherEnabled ? 'ACTIVE' : 'BYPASS'}
                      </button>
                    </div>
                    <div className="mobile-fx-knobs">
                      <Knob 
                        label="Bit Depth"
                        value={getAutomatedFxValue('bitcrusher', 'bits', bitcrusherBits)}
                        min={1}
                        max={16}
                        defaultValue={8}
                        onChange={handleBitcrusherBits}
                        valueDisplayFormatter={v => `${v} bits`}
                        isAutomated={getFxAutomationInfo('bitcrusher', 'bits').isAutomated}
                        onClearAutomation={getFxAutomationInfo('bitcrusher', 'bits').onClearAutomation}
                        midiCc={midiManager.getCcMappingForParam(-1, 'bitcrusherBits')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'bitcrusherBits')}
                        onMidiLearn={() => handleMidiLearn(-1, 'bitcrusherBits')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'bitcrusherBits'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'bitcrusherBits')}
                      />
                      <Knob 
                        label="Downsample"
                        value={getAutomatedFxValue('bitcrusher', 'downsample', bitcrusherDownsample)}
                        min={1}
                        max={32}
                        defaultValue={1}
                        onChange={handleBitcrusherDownsample}
                        valueDisplayFormatter={v => `${v}x`}
                        isAutomated={getFxAutomationInfo('bitcrusher', 'downsample').isAutomated}
                        onClearAutomation={getFxAutomationInfo('bitcrusher', 'downsample').onClearAutomation}
                        midiCc={midiManager.getCcMappingForParam(-1, 'bitcrusherDownsample')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'bitcrusherDownsample')}
                        onMidiLearn={() => handleMidiLearn(-1, 'bitcrusherDownsample')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'bitcrusherDownsample'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'bitcrusherDownsample')}
                      />
                    </div>
                  </div>
                )}

                {mobileActiveFx === 'distortion' && (
                  <div className="mobile-fx-module">
                    <div className="mobile-fx-header">
                      <span>SATURATOR OVERDRIVE</span>
                      <button 
                        className={`mobile-fx-bypass-btn ${fxEnabled.distortion ? 'active' : ''}`}
                        onClick={() => handleFxToggle('distortion')}
                      >
                        {fxEnabled.distortion ? 'ACTIVE' : 'BYPASS'}
                      </button>
                    </div>
                    <div className="mobile-fx-knobs">
                      <Knob 
                        label="Drive"
                        value={getAutomatedFxValue('distortion', 'drive', fxParams.distortion.drive)}
                        min={0.0}
                        max={1.0}
                        defaultValue={0.3}
                        onChange={(val) => handleFxParamChange('distortion', 'drive', val)}
                        valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                        isAutomated={getFxAutomationInfo('distortion', 'drive').isAutomated}
                        onClearAutomation={getFxAutomationInfo('distortion', 'drive').onClearAutomation}
                        midiCc={midiManager.getCcMappingForParam(-1, 'distDrive')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'distDrive')}
                        onMidiLearn={() => handleMidiLearn(-1, 'distDrive')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'distDrive'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'distDrive')}
                      />
                    </div>
                  </div>
                )}

                {mobileActiveFx === 'filter' && (
                  <div className="mobile-fx-module">
                    <div className="mobile-fx-header">
                      <span>BIQUAD FILTER</span>
                      <button 
                        className={`mobile-fx-bypass-btn ${fxEnabled.filter ? 'active' : ''}`}
                        onClick={() => handleFxToggle('filter')}
                      >
                        {fxEnabled.filter ? 'ACTIVE' : 'BYPASS'}
                      </button>
                    </div>
                    <div className="mobile-fx-knobs">
                      <Knob 
                        label="Cutoff"
                        value={getAutomatedFxValue('filter', 'cutoff', fxParams.filter.cutoff)}
                        min={100}
                        max={8000}
                        defaultValue={1200}
                        onChange={(val) => handleFxParamChange('filter', 'cutoff', val)}
                        valueDisplayFormatter={v => v > 1000 ? `${(v/1000).toFixed(1)}kHz` : `${Math.round(v)}Hz`}
                        isAutomated={getFxAutomationInfo('filter', 'cutoff').isAutomated}
                        onClearAutomation={getFxAutomationInfo('filter', 'cutoff').onClearAutomation}
                        midiCc={midiManager.getCcMappingForParam(-1, 'filterCutoff')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'filterCutoff')}
                        onMidiLearn={() => handleMidiLearn(-1, 'filterCutoff')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'filterCutoff'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'filterCutoff')}
                      />
                      <Knob 
                        label="Resonance"
                        value={getAutomatedFxValue('filter', 'resonance', fxParams.filter.resonance)}
                        min={0.5}
                        max={10.0}
                        defaultValue={2.0}
                        onChange={(val) => handleFxParamChange('filter', 'resonance', val)}
                        valueDisplayFormatter={v => v.toFixed(1)}
                        isAutomated={getFxAutomationInfo('filter', 'resonance').isAutomated}
                        onClearAutomation={getFxAutomationInfo('filter', 'resonance').onClearAutomation}
                        midiCc={midiManager.getCcMappingForParam(-1, 'filterResonance')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'filterResonance')}
                        onMidiLearn={() => handleMidiLearn(-1, 'filterResonance')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'filterResonance'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'filterResonance')}
                      />
                    </div>
                    
                    <div className="mobile-alt-switch-row" style={{ marginTop: '0.4rem', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '0.2rem 0.5rem', background: 'rgba(0,0,0,0.015)' }}>
                      <span className="mobile-switch-label" style={{ fontSize: '0.65rem' }}>FILTER TYPE:</span>
                      <div style={{ display: 'flex', gap: '0.2rem' }}>
                        {['lowpass', 'highpass', 'bandpass'].map((t) => (
                          <button
                            key={t}
                            onClick={() => handleFxParamChange('filter', 'type', t)}
                            className={`mobile-switch-btn ${fxParams.filter.type === t ? 'active' : ''}`}
                            style={{
                              background: fxParams.filter.type === t ? 'var(--accent-orange)' : 'transparent',
                              color: fxParams.filter.type === t ? 'white' : 'var(--text-secondary)',
                              padding: '0.15rem 0.35rem',
                              fontSize: '0.55rem',
                              borderRadius: '4px',
                              border: 'none',
                              fontWeight: '700',
                              fontFamily: 'var(--font-mono)'
                            }}
                          >
                            {t.substring(0,4).toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {mobileActiveFx === 'delay' && (
                  <div className="mobile-fx-module">
                    <div className="mobile-fx-header">
                      <span>TIME-ECHO DELAY</span>
                      <button 
                        className={`mobile-fx-bypass-btn ${fxEnabled.delay ? 'active' : ''}`}
                        onClick={() => handleFxToggle('delay')}
                      >
                        {fxEnabled.delay ? 'ACTIVE' : 'BYPASS'}
                      </button>
                    </div>
                    <div className="mobile-fx-knobs">
                      <Knob 
                        label="Time"
                        value={getAutomatedFxValue('delay', 'time', fxParams.delay.time)}
                        min={0.05}
                        max={1.0}
                        defaultValue={0.3}
                        onChange={(val) => handleFxParamChange('delay', 'time', val)}
                        valueDisplayFormatter={v => `${Math.round(v * 1000)}ms`}
                        isAutomated={getFxAutomationInfo('delay', 'time').isAutomated}
                        onClearAutomation={getFxAutomationInfo('delay', 'time').onClearAutomation}
                        midiCc={midiManager.getCcMappingForParam(-1, 'delayTime')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'delayTime')}
                        onMidiLearn={() => handleMidiLearn(-1, 'delayTime')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'delayTime'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'delayTime')}
                      />
                      <Knob 
                        label="Feedback"
                        value={getAutomatedFxValue('delay', 'feedback', fxParams.delay.feedback)}
                        min={0.0}
                        max={0.9}
                        defaultValue={0.4}
                        onChange={(val) => handleFxParamChange('delay', 'feedback', val)}
                        valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                        isAutomated={getFxAutomationInfo('delay', 'feedback').isAutomated}
                        onClearAutomation={getFxAutomationInfo('delay', 'feedback').onClearAutomation}
                        midiCc={midiManager.getCcMappingForParam(-1, 'delayFeedback')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'delayFeedback')}
                        onMidiLearn={() => handleMidiLearn(-1, 'delayFeedback')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'delayFeedback'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'delayFeedback')}
                      />
                      <Knob 
                        label="Mix"
                        value={getAutomatedFxValue('delay', 'mix', fxParams.delay.mix)}
                        min={0.0}
                        max={1.0}
                        defaultValue={0.3}
                        onChange={(val) => handleFxParamChange('delay', 'mix', val)}
                        valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                        isAutomated={getFxAutomationInfo('delay', 'mix').isAutomated}
                        onClearAutomation={getFxAutomationInfo('delay', 'mix').onClearAutomation}
                        midiCc={midiManager.getCcMappingForParam(-1, 'delayMix')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'delayMix')}
                        onMidiLearn={() => handleMidiLearn(-1, 'delayMix')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'delayMix'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'delayMix')}
                      />
                    </div>
                  </div>
                )}

                {mobileActiveFx === 'reverb' && (
                  <div className="mobile-fx-module">
                    <div className="mobile-fx-header">
                      <span>SPATIAL REVERB</span>
                      <button 
                        className={`mobile-fx-bypass-btn ${fxEnabled.reverb ? 'active' : ''}`}
                        onClick={() => handleFxToggle('reverb')}
                      >
                        {fxEnabled.reverb ? 'ACTIVE' : 'BYPASS'}
                      </button>
                    </div>
                    <div className="mobile-fx-knobs">
                      <Knob 
                        label="Decay"
                        value={getAutomatedFxValue('reverb', 'decay', fxParams.reverb.decay)}
                        min={0.2}
                        max={4.0}
                        defaultValue={1.5}
                        onChange={(val) => handleFxParamChange('reverb', 'decay', val)}
                        valueDisplayFormatter={v => `${v.toFixed(1)}s`}
                        isAutomated={getFxAutomationInfo('reverb', 'decay').isAutomated}
                        onClearAutomation={getFxAutomationInfo('reverb', 'decay').onClearAutomation}
                        midiCc={midiManager.getCcMappingForParam(-1, 'reverbDecay')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'reverbDecay')}
                        onMidiLearn={() => handleMidiLearn(-1, 'reverbDecay')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'reverbDecay'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'reverbDecay')}
                      />
                      <Knob 
                        label="Mix"
                        value={getAutomatedFxValue('reverb', 'mix', fxParams.reverb.mix)}
                        min={0.0}
                        max={1.0}
                        defaultValue={0.2}
                        onChange={(val) => handleFxParamChange('reverb', 'mix', val)}
                        valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                        isAutomated={getFxAutomationInfo('reverb', 'mix').isAutomated}
                        onClearAutomation={getFxAutomationInfo('reverb', 'mix').onClearAutomation}
                        midiCc={midiManager.getCcMappingForParam(-1, 'reverbMix')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'reverbMix')}
                        onMidiLearn={() => handleMidiLearn(-1, 'reverbMix')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'reverbMix'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'reverbMix')}
                      />
                    </div>
                  </div>
                )}

                {mobileActiveFx === 'sidechain' && (
                  <div className="mobile-fx-module">
                    <div className="mobile-fx-header">
                      <span>SIDECHAIN DUCKER</span>
                      <button 
                        className={`mobile-fx-bypass-btn ${fxEnabled.sidechain ? 'active' : ''}`}
                        onClick={() => handleFxToggle('sidechain')}
                      >
                        {fxEnabled.sidechain ? 'ACTIVE' : 'BYPASS'}
                      </button>
                    </div>
                    <div className="mobile-fx-knobs">
                      <Knob 
                        label="Ratio"
                        value={fxParams.sidechain.ratio}
                        min={0.0}
                        max={1.0}
                        defaultValue={0.6}
                        onChange={(val) => handleFxParamChange('sidechain', 'ratio', val)}
                        valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                        midiCc={midiManager.getCcMappingForParam(-1, 'sidechainRatio')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'sidechainRatio')}
                        onMidiLearn={() => handleMidiLearn(-1, 'sidechainRatio')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'sidechainRatio'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'sidechainRatio')}
                      />
                      <Knob 
                        label="Attack"
                        value={fxParams.sidechain.attack}
                        min={0.002}
                        max={0.1}
                        defaultValue={0.05}
                        onChange={(val) => handleFxParamChange('sidechain', 'attack', val)}
                        valueDisplayFormatter={v => `${Math.round(v * 1000)}ms`}
                        midiCc={midiManager.getCcMappingForParam(-1, 'sidechainAttack')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'sidechainAttack')}
                        onMidiLearn={() => handleMidiLearn(-1, 'sidechainAttack')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'sidechainAttack'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'sidechainAttack')}
                      />
                      <Knob 
                        label="Release"
                        value={fxParams.sidechain.release}
                        min={0.02}
                        max={1.0}
                        defaultValue={0.2}
                        onChange={(val) => handleFxParamChange('sidechain', 'release', val)}
                        valueDisplayFormatter={v => `${Math.round(v * 1000)}ms`}
                        midiCc={midiManager.getCcMappingForParam(-1, 'sidechainRelease')}
                        showMidiCcOverlay={showMidiCcOverlay}
                        onContextMenu={(e) => handleKnobContextMenu(e, -1, 'sidechainRelease')}
                        onMidiLearn={() => handleMidiLearn(-1, 'sidechainRelease')}
                        isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'sidechainRelease'}
                        onMidiUnbind={() => handleMidiUnbind(-1, 'sidechainRelease')}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.4rem' }}>
                <button
                  onClick={handleClearFxAutomation}
                  className="mobile-util-btn"
                  style={{
                    backgroundColor: 'rgba(224, 108, 67, 0.1)',
                    color: 'var(--accent-orange)',
                    borderColor: 'rgba(224, 108, 67, 0.2)',
                    fontSize: '0.6rem',
                    padding: '0.2rem 0.5rem',
                    height: 'auto',
                    borderRadius: '5px',
                    fontWeight: '700'
                  }}
                >
                  WIPE ALL FX AUTOMATION
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Minimal immersive mobile footer */}
        <footer className="mobile-footer">
          <span>SWING: {Math.round(swing * 100)}%</span>
          <span>PHYZIX S&B V1.6.0</span>
        </footer>

        {/* Floating immersive manual overlay */}
        {showManual && (
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              background: 'rgba(43, 41, 39, 0.65)',
              backdropFilter: 'blur(5px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '0.75rem'
            }}
            onClick={() => setShowManual(false)}
          >
            <div 
              style={{
                background: 'rgba(247, 246, 240, 0.98)',
                border: '2px solid var(--border-medium)',
                borderRadius: '16px',
                padding: '1.25rem 1rem 1rem',
                width: '100%',
                height: '85vh',
                maxHeight: '90vh',
                boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-medium)', paddingBottom: '0.4rem', flexShrink: 0 }}>
                <span style={{ background: 'var(--accent-orange)15', color: 'var(--accent-orange)', fontSize: '0.65rem', fontWeight: '800', padding: '0.1rem 0.4rem', borderRadius: '4px', fontFamily: 'var(--font-mono)' }}>OPERATIONS MANUAL</span>
                <button onClick={() => setShowManual(false)} style={{ background: 'transparent', border: 'none', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
              </div>

              {/* Navigation strip inside manual modal */}
              <div style={{ display: 'flex', gap: '0.2rem', overflowX: 'auto', paddingBottom: '0.2rem', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
                {['quickstart', 'synth', 'sequencing', 'effects', 'presets'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setManualTab(tab)}
                    style={{
                      padding: '0.2rem 0.5rem',
                      fontSize: '0.6rem',
                      fontWeight: '800',
                      borderRadius: '4px',
                      border: 'none',
                      background: manualTab === tab ? 'var(--accent-orange)' : 'rgba(0,0,0,0.04)',
                      color: manualTab === tab ? 'white' : 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {tab.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Scrollable text section optimized for touch reading */}
              <div style={{ flexGrow: 1, overflowY: 'auto', fontSize: '0.72rem', lineHeight: '1.4', paddingRight: '0.25rem', fontFamily: 'var(--font-sans)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {manualTab === 'quickstart' && (
                  <>
                    <h3 style={{ margin: 0, fontSize: '0.8rem', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.3rem', fontFamily: 'var(--font-mono)' }}>⚡ QUICK START GUIDE</h3>
                    <p style={{ margin: 0 }}>
                      The Slams & Bams instrument (part of the Phyzix series) is an immersive synthesized drum studio. Here is how to create a beat in under 60 seconds on mobile:
                    </p>
                    <ol style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>Go to the **DRUMS** tab. Tap different voice pads (Kick, Snare, Closed Hat) at the top to audition and explore their neomorphic synthesis dials.</li>
                      <li>Go to the **SEQUENCER** tab. Choose an active drum (e.g. Kick) and tap steps (1, 5, 9, 13) to punch in active drum triggers.</li>
                      <li>Tap the transport **PLAY** button in the header transport to listen to your beat loops.</li>
                      <li>Go to **EFFECTS** to apply heavy filters, Bitcrusher grit, or saturator drive!</li>
                    </ol>
                  </>
                )}

                {manualTab === 'synth' && (
                  <>
                    <h3 style={{ margin: 0, fontSize: '0.8rem', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.3rem', fontFamily: 'var(--font-mono)' }}>🎛️ SYNTHESIS ENGINES</h3>
                    <p style={{ margin: 0 }}>
                      All 11 drum tracks are custom analog models built natively with Web Audio API nodes:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>**Kick**: Deep analog sine wave pitch sweep with distortion.</li>
                      <li>**Snare**: Resonant filtered noise band with snappy decay.</li>
                      <li>**Hats (Closed/Open)**: Ring-modulated metallic high pass frequencies.</li>
                      <li>**Ride**: Metallic FM voice with ringing tail.</li>
                      <li>**Clap**: Triggered noise bursts with decay.</li>
                      <li>**Toms/Beep/Blip/Bloop**: Pitch swept oscillators. Excellent for step pitch bend recording!</li>
                    </ul>
                  </>
                )}

                {manualTab === 'sequencing' && (
                  <>
                    <h3 style={{ margin: 0, fontSize: '0.8rem', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.3rem', fontFamily: 'var(--font-mono)' }}>🥁 SEQUENCING & AUTOMATION</h3>
                    <p style={{ margin: 0 }}>
                      Phyzix supports step sequencing and recorded motion automation:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>**Piano Roll**: Provides a birds-eye grid of all 12 instruments, with tactile volume velocity bars directly below.</li>
                      <li>**Step Pitch bends**: Swipe sliders on the SEQUENCER tab for Toms, Beeps, Blips, and Bloops to pitch-bend hits.</li>
                      <li>**Dial Motion Recording**: Turn **MOTION REC** on, press **PLAY**, and sweep any neomorphic dial. Your motion loop is recorded and will animate on screen!</li>
                    </ul>
                  </>
                )}

                {manualTab === 'effects' && (
                  <>
                    <h3 style={{ margin: 0, fontSize: '0.8rem', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.3rem', fontFamily: 'var(--font-mono)' }}>🎚️ MODULAR DSP EFFECTS</h3>
                    <p style={{ margin: 0 }}>
                      Route your master sound through 5 universal effects and 1 global Bitcrusher:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>**Bitcrusher**: Heavy quantization bits noise, downsampling aliasing, and dry/wet Mix blending. Individual tracks can bypass the Bitcrusher using their **BYP ON** / **CRUNCH** bypass toggle buttons in their card footers.</li>
                      <li>**Saturator**: Overdriven waveshaper compression.</li>
                      <li>**Filter**: Stereo Lowpass, Highpass, Bandpass, Comb, Formant, Ring Mod, Phaser, 24dB LP, Notch, and Peaking EQ filter with resonance sweeping.</li>
                      <li>**Delay**: Low-pass feedback delay lines for echos.</li>
                      <li>**Sidechain Compressor**: Automatically ducks other frequencies when the Kick triggers!</li>
                    </ul>
                  </>
                )}

                {manualTab === 'presets' && (
                  <>
                    <h3 style={{ margin: 0, fontSize: '0.8rem', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.3rem', fontFamily: 'var(--font-mono)' }}>💾 PRESETS (.PSNB)</h3>
                    <p style={{ margin: 0 }}>
                      Save your work externally using our proprietary `.psnb` file presets:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>Captures all 12-track gate triggers, velocities, and note accents.</li>
                      <li>Saves all custom dial values, instrument modes, and Bitcrusher parameters.</li>
                      <li>Saves modular FX routing order, dry/wet level mixes, and all recorded step automation sweeps.</li>
                      <li>Click **EXPORT** to download your preset, or **IMPORT** to restore a file instantly!</li>
                    </ul>
                  </>
                )}
              </div>

              {/* Close footer button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-medium)', paddingTop: '0.5rem', flexShrink: 0 }}>
                <button 
                  onClick={() => setShowManual(false)}
                  style={{
                    background: 'var(--text-primary)',
                    border: 'none',
                    color: 'white',
                    borderRadius: '6px',
                    padding: '0.3rem 1.25rem',
                    fontSize: '0.65rem',
                    fontWeight: '700',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer'
                  }}
                >
                  CLOSE MANUAL
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Viewport-based responsive guard
  if (isMobile) {
    return renderMobileLayout();
  }

  return (
    <div className="app-container">
      {/* Sticky Header & Control Bar Container */}
      <div className="sticky-top-bar">
        {/* 1. Branded Header */}
        <header className="app-header" style={{ display: 'flex', justifyContent: 'space-between', borderBottom: 'none', paddingBottom: '0.25rem' }}>
        <div className="brand-section">
          <h1 className="brand-title">
            <Radio size={28} color="var(--accent-orange)" />
            Phyzix: Slams and Bams
          </h1>
          <span className="brand-subtitle">Analog Synthesized Drum Grid Sequencer</span>
          <button 
            onClick={() => {
              setShowManual(true);
              logSession("Opened operations manual overlay modal.", "INFO");
            }}
            style={{ 
              marginLeft: '1.2rem', 
              padding: '0.25rem 0.6rem', 
              fontSize: '0.65rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.3rem',
              fontWeight: '700',
              fontFamily: 'var(--font-mono)',
              background: 'rgba(255, 255, 255, 0.6)',
              border: '1.2px solid var(--border-medium)',
              borderRadius: '6px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
            }}
            title="Open interactive operations manual for the drum machine"
          >
            <HelpCircle size={11} color="var(--accent-orange)" />
            MANUAL
          </button>
        </div>

        {/* Slam the Door Control Center */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.8rem',
          margin: '0 1rem',
          padding: '0.2rem 0.5rem',
          border: '1.2px solid var(--border-medium)',
          borderRadius: '10px',
          background: 'rgba(255, 255, 255, 0.4)'
        }}>
          <button
            onMouseDown={handleSlamMouseDown}
            onMouseUp={handleSlamMouseUp}
            onMouseLeave={handleSlamMouseLeave}
            onTouchStart={handleSlamTouchStart}
            onTouchEnd={handleSlamTouchEnd}
            onClick={handleSlamClick}
            className={isSlamPending ? 'slam-pending' : ''}
            style={{
              width: '42px',
              height: '42px',
              background: isSlamPending 
                ? 'linear-gradient(135deg, #f1c40f, #e67e22)' 
                : (isSlamActive ? 'linear-gradient(135deg, #d35400, #e67e22)' : 'linear-gradient(135deg, #e67e22, #f39c12)'),
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              cursor: 'pointer',
              boxShadow: isSlamActive 
                ? 'inset 0 3px 5px rgba(0,0,0,0.2), 0 0 10px rgba(230, 126, 34, 0.4)' 
                : '0 4px 6px rgba(230, 126, 34, 0.15), 0 2px 4px rgba(0,0,0,0.05)',
              transform: isSlamActive ? 'scale(0.95)' : 'scale(1)',
              transition: 'all 0.1s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title={isSlamPending ? 'Pending beat boundary...' : 'Slam the Door (Filter/Compressor)'}
          >
            <Radio size={18} color="white" style={{ animation: (isSlamActive || isSlamPending) ? 'pulse 0.5s infinite alternate' : 'none' }} />
          </button>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              fontSize: '0.65rem',
              fontWeight: '700',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              userSelect: 'none'
            }}>
              <input
                type="checkbox"
                checked={isSlamLatched}
                onChange={(e) => {
                  const latched = e.target.checked;
                  setIsSlamLatched(latched);
                  if (!latched && isSlamActive) {
                    setIsSlamActive(false);
                    audioEngine.setSlamTheDoor(false);
                    logSession("Latched Door Slam released.", "INFO");
                  }
                }}
                style={{
                  accentColor: 'var(--accent-orange)',
                  cursor: 'pointer'
                }}
              />
              LATCH
            </label>
            
            <select
              value={doorType}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setDoorType(val);
                audioEngine.setDoorType(val);
              }}
              style={{
                background: 'white',
                border: '1.2px solid var(--border-medium)',
                borderRadius: '4px',
                padding: '0.1rem 0.2rem',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.6rem',
                fontWeight: '700',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                outline: 'none'
              }}
              title="Select Type of Door (changes filter response)"
            >
              <option value={0}>Hollow Door</option>
              <option value={1}>Heavy Door</option>
              <option value={2}>Aluminum Door</option>
              <option value={3}>Steel Door</option>
              <option value={4}>Glass Door</option>
              <option value={5}>Submarine Hatch</option>
              <option value={6}>Sci-Fi Airlock</option>
              <option value={7}>Cathedral Gate</option>
            </select>
          </div>

          <div style={{ width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Knob 
              label="Mix"
              value={slamMix}
              min={0.0}
              max={1.0}
              defaultValue={1.0}
              onChange={(val) => {
                setSlamMix(val);
                audioEngine.setSlamMix(val);
              }}
              valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
              tooltip="Dry/wet blend of the Slam filter and compressor"
              midiCc={midiManager.getCcMappingForParam(-1, 'slamMix')}
              showMidiCcOverlay={showMidiCcOverlay}
              onContextMenu={(e) => handleKnobContextMenu(e, -1, 'slamMix')}
              onMidiLearn={() => handleMidiLearn(-1, 'slamMix')}
              isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'slamMix'}
              onMidiUnbind={() => handleMidiUnbind(-1, 'slamMix')}
            />
          </div>
        </div>

        {/* Playback Controls Toolbar */}
        <div className="header-right">
          <div className="transport-panel">
            <button 
              className={`btn ${isPlaying ? 'btn-active' : 'btn-primary'}`} 
              onClick={togglePlay}
            >
              {isPlaying ? <Square size={14} fill="var(--accent-teal)" /> : <Play size={14} fill="white" />}
              {isPlaying ? 'STOP' : 'PLAY'}
            </button>
            <button 
              className={`btn ${isSessionRecording ? 'btn-active' : 'btn-secondary'}`} 
              onClick={toggleSessionRecording}
              style={{
                marginLeft: '0.4rem',
                background: isSessionRecording ? 'var(--accent-orange)' : 'var(--text-secondary)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
              title="Record the master post-FX stereo session and export as WAV"
            >
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: isSessionRecording ? '#ffffff' : '#e74c3c' }}></span>
              {isSessionRecording ? 'STOP REC' : 'REC SESSION'}
            </button>

            {/* Swing Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRight: '1px solid var(--border-light)', paddingRight: '0.5rem', marginRight: '0.25rem' }}>
              <Knob
                label="Swing"
                value={swing}
                min={0}
                max={1}
                defaultValue={0.0}
                onChange={(val) => {
                  setSwing(val);
                  audioEngine.swing = val;
                  localStorage.setItem("phyzix_swing", val.toString());
                }}
                valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                tooltip="Applies late-16th note delay to produce an organic human swing groove."
                midiCc={midiManager.getCcMappingForParam(-1, 'swing')}
                showMidiCcOverlay={showMidiCcOverlay}
                onContextMenu={(e) => handleKnobContextMenu(e, -1, 'swing')}
                onMidiLearn={() => handleMidiLearn(-1, 'swing')}
                isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'swing'}
                onMidiUnbind={() => handleMidiUnbind(-1, 'swing')}
              />
            </div>

            <div className="bpm-display">
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>BPM:</span>
              <input 
                type="number" 
                className="bpm-input"
                value={bpm} 
                onChange={handleBpmChange}
                min="40"
                max="240"
              />
            </div>

            <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Steps:</span>
              <select 
                value={stepsCount} 
                onChange={(e) => handleStepsCountChange(parseInt(e.target.value, 10))}
                style={{
                  background: 'white',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '6px',
                  padding: '0.2rem 0.4rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  cursor: 'pointer'
                }}
              >
                {[8, 12, 16, 24, 32, 48, 64].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Time Signature Selector */}
            <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center', marginLeft: '0.25rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Time Sig:</span>
              <select
                value={timeSignature}
                onChange={(e) => handleTimeSignatureChange(e.target.value)}
                style={{
                  background: 'white',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '6px',
                  padding: '0.2rem 0.4rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  fontWeight: '700'
                }}
                title="Select time signature metric to adjust step layouts and dividers"
              >
                <option value="4/4">4/4 Time</option>
                <option value="3/4">3/4 Time</option>
                <option value="5/4">5/4 Time</option>
                <option value="6/8">6/8 Time</option>
              </select>
            </div>

            {/* Master Volume Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderLeft: '1px solid var(--border-light)', paddingLeft: '0.5rem', marginLeft: '0.25rem' }}>
              <Knob
                label="Master"
                value={masterVolume}
                min={0}
                max={1.5}
                defaultValue={0.75}
                onChange={(val) => {
                  setMasterVolume(val);
                }}
                valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                tooltip="Adjusts the global master output gain level of the synthesizer (0% to 150%)."
                midiCc={midiManager.getCcMappingForParam(-1, 'masterVolume')}
                showMidiCcOverlay={showMidiCcOverlay}
                onContextMenu={(e) => handleKnobContextMenu(e, -1, 'masterVolume')}
                onMidiLearn={() => handleMidiLearn(-1, 'masterVolume')}
                isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'masterVolume'}
                onMidiUnbind={() => handleMidiUnbind(-1, 'masterVolume')}
              />
            </div>
          </div>
        </div>
      </header>

      {/* 1.5. NEOMORPHIC STUDIO TOOLBAR */}
      <section 
        className="studio-toolbar"
        style={{
          background: 'rgba(255, 255, 255, 0.45)',
          border: '1.5px solid var(--border-light)',
          borderRadius: '12px',
          padding: '0.55rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          boxShadow: 'var(--shadow-sm)',
          width: '100%',
          marginBottom: '0.75rem',
          flexWrap: 'wrap'
        }}
      >
        {/* Left: Momentary Drum Fills Panel */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.55rem', fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--text-secondary)' }}>MOMENTARY DRUM FILL OVERRIDE</span>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.15rem' }}>
              {/* Momentary Fill Button */}
              <button
                className={`btn ${fillActive ? 'btn-active' : ''}`}
                onMouseDown={startFill}
                onMouseUp={stopFill}
                onMouseLeave={stopFill}
                onTouchStart={startFill}
                onTouchEnd={stopFill}
                style={{
                  fontSize: '0.7rem',
                  fontWeight: '700',
                  padding: '0.25rem 0.6rem',
                  cursor: 'pointer',
                  backgroundColor: fillActive ? 'var(--accent-orange)' : 'rgba(255,255,255,0.7)',
                  color: fillActive ? '#ffffff' : 'var(--text-primary)',
                  boxShadow: fillActive ? '0 0 10px var(--accent-orange-glow)' : 'var(--shadow-sm)',
                  border: '1.2px solid var(--border-medium)',
                  borderRadius: '6px',
                  userSelect: 'none',
                  minWidth: '70px',
                  textAlign: 'center'
                }}
                title="Hold to overlay live drum fill pattern (Traditional, Glitch, Stutter, Half-Speed Break)"
              >
                FILL
              </button>

              {/* Fill Pattern Dropdown */}
              <select
                value={fillPattern}
                onChange={(e) => {
                  const val = e.target.value;
                  setFillPattern(val);
                  audioEngine.fillPattern = val;
                }}
                style={{
                  background: 'white',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '6px',
                  padding: '0.2rem 0.4rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  cursor: 'pointer'
                }}
                title="Select fill rhythm character"
              >
                <option value="traditional_a">Traditional: Snare Roll</option>
                <option value="traditional_b">Traditional: Tom Build</option>
                <option value="glitch">Glitch: 32nd Note Chaos</option>
                <option value="stutter">Stutter: Focus Repeat</option>
                <option value="half_tempo">Half-Tempo Breakbeat</option>
                <option value="crescendo">Crescendo: Snare & Tom Build</option>
                <option value="pitch_rise">Pitch Rise: Resonant Stutter</option>
                <option value="melodic_run">Melodic Run: Step Lead</option>
                <option value="drum_n_bass_crossover">DnB Crossover: Breakbeat</option>
                <option value="dynamic_decay">Dynamic Decay: Filter Sweep</option>
                <option value="chaos_sweep">Chaos Sweep: Rand FX Mod</option>
              </select>

              {/* SHOW MIDI CC Toggle Button */}
              <button
                onClick={() => setShowMidiCcOverlay(!showMidiCcOverlay)}
                style={{
                  padding: '0.2rem 0.45rem',
                  fontSize: '0.65rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: '700',
                  background: showMidiCcOverlay ? 'rgba(230, 126, 34, 0.15)' : 'rgba(255,255,255,0.7)',
                  color: showMidiCcOverlay ? 'var(--accent-orange)' : 'var(--text-secondary)',
                  border: `1.2px solid ${showMidiCcOverlay ? 'var(--accent-orange)' : 'var(--border-medium)'}`,
                  borderRadius: '5px',
                  cursor: 'pointer'
                }}
                title="Toggle MIDI CC overlay badges on controls"
              >
                {showMidiCcOverlay ? 'HIDE MIDI CC' : 'SHOW MIDI CC'}
              </button>
            </div>
          </div>
        </div>

        {/* Factory Presets Panel */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.55rem', fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--text-secondary)' }}>FACTORY DRUM PRESETS</span>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.15rem' }}>
              <select
                onChange={(e) => {
                  const val = e.target.value;
                  if (val !== "") {
                    recallFactoryPreset(parseInt(val, 10));
                  }
                }}
                defaultValue=""
                style={{
                  background: 'white',
                  border: '1.5px solid var(--accent-orange)',
                  borderRadius: '6px',
                  padding: '0.2rem 0.4rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  color: 'var(--accent-orange)',
                  cursor: 'pointer',
                  outline: 'none',
                  boxShadow: 'var(--shadow-sm)',
                  minWidth: '180px'
                }}
                title="Recall professional vintage / modern synthesizer drum presets"
              >
                <option value="" disabled style={{ color: 'var(--text-muted)' }}>-- SELECT FACTORY PRESET --</option>
                {FACTORY_PRESETS.map((preset, idx) => (
                  <option key={idx} value={idx}>{preset.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Center: Pattern Preset Saving/Recalling */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.55rem', fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--text-secondary)' }}>USER PRESET PATTERNS SAVE / LOAD</span>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.15rem' }}>
              {/* Name Input */}
              <input
                type="text"
                value={patternInputName}
                onChange={(e) => setPatternInputName(e.target.value)}
                placeholder="Pattern Name..."
                style={{
                  background: 'white',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '6px',
                  padding: '0.2rem 0.4rem',
                  fontSize: '0.75rem',
                  width: '120px',
                  outline: 'none'
                }}
                title="Enter name for your custom pattern preset"
              />

              {/* Save Button */}
              <button
                onClick={triggerSavePattern}
                className="btn"
                style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', height: 'auto', fontWeight: '700' }}
                title="Save current sequencer grid, BPM, swing, and pitches to local storage"
              >
                SAVE
              </button>

              {/* Load preset dropdown */}
              <select
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  if (val !== "") {
                    recallUserPattern(parseInt(val, 10));
                  }
                }}
                style={{
                  background: 'white',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '6px',
                  padding: '0.2rem 0.4rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  maxWidth: '120px'
                }}
                title="Load previously saved user pattern preset"
              >
                <option value="">-- LOAD PRESET --</option>
                {userPatterns.map((pat, idx) => (
                  <option key={idx} value={idx}>{pat.name}</option>
                ))}
              </select>

              {/* Proprietary PSNB Exporter */}
              <button
                onClick={exportPatternPSNB}
                className="btn btn-premium"
                style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', height: 'auto', fontWeight: '700', background: 'var(--accent-orange)', color: 'white', border: 'none' }}
                title="Export complete pattern configuration (.PSNB) with all dial settings, velocities, and automation sweeps"
              >
                <Download size={11} />
                EXPORT PATTERN
              </button>

              {/* Proprietary PSNB Importer */}
              <button
                onClick={() => psnbInputRef.current && psnbInputRef.current.click()}
                className="btn"
                style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', height: 'auto', fontWeight: '700' }}
                title="Import a previously saved .PSNB pattern configuration file"
              >
                <Upload size={11} />
                IMPORT PATTERN
              </button>

              <input 
                type="file"
                ref={psnbInputRef}
                onChange={handleImportPSNB}
                accept=".psnb"
                style={{ display: 'none' }}
              />
            </div>
          </div>
        </div>

        {/* Right: Randomizer & MIDI Exporter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {/* Pattern Randomizer */}
          <button
            onClick={randomizeFocusedTrack}
            className="btn"
            style={{ 
              fontSize: '0.7rem', 
              fontWeight: '700', 
              padding: '0.25rem 0.6rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.25rem',
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              border: '1.2px solid var(--border-medium)'
            }}
            title="Populate random hits and pitches for focused track"
          >
            <Shuffle size={11} color="var(--accent-teal)" />
            RANDOMIZE TRACK
          </button>

          {/* Randomize Pattern Button */}
          <button
            onClick={randomizePattern}
            className="btn btn-premium"
            style={{ 
              fontSize: '0.7rem', 
              fontWeight: '700', 
              padding: '0.25rem 0.6rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.25rem',
              backgroundColor: 'var(--accent-orange)',
              color: 'white',
              border: 'none'
            }}
            title="Populate random hits and pitches across all 12 tracks simultaneously"
          >
            <Sparkles size={11} color="white" />
            RANDOMIZE PATTERN
          </button>

          {/* MIDI Export */}
          <button
            onClick={triggerMidiExport}
            className="btn"
            style={{ 
              fontSize: '0.7rem', 
              fontWeight: '700', 
              padding: '0.25rem 0.6rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.25rem',
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              border: '1.2px solid var(--border-medium)'
            }}
            title="Download Standard MIDI File (.mid) of the current pattern mapped to GM channel 10"
          >
            <Sparkles size={11} color="var(--accent-orange)" />
            EXPORT MIDI (.MID)
          </button>
        </div>
      </section>

      {/* 2. PROMINENT 3-BAND FREQUENCY-SPLIT OSCILLOSCOPE GRID BANNER (ON TOP) */}
      <section 
        className="visualizer-card"
        style={{
          background: 'rgba(255, 255, 255, 0.45)',
          border: '1.5px solid var(--border-light)',
          borderRadius: '12px',
          padding: '0.55rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
          boxShadow: 'var(--shadow-sm)',
          width: '100%'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 0.25rem', fontSize: '0.65rem', fontWeight: '700', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          <span>NATIVE 3-BAND CROSSOVER OSCILLOSCOPE ANALYSER</span>
          <span style={{ color: isPlaying ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
            {isPlaying ? 'ACTIVE DSP STREAM' : 'CLOCK STATIONARY'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', width: '100%' }}>
          {/* A. Lows Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', fontFamily: 'var(--font-mono)', fontWeight: '700', color: '#e06c43', padding: '0 0.1rem' }}>
              <span>SUB / BASS (LOWS)</span>
              <span>&lt; 180 Hz</span>
            </div>
            <canvas 
              ref={lowsCanvasRef} 
              style={{ 
                width: '100%', 
                height: '46px', 
                borderRadius: '8px', 
                background: 'rgba(255,255,255,0.4)', 
                border: '1px solid rgba(0,0,0,0.03)' 
              }} 
            />
          </div>

          {/* B. Mids Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', fontFamily: 'var(--font-mono)', fontWeight: '700', color: '#43bda6', padding: '0 0.1rem' }}>
              <span>CLAP / SNARE / CORE (MIDS)</span>
              <span>180 Hz - 3.5 kHz</span>
            </div>
            <canvas 
              ref={midsCanvasRef} 
              style={{ 
                width: '100%', 
                height: '46px', 
                borderRadius: '8px', 
                background: 'rgba(255,255,255,0.4)', 
                border: '1px solid rgba(0,0,0,0.03)' 
              }} 
            />
          </div>

          {/* C. Highs Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', fontFamily: 'var(--font-mono)', fontWeight: '700', color: '#439ebd', padding: '0 0.1rem' }}>
              <span>HAT / CYMBAL / BRASS (HIGHS)</span>
              <span>&gt; 3.5 kHz</span>
            </div>
            <canvas 
              ref={highsCanvasRef} 
              style={{ 
                width: '100%', 
                height: '46px', 
                borderRadius: '8px', 
                background: 'rgba(255,255,255,0.4)', 
                border: '1px solid rgba(0,0,0,0.03)' 
              }} 
            />
          </div>
        </div>
      </section>
    </div>

      {/* 3. Utility Actions Toolbar & Page Navigator */}
      {/* 3. Integrated Playback Editor Group (Tabs & Active Panel Grouped Together) */}
      <section 
        className="playback-editor-group"  
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          background: 'rgba(255, 255, 255, 0.45)',
          border: '1.5px solid var(--border-light)',
          borderRadius: '16px',
          padding: '1.25rem',
          boxShadow: 'var(--shadow-md)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          width: '100%',
          marginTop: '1.25rem',
          transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header containing Tab Selector & Utility Actions */}
        <div 
          className="editor-group-header" 
          style={{ 
            display: 'flex', 
            flexWrap: 'wrap',
            justifyContent: 'space-between', 
            alignItems: 'center', 
            gap: '1rem',
            borderBottom: !isEditorCollapsed ? '1px solid var(--border-light)' : 'none',
            paddingBottom: !isEditorCollapsed ? '0.75rem' : '0',
            transition: 'padding 0.3s ease, border 0.3s ease'
          }}
        >
          <div className="page-tabs-container">
            <button 
              className={`tab-btn ${activePage === 'grid' ? 'active' : ''}`} 
              onClick={() => {
                setActivePage('grid');
                logSession("Swapped view tab: GRID SEQUENCER", "INFO");
              }}
              style={{
                background: activePage === 'grid' && !isEditorCollapsed ? '#ffffff' : 'transparent',
                boxShadow: activePage === 'grid' && !isEditorCollapsed ? 'var(--shadow-sm)' : 'none',
                fontWeight: activePage === 'grid' ? '800' : '600',
                color: activePage === 'grid' && !isEditorCollapsed ? 'var(--accent-orange)' : 'var(--text-secondary)'
              }}
            >
              GRID SEQUENCER
            </button>
            <button 
              className={`tab-btn ${activePage === 'piano' ? 'active' : ''}`} 
              onClick={() => {
                setActivePage('piano');
                logSession("Swapped view tab: PIANO ROLL", "INFO");
              }}
              style={{
                background: activePage === 'piano' && !isEditorCollapsed ? '#ffffff' : 'transparent',
                boxShadow: activePage === 'piano' && !isEditorCollapsed ? 'var(--shadow-sm)' : 'none',
                fontWeight: activePage === 'piano' ? '800' : '600',
                color: activePage === 'piano' && !isEditorCollapsed ? 'var(--accent-orange)' : 'var(--text-secondary)'
              }}
            >
              PIANO ROLL
            </button>
            <button 
              className={`tab-btn ${activePage === 'fx' ? 'active' : ''}`} 
              onClick={() => {
                setActivePage('fx');
                logSession("Swapped view tab: UNIVERSAL EFFECTS", "INFO");
              }}
              style={{
                background: activePage === 'fx' && !isEditorCollapsed ? '#ffffff' : 'transparent',
                boxShadow: activePage === 'fx' && !isEditorCollapsed ? 'var(--shadow-sm)' : 'none',
                fontWeight: activePage === 'fx' ? '800' : '600',
                color: activePage === 'fx' && !isEditorCollapsed ? 'var(--accent-orange)' : 'var(--text-secondary)'
              }}
            >
              UNIVERSAL EFFECTS
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
              className={`btn ${isStepRecording ? 'btn-active' : ''}`}
              onClick={() => setIsStepRecording(!isStepRecording)}
              title="Step recording inserts triggers at marker when playing pads / MIDI notes"
            >
              <Activity size={14} />
              Step Record {isStepRecording ? 'ON' : 'OFF'}
            </button>

            <button 
              className={`btn ${isRecordingPitch ? 'btn-active' : ''}`}
              onClick={() => setIsRecordingPitch(!isRecordingPitch)}
              title="When active, turning any knob during playback live records dial motion to steps"
            >
              <Sliders size={14} />
              Record Motion {isRecordingPitch ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* MIDI and Dials Utilities */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
              <div className="midi-status-strip">
                <div 
                  className={`midi-led ${
                    midiLearnTarget !== null ? 'learning' : 
                    midiTrigger ? 'trigger' : 
                    midiConnected ? 'connected' : ''
                  }`} 
                />
                <span>MIDI: {midiStatus}</span>
              </div>

              <button 
                className={`btn ${isEditorCollapsed ? 'btn-active' : ''}`} 
                onClick={() => {
                  setIsEditorCollapsed(!isEditorCollapsed);
                  logSession(`Toggled editor collapse: ${!isEditorCollapsed}`, "INFO");
                }} 
                title="Toggle Collapse/Expand active editor panel"
                style={{
                  background: isEditorCollapsed ? 'var(--accent-orange)' : '',
                  borderColor: isEditorCollapsed ? 'var(--accent-orange)' : '',
                  color: isEditorCollapsed ? 'white' : ''
                }}
              >
                {isEditorCollapsed ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
                {isEditorCollapsed ? 'SHOW EDITOR' : 'COLLAPSE EDITOR'}
              </button>

              <button 
                className={`btn ${isCollapsed ? 'btn-active' : ''}`} 
                onClick={() => setIsCollapsed(!isCollapsed)} 
                title="Toggle Collapsed Drums View for smaller displays"
              >
                {isCollapsed ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
                {isCollapsed ? 'EXPAND DRUMS' : 'COLLAPSE DRUMS'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button className="btn" onClick={handleResetKnobs} title="Reset all instrument parameters">
                <RotateCcw size={12} />
                Reset Dials
              </button>
              <button className="btn" onClick={handleClearGrid} title="Clear all steps in matrix">
                <Trash2 size={12} />
                Clear Grid
              </button>
              <button 
                className="btn btn-premium" 
                onClick={handleClearAllMotion} 
                title="Clear ALL recorded dial and pitch motion automation across the entire project" 
                style={{ background: 'var(--accent-orange)', color: 'white', borderColor: 'var(--accent-orange)' }}
              >
                <Trash2 size={12} color="white" />
                Clear All Motion
              </button>
            </div>
          </div>
        </div>

        {/* Panel Content (Sequencer, Piano Roll, or Modular FX Chain) */}
        {!isEditorCollapsed ? (
          <div className="editor-group-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
            
            {/* 5.5. Page 3: Piano Roll MIDI Editor Tab */}
            {activePage === 'piano' && (
              <section className="master-sequencer-section" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', background: 'transparent', border: 'none', boxShadow: 'none', padding: 0 }}>
          <div className="master-grid-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="master-grid-title" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Activity size={16} color="var(--accent-orange)" />
              <span style={{ fontSize: '0.9rem', fontWeight: '800', fontFamily: 'var(--font-mono)' }}>Piano Roll Editor Matrix</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              EDIT TRIGGERS ACROSS ALL 12 TRACKS • ADJUST VELOCITY LANE BELOW FOR <span style={{ color: activeColor, fontWeight: '700' }}>{INSTRUMENTS[selectedInstrument].name.toUpperCase()}</span>
            </div>
          </div>

          {/* Piano Roll Main Scrollable Grid */}
          <div 
            style={{ 
              background: 'rgba(255, 255, 255, 0.45)',
              border: '1.5px solid var(--border-light)',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-sm)',
              width: '100%'
            }}
          >
            <div style={{ display: 'flex', overflowX: 'auto', width: '100%' }}>
              {/* Vertical Track Headers (Fixed Column) */}
              <div 
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  width: '120px', 
                  borderRight: '1.5px solid var(--border-medium)',
                  background: 'rgba(247, 246, 240, 0.85)',
                  zIndex: 2,
                  flexShrink: 0
                }}
              >
                {INSTRUMENTS.map((inst, idx) => {
                  const isFocused = selectedInstrument === idx;
                  return (
                    <div 
                      key={inst.id}
                      onClick={() => setSelectedInstrument(idx)}
                      style={{
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0 0.5rem',
                        fontSize: '0.7rem',
                        fontWeight: '700',
                        fontFamily: 'var(--font-mono)',
                        borderBottom: '1px solid var(--border-light)',
                        cursor: 'pointer',
                        background: isFocused ? `${inst.color}15` : 'transparent',
                        color: isFocused ? inst.color : 'var(--text-primary)',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: inst.color }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.name}</span>
                    </div>
                  );
                })}
              </div>

              {/* Step Cell Matrix */}
              <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                {INSTRUMENTS.map((inst, trackIdx) => {
                  return (
                    <div 
                      key={inst.id}
                      style={{ 
                        display: 'flex', 
                        height: '32px', 
                        borderBottom: '1px solid var(--border-light)' 
                      }}
                    >
                      {Array.from({ length: stepsCount }).map((_, stepIdx) => {
                        const isActive = gridData[trackIdx][stepIdx];
                        const { isBeatEnd, isOddBeat } = getBeatInfo(stepIdx);
                        const isStepPlaying = currentStep === stepIdx && isPlaying;
                        const rollVal = typeof isActive === 'number' ? isActive : (isActive ? 1 : 0);
                        return (
                          <div
                            key={stepIdx}
                            onClick={() => {
                              const newGrid = gridData.map((row, rIdx) => {
                                  if (rIdx === trackIdx) {
                                    const newRow = [...row];
                                    newRow[stepIdx] = isActive ? false : paintRollValue;
                                    return newRow;
                                  }
                                  return row;
                                });
                                setGridData(newGrid);
                                autoSave(newGrid, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
                                if (!isActive) {
                                  triggerSound(trackIdx);
                                }
                            }}
                            style={{
                              width: '32px',
                              height: '100%',
                              flexShrink: 0,
                              borderRight: `1px solid ${isBeatEnd ? 'var(--border-medium)' : 'rgba(0,0,0,0.03)'}`,
                              background: isStepPlaying 
                                ? 'rgba(224, 108, 67, 0.12)' 
                                : isActive 
                                  ? `${inst.color}30` 
                                  : isOddBeat 
                                    ? 'rgba(0, 0, 0, 0.022)'
                                    : 'transparent',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'background 0.08s ease'
                            }}
                          >
                            {isActive && (
                              <div style={{ display: 'flex', gap: '2px', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', padding: '0 2px' }}>
                                {rollVal > 1 ? (
                                  Array.from({ length: rollVal }).map((_, rIdx) => (
                                    <div 
                                      key={rIdx} 
                                      style={{ 
                                        width: '3px', 
                                        height: '14px', 
                                        borderRadius: '1px', 
                                        backgroundColor: inst.color,
                                        boxShadow: `0 0 3px ${inst.color}aa`
                                      }} 
                                    />
                                  ))
                                ) : (
                                  <div 
                                    style={{ 
                                      width: '18px', 
                                      height: '8px', 
                                      borderRadius: '2px', 
                                      backgroundColor: inst.color,
                                      boxShadow: `0 0 5px ${inst.color}aa`
                                    }} 
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

            </div>
          </div>

          {/* Interactive Velocity Lane */}
          <div 
            style={{
              background: 'rgba(255, 255, 255, 0.45)',
              border: '1.5px solid var(--border-light)',
              borderRadius: '12px',
              padding: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
              boxShadow: 'var(--shadow-sm)',
              width: '100%'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem', fontWeight: '700', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              <span>VELOCITY LANE: {INSTRUMENTS[selectedInstrument].name.toUpperCase()} (DRAG NODES VERTICALLY)</span>
              <span>DEFAULT: 50%</span>
            </div>

            {/* Velocity Sliders Container */}
            <div 
              style={{ 
                display: 'flex', 
                overflowX: 'auto', 
                padding: '0.5rem 0',
                height: '90px',
                alignItems: 'flex-end',
                background: 'rgba(0,0,0,0.01)',
                borderRadius: '8px',
                border: '1px solid var(--border-light)',
                width: '100%'
              }}
            >
              {/* Align with matrix step columns by prefixing space */}
              <div style={{ width: '120px', flexShrink: 0 }} />

              {Array.from({ length: stepsCount }).map((_, stepIdx) => {
                const isActive = gridData[selectedInstrument][stepIdx];
                const velocityVal = velocityData[selectedInstrument][stepIdx] ?? 0.5;
                const isStepPlaying = currentStep === stepIdx && isPlaying;
                
                const handleVelocityMouseDown = (e) => {
                  e.preventDefault();
                  const startY = e.clientY;
                  const startVel = velocityVal;
                  
                  const handleMove = (moveEvent) => {
                    const deltaY = startY - moveEvent.clientY; // Upward drag increases velocity
                    const range = 60; // Pixels for 0 to 1
                    let newVel = startVel + deltaY / range;
                    newVel = Math.max(0.0, Math.min(1.0, newVel));
                    
                    setVelocityData(prev => {
                      const next = prev.map((row, rIdx) => {
                        if (rIdx === selectedInstrument) {
                          const newRow = [...row];
                          newRow[stepIdx] = newVel;
                          return newRow;
                        }
                        return row;
                      });
                      autoSave(gridData, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState(), next);
                      return next;
                    });
                    audioEngine.stepVelocities[selectedInstrument][stepIdx] = newVel;
                  };
                  
                  const handleUp = () => {
                    window.removeEventListener('mousemove', handleMove);
                    window.removeEventListener('mouseup', handleUp);
                  };
                  
                  window.addEventListener('mousemove', handleMove);
                  window.addEventListener('mouseup', handleUp);
                };

                return (
                  <div 
                    key={stepIdx}
                    style={{
                      width: '32px',
                      height: '100%',
                      flexShrink: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      position: 'relative'
                    }}
                  >
                    {/* Vertical Active Slider Bar */}
                    <div 
                      onMouseDown={handleVelocityMouseDown}
                      style={{
                        width: '4px',
                        height: `${velocityVal * 100}%`,
                        maxHeight: '100%',
                        backgroundColor: isActive 
                          ? isStepPlaying ? 'var(--accent-orange)' : activeColor
                          : 'rgba(0,0,0,0.06)',
                        borderRadius: '2px',
                        position: 'relative',
                        cursor: 'ns-resize',
                        transition: 'background-color 0.1s ease'
                      }}
                    >
                      {/* Interactive Drag Handle Dot */}
                      <div 
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor: isActive ? 'white' : 'rgba(0,0,0,0.15)',
                          border: `2px solid ${isActive ? activeColor : 'rgba(0,0,0,0.1)'}`,
                          position: 'absolute',
                          top: '-5px',
                          left: '-3px',
                          boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.15)' : 'none'
                        }}
                      />
                    </div>

                    {/* Step label on bottom */}
                    <span 
                      style={{ 
                        fontSize: '0.5rem', 
                        fontFamily: 'var(--font-mono)', 
                        marginTop: '0.2rem',
                        color: isStepPlaying ? 'var(--accent-orange)' : 'var(--text-muted)',
                        fontWeight: '700'
                      }}
                    >
                      {Math.round(velocityVal * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pitch Bend Note Control Graph */}
          <div 
            style={{
              background: 'rgba(255, 255, 255, 0.45)',
              border: '1.5px solid var(--border-light)',
              borderRadius: '12px',
              padding: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
              boxShadow: 'var(--shadow-sm)',
              width: '100%',
              marginTop: '1rem'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: '800', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  PITCH BEND NOTE CONTROL GRAPH: {INSTRUMENTS[selectedInstrument].name.toUpperCase()}
                </span>
              </div>
              
              {/* Pitch Snapping / Preset Controls */}
              {isPitchEligible && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {/* Key Selector */}
                  <select
                    value={pitchKey}
                    onChange={(e) => {
                      setPitchKey(e.target.value);
                      logSession(`Set pitch snap key to: ${e.target.value}`, "INFO");
                    }}
                    style={{
                      background: 'white',
                      border: '1.2px solid var(--border-medium)',
                      borderRadius: '6px',
                      padding: '0.2rem 0.4rem',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      boxShadow: 'var(--shadow-sm)',
                      cursor: 'pointer'
                    }}
                  >
                    {NOTE_NAMES.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>

                  {/* Scale Selector */}
                  <select
                    value={pitchScale}
                    onChange={(e) => {
                      setPitchScale(e.target.value);
                      logSession(`Set pitch snap scale to: ${e.target.value}`, "INFO");
                    }}
                    style={{
                      background: 'white',
                      border: '1.2px solid var(--border-medium)',
                      borderRadius: '6px',
                      padding: '0.2rem 0.4rem',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      boxShadow: 'var(--shadow-sm)',
                      cursor: 'pointer'
                    }}
                  >
                    {Object.keys(SCALE_INTERVALS).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>

                  {/* Presets Select */}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        applyPitchPreset(e.target.value, NOTE_NAMES.indexOf(pitchKey), pitchScale);
                        e.target.value = ""; // Reset value
                      }
                    }}
                    style={{
                      background: 'white',
                      border: '1.2px solid var(--border-medium)',
                      borderRadius: '6px',
                      padding: '0.2rem 0.4rem',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: 'var(--accent-orange)',
                      outline: 'none',
                      boxShadow: 'var(--shadow-sm)',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="" disabled>PITCH PRESETS</option>
                    <option value="arpeggio_up">Arpeggio Up</option>
                    <option value="descending">Descending Scale</option>
                    <option value="pentatonic">Pentatonic Jumps</option>
                    <option value="octave">Octave Jumps</option>
                    <option value="chaos">Chaos Random</option>
                    <option value="flat">Flat Scale</option>
                  </select>

                  {/* CLEAR Pitch Button */}
                  <button
                    onClick={() => {
                      applyPitchPreset('flat', 0, 'Chromatic');
                      logSession(`Cleared pitches for track ${selectedInstrument}`, "INFO");
                    }}
                    style={{
                      padding: '0.2rem 0.5rem',
                      background: '#e74c3c',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    CLEAR
                  </button>
                </div>
              )}
            </div>

            {/* Note Control Graph SVG */}
            {isPitchEligible ? (
              <div 
                style={{ 
                  position: 'relative', 
                  width: '100%', 
                  background: '#ffffff', 
                  border: '1px solid var(--border-medium)',
                  borderRadius: '8px',
                  boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)',
                  overflow: 'hidden'
                }}
              >
                <svg
                  ref={svgRef}
                  width="100%"
                  height="160"
                  onMouseDown={(e) => {
                    setIsSvgDragging(true);
                    handleSvgInteraction(e);
                  }}
                  onMouseMove={handleSvgMouseMove}
                  onMouseUp={() => setIsSvgDragging(false)}
                  onMouseLeave={() => {
                    setIsSvgDragging(false);
                    setHoveredSvgStep(null);
                    setHoveredSvgSemitone(null);
                  }}
                  style={{ display: 'block', cursor: 'crosshair', userSelect: 'none' }}
                >
                  {/* Grid Lines and Labels */}
                  {(() => {
                    const keyRootIdx = NOTE_NAMES.indexOf(pitchKey);
                    const intervals = SCALE_INTERVALS[pitchScale] || SCALE_INTERVALS["Chromatic"];
                    const lines = [];
                    
                    // Draw horizontal scale notes lines
                    for (let semitone = -24; semitone <= 24; semitone++) {
                      if (isSemitoneInScale(semitone, keyRootIdx, intervals)) {
                        const val = 0.5 + semitone / 48.0;
                        const y = 160 - (val * 160);
                        
                        if (semitone % 12 === 0) {
                          // Octave lines
                          lines.push(
                            <g key={`oct-${semitone}`}>
                              <line x1="120" y1={y} x2="100%" y2={y} stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
                              <text x="10" y={y + 4} fontSize="9" fontWeight="800" fill="rgba(0,0,0,0.4)" fontFamily="var(--font-mono)">
                                {getNoteName(semitone)}
                              </text>
                            </g>
                          );
                        } else {
                          // Normal scale lines
                          lines.push(
                            <line key={`sem-${semitone}`} x1="120" y1={y} x2="100%" y2={y} stroke="rgba(0,0,0,0.03)" strokeWidth="0.5" />
                          );
                        }
                      }
                    }
                    
                    // Draw vertical step lines
                    const stepWidth = (svgRef.current?.getBoundingClientRect().width - 120) / stepsCount || (1280 - 120 - 32) / stepsCount;
                    for (let s = 0; s <= stepsCount; s++) {
                      const x = 120 + s * stepWidth;
                      lines.push(
                        <line key={`v-${s}`} x1={x} y1="0" x2={x} y2="160" stroke="rgba(0,0,0,0.025)" strokeWidth={s % 4 === 0 ? "1" : "0.5"} />
                      );
                    }

                    // Draw vertical trigger guide columns and lines themed in track color for the selected instrument
                    for (let s = 0; s < stepsCount; s++) {
                      const hasHit = gridData[selectedInstrument]?.[s];
                      if (hasHit) {
                        const cx = 120 + s * stepWidth + stepWidth / 2;
                        lines.push(
                          <g key={`v-trigger-${s}`}>
                            <rect 
                              x={120 + s * stepWidth} 
                              y="0" 
                              width={stepWidth} 
                              height="160" 
                              fill={activeColor} 
                              style={{ opacity: 0.05 }} 
                            />
                            <line 
                              x1={cx} 
                              y1="0" 
                              x2={cx} 
                              y2="160" 
                              stroke={activeColor} 
                              strokeWidth="1.5" 
                              strokeDasharray="2,3" 
                              style={{ opacity: 0.35 }} 
                            />
                          </g>
                        );
                      }
                    }
                    
                    return lines;
                  })()}

                  {/* Draw Connecting Line Path */}
                  {activePitches && (() => {
                    const rectWidth = svgRef.current?.getBoundingClientRect().width || (1280 - 32);
                    const graphWidth = rectWidth - 120;
                    const stepWidth = graphWidth / stepsCount;
                    
                    let pathData = "";
                    for (let s = 0; s < stepsCount; s++) {
                      const val = activePitches[s] ?? 0.5;
                      const cx = 120 + s * stepWidth + stepWidth / 2;
                      const cy = 160 - (val * 160);
                      pathData += `${s === 0 ? 'M' : 'L'} ${cx} ${cy}`;
                    }
                    
                    return (
                      <path 
                        d={pathData} 
                        fill="none" 
                        stroke={activeColor} 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        style={{ opacity: 0.85 }} 
                      />
                    );
                  })()}

                  {/* Draw step active indicators and pitch dots */}
                  {activePitches && Array.from({ length: stepsCount }).map((_, s) => {
                    const rectWidth = svgRef.current?.getBoundingClientRect().width || (1280 - 32);
                    const graphWidth = rectWidth - 120;
                    const stepWidth = graphWidth / stepsCount;
                    
                    const val = activePitches[s] ?? 0.5;
                    const cx = 120 + s * stepWidth + stepWidth / 2;
                    const cy = 160 - (val * 160);
                    const hasHit = gridData[selectedInstrument][s];
                    
                    return (
                      <g key={s}>
                        {/* Green trigger dot at top */}
                        {hasHit && (
                          <circle cx={cx} cy="10" r="3.5" fill="#2ecc71" />
                        )}
                        {/* Draggable pitch dot */}
                        <circle 
                          cx={cx} 
                          cy={cy} 
                          r="5.5" 
                          fill={activeColor} 
                          stroke="#ffffff" 
                          strokeWidth="1.5"
                          style={{ cursor: 'ns-resize', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))' }}
                        />
                      </g>
                    );
                  })}
                </svg>

                {/* Snapped Hover Tooltip overlay */}
                {hoveredSvgStep !== null && hoveredSvgSemitone !== null && (() => {
                  const rectWidth = svgRef.current?.getBoundingClientRect().width || (1280 - 32);
                  const graphWidth = rectWidth - 120;
                  const stepWidth = graphWidth / stepsCount;
                  
                  const cx = 120 + hoveredSvgStep * stepWidth + stepWidth / 2;
                  const val = 0.5 + hoveredSvgSemitone / 48.0;
                  const cy = 160 - (val * 160);
                  
                  return (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${cx - 25}px`,
                        top: `${cy - 26}px`,
                        width: '50px',
                        background: 'var(--text-primary)',
                        color: 'white',
                        fontSize: '9px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: '800',
                        textAlign: 'center',
                        padding: '2px 0',
                        borderRadius: '4px',
                        boxShadow: 'var(--shadow-sm)',
                        pointerEvents: 'none',
                        zIndex: 10
                      }}
                    >
                      {getNoteName(hoveredSvgSemitone)}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  height: '160px', 
                  background: 'rgba(0,0,0,0.01)', 
                  border: '1.2px dashed var(--border-medium)', 
                  borderRadius: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: '600'
                }}
              >
                PITCH BEND STEP AUTOMATION ONLY AVAILABLE FOR TOMS, BEEP, BLIP, AND BLOOP.
              </div>
            )}
          </div>
        </section>
      )}

            {/* 5. Page 1: Single Master Sequencer Grid (Bottom) */}
            {activePage === 'grid' && (
              <section className="master-sequencer-section" style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0 }}>
          <div className="master-grid-header">
            <div className="master-grid-title">
              <Sparkles size={16} color={activeColor} />
              <span>Master Sequencer Track: editing {INSTRUMENTS[selectedInstrument].name}</span>
            </div>
            
            {/* Paint Roll Selector Row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.5)', padding: '0.2rem 0.5rem', borderRadius: '8px', border: '1px solid var(--border-medium)' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: '800', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>PAINT ROLL:</span>
              {[1, 2, 3, 4].map(v => (
                <button
                  key={v}
                  onClick={() => {
                    setPaintRollValue(v);
                    logSession(`Set Paint Roll value to ${v}x`, "INFO");
                  }}
                  style={{
                    background: paintRollValue === v ? 'var(--accent-orange)' : 'white',
                    color: paintRollValue === v ? 'white' : 'var(--text-primary)',
                    border: '1.2px solid var(--border-medium)',
                    borderRadius: '4px',
                    padding: '0.15rem 0.4rem',
                    fontSize: '0.7rem',
                    fontWeight: '800',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-sm)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {v === 1 ? 'SINGLE (1x)' : `${v} HITS (${v}x)`}
                </button>
              ))}
            </div>

            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              Selected Sound: <span style={{ color: activeColor, fontWeight: '700' }}>{INSTRUMENTS[selectedInstrument].name.toUpperCase()}</span>
              {isPitchEligible && <span style={{ marginLeft: '1rem', color: 'var(--accent-teal)', fontWeight: '700' }}>PITCH DRAG ON Step Active hits</span>}
            </div>
          </div>

          {/* Polyphonic Step Cells Track */}
          <div className="master-steps-row">
            {Array.from({ length: stepsCount }).map((_, stepIdx) => {
              const isActive = gridData[selectedInstrument][stepIdx];
              const { isBeatStart } = getBeatInfo(stepIdx);
              const isStepPlaying = currentStep === stepIdx && isPlaying;
              const rollVal = typeof isActive === 'number' ? isActive : (isActive ? 1 : 0);
              
              // Check other instruments active on this step (grey layers)
              const otherActiveIndices = [];
              for (let i = 0; i < 11; i++) {
                if (i !== selectedInstrument && gridData[i][stepIdx]) {
                  otherActiveIndices.push(i);
                }
              }

              // Retrieve step pitch value if eligible
              const pitchVal = isPitchEligible && isActive ? getStepPitchForInst(selectedInstrument, stepIdx) : null;

              return (
                <div
                  key={stepIdx}
                  className={`master-step-cell ${isActive ? 'active-selected' : ''} ${isBeatStart ? 'beat-start' : ''} ${isStepPlaying ? 'playing' : ''}`}
                  onMouseDown={(e) => handleStepMouseDown(stepIdx, e)}
                  style={{
                    '--selected-color': activeColor,
                    '--selected-color-alpha': `${activeColor}15`,
                    '--selected-glow': activeGlow,
                    backgroundColor: isActive ? `${activeColor}15` : '',
                    borderColor: isStepPlaying ? 'var(--accent-orange)' : isActive ? activeColor : ''
                  }}
                >
                  {/* Step Num Label */}
                  <span className="master-step-num">{stepIdx + 1}</span>

                  {/* Center Core Hit Indicator */}
                  {isActive ? (
                    <div style={{ display: 'flex', gap: '2px', alignItems: 'center', justifyContent: 'center', height: '14px', width: '100%' }}>
                      {rollVal > 1 ? (
                        Array.from({ length: rollVal }).map((_, rIdx) => (
                          <div 
                            key={rIdx} 
                            style={{ 
                              width: '3px', 
                              height: '12px', 
                              borderRadius: '1px', 
                              backgroundColor: activeColor,
                              boxShadow: `0 0 3px ${activeColor}88`
                            }} 
                          />
                        ))
                      ) : (
                        <div className="master-step-hit-indicator">
                          {/* Render pitch vertical bar inside if eligible */}
                          {pitchVal !== null && (
                            <div 
                              className="step-pitch-indicator"
                              style={{ 
                                height: `${8 + pitchVal * 18}px`, // height fits inside cell
                                background: 'var(--accent-blue, #3b82f6)',
                                boxShadow: '0 0 5px var(--accent-blue-glow)',
                                border: '0.5px solid rgba(0,0,0,0.1)'
                              }} 
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ height: '14px' }} /> // spacer
                  )}

                  {/* Mini Dots indicators for other active background instruments */}
                  <div className="mini-indicators-container">
                    {otherActiveIndices.map(otherIdx => (
                      <div 
                        key={otherIdx} 
                        className="mini-dot"
                        style={{ backgroundColor: INSTRUMENTS[otherIdx].color }}
                        title={INSTRUMENTS[otherIdx].name}
                      />
                    ))}
                    {otherActiveIndices.length === 0 && (
                      <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.03)' }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

            {/* 6. Page 2: Universal Effects Bank (Bottom) */}
            {activePage === 'fx' && (
              <section className="master-sequencer-section" style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0 }}>
          <div className="fx-routing-container">
            
            {/* Left Column: Universal Bitcrusher Card */}
            <div className="bitcrusher-card">
              <div className="bitcrusher-header">
                <span className="bitcrusher-title">Bit Cruncher</span>
                <button 
                  className={`utility-btn ${bitcrusherEnabled ? 'bypassed' : ''}`}
                  onClick={handleBitcrusherToggle}
                  title="Enable/Disable Bitcrusher"
                >
                  <span>{bitcrusherEnabled ? 'ACTIVE' : 'BYPASS'}</span>
                </button>
              </div>
              <div className="bitcrusher-knobs">
                <Knob 
                  label="Bit Depth"
                  value={getAutomatedFxValue('bitcrusher', 'bits', bitcrusherBits)}
                  min={1}
                  max={16}
                  defaultValue={8}
                  onChange={handleBitcrusherBits}
                  valueDisplayFormatter={v => `${v} bits`}
                  tooltip="Reduces audio sample bit depth (1 to 16 bits) to introduce heavy quantization noise."
                  isAutomated={getFxAutomationInfo('bitcrusher', 'bits').isAutomated}
                  onClearAutomation={getFxAutomationInfo('bitcrusher', 'bits').onClearAutomation}
                  midiCc={midiManager.getCcMappingForParam(-1, 'bitcrusherBits')}
                  showMidiCcOverlay={showMidiCcOverlay}
                  onContextMenu={(e) => handleKnobContextMenu(e, -1, 'bitcrusherBits')}
                  onMidiLearn={() => handleMidiLearn(-1, 'bitcrusherBits')}
                  isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'bitcrusherBits'}
                  onMidiUnbind={() => handleMidiUnbind(-1, 'bitcrusherBits')}
                />
                <Knob 
                  label="Downsample"
                  value={getAutomatedFxValue('bitcrusher', 'downsample', bitcrusherDownsample)}
                  min={1}
                  max={32}
                  defaultValue={1}
                  onChange={handleBitcrusherDownsample}
                  valueDisplayFormatter={v => `${v}x`}
                  tooltip="Reduces sample rate by dropping sample steps to introduce digital aliasing and lo-fi grit."
                  isAutomated={getFxAutomationInfo('bitcrusher', 'downsample').isAutomated}
                  onClearAutomation={getFxAutomationInfo('bitcrusher', 'downsample').onClearAutomation}
                  midiCc={midiManager.getCcMappingForParam(-1, 'bitcrusherDownsample')}
                  showMidiCcOverlay={showMidiCcOverlay}
                  onContextMenu={(e) => handleKnobContextMenu(e, -1, 'bitcrusherDownsample')}
                  onMidiLearn={() => handleMidiLearn(-1, 'bitcrusherDownsample')}
                  isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'bitcrusherDownsample'}
                  onMidiUnbind={() => handleMidiUnbind(-1, 'bitcrusherDownsample')}
                />
                <Knob 
                  label="Mix"
                  value={getAutomatedFxValue('bitcrusher', 'mix', bitcrusherMix)}
                  min={0.0}
                  max={1.0}
                  defaultValue={1.0}
                  onChange={handleBitcrusherMix}
                  valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                  tooltip="Dry/wet blend of the bitcrushed signal."
                  isAutomated={getFxAutomationInfo('bitcrusher', 'mix').isAutomated}
                  onClearAutomation={getFxAutomationInfo('bitcrusher', 'mix').onClearAutomation}
                  midiCc={midiManager.getCcMappingForParam(-1, 'bitcrusherMix')}
                  showMidiCcOverlay={showMidiCcOverlay}
                  onContextMenu={(e) => handleKnobContextMenu(e, -1, 'bitcrusherMix')}
                  onMidiLearn={() => handleMidiLearn(-1, 'bitcrusherMix')}
                  isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'bitcrusherMix'}
                  onMidiUnbind={() => handleMidiUnbind(-1, 'bitcrusherMix')}
                />
              </div>
            </div>

            {/* Right Column: Routing Chain and FX Modules */}
            <div className="fx-chain-wrapper">
              <div className="fx-grid-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '700', fontFamily: 'var(--font-mono)' }}>MODULAR FX CHAIN ORDER</span>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                  <button
                    onClick={handleClearFxAutomation}
                    className="btn"
                    style={{
                      fontSize: '0.6rem',
                      padding: '0.2rem 0.45rem',
                      height: 'auto',
                      fontWeight: '700',
                      backgroundColor: 'rgba(224, 108, 67, 0.12)',
                      color: 'var(--accent-orange)',
                      border: '1.2px solid rgba(224, 108, 67, 0.3)',
                      borderRadius: '5px',
                      cursor: 'pointer'
                    }}
                    title="Wipe out all recorded FX parameter automation loops on all steps"
                  >
                    WIPE FX AUTO
                  </button>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>CLICK ARROWS TO LIVE RE-ROUTE EFFECTS</span>
                </div>
              </div>
              
              {/* FX Chain Flow Row */}
              <div className="fx-chain-row">
                {fxChainOrder.map((key, idx) => {
                  const enabled = fxEnabled[key];
                  const label = key === 'distortion' ? 'Saturator' : key === 'filter' ? 'Filter' : key === 'delay' ? 'Delay' : key === 'reverb' ? 'Reverb' : 'Sidechain';
                  return (
                    <React.Fragment key={key}>
                      <div className={`fx-chain-block ${enabled ? 'enabled' : ''}`}>
                        <input 
                          type="checkbox" 
                          checked={enabled} 
                          onChange={() => handleFxToggle(key)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span className="fx-block-title" style={{ color: enabled ? 'var(--accent-orange)' : 'var(--text-secondary)', fontWeight: enabled ? '700' : '500' }}>
                          {label.toUpperCase()}
                        </span>
                        
                        <div className="fx-block-arrows">
                          {idx > 0 && (
                            <button className="arrow-btn" onClick={() => handleSwapEffects(idx, -1)}>◀</button>
                          )}
                          {idx < fxChainOrder.length - 1 && (
                            <button className="arrow-btn" onClick={() => handleSwapEffects(idx, 1)}>▶</button>
                          )}
                        </div>
                      </div>
                      {idx < fxChainOrder.length - 1 && <div style={{ color: 'var(--text-muted)', fontWeight: '700', fontFamily: 'var(--font-mono)' }}>➔</div>}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Param Dials Grid */}
              <div className="fx-params-dashboard">
                        {/* 1. Distortion Card */}
                <div className={`fx-module-card ${fxEnabled.distortion ? 'active-card' : ''}`}>
                  <div className="fx-module-header">
                    <span>SATURATOR</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearFxModuleMotion('distortion');
                        }}
                        style={{
                          padding: '0.1rem 0.3rem',
                          fontSize: '0.55rem',
                          fontWeight: '800',
                          fontFamily: 'var(--font-mono)',
                          borderRadius: '3px',
                          border: '1px solid rgba(230, 126, 34, 0.3)',
                          cursor: 'pointer',
                          background: 'rgba(230, 126, 34, 0.05)',
                          color: 'var(--accent-orange)'
                        }}
                        title="Wipe motion recorded for Saturator"
                      >
                        WIPE
                      </button>
                      <span style={{ fontSize: '0.6rem', color: fxEnabled.distortion ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                        {fxEnabled.distortion ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  </div>
                  <div className="fx-module-knobs">
                    <Knob 
                      label="Drive"
                      value={getAutomatedFxValue('distortion', 'drive', fxParams.distortion.drive)}
                      min={0.0}
                      max={1.0}
                      defaultValue={0.3}
                      onChange={(val) => handleFxParamChange('distortion', 'drive', val)}
                      valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                      tooltip="Overdrives waveshaper saturation limit to warm up or mangle the master output."
                      isAutomated={getFxAutomationInfo('distortion', 'drive').isAutomated}
                      onClearAutomation={getFxAutomationInfo('distortion', 'drive').onClearAutomation}
                      midiCc={midiManager.getCcMappingForParam(-1, 'distDrive')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'distDrive')}
                      onMidiLearn={() => handleMidiLearn(-1, 'distDrive')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'distDrive'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'distDrive')}
                    />
                  </div>
                </div>

                {/* 2. Filter Card */}
                <div className={`fx-module-card ${fxEnabled.filter ? 'active-card' : ''}`}>
                  <div className="fx-module-header">
                    <span>FILTER</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearFxModuleMotion('filter');
                        }}
                        style={{
                          padding: '0.1rem 0.3rem',
                          fontSize: '0.55rem',
                          fontWeight: '800',
                          fontFamily: 'var(--font-mono)',
                          borderRadius: '3px',
                          border: '1px solid rgba(230, 126, 34, 0.3)',
                          cursor: 'pointer',
                          background: 'rgba(230, 126, 34, 0.05)',
                          color: 'var(--accent-orange)'
                        }}
                        title="Wipe motion recorded for Filter"
                      >
                        WIPE
                      </button>
                      <select 
                        value={fxParams.filter.type} 
                        onChange={(e) => handleFilterTypeChange(e.target.value)}
                        style={{
                          background: 'rgba(255,255,255,0.75)',
                          border: '1px solid var(--border-medium)',
                          borderRadius: '6px',
                          padding: '0.15rem 0.4rem',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.65rem',
                          fontWeight: '700',
                          color: fxEnabled.filter ? 'var(--accent-orange)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          outline: 'none',
                          boxShadow: 'var(--shadow-sm)',
                          transition: 'all 0.15s ease'
                        }}
                        title="Select Filter Engine Type"
                      >
                        <option value="lowpass">LP (12dB)</option>
                        <option value="highpass">HP (12dB)</option>
                        <option value="bandpass">Bandpass</option>
                        <option value="comb">Comb Filter</option>
                        <option value="formant">Formant (Vowel)</option>
                        <option value="ringmod">Ring Mod</option>
                        <option value="phaser">Phaser</option>
                        <option value="lowpass24">LP (24dB)</option>
                        <option value="notch">Notch Reject</option>
                        <option value="peaking">Peaking EQ</option>
                      </select>
                    </div>
                  </div>
                  <div className="fx-module-knobs">
                    <Knob 
                      label="Cutoff"
                      value={getAutomatedFxValue('filter', 'cutoff', fxParams.filter.cutoff)}
                      min={100}
                      max={15000}
                      defaultValue={1200}
                      onChange={(val) => handleFxParamChange('filter', 'cutoff', val)}
                      valueDisplayFormatter={v => v > 1000 ? `${(v/1000).toFixed(1)}kHz` : `${Math.round(v)}Hz`}
                      tooltip="Threshold frequency limit above which (LP) or below which (HP) signals are filtered."
                      isAutomated={getFxAutomationInfo('filter', 'cutoff').isAutomated}
                      onClearAutomation={getFxAutomationInfo('filter', 'cutoff').onClearAutomation}
                      midiCc={midiManager.getCcMappingForParam(-1, 'filterCutoff')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'filterCutoff')}
                      onMidiLearn={() => handleMidiLearn(-1, 'filterCutoff')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'filterCutoff'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'filterCutoff')}
                    />
                    <Knob 
                      label="Res"
                      value={getAutomatedFxValue('filter', 'resonance', fxParams.filter.resonance)}
                      min={0.5}
                      max={15.0}
                      defaultValue={2.0}
                      onChange={(val) => handleFxParamChange('filter', 'resonance', val)}
                      valueDisplayFormatter={v => v.toFixed(1)}
                      tooltip="Boosts and amplifies signal frequencies around the cutoff boundary to add sweeping character."
                      isAutomated={getFxAutomationInfo('filter', 'resonance').isAutomated}
                      onClearAutomation={getFxAutomationInfo('filter', 'resonance').onClearAutomation}
                      midiCc={midiManager.getCcMappingForParam(-1, 'filterResonance')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'filterResonance')}
                      onMidiLearn={() => handleMidiLearn(-1, 'filterResonance')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'filterResonance'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'filterResonance')}
                    />
                  </div>
                </div>

                {/* 3. Delay Card */}
                <div className={`fx-module-card ${fxEnabled.delay ? 'active-card' : ''}`}>
                  <div className="fx-module-header">
                    <span>DELAY</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearFxModuleMotion('delay');
                        }}
                        style={{
                          padding: '0.1rem 0.3rem',
                          fontSize: '0.55rem',
                          fontWeight: '800',
                          fontFamily: 'var(--font-mono)',
                          borderRadius: '3px',
                          border: '1px solid rgba(230, 126, 34, 0.3)',
                          cursor: 'pointer',
                          background: 'rgba(230, 126, 34, 0.05)',
                          color: 'var(--accent-orange)'
                        }}
                        title="Wipe motion recorded for Delay"
                      >
                        WIPE
                      </button>
                      <span style={{ fontSize: '0.6rem', color: fxEnabled.delay ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                        {fxEnabled.delay ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  </div>
                  <div className="fx-module-knobs">
                    <Knob 
                      label="Time"
                      value={getAutomatedFxValue('delay', 'time', fxParams.delay.time)}
                      min={0.05}
                      max={1.5}
                      defaultValue={0.3}
                      onChange={(val) => handleFxParamChange('delay', 'time', val)}
                      valueDisplayFormatter={v => `${Math.round(v * 1000)}ms`}
                      tooltip="Sets time interval delay in milliseconds between echo reflections."
                      isAutomated={getFxAutomationInfo('delay', 'time').isAutomated}
                      onClearAutomation={getFxAutomationInfo('delay', 'time').onClearAutomation}
                      midiCc={midiManager.getCcMappingForParam(-1, 'delayTime')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'delayTime')}
                      onMidiLearn={() => handleMidiLearn(-1, 'delayTime')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'delayTime'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'delayTime')}
                    />
                    <Knob 
                      label="Feedback"
                      value={getAutomatedFxValue('delay', 'feedback', fxParams.delay.feedback)}
                      min={0.0}
                      max={0.95}
                      defaultValue={0.4}
                      onChange={(val) => handleFxParamChange('delay', 'feedback', val)}
                      valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                      tooltip="Controls the percentage of signal fed back into the delay line to multiply echoes."
                      isAutomated={getFxAutomationInfo('delay', 'feedback').isAutomated}
                      onClearAutomation={getFxAutomationInfo('delay', 'feedback').onClearAutomation}
                      midiCc={midiManager.getCcMappingForParam(-1, 'delayFeedback')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'delayFeedback')}
                      onMidiLearn={() => handleMidiLearn(-1, 'delayFeedback')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'delayFeedback'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'delayFeedback')}
                    />
                    <Knob 
                      label="Mix"
                      value={getAutomatedFxValue('delay', 'mix', fxParams.delay.mix)}
                      min={0.0}
                      max={1.0}
                      defaultValue={0.3}
                      onChange={(val) => handleFxParamChange('delay', 'mix', val)}
                      valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                      tooltip="Balances dry clean signal and wet delay feedback echos in the chain."
                      isAutomated={getFxAutomationInfo('delay', 'mix').isAutomated}
                      onClearAutomation={getFxAutomationInfo('delay', 'mix').onClearAutomation}
                      midiCc={midiManager.getCcMappingForParam(-1, 'delayMix')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'delayMix')}
                      onMidiLearn={() => handleMidiLearn(-1, 'delayMix')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'delayMix'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'delayMix')}
                    />
                  </div>
                </div>

                {/* 4. Reverb Card */}
                <div className={`fx-module-card ${fxEnabled.reverb ? 'active-card' : ''}`}>
                  <div className="fx-module-header">
                    <span>REVERB</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearFxModuleMotion('reverb');
                        }}
                        style={{
                          padding: '0.1rem 0.3rem',
                          fontSize: '0.55rem',
                          fontWeight: '800',
                          fontFamily: 'var(--font-mono)',
                          borderRadius: '3px',
                          border: '1px solid rgba(230, 126, 34, 0.3)',
                          cursor: 'pointer',
                          background: 'rgba(230, 126, 34, 0.05)',
                          color: 'var(--accent-orange)'
                        }}
                        title="Wipe motion recorded for Reverb"
                      >
                        WIPE
                      </button>
                      <span style={{ fontSize: '0.6rem', color: fxEnabled.reverb ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                        {fxEnabled.reverb ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  </div>
                  <div className="fx-module-knobs">
                    <Knob 
                      label="Decay"
                      value={getAutomatedFxValue('reverb', 'decay', fxParams.reverb.decay)}
                      min={0.1}
                      max={3.0}
                      defaultValue={1.2}
                      onChange={(val) => handleFxParamChange('reverb', 'decay', val)}
                      valueDisplayFormatter={v => `${v.toFixed(1)}s`}
                      tooltip="Sets acoustic room decay size by regenerating a longer noise impulse buffer."
                      isAutomated={getFxAutomationInfo('reverb', 'decay').isAutomated}
                      onClearAutomation={getFxAutomationInfo('reverb', 'decay').onClearAutomation}
                      midiCc={midiManager.getCcMappingForParam(-1, 'reverbDecay')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'reverbDecay')}
                      onMidiLearn={() => handleMidiLearn(-1, 'reverbDecay')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'reverbDecay'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'reverbDecay')}
                    />
                    <Knob 
                      label="Mix"
                      value={getAutomatedFxValue('reverb', 'mix', fxParams.reverb.mix)}
                      min={0.0}
                      max={1.0}
                      defaultValue={0.2}
                      onChange={(val) => handleFxParamChange('reverb', 'mix', val)}
                      valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                      tooltip="Dry/Wet mix ratio of room reverb reverberation."
                      isAutomated={getFxAutomationInfo('reverb', 'mix').isAutomated}
                      onClearAutomation={getFxAutomationInfo('reverb', 'mix').onClearAutomation}
                      midiCc={midiManager.getCcMappingForParam(-1, 'reverbMix')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'reverbMix')}
                      onMidiLearn={() => handleMidiLearn(-1, 'reverbMix')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'reverbMix'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'reverbMix')}
                    />
                  </div>
                </div>

                {/* 5. Sidechain Compressor Card */}
                <div className={`fx-module-card ${fxEnabled.sidechain ? 'active-card' : ''}`}>
                  <div className="fx-module-header">
                    <span>SIDECHAIN</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearFxModuleMotion('sidechain');
                        }}
                        style={{
                          padding: '0.1rem 0.3rem',
                          fontSize: '0.55rem',
                          fontWeight: '800',
                          fontFamily: 'var(--font-mono)',
                          borderRadius: '3px',
                          border: '1px solid rgba(230, 126, 34, 0.3)',
                          cursor: 'pointer',
                          background: 'rgba(230, 126, 34, 0.05)',
                          color: 'var(--accent-orange)'
                        }}
                        title="Wipe motion recorded for Sidechain"
                      >
                        WIPE
                      </button>
                      <span style={{ fontSize: '0.6rem', color: fxEnabled.sidechain ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                        {fxEnabled.sidechain ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  </div>
                  <div className="fx-module-knobs">
                    <Knob 
                      label="Depth"
                      value={fxParams.sidechain.ratio}
                      min={0.0}
                      max={1.0}
                      defaultValue={0.8}
                      onChange={(val) => handleFxParamChange('sidechain', 'ratio', val)}
                      valueDisplayFormatter={v => `${Math.round(v * 100)}%`}
                      tooltip="Sets how deep the volume ducks whenever the Kick drum triggers (0% to 100%)."
                      midiCc={midiManager.getCcMappingForParam(-1, 'sidechainRatio')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'sidechainRatio')}
                      onMidiLearn={() => handleMidiLearn(-1, 'sidechainRatio')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'sidechainRatio'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'sidechainRatio')}
                    />
                    <Knob 
                      label="Attack"
                      value={fxParams.sidechain.attack}
                      min={0.002}
                      max={0.1}
                      defaultValue={0.01}
                      onChange={(val) => handleFxParamChange('sidechain', 'attack', val)}
                      valueDisplayFormatter={v => `${Math.round(v * 1000)}ms`}
                      tooltip="Ducking speed. Time taken for volume to duck down (2ms to 100ms)."
                      midiCc={midiManager.getCcMappingForParam(-1, 'sidechainAttack')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'sidechainAttack')}
                      onMidiLearn={() => handleMidiLearn(-1, 'sidechainAttack')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'sidechainAttack'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'sidechainAttack')}
                    />
                    <Knob 
                      label="Release"
                      value={fxParams.sidechain.release}
                      min={0.02}
                      max={1.0}
                      defaultValue={0.15}
                      onChange={(val) => handleFxParamChange('sidechain', 'release', val)}
                      valueDisplayFormatter={v => `${Math.round(v * 1000)}ms`}
                      tooltip="Recovery speed. Time taken to recover back to full volume (20ms to 1000ms)."
                      midiCc={midiManager.getCcMappingForParam(-1, 'sidechainRelease')}
                      showMidiCcOverlay={showMidiCcOverlay}
                      onContextMenu={(e) => handleKnobContextMenu(e, -1, 'sidechainRelease')}
                      onMidiLearn={() => handleMidiLearn(-1, 'sidechainRelease')}
                      isLearning={midiLearnTarget?.channelId === -1 && midiLearnTarget?.paramKey === 'sidechainRelease'}
                      onMidiUnbind={() => handleMidiUnbind(-1, 'sidechainRelease')}
                    />
                  </div>
                </div>

              </div>
            </div>

          </div>
              </section>
            )}
          </div>
        ) : (
          <div className="editor-group-content-collapsed" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', padding: '0.75rem', background: 'rgba(255,255,255,0.45)', border: '1.5px dashed var(--border-medium)', borderRadius: '12px', boxShadow: 'var(--shadow-sm)' }}>
            {/* Compressed grid sequencer: Horizontal row of 16 mini step cells */}
            {activePage === 'grid' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem', fontWeight: '800', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  <span>COMPRESSED STEP TIMELINE • {INSTRUMENTS[selectedInstrument].name.toUpperCase()}</span>
                  <span>TAP CELLS TO QUICKLY TOGGLE STEPS</span>
                </div>
                <div style={{ display: 'flex', gap: '3px', width: '100%', overflowX: 'auto', padding: '2px 0' }}>
                  {Array.from({ length: stepsCount }).map((_, stepIdx) => {
                    const isActive = gridData[selectedInstrument][stepIdx];
                    const isStepPlaying = currentStep === stepIdx && isPlaying;
                    const { isBeatStart } = getBeatInfo(stepIdx);
                    const rollVal = typeof isActive === 'number' ? isActive : (isActive ? 1 : 0);
                    return (
                      <div
                        key={stepIdx}
                        onClick={() => handleStepMouseDown(stepIdx)}
                        style={{
                          flex: '1 1 0',
                          minWidth: '20px',
                          height: '24px',
                          borderRadius: '4px',
                          background: isStepPlaying 
                            ? 'var(--accent-orange)35' 
                            : isActive 
                              ? `${activeColor}40` 
                              : isBeatStart 
                                ? 'rgba(0,0,0,0.06)' 
                                : 'rgba(0,0,0,0.02)',
                          border: `1px solid ${isStepPlaying ? 'var(--accent-orange)' : isActive ? activeColor : 'rgba(0,0,0,0.05)'}`,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.55rem',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: '700',
                          color: isStepPlaying ? 'var(--accent-orange)' : isActive ? activeColor : 'var(--text-secondary)'
                        }}
                      >
                        {rollVal > 1 ? (
                          <div style={{ display: 'flex', gap: '1px' }}>
                            {Array.from({ length: rollVal }).map((_, r) => (
                              <div key={r} style={{ width: '2px', height: '8px', background: activeColor, borderRadius: '0.5px' }} />
                            ))}
                          </div>
                        ) : isActive ? (
                          '•'
                        ) : (
                          stepIdx + 1
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Compressed piano roll: Vertically-stacked lanes representing 12-track mini hit matrices */}
            {activePage === 'piano' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem', fontWeight: '800', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  <span>COMPRESSED MULTI-TRACK MATRIX TIMELINE</span>
                  <span>12-TRACK POLYPHONIC LAYOUT OVERVIEW</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%', overflowX: 'auto' }}>
                  {INSTRUMENTS.map((inst, trackIdx) => {
                    const isFocused = selectedInstrument === trackIdx;
                    return (
                      <div key={inst.id} style={{ display: 'flex', alignItems: 'center', height: '14px', gap: '4px' }}>
                        {/* Tiny Track Label */}
                        <div 
                          onClick={() => setSelectedInstrument(trackIdx)}
                          style={{ 
                            width: '45px', 
                            fontSize: '0.55rem', 
                            fontFamily: 'var(--font-mono)', 
                            fontWeight: '800', 
                            color: isFocused ? inst.color : 'var(--text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                            paddingLeft: '2px'
                          }}
                        >
                          {inst.name.toUpperCase()}
                        </div>
                        {/* Tiny Step Timeline Row */}
                        <div style={{ display: 'flex', gap: '2px', flexGrow: 1 }}>
                          {Array.from({ length: stepsCount }).map((_, stepIdx) => {
                            const isActive = gridData[trackIdx][stepIdx];
                            const isStepPlaying = currentStep === stepIdx && isPlaying;
                            const rollVal = typeof isActive === 'number' ? isActive : (isActive ? 1 : 0);
                            return (
                              <div
                                key={stepIdx}
                                onClick={() => {
                                  setSelectedInstrument(trackIdx);
                                  const newGrid = gridData.map((row, rIdx) => {
                                    if (rIdx === trackIdx) {
                                      const newRow = [...row];
                                      newRow[stepIdx] = isActive ? false : 1;
                                      return newRow;
                                    }
                                    return row;
                                  });
                                  setGridData(newGrid);
                                  autoSave(newGrid, params, tomPitches, { bpm, stepsCount }, beepPitches, blipPitches, bloopPitches, crunchBypass, swing, getFxSaveState());
                                }}
                                style={{
                                  flex: '1 1 0',
                                  height: '10px',
                                  borderRadius: '1.5px',
                                  background: isStepPlaying 
                                    ? 'var(--accent-orange)45' 
                                    : isActive 
                                      ? `${inst.color}40` 
                                      : 'rgba(0,0,0,0.02)',
                                  border: `0.5px solid ${isStepPlaying ? 'var(--accent-orange)' : isActive ? inst.color : 'rgba(0,0,0,0.03)'}`,
                                  cursor: 'pointer'
                                }}
                                title={`${inst.name} step ${stepIdx + 1}`}
                              >
                                {rollVal > 1 && (
                                  <div style={{ display: 'flex', gap: '0.5px', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                                    {Array.from({ length: rollVal }).map((_, r) => (
                                      <div key={r} style={{ width: '1px', height: '6px', background: inst.color }} />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Compressed FX Chain: Single-row FX swap chain with on/off bypass checkboxes and arrows for movement */}
            {activePage === 'fx' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem', fontWeight: '800', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  <span>COMPRESSED EFFECTS ROUTING CHAIN</span>
                  <span>ROUTE ORDER (DRAG OR SWAP) • TOGGLE ACTIVE / BYPASS BOXES</span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', overflowX: 'auto', padding: '4px 0' }}>
                  {fxChainOrder.map((key, idx) => {
                    const enabled = fxEnabled[key];
                    const displayName = 
                      key === 'distortion' ? 'SATURATOR' :
                      key === 'filter' ? 'FILTER' :
                      key === 'delay' ? 'DELAY' :
                      key === 'reverb' ? 'REVERB' :
                      key === 'sidechain' ? 'SIDECHAIN' : key.toUpperCase();
                    
                    return (
                      <React.Fragment key={key}>
                        <div 
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            background: enabled ? 'rgba(230, 126, 34, 0.08)' : 'rgba(0,0,0,0.02)',
                            border: `1.2px solid ${enabled ? 'var(--accent-orange)' : 'var(--border-medium)'}`,
                            borderRadius: '8px',
                            padding: '0.3rem 0.6rem',
                            boxShadow: 'var(--shadow-sm)',
                            flexShrink: 0
                          }}
                        >
                          {/* Swap Left */}
                          {idx > 0 && (
                            <button
                              onClick={() => handleSwapEffects(idx, -1)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.65rem', padding: '0 0.1rem', fontWeight: '800' }}
                              title="Shift effect earlier in signal chain"
                            >
                              ◀
                            </button>
                          )}
                          
                          {/* Bypass/Active Checkbox */}
                          <input 
                            type="checkbox"
                            checked={enabled}
                            onChange={() => handleFxToggle(key)}
                            style={{ accentColor: 'var(--accent-orange)', cursor: 'pointer' }}
                            title="Toggle active / bypass status"
                          />
                          
                          {/* Name Label */}
                          <span style={{ fontSize: '0.65rem', fontWeight: '800', fontFamily: 'var(--font-mono)', color: enabled ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>
                            {displayName}
                          </span>
                          
                          {/* Swap Right */}
                          {idx < fxChainOrder.length - 1 && (
                            <button
                              onClick={() => handleSwapEffects(idx, 1)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.65rem', padding: '0 0.1rem', fontWeight: '800' }}
                              title="Shift effect later in signal chain"
                            >
                              ▶
                            </button>
                          )}
                        </div>
                        {idx < fxChainOrder.length - 1 && (
                          <span style={{ color: 'var(--text-muted)', fontWeight: '800', fontSize: '0.7rem' }}>➔</span>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
      {/* 4. Instruments Array and Knobs Block */}
      <section className="instruments-wrapper" style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0.25rem' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: '800', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            DRUMS CONTROL STATION & ANALOG DIALS
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {isCollapsed ? 'COMPACT TRIGGERS ONLY' : 'FULL DSP PARAMS VIEW'}
          </span>
        </div>
        <div className={`instruments-grid ${isCollapsed ? 'collapsed-grid' : ''}`}>
          {INSTRUMENTS.map((inst, idx) => {
            const isSelected = selectedInstrument === idx;
            return (
              <div 
                key={inst.id} 
                className={`instrument-card ${isSelected ? 'selected-card' : ''} ${isCollapsed ? 'collapsed-card' : ''}`}
                style={{
                  '--card-accent-color': inst.color,
                  '--card-accent-glow': inst.glow,
                  borderColor: padTrigger[idx] ? inst.color : isSelected ? inst.color : '',
                  boxShadow: padTrigger[idx] ? `0 0 16px ${inst.color}cc, var(--shadow-md)` : isSelected ? `0 6px 20px ${inst.glow}, var(--shadow-md)` : '',
                  transform: padTrigger[idx] ? 'scale(1.02)' : '',
                  transition: padTrigger[idx] ? 'all 0.05s ease-out' : 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                  zIndex: padTrigger[idx] ? 5 : isSelected ? 2 : 1
                }}
              >
                {/* Header Pad Button Trigger */}
                <div 
                  className="card-header-pad"
                  onClick={() => handleInstrumentSelect(idx)}
                  style={{
                    background: padTrigger[idx] ? inst.color : isSelected ? `${inst.color}15` : '#ffffff',
                    border: `1.5px solid ${isSelected ? inst.color : 'rgba(0,0,0,0.06)'}`,
                    boxShadow: padTrigger[idx] ? `0 0 10px ${inst.color}44` : 'none',
                    color: padTrigger[idx] ? '#ffffff' : 'var(--text-primary)'
                  }}
                >
                  <div className="inst-name">{inst.name}</div>
                  <div className="inst-type">
                    {idx < 11 
                      ? (params[idx]?.useAltSound ? ALTS_SUBLINES[idx].B : ALTS_SUBLINES[idx].A)
                      : inst.type
                    }
                  </div>
                </div>

                {!isCollapsed && idx < 11 && (
                  <div className="alt-sound-switch-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.4rem 0.6rem 0.2rem', padding: '0.2rem 0.4rem', background: 'rgba(0,0,0,0.02)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                    <span style={{ fontSize: '0.6rem', fontWeight: '700', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>MODE:</span>
                    <div style={{ display: 'flex', gap: '0.15rem' }}>
                      <button
                        className={`mode-toggle-btn ${!params[idx].useAltSound ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAltSoundToggle(idx, false);
                        }}
                        style={{
                          padding: '0.15rem 0.35rem',
                          fontSize: '0.55rem',
                          fontWeight: '800',
                          fontFamily: 'var(--font-mono)',
                          borderRadius: '4px',
                          border: 'none',
                          cursor: 'pointer',
                          background: !params[idx].useAltSound ? inst.color : 'transparent',
                          color: !params[idx].useAltSound ? 'white' : 'var(--text-secondary)',
                          boxShadow: !params[idx].useAltSound ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        A
                      </button>
                      <button
                        className={`mode-toggle-btn ${params[idx].useAltSound ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAltSoundToggle(idx, true);
                        }}
                        style={{
                          padding: '0.15rem 0.35rem',
                          fontSize: '0.55rem',
                          fontWeight: '800',
                          fontFamily: 'var(--font-mono)',
                          borderRadius: '4px',
                          border: 'none',
                          cursor: 'pointer',
                          background: params[idx].useAltSound ? inst.color : 'transparent',
                          color: params[idx].useAltSound ? 'white' : 'var(--text-secondary)',
                          boxShadow: params[idx].useAltSound ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        B
                      </button>
                    </div>
                  </div>
                )}

                {!isCollapsed && (
                  <div className="card-knobs-grid">
                    {KNOB_DEFS[idx].map((k) => {
                      const isLearning = midiLearnTarget && midiLearnTarget.channelId === idx && midiLearnTarget.paramKey === k.key;
                      const midiCc = midiManager.getCcMappingForParam(idx, k.key);
                      const overriddenK = getOverriddenKnobDef(idx, k, params[idx]?.useAltSound);
                      return (
                        <Knob
                          key={k.key}
                          label={overriddenK.label}
                          value={getAutomatedInstrumentValue(idx, k.key, params[idx][k.key])}
                          min={k.min}
                          max={k.max}
                          defaultValue={k.defaultValue}
                          onChange={(val) => handleKnobChange(idx, k.key, val)}
                          onMidiLearn={() => handleMidiLearn(idx, k.key)}
                          isLearning={isLearning}
                          midiCc={midiCc}
                          onMidiUnbind={() => handleMidiUnbind(idx, k.key)}
                          valueDisplayFormatter={overriddenK.formatter}
                          tooltip={overriddenK.tooltip}
                          isAutomated={getInstrumentAutomationInfo(idx, k.key).isAutomated}
                          onClearAutomation={getInstrumentAutomationInfo(idx, k.key).onClearAutomation}
                          showMidiCcOverlay={showMidiCcOverlay}
                          onContextMenu={(e) => handleKnobContextMenu(e, idx, k.key)}
                        />
                      );
                    })}
                  </div>
                )}

                {!isCollapsed && (
                  <div className="card-utility-row">
                    <button 
                      className={`utility-btn ${mutes[idx] ? 'muted' : ''}`}
                      onClick={() => toggleMute(idx)}
                    >
                      {mutes[idx] ? <VolumeX size={10} /> : <Volume2 size={10} />}
                      <span>{mutes[idx] ? 'MUTED' : 'MUTE'}</span>
                    </button>

                    <button 
                      className={`utility-btn ${crunchBypass[idx] ? 'bypassed' : ''}`}
                      onClick={() => toggleCrunchBypass(idx)}
                      title="Bypass universal bitcrusher for this sound"
                    >
                      <span>{crunchBypass[idx] ? 'BYP ON' : 'CRUNCH'}</span>
                    </button>

                    <button 
                      className="utility-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClearInstrumentMotion(idx);
                      }}
                      style={{
                        background: 'rgba(230, 126, 34, 0.05)',
                        border: '1px solid rgba(230, 126, 34, 0.3)',
                        color: 'var(--accent-orange)',
                        fontSize: '0.55rem',
                        fontWeight: '800',
                        padding: '0.1rem 0.3rem',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                      title={`Wipe all dial motion automation recorded for ${inst.name}`}
                    >
                      <span>WIPE</span>
                    </button>
                    
                    {/* Selected Highlight Circle Indicator */}
                    {isSelected && (
                      <div 
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: inst.color,
                          boxShadow: `0 0 6px ${inst.color}`
                        }}
                      />
                    )}
                  </div>
                )}

                {!isCollapsed && idx === 11 && (
                  <div className="sampler-custom-panel" style={{ marginTop: '0.4rem', borderTop: '1px dashed var(--border-medium)', paddingTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    
                    {/* A. Waveform display screen with overlay slice cropping bounds */}
                    <div style={{ position: 'relative', width: '100%', height: '40px', background: 'rgba(0,0,0,0.02)', borderRadius: '6px', border: '1px solid var(--border-light)', overflow: 'hidden' }}>
                      <canvas 
                        ref={waveformCanvasRef} 
                        style={{ width: '100%', height: '100%', display: 'block' }} 
                        width="180" 
                        height="40" 
                      />
                      
                      {/* Left cropped translucent overlay */}
                      <div 
                        style={{ 
                          position: 'absolute', 
                          top: 0, 
                          left: 0, 
                          width: `${params[11].startPoint * 100}%`, 
                          height: '100%', 
                          background: 'rgba(43, 41, 39, 0.15)', 
                          borderRight: '1px solid rgba(236, 72, 153, 0.4)' 
                        }} 
                      />
                      
                      {/* Right cropped translucent overlay */}
                      <div 
                        style={{ 
                          position: 'absolute', 
                          top: 0, 
                          right: 0, 
                          width: `${(1.0 - params[11].endPoint) * 100}%`, 
                          height: '100%', 
                          background: 'rgba(43, 41, 39, 0.15)', 
                          borderLeft: '1px solid rgba(236, 72, 153, 0.4)' 
                        }} 
                      />
                      
                      {/* File Name Label Overlay */}
                      <div style={{ position: 'absolute', bottom: '2px', left: '4px', fontSize: '0.55rem', fontFamily: 'var(--font-mono)', color: 'rgba(0,0,0,0.4)', pointerEvents: 'none', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sampleName}
                      </div>
                    </div>

                    {/* B. Mic Record / Import Action Buttons (Range inputs are completely replaced by premium VST knobs!) */}
                    <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.1rem' }}>
                      <button 
                        className={`utility-btn ${isRecordingMic ? 'recording-flash' : ''}`}
                        onClick={triggerRecordMic}
                        style={{ 
                          flex: 1, 
                          padding: '0.25rem 0.4rem', 
                          fontSize: '0.6rem', 
                          fontWeight: '700',
                          background: isRecordingMic ? 'rgba(239, 68, 68, 0.15)' : '',
                          border: isRecordingMic ? '1px solid rgba(239, 68, 68, 0.4)' : '',
                          color: isRecordingMic ? '#ef4444' : ''
                        }}
                        title={isRecordingMic ? `Stop mic capture - elapsed ${recTime}s` : "Record live audio through computer microphone"}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}>
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444', animation: isRecordingMic ? 'blink 1s infinite alternate' : 'none' }} />
                          <span>{isRecordingMic ? `REC ${recTime}s` : 'MIC REC'}</span>
                        </div>
                      </button>

                      <button 
                        className="utility-btn"
                        onClick={() => fileInputRef.current && fileInputRef.current.click()}
                        style={{ flex: 1, padding: '0.25rem 0.4rem', fontSize: '0.6rem', fontWeight: '700' }}
                        title="Import WAV or MP3 audio file into sampler track"
                      >
                        IMPORT AUDIO
                      </button>

                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileLoad} 
                        accept="audio/*" 
                        style={{ display: 'none' }} 
                      />
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 7. Footer */}
      <footer className="app-footer">
        <div>SYSTEM STATUS: ONLINE</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <HelpCircle size={10} />
          {activePage === 'grid' ? (
            <span>SELECT INSTRUMENT TO FOCUS ACTIVE MATRIX. DRAG HITS VERTICALLY FOR TOM/BEEP/BLIP/BLOOP STEP PITCH SHIFTS.</span>
          ) : (
            <span>TOGGLE FX BOX CHECKBOX TO ENABLE. CLICK SWAP ARROWS TO ALTER MODULAR DSP PROCESSING ORDER.</span>
          )}
        </div>
        <div>PHYZIX V1.2.2</div>
      </footer>

      {/* ========================================== */}
      {/* OPERATIONS MANUAL MODAL OVERLAY BACKDROP */}
      {/* ========================================== */}
      {showManual && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(43, 41, 39, 0.45)', // dark warm mask
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem'
          }}
          onClick={() => setShowManual(false)}
        >
          <div 
            style={{
              background: 'rgba(247, 246, 240, 0.98)',
              border: '2px solid var(--border-medium)',
              borderRadius: '16px',
              padding: '1.75rem 2rem 2rem',
              width: '880px',
              maxWidth: '95%',
              height: '80vh',
              maxHeight: '85vh',
              boxShadow: '0 25px 60px rgba(0,0,0,0.18)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
              animation: 'modalFadeIn 0.25s ease-out'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-medium)', paddingBottom: '0.85rem', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Radio size={24} color="var(--accent-orange)" />
                <span style={{ fontSize: '1.25rem', fontWeight: '800', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>PHYZIX: SLAMS AND BAMS</span>
                <span style={{ background: 'var(--accent-orange)15', color: 'var(--accent-orange)', fontSize: '0.65rem', fontWeight: '800', padding: '0.1rem 0.4rem', borderRadius: '4px', fontFamily: 'var(--font-mono)' }}>OPERATIONS MANUAL</span>
              </div>
              <button 
                onClick={() => setShowManual(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '1.2rem',
                  fontWeight: '700',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '0.2rem'
                }}
                title="Close manual"
              >
                ⨉
              </button>
            </div>

            {/* Inner Manual Navigation Tabs */}
            <div 
              style={{ 
                display: 'flex', 
                gap: '0.35rem', 
                borderBottom: '1px solid var(--border-light)', 
                paddingBottom: '0.5rem', 
                flexShrink: 0,
                flexWrap: 'wrap'
              }}
            >
              {[
                { id: 'quickstart', label: '1. QUICKSTART' },
                { id: 'ab_synths', label: '2. A/B SYNTH MODES' },
                { id: 'fx_routing', label: '3. DSP FX ROUTING' },
                { id: 'piano_roll', label: '4. PIANO ROLL' },
                { id: 'midi_learn', label: '5. MIDI CC LEARN' },
                { id: 'v143_features', label: '6. v1.4.3 WORKFLOWS' },
                { id: 'v190_features', label: '7. v1.9.0 ADVANCED' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setManualTab(tab.id)}
                  style={{
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.65rem',
                    fontWeight: '800',
                    fontFamily: 'var(--font-mono)',
                    border: '1.2px solid var(--border-medium)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: manualTab === tab.id ? 'var(--accent-orange)' : 'white',
                    color: manualTab === tab.id ? 'white' : 'var(--text-primary)',
                    boxShadow: manualTab === tab.id ? '0 1px 3px rgba(224,108,67,0.2)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Scrollable Tab Content Body */}
            <div style={{ flexGrow: 1, overflowY: 'auto', fontSize: '0.85rem', lineHeight: '1.5', paddingRight: '0.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              {manualTab === 'quickstart' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>1. INTERFACE LAYOUT & OVERVIEW</h3>
                    <pre style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '0.75rem', fontSize: '0.62rem', fontFamily: 'var(--font-mono)', lineHeight: '1.25', overflowX: 'auto', margin: '0.35rem 0' }}>
{` ┌────────────────────────────────────────────────────────────────────────┐
 │ [PHYZIX] [PLAY] [SWING: 15%] [BPM: 120] [STEPS: 16] [MASTER VOLUME]    │ ◄─── Control Bar
 ├────────────────────────────────────────────────────────────────────────┤
 │ [=== 3-Band Audio-Reactive Freq-Split Waveform Crossover Banner ===]   │ ◄─── Visualizer
 ├────────────────────────────────────┬───────────────────────────────────┤
 │                                    │  [1. SEQUENCER]   [2. FX BANK]    │
 │  Instrument Cards (Tracks 0 - 11)  │  [3. PIANO ROLL]  [4. MANUAL]     │ ◄─── Page Tabs
 │                                    ├───────────────────────────────────┤
 │  ┌──────────────────────────────┐  │                                   │
 │  │ TRACK 0: KICK DRUM  [A] [B]  │  │  Active Sequencer/Editor Page     │
 │  │ (Decay, Tone, Crunch, Vol)   │  │  e.g. 12-Track Piano Roll Grid    │ ◄─── Workspace
 │  │ [ Learn MIDI ]               │  │  or Effects Module Routing        │
 │  │ └──────────────────────────────┘  │                                   │
 └────────────────────────────────────┴───────────────────────────────────┘`}
                    </pre>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.25rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>2. GETTING STARTED & SYSTEM CLOCK</h3>
                    <p style={{ margin: 0 }}>
                      Phyzix Slams and Bams is a professional 12-track analog-style synthesized drum machine. To begin playback:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>Click the **PLAY** button in the transport toolbar to start the high-precision clock loop.</li>
                      <li>Modify the **BPM** input box to adjust playback tempo on the fly (40 to 240 BPM).</li>
                      <li>Change the sequencer pattern grid size from **8 to 64 steps** using the **Steps** dropdown.</li>
                      <li>Adjust the **Swing** dial to delay off-beat 16th notes, adding a humanized groove element.</li>
                      <li>Attenuate or boost the global signal output (0% to 150%) using the top-right **Master Volume** dial.</li>
                    </ul>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-teal)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>3. 3-BAND FREQUENCY-SPLIT VISUALIZER</h3>
                    <p style={{ margin: 0 }}>
                      The premium real-time crossover visualizer filters the master mix signal through parallel crossovers to analyze frequency bands independently:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li><strong style={{ color: '#e06c43' }}>Sub/Bass (Lows)</strong>: Amber Oscilloscope (&lt; 180 Hz). Displays heavy kick drum punch and tom booms.</li>
                      <li><strong style={{ color: '#43bda6' }}>Clap/Snare (Mids)</strong>: Jade Oscilloscope (180 Hz - 3.5 kHz). Represents snare snaps and core frequencies.</li>
                      <li><strong style={{ color: '#439ebd' }}>Hat/Ride (Highs)</strong>: Cobalt Oscilloscope (&gt; 3.5 kHz). Flutters on metal cymbals and high-pitched transients.</li>
                    </ul>
                  </div>
                </>
              )}

              {manualTab === 'ab_synths' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>1. DUAL SYNTH MODE SWITCHES (A / B)</h3>
                    <p style={{ margin: 0 }}>
                      Every synthesized track (0 to 10) features an elegant **Mode Selector Switch** under its name header. Clicking **A** triggers the standard analog drum synth, while clicking **B** hot-swaps the underlying DSP engine to a completely unique, alternate synthesizer archetype.
                    </p>
                    <div style={{ background: 'rgba(75, 155, 148, 0.08)', border: '1px solid var(--accent-teal-glow)', borderRadius: '8px', padding: '0.6rem', marginTop: '0.25rem', fontSize: '0.75rem' }}>
                      <strong style={{ color: 'var(--accent-teal)' }}>EXCLUSIVE CHOKE GROUP (HI-HATS):</strong> Track 2 (Closed Hi-Hat) and Track 3 (Open Hi-Hat) are configured as an exclusive choke group. Triggering a Closed Hat will instantly damp any sustaining Open Hat tail using a click-free 15ms linear gain envelope, providing realistic, highly organic drum machine performance.
                    </div>
                    <pre style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '0.75rem', fontSize: '0.65rem', fontFamily: 'var(--font-mono)', lineHeight: '1.35', overflowX: 'auto', margin: '0.35rem 0' }}>
{`                 ┌───────────► [ ANALOG ENGINE (A) ] ──────────┐
                 │                                             │
  [ STEP GATE ] ─┼─ (Track Toggle A/B)                         ├──► [ TRACK VOLUME ] ──► (To Mixer)
                 │                                             │
                 └───────────► [ ALTERNATE DSP (B) ] ──────────┘`}
                    </pre>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-teal)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>2. KEY ALTERNATE DSP ARCHETYPES</h3>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      <li><strong>Track 0 (Kick B - 808 Sub)</strong>: A heavy 808-style tunable sub bass. The decay control supports extremely long rings (up to 4 seconds). The **Drive** dial is repurposed as a **Click/Punch** transient control, allowing you to blend a sharp high-frequency edge at the trigger onset.</li>
                      <li><strong>Track 3 (Open Hat B - Reverse Open Hat)</strong>: Reverse Hi-Hat crescendo. The **Decay** dial acts as a quantized step selector (1 to 4 steps), calculating exact envelope crescendo timings scaled automatically to the system BPM.</li>
                      <li><strong>Track 4 (Ride B - FM Gong)</strong>: Complex frequency-modulated resonant cluster gong simulating rich, dark bronze metallic bell sweeps.</li>
                      <li><strong>Track 5 (Clap B - Snap)</strong>: A crisp acoustic finger snap featuring a very short highpass-filtered white noise tail.</li>
                      <li><strong>Track 6 (Toms B - Bomba Drum)</strong>: Highly resonant Puerto Rican Bomba skin drum with sweeping bandpass filter resonances tunable per step.</li>
                      <li><strong>Track 10 (Crunch B - Funk Guitar Wah)</strong>: Chopped Funk Guitar percussive sweep using an envelope-swept bandpass filter driven by the Crunch overdrive dial.</li>
                      <li><strong>Other Track alternates</strong>: Track 1 Snare B (Crisp Sidestick/Rimshot), Track 2 Closed Hat B (Diffuse Shaker), Track 7 Beep B (Chiptune Laser sweep down), Track 8 Blip B (Water Drop "Plop" sweep up), Track 9 Bloop B (Jump Spring sweep down-up).</li>
                    </ul>
                  </div>
                </>
              )}

              {manualTab === 'fx_routing' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>1. MODULAR DSP ROUTING CHAIN</h3>
                    <p style={{ margin: 0 }}>
                      Phyzix routes its 12 voices through a highly customizable master effects bank. Select individual tracks to bypass the Master Bitcrusher using their **CRUNCH** bypass buttons in the card footers. The rest of the signal flow is fully re-routable:
                    </p>
                    <pre style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '0.75rem', fontSize: '0.65rem', fontFamily: 'var(--font-mono)', lineHeight: '1.35', overflowX: 'auto', margin: '0.35rem 0' }}>
{`  [ Synth Voices ] ────> [ Crunch Bypass? ] ──(No)──> [ Bitcrusher ] ────┐
          │                                                               │
          └─────────────(Yes)─────────────────────────────────────────────┼─> [ FX Chain Input ]
                                                                          │
  ┌───────────────────────────────────────────────────────────────────────┘
  │
  └─> [ Modular FX Chain: Live Re-routable (Saturator ➔ Filter ➔ Delay ➔ Reverb ➔ Sidechain) ] ──> [ Master Output ]`}
                    </pre>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-teal)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>2. STEP-BY-STEP FX AUTOMATION RECORDING</h3>
                    <p style={{ margin: 0 }}>
                      You can record effects sweeps and module triggers directly into step sequences:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>Turn **Record Pitch** (ON) in the transport bar during active playback.</li>
                      <li>Check/uncheck FX boxes (Saturator, Filter, Delay, Reverb, Sidechain, Bitcrusher) or drag their knobs on Page 2.</li>
                      <li>These settings are stamped directly onto the current active sequencer step (0 to 64).</li>
                      <li>During playback, the engine sweeps these parameters in real time as the playhead advances, enabling dynamic loops.</li>
                      <li>To clear all sweeps instantly, click the **WIPE FX AUTO** button inside the Effects page header.</li>
                    </ul>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>3. DYNAMIC SIDECHAIN COMPRESSOR</h3>
                    <p style={{ margin: 0 }}>
                      The dynamic **Sidechain Compressor** is a high-performance pumping effect tied directly to Kick triggers (Track 0/Ate Oh Ate). Whenever a Kick is triggered:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>**Depth (Ratio)**: Controls how much the master output ducks (0% to 100%). At 100%, the rest of the mix ducks completely to silence when the Kick hits.</li>
                      <li>**Attack**: Adjusts the ducking onset time (2ms to 100ms) to let transients slide through or clamp down immediately.</li>
                      <li>**Release**: Adjusts the volume recovery duration (20ms to 1000ms), delivering that signature electronic music pumping swing.</li>
                    </ul>
                  </div>
                </>
              )}

              {manualTab === 'piano_roll' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>1. PIANO ROLL MIDI GRID EDITOR</h3>
                    <p style={{ margin: 0 }}>
                      The **PIANO ROLL** tab displays a comprehensive MIDI editor view. The left panel shows vertical track labels representing each of the 12 drum tracks. The right grid displays the steps horizontally. Clicking any step in a track lane toggles a note hit on that step, providing an alternative, visually coherent view to orchestrate beats.
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-teal)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>2. DRAGGABLE STEP VELOCITY LANE</h3>
                    <p style={{ margin: 0 }}>
                      Beneath the main Piano Roll grid is the **Velocity Lane** for the selected instrument:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>Active notes show as colored vertical sliders aligned with the step column.</li>
                      <li>**Drag the circular handles** vertically to adjust step note velocity (0% to 100%).</li>
                      <li>Notes punched in via the standard grid sequencer or step recorder default to **50% velocity** automatically.</li>
                      <li>The synthesis engine scales each track's master gain in real-time according to these velocity levels, allowing for natural accents, ghost notes, and dynamic build-ups!</li>
                      <li>Step velocities are also fully mapped during **MIDI File Export (.mid)**, embedding professional velocity dynamics directly into your exported DAW patterns!</li>
                    </ul>
                  </div>
                </>
              )}

              {manualTab === 'midi_learn' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>1. HARDWARE MIDI CONTROLLER MAPPING</h3>
                    <p style={{ margin: 0 }}>
                      Right-click on any control dial or knob to open the MIDI context menu:
                    </p>
                    <ol style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>Select **"Learn MIDI CC"** from the context menu (the dial will enter learning mode).</li>
                      <li>Move any physical dial, slider, or controller knob on your external MIDI keyboard.</li>
                      <li>The on-screen knob will instantly bind to that control and map its movements!</li>
                    </ol>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-teal)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>2. CLEARING MIDI BINDINGS & CC OVERLAY</h3>
                    <p style={{ margin: 0 }}>
                      To clear a binding or toggle overlays:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>Right-click the mapped knob and select **"Clear Binding"** to remove the mapping.</li>
                      <li>Click the **"SHOW MIDI CC"** button in the header toolbar to display a semi-transparent orange overlay showing all active CC mapping numbers directly on top of controls.</li>
                    </ul>
                  </div>
                </>
              )}

              {manualTab === 'v143_features' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>1. COLLAPSIBLE DRUMS PANEL</h3>
                    <p style={{ margin: 0 }}>
                      The **COLLAPSE VIEW** toggle button in the toolbar lets you shrink down the drums panel instantly. When active, it hides all dial sections, custom samplers, and mode switchers, leaving a clean, compact horizontal row of 12 pads. This is highly useful on smaller displays, allowing the Piano Roll and Effects dashboard to be fully visible simultaneously!
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-teal)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>2. PROPRIETARY PATTERN PRESETS (.PSNB)</h3>
                    <p style={{ margin: 0 }}>
                      Phyzix introducing a proprietary format, **.PSNB**, that captures all configuration information beyond simple MIDI! It saves:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <li>Full sequencer step grid triggers and track mute states</li>
                      <li>Per-step velocity values and micro-timing adjustments</li>
                      <li>Custom sampler start/end crop points and filename tags</li>
                      <li>All modular FX parameters, bypass status, and custom DSP routing orders</li>
                      <li>All recorded step parameter motion and pitch automation sweeps</li>
                    </ul>
                    <p style={{ margin: 0 }}>
                      Click **EXPORT PATTERN** to save a `.psnb` file onto your disk, and **IMPORT PATTERN** to restore any preset instantly!
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid #7c3aed', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>3. REAL-TIME KNOB MOTION & UNDO BINDINGS</h3>
                    <p style={{ margin: 0 }}>
                      During playback, automated knobs will dynamically rotate and animate in real-time, showing your recorded motion sweeps on screen.
                    </p>
                    <p style={{ margin: 0 }}>
                      If a knob has automation sweeps recorded on it, a tiny orange **"M" (Motion)** badge will render next to its label. Click the **"M"** badge to safely erase automation for *that specific dial only*, preserving other parameters intact!
                    </p>
                  </div>
                </>
              )}

              {manualTab === 'v190_features' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-orange)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>1. "SLAM THE DOOR" ACOUSTIC DSP EFFECT</h3>
                    <p style={{ margin: 0 }}>
                      Press and hold the orange **SLAM THE DOOR** button in the header (or check the **LATCH SLAM** box underneath to keep it engaged). During active sequencer playback, engagement delays until the next **1st or 4th beat** of the measure for a seamless transition. A gentle **150ms** crossfade attack is used to route the master mix through an acoustic filter chain (with a dedicated **SLAM MIX** knob to blend between clean and processed signals):
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <li>**Vintage speaker lowpass filter**: Muffles high-end above **450Hz** to let more mid frequencies pass through.</li>
                      <li>**Squashed dynamics compressor**: Applies a heavy **8:1 ratio** limit at a **-32dB threshold**, producing a high-pressure pumping effect.</li>
                      <li>**Sub-bass booming sweep**: Automatically injects a powerful 55Hz down-swept booming sub-bass note with a 3.0s decay on the 1st or 4th beat of each measure.</li>
                    </ul>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid var(--accent-teal)', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>2. STEP STUTTERS & MICRO-ROLLS</h3>
                    <p style={{ margin: 0 }}>
                      Select a **PAINT ROLL** multiplier (1x, 2x, 3x, 4x) inside the sequencer grid header. Click or paint on steps to division-multiply that step duration into rapid sub-hits, producing modern rolling hi-hats, snare rushes, and glitch stutter breaks in perfect clock sync.
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '800', borderLeft: '3px solid #7c3aed', paddingLeft: '0.45rem', margin: 0, fontFamily: 'var(--font-mono)' }}>3. DYNAMIC MOTION AUTOMATION & CLEAN SWEEPS</h3>
                    <p style={{ margin: 0 }}>
                      Activate **RECORD MOTION** in the toolbar to record real-time dial movements on *any* instrument card dial directly into sequencer steps during playback! Mapped knobs will rotate dynamically to demonstrate sweeps. To erase automation loops safely:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <li>Click the **WIPE** button on any individual Drum Card footer to wipe that track's dial sweeps.</li>
                      <li>Click the **WIPE** button on any FX Module header to erase its parameters sweep path.</li>
                      <li>Click the global **CLEAR ALL MOTION** button in the utilities toolbar to erase all motion sweeps across the entire project instantly!</li>
                    </ul>
                  </div>
                </>
              )}

            </div>

            {/* Close Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-medium)', paddingTop: '1rem', flexShrink: 0 }}>
              <button 
                onClick={() => setShowManual(false)}
                style={{
                  background: 'var(--text-primary)',
                  border: 'none',
                  color: 'white',
                  borderRadius: '8px',
                  padding: '0.5rem 1.5rem',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'background 0.15s ease'
                }}
              >
                CLOSE MANUAL
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <>
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 9999,
              background: 'transparent'
            }}
            onClick={() => setContextMenu(null)}
          />
          <div 
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 10000,
              background: 'white',
              border: '1.2px solid var(--border-medium)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-lg)',
              padding: '0.25rem',
              display: 'flex',
              flexDirection: 'column',
              minWidth: '130px'
            }}
          >
            <button 
              onClick={() => {
                handleMidiLearn(contextMenu.channelId, contextMenu.paramKey);
                setContextMenu(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                textAlign: 'left',
                padding: '0.4rem 0.6rem',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: 'pointer',
                borderRadius: '4px',
                color: 'var(--text-primary)'
              }}
              onMouseEnter={(e) => e.target.style.background = 'rgba(230, 126, 34, 0.1)'}
              onMouseLeave={(e) => e.target.style.background = 'none'}
            >
              Learn MIDI CC
            </button>
            <button 
              onClick={() => {
                handleMidiUnbind(contextMenu.channelId, contextMenu.paramKey);
                setContextMenu(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                textAlign: 'left',
                padding: '0.4rem 0.6rem',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: 'pointer',
                borderRadius: '4px',
                color: 'var(--accent-red)'
              }}
              onMouseEnter={(e) => e.target.style.background = 'rgba(231, 76, 60, 0.1)'}
              onMouseLeave={(e) => e.target.style.background = 'none'}
            >
              Clear Binding
            </button>
          </div>
        </>
      )}
    </div>
  );
}
