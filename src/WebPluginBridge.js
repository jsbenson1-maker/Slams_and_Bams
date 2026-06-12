// WebPluginBridge.js - Web Audio interceptor and bidirectional IPC bridge for DAW hosting

export function initPluginBridge(audioEngine) {
  // Check if we are running inside WebView2 (Windows) or WKWebView (macOS)
  const isWebView2 = window.chrome && window.chrome.webview;
  const isWKWebView = window.webkit && window.webkit.messageHandlers;
  
  if (!isWebView2 && !isWKWebView) {
    // Not running inside DAW plugin hosting environment, stay in standalone mode
    return;
  }

  audioEngine.log("Plugin host wrapper environment detected. Activating Web-to-Native DAW IPC Bridge.", "INFO");
  window.isDawPlugin = true;

  try {
    // 1. Setup Audio buffer capture using a robust, highly compatible ScriptProcessorNode
    // Size 512 is an excellent balance between low latency and message throughput
    const bufferSize = 512;
    const processor = audioEngine.ctx.createScriptProcessor(bufferSize, 2, 2);
    
    // Disconnect master analyser from standard computer speakers
    audioEngine.analyser.disconnect(audioEngine.ctx.destination);
    
    // Route the master sound stream through the bridge interceptor
    audioEngine.analyser.connect(processor);
    processor.connect(audioEngine.ctx.destination); // keeps processor clock ticking

    processor.onaudioprocess = (e) => {
      const left = e.inputBuffer.getChannelData(0);
      const right = e.inputBuffer.getChannelData(1);

      // Check for JUCE 8 native integration
      if (window.Juce) {
        try {
          const juceAudioBridge = window.Juce.getNativeFunction("phyzixAudioBridge");
          juceAudioBridge({
            left: Array.from(left),
            right: Array.from(right)
          });
          return; // Successfully sent to DAW audio thread
        } catch (err) {
          // Fallback to standard messages
        }
      }

      // Package float arrays for standalone or alternative bridges
      const payload = {
        type: 'AUDIO_BLOCK',
        left: Array.from(left),
        right: Array.from(right)
      };

      if (isWebView2) {
        // Windows WebView2 Bridge (Electron Standalone)
        window.chrome.webview.postMessage(payload);
      } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.phyzixBridge) {
        // macOS WKWebView Bridge
        window.webkit.messageHandlers.phyzixBridge.postMessage(payload);
      }
    };

    // 2. Setup bidirectional callback listener to receive DAW MIDI notes and automated dial sweeps
    const handleDawMessage = (msg) => {
      if (!msg) return;
      
      let parsed = msg;
      if (typeof msg === 'string') {
        try {
          parsed = JSON.parse(msg);
        } catch (e) {
          return;
        }
      }

      if (parsed.type === 'MIDI_NOTE_ON') {
        const instIdx = parsed.instrumentIndex;
        if (instIdx !== undefined && instIdx >= 0 && instIdx < 12) {
          audioEngine.triggerInstrument(instIdx);
        }
      } else if (parsed.type === 'PARAM_UPDATE') {
        const { channelId, paramKey, value } = parsed;
        if (channelId !== undefined && paramKey) {
          // Adjust parameter directly in active synthesis engines
          audioEngine.updateParams(channelId, { [paramKey]: value });
          
          // Trigger a custom event to notify React UI to sweep the visual knob
          const event = new CustomEvent('daw-param-update', {
            detail: { channelId, paramKey, value }
          });
          window.dispatchEvent(event);
        }
      }
    };

    if (isWebView2) {
      window.chrome.webview.addEventListener('message', (event) => {
        handleDawMessage(event.data);
      });
    } else {
      // Expose globally so WKWebView or JUCE can call it
      window.handleDawMessage = handleDawMessage;
      window.onPluginMessage = handleDawMessage;
    }

    audioEngine.log("Web-to-Native DAW IPC Bridge successfully connected.", "INFO");
  } catch (err) {
    audioEngine.log(`Failed to initialize DAW bridge: ${err.message}`, "ERROR");
  }
}
