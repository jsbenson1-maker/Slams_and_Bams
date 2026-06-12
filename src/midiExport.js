// midiExport.js - Pure JavaScript Standard MIDI File (SMF) Serializer (v1.0.0)

// Standard General MIDI (GM) Drum Notes mapping for each track:
const GM_DRUMS = [
  36, // Track 0: Kick -> Bass Drum 1
  38, // Track 1: Snare -> Acoustic Snare
  42, // Track 2: Closed Hat -> Closed Hi-Hat
  46, // Track 3: Open Hat -> Open Hi-Hat
  51, // Track 4: Ride -> Ride Cymbal 1
  39, // Track 5: Clap -> Hand Clap
  47, // Track 6: Toms -> Low-Mid Tom
  60, // Track 7: Beep -> Middle C (with pitch offset)
  64, // Track 8: Blip -> E3 (with pitch offset)
  67, // Track 9: Bloop -> G3 (with pitch offset)
  56, // Track 10: Crunch -> Cowbell
  69  // Track 11: Sample -> A3
];

// Helper: Convert number to Variable Length Quantity (VLQ) byte array
function toVLQ(val) {
  const bytes = [];
  let buffer = val & 0x7F;
  while ((val >>>= 7) > 0) {
    buffer <<= 8;
    buffer |= ((val & 0x7F) | 0x80);
  }
  while (true) {
    bytes.push(buffer & 0xFF);
    if (buffer & 0x80) {
      buffer >>>= 8;
    } else {
      break;
    }
  }
  return bytes;
}

/**
 * Compiles active sequencer grid states into standard Single-Track MIDI file bytes.
 * Mapped to General MIDI Channel 10 (percussion).
 */
export function exportToMidi(gridData, bpm, stepsCount, tomPitches, beepPitches, blipPitches, bloopPitches, velocityData) {
  const ticksPerQuarterNote = 96;
  const ticksPerStep = 24; // 16th note subdivisions (96 / 4)
  
  const events = [];
 
  // Generate Note On & Note Off events
  for (let trackIdx = 0; trackIdx < gridData.length; trackIdx++) {
    const track = gridData[trackIdx];
    const baseNote = GM_DRUMS[trackIdx] || 60;
    
    for (let stepIdx = 0; stepIdx < stepsCount; stepIdx++) {
      if (track[stepIdx]) {
        let note = baseNote;
        
        // Dynamic pitch offset calculation for pitchable synthesis engines
        if (trackIdx === 6) { // Toms
          note = baseNote + Math.round((tomPitches[stepIdx] - 0.5) * 12);
        } else if (trackIdx === 7) { // Beep
          note = baseNote + Math.round((beepPitches[stepIdx] - 0.5) * 24);
        } else if (trackIdx === 8) { // Blip
          note = baseNote + Math.round((blipPitches[stepIdx] - 0.5) * 24);
        } else if (trackIdx === 9) { // Bloop
          note = baseNote + Math.round((bloopPitches[stepIdx] - 0.5) * 24);
        }
        
        const tickOn = stepIdx * ticksPerStep;
        const tickOff = tickOn + 18; // 75% step duration gate length
        
        const stepVel = (velocityData && velocityData[trackIdx]) 
          ? Math.round((velocityData[trackIdx][stepIdx] ?? 0.5) * 127) 
          : 64;
        
        events.push({
          tick: tickOn,
          type: 'on',
          note: Math.max(0, Math.min(127, note)),
          velocity: Math.max(1, Math.min(127, stepVel))
        });
        
        events.push({
          tick: tickOff,
          type: 'off',
          note: Math.max(0, Math.min(127, note)),
          velocity: 0
        });
      }
    }
  }

  // Sort: Chronological tick time first, then Note Offs before Note Ons at identical ticks
  events.sort((a, b) => {
    if (a.tick !== b.tick) {
      return a.tick - b.tick;
    }
    return a.type === 'off' ? -1 : 1;
  });

  const trackData = [];

  // 1. Meta Event: Set Tempo
  // Microseconds per beat = 60,000,000 / BPM
  const tempoUS = Math.round(60000000 / bpm);
  const tByte1 = (tempoUS >> 16) & 0xFF;
  const tByte2 = (tempoUS >> 8) & 0xFF;
  const tByte3 = tempoUS & 0xFF;
  
  // Set Tempo delta-time = 0
  trackData.push(0x00, 0xFF, 0x51, 0x03, tByte1, tByte2, tByte3);

  // 2. Meta Event: Time Signature (4/4 time)
  // Delta-time = 0
  trackData.push(0x00, 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  // Serialize note events with VLQ delta-ticks
  let lastTick = 0;
  for (const event of events) {
    const delta = event.tick - lastTick;
    lastTick = event.tick;
    
    const vlqBytes = toVLQ(delta);
    trackData.push(...vlqBytes);
    
    // Status bytes 0x99 and 0x89 map to GM percussion Channel 10
    if (event.type === 'on') {
      trackData.push(0x99, event.note, event.velocity);
    } else {
      trackData.push(0x89, event.note, event.velocity);
    }
  }

  // 3. Meta Event: End of Track (Delta-time = 0)
  trackData.push(0x00, 0xFF, 0x2F, 0x00);

  // Header Chunk (MThd)
  const header = [
    0x4D, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // Chunk size = 6
    0x00, 0x00,             // Format = 0 (single track file)
    0x00, 0x01,             // Number of tracks = 1
    0x00, 0x60              // Time division = 96 ticks per quarter note
  ];

  // Track Chunk (MTrk) header with calculated size bytes
  const trackHeader = [
    0x4D, 0x54, 0x72, 0x6B, // "MTrk"
    (trackData.length >> 24) & 0xFF,
    (trackData.length >> 16) & 0xFF,
    (trackData.length >> 8) & 0xFF,
    trackData.length & 0xFF
  ];

  // Combine headers and serialized bytes
  return new Uint8Array([...header, ...trackHeader, ...trackData]);
}
