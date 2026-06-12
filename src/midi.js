// midi.js - Web MIDI API integration with dynamic MIDI CC Learn mapping

class MidiManager {
  constructor() {
    this.midiAccess = null;
    this.inputs = [];
    
    // MIDI CC Mapping state: maps CC number -> { channelId, paramKey }
    // Example: { "74": { channelId: 0, paramKey: "decay" } }
    this.ccMappings = {};
    
    // Learning status
    this.learningKnob = null; // { channelId, paramKey }
    
    // Callbacks to notify UI state changes
    this.onNoteOn = null;       // (instrumentIndex)
    this.onCcValueChange = null; // (channelId, paramKey, normalizedValue)
    this.onStatusChange = null;  // (statusString, isConnected)
    this.onMidiActivity = null;  // trigger simple flash callback

    // Default Note-to-Pad mapping
    // MIDI note standard numbers (often GM drum map)
    this.noteToInstrumentMap = {
      36: 0,  // C1 - Kick
      38: 1,  // D1 - Snare
      42: 2,  // F#1 - Closed Hat
      46: 3,  // A#1 - Open Hat
      51: 4,  // D#2 - Ride Cymbal
      39: 5,  // D#1 - Clap
      41: 6,  // F1 - Tom
      48: 7,  // C2 - Tom High (also triggers beep in alternative)
      60: 7,  // C3 - Beep
      62: 8,  // D3 - Blip
      64: 9,  // E3 - Bloop
      65: 10  // F3 - Noisy Crunch
    };
  }

  // Request access
  async init() {
    if (this.midiAccess) return true;

    try {
      if (!navigator.requestMIDIAccess) {
        this.updateStatus("MIDI Not Supported", false);
        return false;
      }

      this.midiAccess = await navigator.requestMIDIAccess();
      this.loadMappings();
      this.scanDevices();

      // Listen for hardware connections/disconnections
      this.midiAccess.onstatechange = () => {
        this.scanDevices();
      };

      return true;
    } catch (e) {
      console.warn("MIDI access request rejected or failed:", e);
      this.updateStatus("MIDI Blocked", false);
      return false;
    }
  }

  // Scan for active MIDI ports
  scanDevices() {
    this.inputs = Array.from(this.midiAccess.inputs.values());
    
    if (this.inputs.length > 0) {
      const names = this.inputs.map(i => i.name).join(", ");
      this.updateStatus(`Connected: ${this.inputs.length} device(s)`, true);
      
      // Hook up input events
      this.inputs.forEach(input => {
        input.onmidimessage = (msg) => this.handleMidiMessage(msg);
      });
    } else {
      this.updateStatus("No Devices Found", false);
    }
  }

  updateStatus(status, isConnected) {
    if (this.onStatusChange) {
      this.onStatusChange(status, isConnected);
    }
  }

  // Set active learn target
  startLearning(channelId, paramKey) {
    this.learningKnob = { channelId, paramKey };
    if (this.onStatusChange) {
      this.onStatusChange("Learning CC...", true);
    }
  }

  cancelLearning() {
    this.learningKnob = null;
    this.scanDevices();
  }

  // Handle inbound raw byte packets
  handleMidiMessage(event) {
    const data = event.data;
    if (data.length < 3) return;

    const command = data[0] & 0xf0;
    const noteOrControl = data[1];
    const velocityOrVal = data[2];

    // Trigger visual MIDI indicator
    if (this.onMidiActivity) {
      this.onMidiActivity();
    }

    // 1. NOTE ON MESSAGE
    if (command === 0x90 && velocityOrVal > 0) {
      const instIndex = this.noteToInstrumentMap[noteOrControl];
      if (instIndex !== undefined && this.onNoteOn) {
        this.onNoteOn(instIndex);
      }
    }

    // 2. CONTROL CHANGE (CC) MESSAGE
    if (command === 0xb0) {
      const ccNumber = noteOrControl;
      const ccValue = velocityOrVal; // 0-127

      // If in Learn Mode: bind CC to the active knob
      if (this.learningKnob) {
        const { channelId, paramKey } = this.learningKnob;
        
        // Remove existing mappings for this exact knob to prevent duplicates
        this.unbindKnob(channelId, paramKey);
        
        // Map CC number to the learning knob parameters
        this.ccMappings[ccNumber] = { channelId, paramKey };
        this.saveMappings();
        
        this.learningKnob = null; // Exit learn state
        this.scanDevices();      // Reset status bar text
        
        if (this.onStatusChange) {
          this.onStatusChange(`Mapped CC ${ccNumber}!`, true);
        }
        return;
      }

      // If not learning: look up CC in our mappings
      const mapping = this.ccMappings[ccNumber];
      if (mapping && this.onCcValueChange) {
        const normalizedVal = ccValue / 127.0; // 0.0 to 1.0
        this.onCcValueChange(mapping.channelId, mapping.paramKey, normalizedVal);
      }
    }
  }

  // Remove existing CC bindings
  unbindKnob(channelId, paramKey) {
    for (const ccNum in this.ccMappings) {
      const m = this.ccMappings[ccNum];
      if (m.channelId === channelId && m.paramKey === paramKey) {
        delete this.ccMappings[ccNum];
      }
    }
    this.saveMappings();
  }

  // Retrieve bound CC number for a specific parameter (to render in UI)
  getCcMappingForParam(channelId, paramKey) {
    for (const ccNum in this.ccMappings) {
      const m = this.ccMappings[ccNum];
      if (m.channelId === channelId && m.paramKey === paramKey) {
        return parseInt(ccNum, 10);
      }
    }
    return null;
  }

  // Save to LocalStorage
  saveMappings() {
    localStorage.setItem("phyzix_midi_mappings", JSON.stringify(this.ccMappings));
  }

  // Load from LocalStorage
  loadMappings() {
    const saved = localStorage.getItem("phyzix_midi_mappings");
    if (saved) {
      try {
        this.ccMappings = JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved MIDI mappings:", e);
        this.ccMappings = {};
      }
    }
  }
}

export const midiManager = new MidiManager();
