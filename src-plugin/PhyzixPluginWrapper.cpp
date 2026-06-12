// PhyzixPluginWrapper.cpp - Native C++ Synthesis Engines, Sequencer Clock, and LookAndFeel GUI (v2.1.0)
#include <JuceHeader.h>
#include <cmath>
#include <vector>
#include <map>
#include <atomic>
#include <random>
#include <algorithm>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// =============================================================================
// 1. LIGHTWEIGHT DSP HELPERS
// =============================================================================

class WhiteNoise {
public:
    WhiteNoise() : dist(-1.0f, 1.0f) {}
    float nextSample() {
        return dist(gen);
    }
private:
    std::mt19937 gen{std::random_device{}()};
    std::uniform_real_distribution<float> dist;
};

class Envelope {
public:
    void trigger(float decaySeconds, double sampleRate, float startGain = 1.0f, float attackSeconds = 0.0f) {
        currentGain = attackSeconds > 0.0f ? 0.0f : startGain;
        targetGain = startGain;
        
        if (decaySeconds <= 0.001f) decaySeconds = 0.001f;
        decayFactor = std::exp(-1.0f / (sampleRate * decaySeconds));
        
        if (attackSeconds > 0.0f) {
            attackStep = 1.0f / (float)(sampleRate * attackSeconds);
            isAttacking = true;
        } else {
            attackStep = 0.0f;
            isAttacking = false;
        }
    }
    float nextSample() {
        if (isAttacking) {
            currentGain += attackStep;
            if (currentGain >= targetGain) {
                currentGain = targetGain;
                isAttacking = false;
            }
            return currentGain;
        }
        currentGain *= decayFactor;
        if (currentGain < 0.0001f) currentGain = 0.0f;
        return currentGain;
    }
    bool isActive() const { return currentGain > 0.0f || isAttacking; }
    void kill() { currentGain = 0.0f; isAttacking = false; }
private:
    float currentGain = 0.0f;
    float targetGain = 1.0f;
    float decayFactor = 0.999f;
    float attackStep = 0.0f;
    bool isAttacking = false;
};

class DelayLine {
public:
    void prepare(double sampleRate) {
        buffer.resize((int)(sampleRate * 2.0) + 256, 0.0f); // max 2s delay
        writePtr = 0;
    }
    void write(float sample) {
        if (buffer.empty()) return;
        buffer[writePtr] = sample;
        writePtr = (writePtr + 1) % buffer.size();
    }
    float read(float delaySeconds, double sampleRate) {
        if (buffer.empty()) return 0.0f;
        float delaySamples = delaySeconds * (float)sampleRate;
        float readFloat = (float)writePtr - delaySamples;
        if (readFloat < 0.0f) readFloat += (float)buffer.size();
        
        int idx1 = (int)readFloat % buffer.size();
        int idx2 = (idx1 + 1) % buffer.size();
        float frac = readFloat - (float)((int)readFloat);
        
        return (1.0f - frac) * buffer[idx1] + frac * buffer[idx2];
    }
private:
    std::vector<float> buffer;
    int writePtr = 0;
};

class BiquadFilter {
public:
    enum Type { Lowpass, Highpass, Bandpass };

    void setParams(Type newType, float cutoffHz, float QVal, double sampleRate) {
        if (sampleRate <= 0) return;
        if (cutoffHz <= 20.0f) cutoffHz = 20.0f;
        if (cutoffHz >= (float)sampleRate * 0.49f) cutoffHz = (float)sampleRate * 0.49f;
        if (QVal <= 0.05f) QVal = 0.05f;

        float w0 = 2.0f * (float)M_PI * cutoffHz / (float)sampleRate;
        float alpha = std::sin(w0) / (2.0f * QVal);
        float cosw0 = std::cos(w0);

        if (newType == Lowpass) {
            b0 = (1.0f - cosw0) / 2.0f;
            b1 = 1.0f - cosw0;
            b2 = (1.0f - cosw0) / 2.0f;
            a0 = 1.0f + alpha;
            a1 = -2.0f * cosw0;
            a2 = 1.0f - alpha;
        } else if (newType == Highpass) {
            b0 = (1.0f + cosw0) / 2.0f;
            b1 = -(1.0f + cosw0);
            b2 = (1.0f + cosw0) / 2.0f;
            a0 = 1.0f + alpha;
            a1 = -2.0f * cosw0;
            a2 = 1.0f - alpha;
        } else { // Bandpass
            b0 = alpha;
            b1 = 0.0f;
            b2 = -alpha;
            a0 = 1.0f + alpha;
            a1 = -2.0f * cosw0;
            a2 = 1.0f - alpha;
        }
    }

    float process(float in) {
        float out = (b0/a0)*in + (b1/a0)*x1 + (b2/a0)*x2 - (a1/a0)*y1 - (a2/a0)*y2;
        x2 = x1;
        x1 = in;
        y2 = y1;
        y1 = out;
        return out;
    }

private:
    float b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    float x1 = 0, x2 = 0, y1 = 0, y2 = 0;
};

class ReverbNode {
public:
    void prepare(double sampleRate) {
        for (int i = 0; i < 4; ++i) {
            delays[i].prepare(sampleRate);
            filters[i].setParams(BiquadFilter::Lowpass, 4000.0f, 0.7f, sampleRate);
        }
        delayTimes = { 0.029f, 0.037f, 0.043f, 0.053f };
    }

    float process(float in, float decayTime, float mix) {
        if (mix <= 0.01f) return in;
        
        float feedback = std::min(0.92f, 0.4f + decayTime * 0.15f);
        float outAccum = 0.0f;
        
        for (int i = 0; i < 4; ++i) {
            float dOut = delays[i].read(delayTimes[i], 44100.0);
            dOut = filters[i].process(dOut);
            
            float dIn = in + dOut * feedback;
            delays[i].write(dIn);
            
            outAccum += dOut * 0.25f;
        }
        
        return (1.0f - mix) * in + mix * outAccum;
    }

private:
    DelayLine delays[4];
    BiquadFilter filters[4];
    std::vector<float> delayTimes;
};

class StereoReverb {
public:
    void prepare(double sampleRate) {
        reverbL.prepare(sampleRate);
        reverbR.prepare(sampleRate);
    }
    void process(float& left, float& right, float decayTime, float mix) {
        left = reverbL.process(left, decayTime, mix);
        right = reverbR.process(right, decayTime, mix);
    }
private:
    ReverbNode reverbL;
    ReverbNode reverbR;
};

class Compressor {
public:
    float process(float sample, float thresholdDB, float ratio, float attackMs, float releaseMs, double sampleRate) {
        float absolute = std::abs(sample);
        float db = absolute > 0.0001f ? 20.0f * std::log10(absolute) : -80.0f;
        
        if (db > thresholdDB) {
            float target = thresholdDB + (db - thresholdDB) / ratio;
            float gainDB = target - db;
            float gain = std::pow(10.0f, gainDB / 20.0f);
            
            float attCoef = std::exp(-1.0f / (sampleRate * (attackMs / 1000.0f)));
            currentGain = attCoef * currentGain + (1.0f - attCoef) * gain;
        } else {
            float relCoef = std::exp(-1.0f / (sampleRate * (releaseMs / 1000.0f)));
            currentGain = relCoef * currentGain + (1.0f - relCoef) * 1.0f;
        }
        
        return sample * currentGain;
    }
private:
    float currentGain = 1.0f;
};

class Bitcrusher {
public:
    void process(float& left, float& right, int bits, int downsample) {
        if (!enabled) return;
        float norm = std::pow(2.0f, (float)bits - 1.0f);
        sampleCounter++;
        if (sampleCounter >= downsample) {
            sampleCounter = 0;
            lastLeft = std::round(left * norm) / norm;
            lastRight = std::round(right * norm) / norm;
        }
        left = lastLeft;
        right = lastRight;
    }
    bool enabled = true;
private:
    int sampleCounter = 0;
    float lastLeft = 0.0f;
    float lastRight = 0.0f;
};

class Saturator {
public:
    float process(float in, float drive) {
        if (drive <= 0.01f) return in;
        float k = drive * 250.0f;
        float deg = (float)M_PI / 180.0f;
        float num = (3.0f + k) * in * 20.0f * deg;
        float den = (float)M_PI + k * std::abs(in);
        return num / den;
    }
};

class FXDelay {
public:
    void prepare(double sampleRate) {
        delayLineL.prepare(sampleRate);
        delayLineR.prepare(sampleRate);
    }
    void process(float& left, float& right, float time, float feedback, float mix, double sampleRate) {
        float dL = delayLineL.read(time, sampleRate);
        float dR = delayLineR.read(time, sampleRate);
        float inL = left + dL * feedback;
        float inR = right + dR * feedback;
        delayLineL.write(inL);
        delayLineR.write(inR);
        left = (1.0f - mix * 0.5f) * left + mix * dL;
        right = (1.0f - mix * 0.5f) * right + mix * dR;
    }
private:
    DelayLine delayLineL;
    DelayLine delayLineR;
};

class SidechainDuck {
public:
    void trigger(float ratio, float attackSecs, float releaseSecs, double sampleRate) {
        targetGain = 1.0f - ratio;
        attackCoef = std::exp(-1.0f / (sampleRate * (attackSecs <= 0.001f ? 0.001f : attackSecs)));
        releaseCoef = std::exp(-1.0f / (sampleRate * (releaseSecs <= 0.001f ? 0.001f : releaseSecs)));
        state = State::Attack;
    }
    float nextSample() {
        if (state == State::Idle) return 1.0f;
        if (state == State::Attack) {
            currentGain = attackCoef * currentGain + (1.0f - attackCoef) * targetGain;
            if (currentGain <= targetGain + 0.01f) {
                currentGain = targetGain;
                state = State::Release;
            }
        } else if (state == State::Release) {
            currentGain = releaseCoef * currentGain + (1.0f - releaseCoef) * 1.0f;
            if (currentGain >= 0.999f) {
                currentGain = 1.0f;
                state = State::Idle;
            }
        }
        return currentGain;
    }
private:
    enum class State { Idle, Attack, Release };
    State state = State::Idle;
    float currentGain = 1.0f;
    float targetGain = 1.0f;
    float attackCoef = 0.99f;
    float releaseCoef = 0.999f;
};

// =============================================================================
// 2. SYNTHESIS ENGINE (12 CHANNELS WITH MODE A/B)
// =============================================================================

class PhyzixAudioProcessor; // Forward declaration

// Helper function for track-specific premium colors
static juce::Colour getTrackColour (int trackIdx) {
    static const std::vector<juce::Colour> colours = {
        juce::Colour (0xffe74c3c), // Kick: Red
        juce::Colour (0xffe67e22), // Snare: Orange
        juce::Colour (0xfff1c40f), // Closed Hat: Yellow
        juce::Colour (0xff2ecc71), // Open Hat: Green
        juce::Colour (0xff1abc9c), // Ride: Teal
        juce::Colour (0xff3498db), // Clap: Light Blue
        juce::Colour (0xff9b59b6), // Toms: Deep Blue
        juce::Colour (0xff8e44ad), // Beep: Purple
        juce::Colour (0xffe84393), // Blip: Magenta
        juce::Colour (0xfffd79a8), // Bloop: Pink
        juce::Colour (0xffd35400), // Crunch: Amber
        juce::Colour (0xff20bf6b)  // Sample: Mint
    };
    if (trackIdx >= 0 && trackIdx < 12) return colours[trackIdx];
    return juce::Colour (0xffe67e22);
}

class InstrumentVoice {
public:
    void trigger(int instIdx, float volume, float decay, float tone, float sweep, float snappy, float pitch, float velocity, bool useAlt, double sampleRate) {
        this->instIdx = instIdx;
        this->volume = volume;
        this->decay = decay;
        this->tone = tone;
        this->sweep = sweep;
        this->snappy = snappy;
        this->pitch = pitch;
        this->velocity = velocity;
        this->useAlt = useAlt;
        
        phase = 0.0f;
        phase2 = 0.0f;
        modPhase = 0.0f;
        timeInSeconds = 0.0f;
        active = true;
        sampleReadPos = 0.0f;

        float effectiveDecay = decay;
        if (instIdx == 2 && decay == 0.25f) effectiveDecay = 0.06f; 
        else if (instIdx == 3 && decay == 0.25f) effectiveDecay = 0.35f;
        else if (instIdx == 0 && useAlt) { // Kick B (808)
            effectiveDecay = decay * 5.0f; // Scale decay up to 5x
        }

        float attackTime = 0.0f;
        if (instIdx == 2 && useAlt) { 
            attackTime = 0.01f;
        }
        
        gainEnv.trigger(effectiveDecay, sampleRate, volume * velocity, attackTime);
        
        if (instIdx == 1 && !useAlt) { 
            noiseEnv.trigger(effectiveDecay * 1.2f, sampleRate, volume * velocity * snappy);
        } else if (instIdx == 5 && !useAlt) { 
            clapBurstCounter = 0;
            clapBurstTimer = 0.0f;
        } else if (instIdx == 6 && useAlt) { 
            noiseEnv.trigger(0.015f, sampleRate, volume * velocity * 0.25f);
        }
        
        modEnv.trigger(effectiveDecay * 0.7f, sampleRate, tone * 1.5f * snappy); 
        
        for (int i = 0; i < 6; ++i) {
            ridePhases[i] = 0.0f;
        }
    }

    void choke() {
        if (instIdx == 3) { 
            gainEnv.kill();
            active = false;
        }
    }

    float nextSample(double sampleRate);

    bool isActive() const { return active; }
    void setProcessor(PhyzixAudioProcessor* p) { processor = p; }

private:
    int instIdx = 0;
    float volume = 0.5f;
    float decay = 0.5f;
    float tone = 1000.0f;
    float sweep = 0.5f;
    float snappy = 0.5f;
    float pitch = 0.5f;
    float velocity = 0.5f;
    bool useAlt = false;

    bool active = false;
    float phase = 0.0f;
    float phase2 = 0.0f;
    float modPhase = 0.0f;
    float ridePhases[6] = {0, 0, 0, 0, 0, 0};
    float timeInSeconds = 0.0f;

    int clapBurstCounter = 0;
    float clapBurstTimer = 0.0f;

    Envelope gainEnv;
    Envelope noiseEnv;
    Envelope modEnv;
    WhiteNoise noise;
    BiquadFilter filter;
    BiquadFilter filter2;

    PhyzixAudioProcessor* processor = nullptr;
    float sampleReadPos = 0.0f;
};

class PluginWindow : public juce::DocumentWindow {
public:
    PluginWindow(juce::AudioPluginInstance* instance, const juce::String& name)
        : DocumentWindow(name, juce::Colours::darkgrey, DocumentWindow::allButtons) {
        setUsingNativeTitleBar(true);
        if (instance != nullptr) {
            editor.reset(instance->createEditorIfNeeded());
            if (editor != nullptr) {
                setContentNonOwned(editor.get(), true);
            }
        }
        setResizable(editor != nullptr ? editor->isResizable() : false, false);
        centreWithSize(getWidth(), getHeight());
    }

    void closeButtonPressed() override {
        setVisible(false);
    }

private:
    std::unique_ptr<juce::AudioProcessorEditor> editor;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginWindow)
};

class ScanThread : public juce::Thread {
public:
    ScanThread(juce::AudioPluginFormatManager& fm, juce::KnownPluginList& kpl, const juce::FileSearchPath& paths)
        : Thread("VST Scan Thread"), formatManager(fm), knownList(kpl), searchPaths(paths) {}

    void run() override {
        for (int i = 0; i < formatManager.getNumFormats(); ++i) {
            auto* format = formatManager.getFormat(i);
            juce::PluginDirectoryScanner scanner(knownList, *format, searchPaths, true, juce::File());
            juce::String name;
            while (scanner.scanNextFile(true, name)) {
                if (threadShouldExit()) return;
            }
        }
        isDone = true;
    }

    bool isScanningDone() const { return isDone; }

private:
    juce::AudioPluginFormatManager& formatManager;
    juce::KnownPluginList& knownList;
    juce::FileSearchPath searchPaths;
    std::atomic<bool> isDone{false};
};

// =============================================================================
// 3. JUCE NATIVE AUDIO PROCESSOR ENGINE
// =============================================================================

class PhyzixAudioProcessor : public juce::AudioProcessor {
public:
    PhyzixAudioProcessor() : AudioProcessor(BusesProperties()
                                            .withInput("Input", juce::AudioChannelSet::stereo(), true)
                                            .withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
        formatManager.registerBasicFormats();

        pluginFormatManager.addFormat(std::make_unique<juce::VST3PluginFormat>());
        #if JUCE_PLUGINHOST_VST
        pluginFormatManager.addFormat(std::make_unique<juce::VSTPluginFormat>());
        #endif

        loadKnownPluginsList();

        for (int i = 0; i < 12; ++i) {
            voices[i] = std::make_unique<InstrumentVoice>();
            voices[i]->setProcessor(this);
            padTrigger[i] = false;
        }

        // Initialize default parameters matching JS App exactly
        for (int c = 0; c < 12; ++c) {
            params[c]["volume"] = (c == 4 ? 0.4f : (c == 2 || c == 3 ? 0.5f : (c == 0 ? 0.8f : (c == 11 ? 0.7f : 0.6f))));
            params[c]["decay"] = (c == 0 ? 0.25f : (c == 1 ? 0.2f : (c == 2 ? 0.06f : (c == 3 ? 0.35f : (c == 4 ? 0.8f : (c == 5 ? 0.22f : (c == 6 ? 0.35f : (c == 7 ? 0.15f : (c == 8 ? 0.04f : (c == 9 ? 0.18f : (c == 10 ? 0.4f : 1.5f)))))))))));
            params[c]["tone"] = (c == 0 ? 55.0f : (c == 1 ? 180.0f : (c == 2 || c == 3 ? 8000.0f : (c == 4 ? 350.0f : (c == 5 ? 1200.0f : (c == 6 ? 90.0f : (c == 7 ? 880.0f : (c == 8 ? 2500.0f : (c == 9 ? 800.0f : (c == 10 ? 1200.0f : 1.0f))))))))));
            params[c]["pitch"] = 1.0f; 
            params[c]["distortion"] = 0.1f; 
            params[c]["snappy"] = 0.5f; 
            params[c]["ring"] = 0.4f; 
            params[c]["spread"] = 12.0f; 
            params[c]["sweep"] = 0.45f; 
            params[c]["pulseWidth"] = 0.0f; 
            params[c]["speed"] = 0.4f; 
            params[c]["crunch"] = 0.6f; 
            params[c]["startPoint"] = 0.0f; 
            params[c]["endPoint"] = 1.0f; 
            params[c]["useAltSound"] = 0.0f; 
        }

        // Initialize 64 steps grids
        memset(patternGrid, 0, sizeof(patternGrid));
        for (int r = 0; r < 12; ++r) {
            for (int s = 0; s < 64; ++s) {
                rollGrid[r][s] = 1;
                velocityGrid[r][s] = 0.5f;
                pitchAutomationGrid[r][s] = 0.5f;
            }
        }
    }

    ~PhyzixAudioProcessor() override {
        if (scanThread != nullptr) {
            scanThread->signalThreadShouldExit();
            scanThread->stopThread(3000);
        }
        pluginWindow = nullptr;
        hostedPlugin = nullptr;
    }

    void saveKnownPluginsList() {
        juce::File appDir = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                                .getChildFile("PhyzixSnB");
        appDir.createDirectory();
        
        juce::File cacheFile = appDir.getChildFile("vst_cache.xml");
        if (auto xml = knownPluginList.createXml()) {
            xml->writeTo(cacheFile);
        }

        juce::File pathsFile = appDir.getChildFile("vst_paths.txt");
        juce::StringArray paths;
        for (auto& p : userFoldersToScan) {
            paths.add(p);
        }
        pathsFile.replaceWithText(paths.joinIntoString("\n"));
    }

    void loadKnownPluginsList() {
        juce::File appDir = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                                .getChildFile("PhyzixSnB");
        
        juce::File cacheFile = appDir.getChildFile("vst_cache.xml");
        if (cacheFile.existsAsFile()) {
            if (auto xml = juce::XmlDocument::parse(cacheFile)) {
                knownPluginList.recreateFromXml(*xml);
            }
        }

        juce::File pathsFile = appDir.getChildFile("vst_paths.txt");
        if (pathsFile.existsAsFile()) {
            juce::StringArray paths;
            paths.addLines(pathsFile.loadFileAsString());
            userFoldersToScan.clear();
            for (auto& p : paths) {
                if (p.trim().isNotEmpty()) {
                    userFoldersToScan.add(p.trim());
                }
            }
        }
    }

    juce::FileSearchPath getSearchPaths() {
        juce::FileSearchPath path;
        path.add(juce::File("C:\\Program Files\\Common Files\\VST3"));
        path.add(juce::File("C:\\Program Files\\VSTPlugins"));
        path.add(juce::File("C:\\Program Files\\Steinberg\\VSTPlugins"));
        path.add(juce::File("C:\\Program Files\\Common Files\\VST2"));
        for (auto& p : userFoldersToScan) {
            path.add(juce::File(p));
        }
        return path;
    }

    void addUserFolder(const juce::String& p) {
        if (p.isNotEmpty() && !userFoldersToScan.contains(p)) {
            userFoldersToScan.add(p);
            saveKnownPluginsList();
        }
    }

    void runScanner() {
        if (scanThread != nullptr && scanThread->isThreadRunning()) {
            return;
        }
        scanThread = std::make_unique<ScanThread>(pluginFormatManager, knownPluginList, getSearchPaths());
        scanThread->startThread();
    }

    bool isScanning() const {
        return scanThread != nullptr && scanThread->isThreadRunning();
    }

    bool loadPluginByDescription(const juce::PluginDescription& desc) {
        juce::String error;
        std::unique_ptr<juce::AudioPluginInstance> instance = pluginFormatManager.createPluginInstance(desc, currentSampleRate, lastBlockSize, error);
        if (instance == nullptr) {
            juce::Logger::writeToLog("Failed to instantiate plugin: " + desc.name + " - " + error);
            return false;
        }

        instance->setBusesLayout(getBusesLayout());
        instance->prepareToPlay(currentSampleRate, lastBlockSize);

        {
            const juce::ScopedLock sl(pluginMutex);
            hostedPlugin = std::move(instance);
        }
        return true;
    }

    void unloadPlugin() {
        const juce::ScopedLock sl(pluginMutex);
        hostedPlugin = nullptr;
    }

    // Crossover visualizer buffers
    float lowsBuffer[256] = {0};
    float midsBuffer[256] = {0};
    float highsBuffer[256] = {0};
    std::atomic<int> lowsWritePtr{0};
    std::atomic<int> midsWritePtr{0};
    std::atomic<int> highsWritePtr{0};

    // Sequencer clock properties
    std::atomic<bool> isPlaying{false};
    std::atomic<int> bpm{120};
    std::atomic<int> stepsCount{16};
    std::atomic<int> currentStep{0};
    std::atomic<float> swing{0.0f};
    std::atomic<bool> recordMotion{false};
    std::atomic<bool> slamActive{false};
    std::atomic<bool> slamPending{false};
    std::atomic<bool> slamLatched{false};
    std::atomic<float> slamWetMix{0.0f};
    juce::String timeSignature = "4/4";

    // Fills Overrides
    std::atomic<bool> fillActive{false};
    juce::String fillPattern = "traditional_a";

    // Automation loops
    std::map<juce::String, float> automationGrid[12][64];

    // Mutes & Crunch Bypasses
    bool mutes[12] = {false};
    bool channelCrunchBypass[12] = {
        true, true, true, true, true, true, true, true, true, true, true, true
    };
    
    // Param value stores
    std::map<juce::String, float> params[12];
    std::atomic<int> selectedCard{0};

    // Step sequences
    bool patternGrid[12][64];
    int rollGrid[12][64];
    float velocityGrid[12][64];
    
    // Pitch automation bends
    float pitchAutomationGrid[12][64];

    // Trigger visual feedback flags
    std::atomic<bool> padTrigger[12];

    // Session recording
    std::atomic<bool> sessionRecording{false};
    std::vector<float> sessionBufferL;
    std::vector<float> sessionBufferR;

    void exportSessionWav(const juce::File& file) {
        if (sessionBufferL.empty()) return;
        
        file.deleteFile();
        auto outStream = file.createOutputStream();
        if (outStream == nullptr) return;
        
        juce::WavAudioFormat wavFormat;
        std::unique_ptr<juce::AudioFormatWriter> writer(wavFormat.createWriterFor(
            outStream.get(), currentSampleRate, 2, 16, {}, 0));
             
        if (writer != nullptr) {
            outStream.release(); // The writer now owns the stream
            
            int totalSamples = (int)sessionBufferL.size();
            int chunkSize = 4096;
            juce::AudioBuffer<float> tempBuffer(2, chunkSize);
            
            for (int start = 0; start < totalSamples; start += chunkSize) {
                int numToWrite = std::min(chunkSize, totalSamples - start);
                
                for (int i = 0; i < numToWrite; ++i) {
                    tempBuffer.setSample(0, i, sessionBufferL[start + i]);
                    tempBuffer.setSample(1, i, sessionBufferR[start + i]);
                }
                
                writer->writeFromAudioSampleBuffer(tempBuffer, 0, numToWrite);
            }
        }
    }

    void loadPreset(int index) {
        memset(patternGrid, 0, sizeof(patternGrid));
        for (int r = 0; r < 12; ++r) {
            for (int s = 0; s < 64; ++s) {
                rollGrid[r][s] = 1;
                velocityGrid[r][s] = 0.5f;
                pitchAutomationGrid[r][s] = 0.5f; // Clear pitches
            }
        }
        
        auto setHits = [this](int ch, std::vector<int> steps) {
            for (int s : steps) {
                if (s >= 0 && s < 64) patternGrid[ch][s] = true;
            }
        };

        if (index == 0) { // Classic Techno (126 BPM)
            bpm = 126;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.0f;
            setHits(0, {0, 4, 8, 12});
            setHits(1, {4, 12});
            setHits(2, {0, 2, 4, 6, 8, 10, 12, 14});
            setHits(3, {2, 6, 10, 14});
            setHits(4, {8, 14});
        } else if (index == 1) { // Dusty Boom-Bap (90 BPM)
            bpm = 90;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.15f;
            setHits(0, {0, 8, 11});
            setHits(1, {4, 12});
            setHits(2, {0, 2, 4, 6, 8, 10, 12, 14});
            setHits(3, {6, 14});
            setHits(5, {12});
        } else if (index == 2) { // Liquid Drum & Bass (174 BPM)
            bpm = 174;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.0f;
            setHits(0, {0, 10});
            setHits(1, {4, 12});
            setHits(2, {0, 2, 4, 6, 8, 10, 12, 14});
            setHits(3, {2, 6, 14});
            setHits(4, {0, 8});
        } else if (index == 3) { // Neon Synthwave (112 BPM)
            bpm = 112;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.0f;
            setHits(0, {0, 4, 8, 12});
            setHits(1, {4, 12});
            setHits(2, {2, 6, 10, 14});
            setHits(3, {0, 8});
            setHits(5, {4, 12});
        } else if (index == 4) { // Rattling Trap (140 BPM)
            bpm = 140;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.0f;
            setHits(0, {0, 6, 8});
            setHits(1, {4, 12});
            setHits(2, {0, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 14, 15});
            setHits(3, {2, 10});
            rollGrid[2][2] = 2;
            rollGrid[2][6] = 3;
            rollGrid[2][14] = 4;
        } else if (index == 5) { // Sleek Deep House (122 BPM)
            bpm = 122;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.08f;
            setHits(0, {0, 4, 8, 12});
            setHits(1, {4, 12});
            setHits(2, {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15});
            setHits(3, {2, 6, 10, 14});
            setHits(4, {14});
            setHits(5, {12});
        } else if (index == 6) { // Industrial EBM (120 BPM)
            bpm = 120;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.0f;
            setHits(0, {0, 4, 8, 12});
            setHits(1, {4, 12});
            setHits(2, {2, 6, 10, 14});
            setHits(3, {0, 8});
            setHits(10, {2, 6, 10, 14});
        } else if (index == 7) { // Ambient Dub Space (80 BPM)
            bpm = 80;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.2f;
            setHits(0, {0, 11});
            setHits(1, {4, 12});
            setHits(2, {0, 4, 8, 12});
            setHits(3, {6, 14});
        } else if (index == 8) { // Latin Samba (110 BPM)
            bpm = 110;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.35f;
            setHits(0, {0, 3, 6, 8, 11, 14});
            setHits(1, {4, 12});
            setHits(2, {0, 2, 4, 6, 8, 10, 12, 14});
            setHits(3, {2, 10});
        } else if (index == 9) { // Minimal Glitch (125 BPM)
            bpm = 125;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.05f;
            setHits(0, {0, 8});
            setHits(1, {4, 12});
            setHits(2, {2, 6, 10, 14});
            setHits(8, {5, 13});
            setHits(9, {7, 15});
        } else if (index == 10) { // Organic Funk Break (105 BPM)
            bpm = 105;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.22f;
            setHits(0, {0, 6, 8, 14});
            setHits(1, {4, 9, 12, 15});
            setHits(2, {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15});
            setHits(3, {2, 10});
        } else if (index == 11) { // Future Bass Half-Time (140 BPM)
            bpm = 140;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.0f;
            setHits(0, {0, 8, 14});
            setHits(1, {8});
            setHits(2, {0, 2, 4, 6, 8, 10, 12, 14});
            setHits(3, {6, 14});
            setHits(5, {8});
        } else if (index == 12) { // Melodic Hip-Hop (92 BPM)
            bpm = 92;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.12f;
            setHits(0, {0, 8, 11});
            setHits(1, {4, 12});
            setHits(2, {0, 2, 4, 6, 8, 10, 12, 14});
            setHits(3, {6, 14});
            setHits(6, {0, 4, 8, 12});
            setHits(7, {2, 6, 10, 14, 15});
            pitchAutomationGrid[6][0] = 0.0167f; pitchAutomationGrid[6][4] = 0.0513f; pitchAutomationGrid[6][8] = 0.078f; pitchAutomationGrid[6][12] = 0.108f;
            pitchAutomationGrid[7][2] = 0.0857f; pitchAutomationGrid[7][6] = 0.1155f; pitchAutomationGrid[7][10] = 0.1383f; pitchAutomationGrid[7][14] = 0.1640f; pitchAutomationGrid[7][15] = 0.20f;
        } else { // Ethnic Drill (142 BPM)
            bpm = 142;
            timeSignature = "4/4";
            stepsCount = 64;
            swing = 0.0f;
            setHits(0, {0, 8, 10});
            setHits(1, {6, 14});
            setHits(2, {0, 3, 6, 8, 11, 14});
            setHits(3, {2, 10});
            setHits(7, {3, 7, 11, 15});
            setHits(9, {0, 2, 4, 8, 10, 12});
            pitchAutomationGrid[9][0] = 0.2f; pitchAutomationGrid[9][2] = 0.3f; pitchAutomationGrid[9][4] = 0.25f; pitchAutomationGrid[9][8] = 0.4f; pitchAutomationGrid[9][10] = 0.35f; pitchAutomationGrid[9][12] = 0.3f;
            pitchAutomationGrid[7][3] = 0.5f; pitchAutomationGrid[7][7] = 0.55f; pitchAutomationGrid[7][11] = 0.6f; pitchAutomationGrid[7][15] = 0.45f;
        }

        // Replicate first 16 steps to fill the rest of the 64 steps
        for (int ch = 0; ch < 12; ++ch) {
            for (int s = 16; s < 64; ++s) {
                patternGrid[ch][s] = patternGrid[ch][s % 16];
                rollGrid[ch][s] = rollGrid[ch][s % 16];
                velocityGrid[ch][s] = velocityGrid[ch][s % 16];
                pitchAutomationGrid[ch][s] = pitchAutomationGrid[ch][s % 16];
            }
        }
    }

    void saveUserPreset(const juce::String& name) {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("name", name);
        obj->setProperty("bpm", bpm.load());
        obj->setProperty("swing", swing.load());
        obj->setProperty("stepsCount", stepsCount.load());
        obj->setProperty("timeSignature", timeSignature);
        
        juce::Array<juce::var> paramsArray;
        for (int c = 0; c < 12; ++c) {
            juce::DynamicObject::Ptr pObj = new juce::DynamicObject();
            for (auto const& [key, val] : params[c]) {
                pObj->setProperty(key, val);
            }
            paramsArray.add(pObj.get());
        }
        obj->setProperty("params", paramsArray);
        
        juce::Array<juce::var> patterns;
        juce::Array<juce::var> rolls;
        juce::Array<juce::var> velocities;
        juce::Array<juce::var> pitches;
        
        for (int c = 0; c < 12; ++c) {
            juce::Array<juce::var> patRow;
            juce::Array<juce::var> rollRow;
            juce::Array<juce::var> velRow;
            juce::Array<juce::var> pitchRow;
            for (int s = 0; s < 64; ++s) {
                patRow.add(patternGrid[c][s]);
                rollRow.add(rollGrid[c][s]);
                velRow.add(velocityGrid[c][s]);
                pitchRow.add(pitchAutomationGrid[c][s]);
            }
            patterns.add(patRow);
            rolls.add(rollRow);
            velocities.add(velRow);
            pitches.add(pitchRow);
        }
        obj->setProperty("patternGrid", patterns);
        obj->setProperty("rollGrid", rolls);
        obj->setProperty("velocityGrid", velocities);
        obj->setProperty("pitchAutomationGrid", pitches);
        
        juce::File presetDir = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                                  .getChildFile("PhyzixSnB")
                                  .getChildFile("UserPresets");
        presetDir.createDirectory();
        juce::File file = presetDir.getChildFile(name + ".json");
        
        juce::var v(obj.get());
        juce::String jsonStr = juce::JSON::toString(v);
        file.replaceWithText(jsonStr);
    }

    bool loadUserPreset(const juce::String& name) {
        juce::File presetDir = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                                  .getChildFile("PhyzixSnB")
                                  .getChildFile("UserPresets");
        juce::File file = presetDir.getChildFile(name + ".json");
        if (!file.existsAsFile()) return false;
        
        juce::var parsed = juce::JSON::parse(file);
        if (parsed.isVoid()) return false;
        
        auto* obj = parsed.getDynamicObject();
        if (obj == nullptr) return false;
        
        if (obj->hasProperty("bpm")) bpm = (int)obj->getProperty("bpm");
        if (obj->hasProperty("swing")) swing = (float)obj->getProperty("swing");
        if (obj->hasProperty("stepsCount")) stepsCount = (int)obj->getProperty("stepsCount");
        if (obj->hasProperty("timeSignature")) timeSignature = obj->getProperty("timeSignature").toString();
        
        if (obj->hasProperty("params")) {
            auto* paramsArray = obj->getProperty("params").getArray();
            if (paramsArray != nullptr) {
                for (int c = 0; c < 12 && c < paramsArray->size(); ++c) {
                    auto* pObj = paramsArray->getReference(c).getDynamicObject();
                    if (pObj != nullptr) {
                        for (auto const& [key, val] : pObj->getProperties()) {
                            params[c][key.toString()] = (float)val;
                        }
                    }
                }
            }
        }
        
        auto parseGrid = [obj](const juce::String& propName, auto& targetGrid) {
            if (obj->hasProperty(propName)) {
                auto* arr = obj->getProperty(propName).getArray();
                if (arr != nullptr) {
                    for (int c = 0; c < 12 && c < arr->size(); ++c) {
                        auto* row = arr->getReference(c).getArray();
                        if (row != nullptr) {
                            for (int s = 0; s < 64 && s < row->size(); ++s) {
                                targetGrid[c][s] = (typename std::remove_reference_t<decltype(targetGrid[0][0])>)row->getReference(s);
                            }
                        }
                    }
                }
            }
        };
        
        parseGrid("patternGrid", patternGrid);
        parseGrid("rollGrid", rollGrid);
        parseGrid("velocityGrid", velocityGrid);
        parseGrid("pitchAutomationGrid", pitchAutomationGrid);
        
        return true;
    }

    void togglePlay() {
        isPlaying = !isPlaying.load();
        if (isPlaying) {
            currentStep = 0;
            stepSampleCounter = 0;
        }
    }

    void setSlamTheDoor(bool active) {
        if (active) {
            if (!isPlaying.load()) {
                slamActive = true;
                slamPending = false;
                triggerSlamSubBassVoice = true;
            } else {
                slamPending = true;
            }
        } else {
            slamActive = false;
            slamPending = false;
        }
    }

    // Modular FX state and parameters mapping
    std::atomic<bool> bitcrusherEnabled{true};
    std::atomic<int> bitcrusherBits{8};
    std::atomic<int> bitcrusherDownsample{1};
    Bitcrusher bitcrusher;

    std::vector<int> fxChainOrder = { 0, 1, 2, 3, 4, 5 };
    bool fxEnabled[6] = { false, false, false, false, false, false };

    juce::AudioPluginFormatManager pluginFormatManager;
    juce::KnownPluginList knownPluginList;
    std::unique_ptr<juce::AudioPluginInstance> hostedPlugin;
    juce::CriticalSection pluginMutex;
    juce::StringArray userFoldersToScan;
    std::unique_ptr<PluginWindow> pluginWindow;
    int lastBlockSize = 512;
    std::unique_ptr<ScanThread> scanThread;

    float distDrive = 0.3f;
    float filterCutoff = 1200.0f;
    float filterResonance = 2.0f;
    juce::String filterType = "lowpass";
    float delayTime = 0.3f;
    float delayFeedback = 0.4f;
    float delayMix = 0.3f;
    float reverbDecay = 1.2f;
    float reverbMix = 0.2f;
    float sidechainRatio = 0.8f;
    float sidechainRelease = 0.15f;
    float sidechainAttack = 0.01f;

    Saturator saturator;
    BiquadFilter filterL;
    BiquadFilter filterR;
    FXDelay delay;
    StereoReverb reverb;
    SidechainDuck sidechain;

    BiquadFilter lowsFilter;
    BiquadFilter midsFilter;
    BiquadFilter highsFilter;

    // Standalone parameters initialization
    void prepareToPlay(double sampleRate, int samplesPerBlock) override {
        currentSampleRate = sampleRate;
        lastBlockSize = samplesPerBlock;
        for (int i = 0; i < 12; ++i) {
            voices[i] = std::make_unique<InstrumentVoice>();
            voices[i]->setProcessor(this);
        }
        delay.prepare(sampleRate);
        reverb.prepare(sampleRate);
        
        masterSlamFilter.setParams(BiquadFilter::Lowpass, 160.0f, 1.0f, sampleRate);
        subBassOscPhase = 0.0f;
        subBassEnv = 0.0f;

        const juce::ScopedLock sl(pluginMutex);
        if (hostedPlugin != nullptr) {
            hostedPlugin->setBusesLayout(getBusesLayout());
            hostedPlugin->prepareToPlay(sampleRate, samplesPerBlock);
        }

        lowsFilter.setParams(BiquadFilter::Lowpass, 180.0f, 0.707f, sampleRate);
        midsFilter.setParams(BiquadFilter::Bandpass, 1000.0f, 1.0f, sampleRate);
        highsFilter.setParams(BiquadFilter::Highpass, 3500.0f, 0.707f, sampleRate);
    }

    void releaseResources() override {}

    bool isBusesLayoutSupported(const BusesLayout& layouts) const override {
        return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
    }

    void triggerVoice(int channel, float vel) {
        if (channel < 0 || channel >= 12) return;
        bool alt = params[channel]["useAltSound"] > 0.5f;
        
        float v = params[channel]["volume"];
        float d = params[channel]["decay"];
        float t = params[channel]["tone"];
        float sw = params[channel]["sweep"];
        float sn = params[channel]["snappy"];
        float p = params[channel]["pitch"];

        triggerVoiceWithParams(channel, v, d, t, sw, sn, p, vel, alt);
    }

    void triggerVoiceWithParams(int channel, float vol, float dec, float ton, float sw, float sn, float p, float vel, bool alt) {
        if (channel < 0 || channel >= 12) return;
        
        // Trap Open Hat step gate override
        if (channel == 3 && alt) {
            // Steps selection acts as a direct gate time
            double stepDur = 60.0 / (double)bpm.load() / 4.0;
            dec = (float)(std::max(1.0f, std::round(dec)) * stepDur);
        }

        if (channel == 2) {
            voices[3]->choke();
        }

        voices[channel]->trigger(channel, vol, dec, ton, sw, sn, p, vel, alt, currentSampleRate);
        padTrigger[channel] = true;

        if (channel == 0 && fxEnabled[4]) { // Trigger Sidechain on Kick
            sidechain.trigger(sidechainRatio, sidechainAttack, sidechainRelease, currentSampleRate);
        }
    }

    void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages) override {
        juce::ScopedNoDenormals noDenormals;
        int numSamples = buffer.getNumSamples();
        double sampleRate = currentSampleRate;

        int numInputChannels = getTotalNumInputChannels();
        if (isRecording.load()) {
            int maxSamples = recordedBuffer.getNumSamples();
            int currentWritePos = writePos;
            for (int channel = 0; channel < 2; ++channel) {
                int inputChan = std::min(channel, numInputChannels - 1);
                if (inputChan >= 0) {
                    const float* inputData = buffer.getReadPointer(inputChan);
                    float* recordData = recordedBuffer.getWritePointer(channel);
                    for (int s = 0; s < numSamples; ++s) {
                        if (currentWritePos + s < maxSamples) {
                            recordData[currentWritePos + s] = inputData[s];
                        }
                    }
                }
            }
            writePos += numSamples;
            if (writePos >= maxSamples) {
                isRecording = false;
                recordedLength = maxSamples;
            }
        }

        for (const auto metadata : midiMessages) {
            auto msg = metadata.getMessage();
            if (msg.isNoteOn()) {
                int note = msg.getNoteNumber();
                int inst = note % 12;
                triggerVoice(inst, 0.8f);
            }
        }

        float* leftChannel = buffer.getWritePointer(0);
        float* rightChannel = buffer.getWritePointer(1);

        double secondsPerBeat = 60.0 / (double)bpm.load();
        double stepDurationSecs = secondsPerBeat / 4.0;
        int standardStepDurationSamples = (int)(stepDurationSecs * sampleRate);

        for (int i = 0; i < numSamples; ++i) {
            if (isPlaying.load()) {
                double swingFactor = swing.load() * 0.55;
                double speedMultiplier = 1.0;
                if (fillActive.load() && fillPattern == "half_tempo") {
                    speedMultiplier = 2.0;
                }
                double durationFactor = (currentStep.load() % 2 == 0) ? (1.0 + swingFactor) : (1.0 - swingFactor);
                int targetStepSamples = (int)(stepDurationSecs * durationFactor * speedMultiplier * sampleRate);

                if (stepSampleCounter >= targetStepSamples) {
                    stepSampleCounter = 0;
                    currentStep = (currentStep.load() + 1) % stepsCount.load();
                    
                    if (slamPending.load()) {
                        bool triggerNow = false;
                        int step = currentStep.load();
                        if (timeSignature == "4/4" && (step == 0 || step == 12)) triggerNow = true;
                        else if (timeSignature == "3/4" && (step == 0 || step == 8)) triggerNow = true;
                        else if (timeSignature == "5/4" && (step == 0 || step == 12)) triggerNow = true;
                        else if (timeSignature == "6/8" && (step == 0 || step == 9)) triggerNow = true;
                        
                        if (triggerNow) {
                            slamActive = true;
                            slamPending = false;
                            triggerSlamSubBassVoice = true;
                        }
                    }

                    int step = currentStep.load();
                    bool triggerSub = false;
                    if (timeSignature == "4/4" && (step == 0 || step == 12)) triggerSub = true;
                    else if (timeSignature == "3/4" && (step == 0 || step == 8)) triggerSub = true;
                    else if (timeSignature == "5/4" && (step == 0 || step == 12)) triggerSub = true;
                    else if (timeSignature == "6/8" && (step == 0 || step == 9)) triggerSub = true;

                    if (slamActive.load() && triggerSub) {
                        triggerSlamSubBassVoice = true;
                    }

                    if (fillActive.load() && fillPattern != "half_tempo") {
                        triggerFillPattern(step, i, standardStepDurationSamples);
                    } else {
                        int curS = currentStep.load();
                        for (int c = 0; c < 12; ++c) {
                            if (patternGrid[c][curS] && !mutes[c]) {
                                float vol = getParamWithAutomation(c, "volume", curS);
                                float dec = getParamWithAutomation(c, "decay", curS);
                                float ton = getParamWithAutomation(c, "tone", curS);
                                float sw = getParamWithAutomation(c, "sweep", curS);
                                float sn = getParamWithAutomation(c, "snappy", curS);
                                
                                float p = pitchAutomationGrid[c][curS];
                                
                                bool alt = params[c]["useAltSound"] > 0.5f;
                                float vel = velocityGrid[c][curS];

                                if (c == 2) voices[3]->choke(); 
                                
                                int rolls = rollGrid[c][curS];
                                if (rolls > 1) { 
                                    int subDuration = standardStepDurationSamples / rolls;
                                    for (int r = 0; r < rolls; ++r) {
                                        scheduledTriggers.push_back({
                                            (int)(i + r * subDuration), c, vol, dec, ton, sw, sn, p, vel, alt
                                        });
                                    }
                                } else { 
                                    triggerVoiceWithParams(c, vol, dec, ton, sw, sn, p, vel, alt);
                                }
                            }
                        }
                    }
                }
                stepSampleCounter++;
            }

            for (auto it = scheduledTriggers.begin(); it != scheduledTriggers.end();) {
                if (it->sampleIndex <= i) {
                    triggerVoiceWithParams(it->channel, it->volume, it->decay, it->tone, it->sweep, it->snappy, it->pitch, it->velocity, it->useAlt);
                    it = scheduledTriggers.erase(it);
                } else {
                    ++it;
                }
            }

            float crunchSumLeft = 0.0f;
            float crunchSumRight = 0.0f;
            float drySumLeft = 0.0f;
            float drySumRight = 0.0f;
            
            for (int c = 0; c < 12; ++c) {
                if (voices[c]->isActive()) {
                    float s = voices[c]->nextSample(sampleRate);
                    float sL = s * 0.707f;
                    float sR = s * 0.707f;
                    
                    if (channelCrunchBypass[c]) {
                        drySumLeft += sL;
                        drySumRight += sR;
                    } else {
                        crunchSumLeft += sL;
                        crunchSumRight += sR;
                    }
                }
            }
            
            if (bitcrusherEnabled.load()) {
                bitcrusher.process(crunchSumLeft, crunchSumRight, bitcrusherBits.load(), bitcrusherDownsample.load());
            }
            
            leftChannel[i] = drySumLeft + crunchSumLeft;
            rightChannel[i] = drySumRight + crunchSumRight;
        }

        // Apply Modular FX chain block-by-block
        for (int fxType : fxChainOrder) {
            if (!fxEnabled[fxType]) continue;
            
            switch (fxType) {
                case 0: // Distortion (Saturator)
                    for (int i = 0; i < numSamples; ++i) {
                        leftChannel[i] = saturator.process(leftChannel[i], distDrive);
                        rightChannel[i] = saturator.process(rightChannel[i], distDrive);
                    }
                    break;
                case 1: // Filter
                {
                    BiquadFilter::Type filterTypeEnum = BiquadFilter::Lowpass;
                    if (filterType == "highpass") filterTypeEnum = BiquadFilter::Highpass;
                    else if (filterType == "bandpass") filterTypeEnum = BiquadFilter::Bandpass;
                    
                    filterL.setParams(filterTypeEnum, filterCutoff, filterResonance, sampleRate);
                    filterR.setParams(filterTypeEnum, filterCutoff, filterResonance, sampleRate);
                    for (int i = 0; i < numSamples; ++i) {
                        leftChannel[i] = filterL.process(leftChannel[i]);
                        rightChannel[i] = filterR.process(rightChannel[i]);
                    }
                    break;
                }
                case 2: // Delay
                    for (int i = 0; i < numSamples; ++i) {
                        delay.process(leftChannel[i], rightChannel[i], delayTime, delayFeedback, delayMix, sampleRate);
                    }
                    break;
                case 3: // Reverb
                    for (int i = 0; i < numSamples; ++i) {
                        reverb.process(leftChannel[i], rightChannel[i], reverbDecay, reverbMix);
                    }
                    break;
                case 4: // Sidechain
                    for (int i = 0; i < numSamples; ++i) {
                        float duck = sidechain.nextSample();
                        leftChannel[i] *= duck;
                        rightChannel[i] *= duck;
                    }
                    break;
                case 5: // VST Host
                {
                    const juce::ScopedLock sl (pluginMutex);
                    if (hostedPlugin != nullptr) {
                        hostedPlugin->processBlock(buffer, midiMessages);
                    }
                    break;
                }
            }
        }

        // Master FX, Slam and visualization
        for (int i = 0; i < numSamples; ++i) {
            float fxLeft = leftChannel[i];
            float fxRight = rightChannel[i];
            float dryLeft = fxLeft;
            float dryRight = fxRight;

            if (triggerSlamSubBassVoice) {
                subBassEnv = 1.0f;
                subBassOscPhase = 0.0f;
                triggerSlamSubBassVoice = false;
            }

            float subBassSample = 0.0f;
            if (subBassEnv > 0.0001f) {
                float subFreq = 30.0f + (55.0f - 30.0f) * subBassEnv;
                subBassOscPhase += 2.0f * (float)M_PI * subFreq / (float)sampleRate;
                subBassSample = std::sin(subBassOscPhase) * subBassEnv * 0.35f;
                subBassEnv *= std::exp(-1.0f / (sampleRate * 2.8f)); 
            }

            float wetLeft = masterSlamFilter.process(fxLeft);
            float wetRight = masterSlamFilter.process(fxRight);
            
            wetLeft = masterSlamComp.process(wetLeft, -32.0f, 8.0f, 5.0f, 80.0f, sampleRate);
            wetRight = masterSlamComp.process(wetRight, -32.0f, 8.0f, 5.0f, 80.0f, sampleRate);

            float wetTarget = (slamActive.load() ? 1.0f : 0.0f);
            float mixStep = 1.0f / (float)(sampleRate * 0.15f); 
            if (slamWetMix < wetTarget) {
                slamWetMix = std::min(wetTarget, slamWetMix + mixStep);
            } else if (slamWetMix > wetTarget) {
                slamWetMix = std::max(wetTarget, slamWetMix - mixStep);
            }

            leftChannel[i] = (1.0f - slamWetMix) * dryLeft + slamWetMix * wetLeft + subBassSample * slamWetMix;
            rightChannel[i] = (1.0f - slamWetMix) * dryRight + slamWetMix * wetRight + subBassSample * slamWetMix;

            // Write outputs into Crossover visualizer buffers
            float monoSample = (leftChannel[i] + rightChannel[i]) * 0.5f;
            
            float lSample = lowsFilter.process(monoSample);
            float mSample = midsFilter.process(monoSample);
            float hSample = highsFilter.process(monoSample);
            
            int lPtr = lowsWritePtr.load();
            lowsBuffer[lPtr] = lSample;
            lowsWritePtr = (lPtr + 1) % 256;
            
            int mPtr = midsWritePtr.load();
            midsBuffer[mPtr] = mSample;
            midsWritePtr = (mPtr + 1) % 256;
            
            int hPtr = highsWritePtr.load();
            highsBuffer[hPtr] = hSample;
            highsWritePtr = (hPtr + 1) % 256;
        }
        buffer.applyGain (masterVolume.load());

        if (sessionRecording.load()) {
            const float* leftOut = buffer.getReadPointer(0);
            const float* rightOut = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : buffer.getReadPointer(0);
            int nS = buffer.getNumSamples();
            for (int s = 0; s < nS; ++s) {
                if (sessionBufferL.size() < sessionBufferL.capacity()) {
                    sessionBufferL.push_back(leftOut[s]);
                    sessionBufferR.push_back(rightOut[s]);
                } else {
                    sessionRecording.store(false);
                    break;
                }
            }
        }
    }

    void triggerFillPattern(int step, int sampleIndex, int stepDurationSamples) {
        auto pattern = fillPattern;
        if (pattern == "traditional_a") {
            scheduledTriggers.push_back({
                sampleIndex, 1, params[1]["volume"], params[1]["decay"], params[1]["tone"], params[1]["sweep"], params[1]["snappy"], params[1]["pitch"], 0.8f, false
            });
            if (step % 4 == 0) {
                scheduledTriggers.push_back({
                    sampleIndex, 0, params[0]["volume"], params[0]["decay"], params[0]["tone"], params[0]["sweep"], params[0]["snappy"], params[0]["pitch"], 0.9f, false
                });
            }
        } else if (pattern == "traditional_b") {
            int moduloStep = step % 16;
            if (moduloStep < 8) {
                scheduledTriggers.push_back({
                    sampleIndex, 1, params[1]["volume"], params[1]["decay"], params[1]["tone"], params[1]["sweep"], params[1]["snappy"], params[1]["pitch"], 0.7f, false
                });
            } else if (moduloStep < 12) {
                scheduledTriggers.push_back({
                    sampleIndex, 6, params[6]["volume"], params[6]["decay"], params[6]["tone"], params[6]["sweep"], params[6]["snappy"], 0.4f, 0.7f, false
                });
            } else if (moduloStep < 15) {
                scheduledTriggers.push_back({
                    sampleIndex, 1, params[1]["volume"], params[1]["decay"], params[1]["tone"], params[1]["sweep"], params[1]["snappy"], params[1]["pitch"], 0.7f, false
                });
                scheduledTriggers.push_back({
                    sampleIndex, 6, params[6]["volume"], params[6]["decay"], params[6]["tone"], params[6]["sweep"], params[6]["snappy"], 0.6f, 0.7f, false
                });
            } else {
                scheduledTriggers.push_back({
                    sampleIndex, 0, params[0]["volume"], params[0]["decay"], params[0]["tone"], params[0]["sweep"], params[0]["snappy"], params[0]["pitch"], 0.9f, false
                });
                scheduledTriggers.push_back({
                    sampleIndex, 10, params[10]["volume"], params[10]["decay"], params[10]["tone"], params[10]["sweep"], params[10]["snappy"], params[10]["pitch"], 0.8f, false
                });
            }
        } else if (pattern == "glitch") {
            int randCh1 = std::rand() % 12;
            int randCh2 = std::rand() % 12;
            float randP1 = 0.2f + (std::rand() % 100) * 0.008f;
            float randP2 = 0.2f + (std::rand() % 100) * 0.008f;
            scheduledTriggers.push_back({
                sampleIndex, randCh1, params[randCh1]["volume"], params[randCh1]["decay"], params[randCh1]["tone"], params[randCh1]["sweep"], params[randCh1]["snappy"], randP1, 0.7f, false
            });
            scheduledTriggers.push_back({
                sampleIndex + stepDurationSamples / 2, randCh2, params[randCh2]["volume"], params[randCh2]["decay"], params[randCh2]["tone"], params[randCh2]["sweep"], params[randCh2]["snappy"], randP2, 0.7f, false
            });
        } else if (pattern == "stutter") {
            int ch = selectedCard.load();
            scheduledTriggers.push_back({
                sampleIndex, ch, params[ch]["volume"], params[ch]["decay"], params[ch]["tone"], params[ch]["sweep"], params[ch]["snappy"], params[ch]["pitch"], 0.8f, false
            });
            scheduledTriggers.push_back({
                sampleIndex + stepDurationSamples / 2, ch, params[ch]["volume"], params[ch]["decay"], params[ch]["tone"], params[ch]["sweep"], params[ch]["snappy"], params[ch]["pitch"], 0.8f, false
            });
        }
    }

    float getParamWithAutomation(int channel, juce::String key, int step) {
        auto it = automationGrid[channel][step].find(key);
        if (it != automationGrid[channel][step].end()) {
            return it->second;
        }
        return params[channel][key];
    }

    // Standard details
    const juce::String getName() const override { return "PhyzixSnB"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int index) override {}
    const juce::String getProgramName (int index) override { return {}; }
    void changeProgramName (int index, const juce::String& newName) override {}
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    void getStateInformation(juce::MemoryBlock& destData) override {}
    void setStateInformation(const void* data, int sizeInBytes) override {}

    juce::AudioFormatManager formatManager;
    juce::AudioBuffer<float> recordedBuffer{2, 300000};
    std::atomic<bool> isRecording{false};
    std::atomic<int> recordedLength{0};
    int writePos = 0;
    std::atomic<float> masterVolume{0.8f};

    void loadSampleFile(const juce::File& file) {
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader != nullptr) {
            int length = (int)reader->lengthInSamples;
            int maxSamples = recordedBuffer.getNumSamples();
            int numSamplesToRead = std::min(length, maxSamples);
            recordedBuffer.setSize(2, maxSamples, false, true, true);
            reader->read(&recordedBuffer, 0, numSamplesToRead, 0, true, true);
            recordedLength = numSamplesToRead;
        }
    }

    void startRecording() {
        recordedBuffer.clear();
        writePos = 0;
        recordedLength = 0;
        isRecording = true;
    }

    void stopRecording() {
        isRecording = false;
        recordedLength = writePos;
    }

private:
    double currentSampleRate = 44100.0;
    std::unique_ptr<InstrumentVoice> voices[12];
    int stepSampleCounter = 0;
    
    struct ScheduledHit {
        int sampleIndex;
        int channel;
        float volume, decay, tone, sweep, snappy, pitch, velocity;
        bool useAlt;
    };
    std::vector<ScheduledHit> scheduledTriggers;

    BiquadFilter masterSlamFilter;
    Compressor masterSlamComp;
    float subBassOscPhase = 0.0f;
    float subBassEnv = 0.0f;
    bool triggerSlamSubBassVoice = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PhyzixAudioProcessor)
};

// =============================================================================
// InstrumentVoice Implementation
// =============================================================================
float InstrumentVoice::nextSample(double sampleRate) {
    if (!active) return 0.0f;
    
    float sample = 0.0f;
    float currentGain = gainEnv.nextSample();
    timeInSeconds += 1.0f / (float)sampleRate;
    
    float pitchScaler = std::pow(2.0f, (pitch - 0.5f) * 4.0f);
    
    if (currentGain <= 0.0f && !gainEnv.isActive()) {
        active = false;
        return 0.0f;
    }
    
    switch (instIdx) {
        case 0: // Kick
        {
            float scaledTone = tone * pitchScaler;
            if (useAlt) { // Mode B: Tunable 808 Sub Kick
                float pitchEnv = std::exp(-40.0f * timeInSeconds);
                float freq = scaledTone + (scaledTone * 1.2f * sweep) * pitchEnv;
                phase += 2.0f * (float)M_PI * freq / (float)sampleRate;
                sample = std::sin(phase);
                if (snappy > 0.01f && timeInSeconds < 0.015f) {
                    float clickFreq = 2000.0f * std::exp(-300.0f * timeInSeconds);
                    phase2 += 2.0f * (float)M_PI * clickFreq / (float)sampleRate;
                    sample += snappy * 0.8f * std::sin(phase2);
                }
            } else { // Mode A: Punchy Gritty Analog Kick
                float pitchEnv = std::exp(-80.0f * timeInSeconds);
                float freq = scaledTone + (scaledTone * 3.0f * sweep) * pitchEnv;
                phase += 2.0f * (float)M_PI * freq / (float)sampleRate;
                float osc = std::sin(phase);
                sample = std::tanh(osc * (1.5f + snappy * 2.0f)) * 0.75f + 0.25f * osc;
                float click = std::sin(10.0f * phase) * std::exp(-150.0f * timeInSeconds) * snappy;
                sample = std::tanh(sample + click);
            }
            break;
        }
        case 1: // Snare
        {
            float scaledTone = tone * pitchScaler;
            if (useAlt) { // Mode B: 808 Style Snare
                float f1 = 180.0f * (scaledTone / 180.0f);
                float f2 = 330.0f * (scaledTone / 180.0f);
                phase += 2.0f * (float)M_PI * f1 / (float)sampleRate;
                phase2 += 2.0f * (float)M_PI * f2 / (float)sampleRate;
                float shell = (std::sin(phase) * 0.6f + std::sin(phase2) * 0.3f) * std::exp(-40.0f * timeInSeconds);
                
                float noiseSample = noise.nextSample();
                filter.setParams(BiquadFilter::Bandpass, 1500.0f * pitchScaler, 1.2f, sampleRate);
                float snareNoise = filter.process(noiseSample) * std::exp(-20.0f * timeInSeconds) * snappy * 1.2f;
                
                sample = shell + snareNoise;
            } else { // Mode A: Snappy Gritty Analog Snare
                float pitchEnv = std::exp(-100.0f * timeInSeconds);
                float freq = scaledTone * (1.0f + 1.5f * sweep * pitchEnv);
                phase += 2.0f * (float)M_PI * freq / (float)sampleRate;
                float shell = std::sin(phase) * std::exp(-50.0f * timeInSeconds);
                
                float noiseSample = noise.nextSample();
                filter.setParams(BiquadFilter::Bandpass, scaledTone * 5.0f, 1.0f, sampleRate);
                float noiseFiltered = filter.process(noiseSample) * noiseEnv.nextSample() * (0.8f + snappy * 1.2f);
                
                sample = shell + noiseFiltered;
                sample = std::tanh(sample * (1.5f + snappy * 1.5f)) * 0.75f;
            }
            break;
        }
        case 2: // Closed Hat
        {
            if (useAlt) { // Mode B: Bandpass filtered noise
                float noiseSample = noise.nextSample();
                filter.setParams(BiquadFilter::Bandpass, tone * 0.8f * pitchScaler, 1.0f, sampleRate);
                sample = filter.process(noiseSample);
            } else { // Mode A: Highpass filtered noise
                float noiseSample = noise.nextSample();
                filter.setParams(BiquadFilter::Highpass, tone * pitchScaler, 2.0f, sampleRate);
                sample = filter.process(noiseSample);
            }
            break;
        }
        case 3: // Open Hat
        {
            if (useAlt) { // Mode B: Reverse Open Hat
                float duration = decay;
                if (timeInSeconds < duration) {
                    float ramp = timeInSeconds / duration;
                    float noiseSample = noise.nextSample();
                    filter.setParams(BiquadFilter::Highpass, tone * pitchScaler, 2.0f, sampleRate);
                    sample = filter.process(noiseSample) * ramp;
                } else {
                    sample = 0.0f;
                    active = false;
                }
            } else { // Mode A: Standard Open Hat
                float noiseSample = noise.nextSample();
                filter.setParams(BiquadFilter::Highpass, tone * pitchScaler, 2.0f, sampleRate);
                sample = filter.process(noiseSample);
            }
            break;
        }
        case 4: // Ride
        {
            float scaledTone = tone * pitchScaler;
            if (useAlt) { // Mode B: Carrier-Modulator FM Pair
                float modFreq = scaledTone * 0.35f;
                modPhase += 2.0f * (float)M_PI * modFreq / (float)sampleRate;
                float modEnvVal = modEnv.nextSample();
                float modVal = std::sin(modPhase) * (scaledTone * 1.5f * snappy) * modEnvVal;
                
                float carrierFreq = scaledTone + modVal;
                phase += 2.0f * (float)M_PI * carrierFreq / (float)sampleRate;
                filter.setParams(BiquadFilter::Bandpass, scaledTone * 1.8f, 3.0f, sampleRate);
                sample = filter.process(std::sin(phase));
            } else { // Mode A: FM Ride
                float ratios[6] = { 2.0f, 3.0f, 4.15f, 5.43f, 6.79f, 8.21f };
                float oscSum = 0.0f;
                for (int i = 0; i < 6; ++i) {
                    float f = scaledTone * ratios[i];
                    ridePhases[i] += 2.0f * (float)M_PI * f / (float)sampleRate;
                    oscSum += (std::sin(ridePhases[i]) > 0.0f ? 1.0f : -1.0f) * 0.16f;
                }
                filter.setParams(BiquadFilter::Bandpass, 9000.0f * pitchScaler, 1.8f + snappy * 5.0f, sampleRate);
                float bp = filter.process(oscSum);
                filter2.setParams(BiquadFilter::Highpass, 7000.0f * pitchScaler, 0.707f, sampleRate);
                sample = filter2.process(bp);
            }
            break;
        }
        case 5: // Clap
        {
            if (useAlt) { // Mode B: Acoustic Snap
                float scaledTone = tone * pitchScaler;
                float freq = scaledTone * 0.9f + (scaledTone * 0.9f) * std::exp(-200.0f * timeInSeconds);
                phase += 2.0f * (float)M_PI * freq / (float)sampleRate;
                float osc = std::sin(phase) * 0.8f * std::exp(-100.0f * timeInSeconds);
                
                float hpFreq = 500.0f + snappy * 80.0f;
                float noiseSample = noise.nextSample();
                filter.setParams(BiquadFilter::Highpass, hpFreq * pitchScaler, 0.707f, sampleRate);
                float ns = filter.process(noiseSample) * 0.45f * std::exp(-25.0f * timeInSeconds);
                sample = osc + ns;
            } else { // Mode A: Hand Clap
                float spacing = snappy / 1000.0f;
                clapBurstTimer += 1.0f / (float)sampleRate;
                
                float burstAmp = 0.0f;
                if (clapBurstCounter < 3) {
                    if (clapBurstTimer >= spacing) {
                        clapBurstTimer = 0.0f;
                        clapBurstCounter++;
                    }
                    burstAmp = 0.7f * std::exp(-125.0f * clapBurstTimer);
                } else {
                    burstAmp = std::exp(-25.0f * (clapBurstTimer - spacing * 3.0f));
                }
                
                float noiseSample = noise.nextSample();
                filter.setParams(BiquadFilter::Bandpass, tone * pitchScaler, 2.0f, sampleRate);
                sample = filter.process(noiseSample) * burstAmp * 1.4f;
            }
            break;
        }
        case 6: // Tom
        {
            float stepPitchFreq = 50.0f + (pitch * 300.0f);
            float startFreq = stepPitchFreq * (1.5f + sweep * 1.5f);
            float endFreq = stepPitchFreq;
            
            if (useAlt) { // Mode B: Resonant skin drum
                float sweepFreq = endFreq + (startFreq - endFreq) * std::exp(-20.0f * timeInSeconds);
                phase += 2.0f * (float)M_PI * sweepFreq / (float)sampleRate;
                float osc = std::sin(phase);
                
                filter.setParams(BiquadFilter::Bandpass, sweepFreq * 1.2f, 8.0f, sampleRate);
                sample = filter.process(osc);
                
                float clickNoise = noise.nextSample() * noiseEnv.nextSample();
                sample += clickNoise;
            } else { // Mode A: Standard Tom
                float freq = endFreq + (startFreq - endFreq) * std::exp(-20.0f * timeInSeconds);
                phase += 2.0f * (float)M_PI * freq / (float)sampleRate;
                filter.setParams(BiquadFilter::Lowpass, tone * 5.0f, 0.707f, sampleRate);
                sample = filter.process(std::sin(phase)) * 0.8f;
            }
            break;
        }
        case 7: // Beep
        {
            float freq = 200.0f + (pitch * 2800.0f);
            if (useAlt) { // Mode B: Metallic Ring-Mod FM Beep
                float f1 = freq;
                float f2 = freq * 1.5f;
                phase += 2.0f * (float)M_PI * f1 / (float)sampleRate;
                phase2 += 2.0f * (float)M_PI * f2 / (float)sampleRate;
                sample = std::sin(phase) * (0.5f + 0.5f * std::sin(phase2));
            } else { // Mode A: Punchy Saturated Analog Beep
                float pitchEnv = std::exp(-150.0f * timeInSeconds);
                float f = freq * (1.0f + 1.5f * sweep * pitchEnv);
                phase += 2.0f * (float)M_PI * f / (float)sampleRate;
                sample = std::sin(phase);
                sample = std::tanh(sample * (1.8f + snappy * 2.0f)) * 0.7f;
            }
            break;
        }
        case 8: // Blip
        {
            float minFreq = 100.0f;
            if (useAlt) { 
                float startFreq = 80.0f;
                float endFreq = 600.0f + (pitch * 3500.0f);
                float freq = startFreq + (endFreq - startFreq) * (1.0f - std::exp(-timeInSeconds / (decay * 0.85f)));
                phase += 2.0f * (float)M_PI * freq / (float)sampleRate;
                sample = std::sin(phase);
            } else { 
                float startFreq = 500.0f + (pitch * 4500.0f);
                float sweepDuration = 0.01f + (1.0f - sweep) * 0.05f;
                float freq = minFreq + (startFreq - minFreq) * std::exp(-timeInSeconds / sweepDuration);
                phase += 2.0f * (float)M_PI * freq / (float)sampleRate;
                sample = std::sin(phase);
            }
            break;
        }
        case 9: // Bloop
        {
            if (useAlt) { 
                float frequency = 150.0f + (pitch * 1650.0f);
                float freq = frequency * 1.5f;
                if (timeInSeconds < decay * 0.3f) {
                    freq = frequency * 1.5f + (frequency * 0.5f - frequency * 1.5f) * (timeInSeconds / (decay * 0.3f));
                } else {
                    float t = (timeInSeconds - decay * 0.3f) / (decay * 0.7f);
                    freq = frequency * 0.5f + (frequency * 2.2f - frequency * 0.5f) * t;
                }
                phase += 2.0f * (float)M_PI * freq / (float)sampleRate;
                sample = std::sin(phase);
            } else { 
                float startFreq = 60.0f;
                float endFreq = 150.0f + (pitch * 1650.0f);
                float sweepDuration = 0.02f + sweep * 0.12f; 
                float freq = startFreq + (endFreq - startFreq) * (1.0f - std::exp(-timeInSeconds / sweepDuration));
                phase += 2.0f * (float)M_PI * freq / (float)sampleRate;
                sample = std::sin(phase);
            }
            break;
        }
        case 10: // Crunch
        {
            if (useAlt) { 
                float scaledTone = tone * pitchScaler;
                float freq = scaledTone * 0.5f + (scaledTone * 3.0f) * std::exp(-timeInSeconds / (decay * 0.35f));
                phase += 2.0f * (float)M_PI * (scaledTone * 0.35f) / (float)sampleRate;
                float saw = 2.0f * (phase / (2.0f * (float)M_PI) - std::floor(phase / (2.0f * (float)M_PI) + 0.5f));
                filter.setParams(BiquadFilter::Bandpass, freq, 5.0f + snappy * 12.0f, sampleRate);
                sample = filter.process(saw);
            } else { 
                float noiseSample = noise.nextSample();
                filter.setParams(BiquadFilter::Lowpass, tone * pitchScaler, 2.5f + snappy * 4.0f, sampleRate); 
                float filtered = filter.process(noiseSample);
                float k = snappy * 180.0f;
                sample = (1.0f + k / 100.0f) * filtered / (1.0f + (k / 100.0f) * std::abs(filtered)) * 0.5f;
            }
            break;
        }
        case 11: // Custom Sample
        {
            if (processor != nullptr && processor->recordedLength.load() > 0) {
                float speed = pitchScaler * tone; // normal speed is 1.0f
                if (speed <= 0.0f) speed = 1.0f;
                
                int intPos = (int)sampleReadPos;
                int length = processor->recordedLength.load();
                if (intPos < length) {
                    int nextPos = std::min(intPos + 1, length - 1);
                    float alpha = sampleReadPos - (float)intPos;
                    
                    float left1 = processor->recordedBuffer.getSample(0, intPos);
                    float right1 = processor->recordedBuffer.getNumChannels() > 1 ? processor->recordedBuffer.getSample(1, intPos) : left1;
                    float s1 = (left1 + right1) * 0.5f;
                    
                    float left2 = processor->recordedBuffer.getSample(0, nextPos);
                    float right2 = processor->recordedBuffer.getNumChannels() > 1 ? processor->recordedBuffer.getSample(1, nextPos) : left2;
                    float s2 = (left2 + right2) * 0.5f;
                    
                    sample = s1 + alpha * (s2 - s1);
                    sampleReadPos += speed;
                } else {
                    sample = 0.0f;
                    active = false;
                }
            } else {
                // Fallback synthesis if empty
                float freq = 800.0f * tone + (400.0f * tone) * std::exp(-100.0f * timeInSeconds);
                phase += 2.0f * (float)M_PI * freq / (float)sampleRate;
                sample = std::sin(phase) * 0.5f;
            }
            break;
        }
    }
    
    return sample * currentGain;
}

// =============================================================================
// 4. CUSTOM LOOKANDFEEL & KNOB WIDGETS
// =============================================================================

class GlassmorphicLookAndFeel : public juce::LookAndFeel_V4 {
public:
    GlassmorphicLookAndFeel() {
        setColour(juce::Slider::thumbColourId, juce::Colour(0xff2b2927));
    }

    void drawRotarySlider(juce::Graphics& g, int x, int y, int width, int height,
                          float sliderPos, const float rotaryStartAngle, const float rotaryEndAngle,
                          juce::Slider& slider) override {
        // Cap the rotary knob radius to 22.0f (44px diameter) to keep it crisp and elegant
        float radius = std::min((float)std::min(width, height) * 0.42f, 22.0f);
        float centreX = (float)x + (float)width * 0.5f;
        float centreY = (float)y + (float)height * 0.5f;
        
        g.setColour(juce::Colour(0x0a000000));
        g.fillEllipse(centreX - radius - 1.0f, centreY - radius + 1.0f, radius * 2.0f + 2.0f, radius * 2.0f + 2.0f);
        
        g.setColour(juce::Colours::white);
        g.fillEllipse(centreX - radius, centreY - radius, radius * 2.0f, radius * 2.0f);
        g.setColour(juce::Colour(0x1a000000));
        g.drawEllipse(centreX - radius, centreY - radius, radius * 2.0f, radius * 2.0f, 1.5f);

        float angle = rotaryStartAngle + sliderPos * (rotaryEndAngle - rotaryStartAngle);
        juce::Path arcPath;
        arcPath.addCentredArc(centreX, centreY, radius - 2.5f, radius - 2.5f, 0.0f, rotaryStartAngle, angle, true);
        
        g.setColour(juce::Colour(0xffe67e22)); 
        g.strokePath(arcPath, juce::PathStrokeType(2.5f, juce::PathStrokeType::mitered, juce::PathStrokeType::rounded));

        float coreR = radius * 0.55f;
        g.setColour(juce::Colour(0xfff7f6f0));
        g.fillEllipse(centreX - coreR, centreY - coreR, coreR * 2.0f, coreR * 2.0f);
        g.setColour(juce::Colour(0x0f000000));
        g.drawEllipse(centreX - coreR, centreY - coreR, coreR * 2.0f, coreR * 2.0f, 0.5f);

        juce::Path p;
        p.startNewSubPath(centreX, centreY);
        p.lineTo(centreX, centreY - radius + 1.5f);
        g.setColour(juce::Colour(0xff2b2927));
        g.strokePath(p, juce::PathStrokeType(2.5f, juce::PathStrokeType::mitered, juce::PathStrokeType::rounded),
                     juce::AffineTransform::rotation(angle, centreX, centreY));
    }

    void drawToggleButton(juce::Graphics& g, juce::ToggleButton& button,
                          bool shouldDrawButtonAsHighlighted, bool shouldDrawButtonAsDown) override {
        auto fontSize = std::min(13.0f, button.getHeight() * 0.75f);
        g.setFont(juce::FontOptions(fontSize, juce::Font::bold));
        
        auto tickArea = button.getLocalBounds().removeFromLeft(20).reduced(2);
        
        // Draw checkbox box
        g.setColour(juce::Colour(0xffffffff));
        g.fillRoundedRectangle(tickArea.toFloat(), 4.0f);
        g.setColour(juce::Colour(0x332b2927));
        g.drawRoundedRectangle(tickArea.toFloat(), 4.0f, 1.5f);
        
        if (button.getToggleState()) {
            g.setColour(juce::Colour(0xffd35400));
            g.fillRoundedRectangle(tickArea.reduced(3).toFloat(), 2.0f);
        }
        
        // Draw text
        g.setColour(button.findColour(juce::ToggleButton::textColourId));
        g.drawText(button.getButtonText(),
                   24, 0, button.getWidth() - 24, button.getHeight(),
                   juce::Justification::centredLeft, true);
    }
};

class CustomKnob : public juce::Component {
public:
    CustomKnob(const juce::String& labelText, float minVal, float maxVal, float defaultVal) {
        label.setText(labelText, juce::dontSendNotification);
        label.setFont(juce::FontOptions(10.0f, juce::Font::bold));
        label.setJustificationType(juce::Justification::centred);
        label.setColour(juce::Label::textColourId, juce::Colour(0xff6e6d6c));
        addAndMakeVisible(label);

        slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        slider.setRange(minVal, maxVal);
        slider.setValue(defaultVal);
        slider.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 45, 12);
        slider.setColour(juce::Slider::textBoxTextColourId, juce::Colour(0xff6e6d6c));
        slider.setColour(juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
        slider.setLookAndFeel(&lnf);
        addAndMakeVisible(slider);
    }

    ~CustomKnob() override {
        slider.setLookAndFeel(nullptr);
    }

    void resized() override {
        auto bounds = getLocalBounds();
        label.setBounds(bounds.removeFromTop(12));
        slider.setBounds(bounds);
    }

    void setLabel(const juce::String& text) {
        label.setText(text, juce::dontSendNotification);
    }

    juce::Slider slider;

private:
    juce::Label label;
    GlassmorphicLookAndFeel lnf;
};

// =============================================================================
// 5. DRUM CARD COMPONENT
// =============================================================================

class DrumCardComponent : public juce::Component {
public:
    struct KnobDef {
        juce::String key;
        juce::String label;
        float minVal;
        float maxVal;
        float defaultVal;
    };

    DrumCardComponent(int instrumentIndex, PhyzixAudioProcessor& p)
        : instIdx(instrumentIndex), processor(p)
    {
        titleLabel.setText(getInstrumentName().toUpperCase(), juce::dontSendNotification);
        titleLabel.setFont(juce::FontOptions(15.0f, juce::Font::bold));
        titleLabel.setColour(juce::Label::textColourId, juce::Colour(0xff2c3e50));
        titleLabel.setJustificationType(juce::Justification::centred);
        titleLabel.setBorderSize(juce::BorderSize<int>(0));
        addAndMakeVisible(titleLabel);

        subLabel.setText(getInstrumentSubline(false), juce::dontSendNotification);
        subLabel.setFont(juce::FontOptions(10.0f, juce::Font::plain));
        subLabel.setColour(juce::Label::textColourId, juce::Colour(0xff7f8c8d));
        subLabel.setJustificationType(juce::Justification::centred);
        subLabel.setBorderSize(juce::BorderSize<int>(0));
        addAndMakeVisible(subLabel);

        if (instIdx == 11) {
            modeButton.setButtonText("LOAD");
            modeButton.setClickingTogglesState(false);
            modeButton.onClick = [this]() {
                fileChooser = std::make_unique<juce::FileChooser> (
                    "Select a sample to load...",
                    juce::File{},
                    "*.wav;*.mp3;*.aif;*.aiff"
                );
                fileChooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                    [this] (const juce::FileChooser& fc)
                    {
                        auto file = fc.getResult();
                        if (file.existsAsFile()) {
                            processor.loadSampleFile(file);
                            processor.triggerVoice(11, 0.8f);
                        }
                    });
            };
        } else {
            modeButton.setButtonText("A");
            modeButton.setClickingTogglesState(true);
            modeButton.onClick = [this]() {
                bool useAlt = modeButton.getToggleState();
                processor.params[instIdx]["useAltSound"] = useAlt ? 1.0f : 0.0f;
                modeButton.setButtonText(useAlt ? "B" : "A");
                subLabel.setText(getInstrumentSubline(useAlt), juce::dontSendNotification);
                updateKnobLabelsAndRanges(useAlt);
                processor.triggerVoice(instIdx, 0.8f);
            };
        }
        addAndMakeVisible(modeButton);

        muteButton.setButtonText("MUTE");
        muteButton.setClickingTogglesState(true);
        muteButton.onClick = [this]() {
            processor.mutes[instIdx] = muteButton.getToggleState();
            muteButton.setColour(juce::TextButton::buttonColourId, muteButton.getToggleState() ? juce::Colour(0xffe74c3c) : juce::Colours::white);
            muteButton.setColour(juce::TextButton::textColourOffId, muteButton.getToggleState() ? juce::Colours::white : juce::Colour(0xff2b2927));
        };
        addAndMakeVisible(muteButton);

        if (instIdx == 11) {
            crunchButton.setButtonText("REC");
            crunchButton.setClickingTogglesState(true);
            crunchButton.onClick = [this]() {
                bool recording = crunchButton.getToggleState();
                if (recording) {
                    processor.startRecording();
                    crunchButton.setColour(juce::TextButton::buttonColourId, juce::Colour(0xffe74c3c));
                    crunchButton.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
                } else {
                    processor.stopRecording();
                    crunchButton.setColour(juce::TextButton::buttonColourId, juce::Colours::white);
                    crunchButton.setColour(juce::TextButton::textColourOffId, juce::Colour(0xff2b2927));
                }
            };
        } else {
            crunchButton.setButtonText("BYP ON");
            crunchButton.setClickingTogglesState(true);
            crunchButton.setToggleState(true, juce::dontSendNotification);
            crunchButton.onClick = [this]() {
                processor.channelCrunchBypass[instIdx] = crunchButton.getToggleState();
                crunchButton.setColour(juce::TextButton::buttonColourId, crunchButton.getToggleState() ? juce::Colour(0xff16a085) : juce::Colours::white);
                crunchButton.setColour(juce::TextButton::textColourOffId, crunchButton.getToggleState() ? juce::Colours::white : juce::Colour(0xff2b2927));
            };
        }
        addAndMakeVisible(crunchButton);

        wipeButton.setButtonText("WIPE");
        wipeButton.onClick = [this]() {
            for (int s = 0; s < 64; ++s) {
                processor.patternGrid[instIdx][s] = false;
                processor.automationGrid[instIdx][s].clear();
                processor.pitchAutomationGrid[instIdx][s] = 0.5f;
            }
        };
        addAndMakeVisible(wipeButton);

        setupKnobs();
        addMouseListener(this, true);
    }

    ~DrumCardComponent() override {}

    void flash() {
        triggerFlashActive = true;
        repaint();
        juce::Timer::callAfterDelay(100, [this]() {
            triggerFlashActive = false;
            repaint();
        });
    }

    void updateSlidersFromProcessor() {
        auto defs = getKnobDefinitions(instIdx, modeButton.getToggleState());
        for (int i = 0; i < defs.size() && i < knobs.size(); ++i) {
            knobs[i]->slider.setValue(processor.params[instIdx][defs[i].key], juce::dontSendNotification);
        }
        
        if (instIdx == 11) {
            crunchButton.setToggleState(processor.isRecording.load(), juce::dontSendNotification);
            crunchButton.setColour(juce::TextButton::buttonColourId, processor.isRecording.load() ? juce::Colour(0xffe74c3c) : juce::Colours::white);
            crunchButton.setColour(juce::TextButton::textColourOffId, processor.isRecording.load() ? juce::Colours::white : juce::Colour(0xff2b2927));
        } else {
            modeButton.setToggleState(processor.params[instIdx]["useAltSound"] > 0.5f, juce::dontSendNotification);
            modeButton.setButtonText(modeButton.getToggleState() ? "B" : "A");
            subLabel.setText(getInstrumentSubline(modeButton.getToggleState()), juce::dontSendNotification);
            updateKnobLabelsAndRanges(modeButton.getToggleState());

            muteButton.setToggleState(processor.mutes[instIdx], juce::dontSendNotification);
            muteButton.setColour(juce::TextButton::buttonColourId, processor.mutes[instIdx] ? juce::Colour(0xffe74c3c) : juce::Colours::white);
            muteButton.setColour(juce::TextButton::textColourOffId, processor.mutes[instIdx] ? juce::Colours::white : juce::Colour(0xff2b2927));

            crunchButton.setToggleState(processor.channelCrunchBypass[instIdx], juce::dontSendNotification);
            crunchButton.setColour(juce::TextButton::buttonColourId, processor.channelCrunchBypass[instIdx] ? juce::Colour(0xff16a085) : juce::Colours::white);
            crunchButton.setColour(juce::TextButton::textColourOffId, processor.channelCrunchBypass[instIdx] ? juce::Colours::white : juce::Colour(0xff2b2927));
        }
        
        titleLabel.setText(getInstrumentName().toUpperCase(), juce::dontSendNotification);
    }

    void paint(juce::Graphics& g) override {
        auto bounds = getLocalBounds().toFloat();
        
        // Soft drop shadow (multi-layered for realistic depth)
        g.setColour(juce::Colour(0x0a000000));
        g.fillRoundedRectangle(bounds.translated(3.0f, 4.0f), 12.0f);
        g.setColour(juce::Colour(0x08000000));
        g.fillRoundedRectangle(bounds.translated(1.5f, 2.0f), 12.0f);
        g.setColour(juce::Colour(0x04000000));
        g.fillRoundedRectangle(bounds.translated(0.5f, 1.0f), 12.0f);
        
        // Card body gradient (subtle top-to-bottom shading)
        juce::ColourGradient grad(juce::Colour(0xffffffff), 0.0f, 0.0f,
                                   juce::Colour(0xfff5f4ef), 0.0f, bounds.getHeight(), false);
        g.setFillType(grad);
        g.fillRoundedRectangle(bounds, 12.0f);
        
        // Highlighting/selection ring
        if (processor.selectedCard.load() == instIdx) {
            juce::Colour trColour = getTrackColour(instIdx);
            g.setColour(trColour);
            g.drawRoundedRectangle(bounds, 12.0f, 2.2f);
            
            g.setColour(trColour.withAlpha(0.08f));
            g.fillRoundedRectangle(bounds.reduced(1.0f), 11.0f);
        } else {
            // Clean, soft border
            g.setColour(juce::Colour(0x222b2927));
            g.drawRoundedRectangle(bounds, 12.0f, 1.2f);
        }
        
        if (triggerFlashActive) {
            g.setColour(getTrackColour(instIdx).withAlpha(0.25f));
            g.drawRoundedRectangle(bounds.reduced(1.0f), 12.0f, 3.5f);
            g.setColour(getTrackColour(instIdx).withAlpha(0.15f));
            g.fillRoundedRectangle(bounds.reduced(2.0f), 10.0f);
        }
    }

    void mouseDown(const juce::MouseEvent& event) override {
        processor.selectedCard = instIdx;
        if (auto* parent = getParentComponent()) {
            parent->repaint();
            if (auto* grandparent = parent->getParentComponent()) {
                grandparent->repaint();
            }
        }
        
        // Prevent triggering from buttons inside the card
        if (event.originalComponent != &modeButton && 
            event.originalComponent != &muteButton && 
            event.originalComponent != &crunchButton && 
            event.originalComponent != &wipeButton) 
        {
            if (!processor.isPlaying.load()) {
                processor.triggerVoice(instIdx, 0.8f);
            } else if (event.originalComponent == this) {
                processor.triggerVoice(instIdx, 0.8f);
            }
        }
    }

    void resized() override {
        auto bounds = getLocalBounds();
        titleLabel.setBounds(bounds.removeFromTop(22));
        subLabel.setBounds(bounds.removeFromTop(14));
        
        auto btnRow = bounds.removeFromTop(20);
        int btnW = btnRow.getWidth() / 4;
        modeButton.setBounds(btnRow.removeFromLeft(btnW).reduced(2, 1));
        muteButton.setBounds(btnRow.removeFromLeft(btnW).reduced(2, 1));
        crunchButton.setBounds(btnRow.removeFromLeft(btnW).reduced(2, 1));
        wipeButton.setBounds(btnRow.reduced(2, 1));

        if (instIdx == 11) { // Sample has 5 knobs
            int w = bounds.getWidth() / 3;
            int h = bounds.getHeight() / 2;
            
            auto row1 = bounds.removeFromTop(h);
            knobs[0]->setBounds(row1.removeFromLeft(w).reduced(2));
            knobs[1]->setBounds(row1.removeFromLeft(w).reduced(2));
            knobs[2]->setBounds(row1.reduced(2));
            
            auto row2 = bounds;
            knobs[3]->setBounds(row2.removeFromLeft(w).reduced(2));
            knobs[4]->setBounds(row2.removeFromLeft(w).reduced(2));
        } else { // 4 knobs
            int w = bounds.getWidth() / 2;
            int h = bounds.getHeight() / 2;
            
            auto row1 = bounds.removeFromTop(h);
            knobs[0]->setBounds(row1.removeFromLeft(w).reduced(4, 2));
            knobs[1]->setBounds(row1.reduced(4, 2));
            
            auto row2 = bounds;
            knobs[2]->setBounds(row2.removeFromLeft(w).reduced(4, 2));
            knobs[3]->setBounds(row2.reduced(4, 2));
        }
    }

  private:
      int instIdx;
      PhyzixAudioProcessor& processor;
      bool triggerFlashActive = false;

      juce::Label titleLabel;
      juce::Label subLabel;
      juce::TextButton modeButton;
      juce::TextButton muteButton;
      juce::TextButton crunchButton;
      juce::TextButton wipeButton;
      juce::OwnedArray<CustomKnob> knobs;
      std::unique_ptr<juce::FileChooser> fileChooser;

      juce::String getInstrumentName() const {
          std::vector<juce::String> names = { "Kick", "Snare", "Closed Hat", "Open Hat", "Ride", "Clap", "Toms", "Beep", "Blip", "Bloop", "Crunch", "Sample/Rec" };
          return names[instIdx];
      }

      juce::String getInstrumentSubline(bool useAlt) const {
          if (!useAlt) {
              std::vector<juce::String> sublines = { "Analog Sub", "Analog Noise", "Analog Metal", "Analog Metal", "FM Metal", "Analog Burst", "Pitch Swept", "Digital Sine", "FM Sweep Down", "FM Sweep Up", "Resonant Dist", "Sampler Track" };
              return sublines[instIdx];
          } else {
              std::vector<juce::String> sublines = { "Ate Oh Ate", "Sidestick Rim", "Diffuse Shaker", "Reverse Quant", "Metallic Gong", "Acoustic Snap", "Resonant Bomba", "Retro Laser", "Water Drop Plop", "Spring Bloop", "Guitar Wah", "Sampler Track" };
              return sublines[instIdx];
          }
      }

      void setupKnobs() {
          knobs.clear();
          auto defs = getKnobDefinitions(instIdx, false);
          for (const auto& def : defs) {
              auto* k = new CustomKnob(def.label, def.minVal, def.maxVal, def.defaultVal);
              k->slider.onValueChange = [this, k, key = def.key]() {
                  processor.params[instIdx][key] = (float)k->slider.getValue();
              };
              knobs.add(k);
              addAndMakeVisible(k);
          }
      }

      void updateKnobLabelsAndRanges(bool useAlt) {
          auto defs = getKnobDefinitions(instIdx, useAlt);
          for (int i = 0; i < defs.size() && i < knobs.size(); ++i) {
              knobs[i]->setLabel(defs[i].label);
              knobs[i]->slider.setRange(defs[i].minVal, defs[i].maxVal);
          }
      }

      std::vector<KnobDef> getKnobDefinitions(int inst, bool useAlt) {
          std::vector<KnobDef> defs;
          if (inst == 0) { 
              defs.push_back({"decay", useAlt ? "SubDecay" : "Decay", 0.05f, useAlt ? 4.0f : 0.8f, 0.25f});
              defs.push_back({"tone", "Tone", 30.0f, 100.0f, 55.0f});
              defs.push_back({"distortion", useAlt ? "Click" : "Drive", 0.0f, 1.0f, 0.1f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.8f});
          } else if (inst == 1) { 
              defs.push_back({"decay", "Decay", 0.05f, 0.8f, 0.2f});
              defs.push_back({"tone", "Tone", 100.0f, 300.0f, 180.0f});
              defs.push_back({"snappy", "Snappy", 0.0f, 1.0f, 0.5f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.7f});
          } else if (inst == 2) { 
              defs.push_back({"decay", "Decay", 0.02f, 0.2f, 0.06f});
              defs.push_back({"tone", "Tone", 5000.0f, 12000.0f, 8000.0f});
              defs.push_back({"pitch", "Speed", 0.2f, 2.0f, 1.0f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.5f});
          } else if (inst == 3) { 
              defs.push_back({"decay", useAlt ? "Steps" : "Decay", useAlt ? 1.0f : 0.1f, useAlt ? 4.0f : 1.0f, useAlt ? 1.0f : 0.35f});
              defs.push_back({"tone", "Tone", 5000.0f, 12000.0f, 8000.0f});
              defs.push_back({"pitch", "Speed", 0.2f, 2.0f, 1.0f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.5f});
          } else if (inst == 4) { 
              defs.push_back({"decay", useAlt ? "GongDecay" : "Decay", 0.2f, 2.0f, 0.8f});
              defs.push_back({"tone", "Tone", 200.0f, 800.0f, 350.0f});
              defs.push_back({"ring", useAlt ? "FM Mod" : "Ring", 0.0f, 1.0f, 0.4f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.4f});
          } else if (inst == 5) { 
              defs.push_back({"decay", useAlt ? "SnapDecay" : "Decay", 0.05f, 0.8f, 0.22f});
              defs.push_back({"tone", "Tone", 600.0f, 2000.0f, 1200.0f});
              defs.push_back({"spread", useAlt ? "Highpass" : "Spread", useAlt ? 5.0f : 5.0f, useAlt ? 30.0f : 30.0f, useAlt ? 12.0f : 12.0f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.6f});
          } else if (inst == 6) { 
              defs.push_back({"decay", "Decay", 0.1f, 1.2f, 0.35f});
              defs.push_back({"tone", "Tone", 50.0f, 200.0f, 90.0f});
              defs.push_back({"sweep", useAlt ? "Resonance" : "Sweep", 0.0f, 1.0f, 0.45f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.65f});
          } else if (inst == 7) { 
              defs.push_back({"decay", "Decay", 0.05f, 0.8f, 0.15f});
              defs.push_back({"pitch", "Pitch", 200.0f, 3000.0f, 880.0f});
              defs.push_back({"pulseWidth", "Shape", 0.0f, 1.0f, 0.0f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.5f});
          } else if (inst == 8) { 
              defs.push_back({"decay", "Decay", 0.01f, 0.2f, 0.04f});
              defs.push_back({"pitch", "Pitch", 1000.0f, 5000.0f, 2500.0f});
              defs.push_back({"sweep", "Speed", 0.0f, 1.0f, 0.5f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.6f});
          } else if (inst == 9) { 
              defs.push_back({"decay", "Decay", 0.05f, 0.6f, 0.18f});
              defs.push_back({"pitch", "Pitch", 200.0f, 1500.0f, 800.0f});
              defs.push_back({"speed", "Speed", 0.0f, 1.0f, 0.4f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.55f});
          } else if (inst == 10) { 
              defs.push_back({"decay", "Decay", 0.1f, 1.2f, 0.4f});
              defs.push_back({"tone", "Tone", 100.0f, 4000.0f, 1200.0f});
              defs.push_back({"crunch", useAlt ? "Wah Depth" : "Drive", 0.0f, 1.0f, 0.6f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.5f});
          } else if (inst == 11) { 
              defs.push_back({"decay", "Decay", 0.1f, 5.0f, 1.5f});
              defs.push_back({"tone", "Pitch", 0.25f, 4.0f, 1.0f});
              defs.push_back({"startPoint", "Start", 0.0f, 0.95f, 0.0f});
              defs.push_back({"endPoint", "End", 0.05f, 1.0f, 1.0f});
              defs.push_back({"volume", "Vol", 0.0f, 1.0f, 0.7f});
          }
          return defs;
      }
  };

// =============================================================================
// 6. REAL-TIME OSCILLOSCOPE WAVEFORM COMPONENT
// =============================================================================

class OscilloscopeComponent : public juce::Component, public juce::Timer {
public:
    OscilloscopeComponent(PhyzixAudioProcessor& p) : processor(p) {
        startTimerHz(40); 
    }

    void timerCallback() override {
        repaint();
    }

    void paint(juce::Graphics& g) override {
        auto bounds = getLocalBounds().toFloat();
        
        g.setColour(juce::Colour(0xffffffff));
        g.fillRoundedRectangle(bounds, 8.0f);
        g.setColour(juce::Colour(0x15000000));
        g.drawRoundedRectangle(bounds, 8.0f, 1.5f);

        float w = bounds.getWidth();
        float h = bounds.getHeight();
        float midY = h * 0.5f;

        drawPath(g, processor.lowsBuffer, processor.lowsWritePtr.load(), w, h, midY, juce::Colour(0x33e06c43), juce::Colour(0xffe06c43));
        drawPath(g, processor.midsBuffer, processor.midsWritePtr.load(), w, h, midY, juce::Colour(0x334b9b94), juce::Colour(0xff4b9b94));
        drawPath(g, processor.highsBuffer, processor.highsWritePtr.load(), w, h, midY, juce::Colour(0x333b82f6), juce::Colour(0xff3b82f6));
    }

private:
    PhyzixAudioProcessor& processor;
    
    void drawPath(juce::Graphics& g, const float* buffer, int writePtr, float w, float h, float midY, juce::Colour fillColour, juce::Colour strokeColour) {
        juce::Path p;
        p.startNewSubPath(0.0f, midY);
        
        for (int i = 0; i < 256; ++i) {
            int idx = (writePtr - 256 + i + 256) % 256;
            float sample = buffer[idx];
            float x = ((float)i / 256.0f) * w;
            float y = midY + sample * midY * 1.8f;
            p.lineTo(x, std::max(2.0f, std::min(h - 2.0f, y)));
        }

        g.setColour(fillColour);
        g.strokePath(p, juce::PathStrokeType(4.0f, juce::PathStrokeType::mitered, juce::PathStrokeType::rounded));
        g.setColour(strokeColour);
        g.strokePath(p, juce::PathStrokeType(1.5f, juce::PathStrokeType::mitered, juce::PathStrokeType::rounded));
    }
};

// =============================================================================
// 7. VELOCITY EDITOR COMPONENT
// =============================================================================

class VelocityEditorComponent : public juce::Component {
public:
    VelocityEditorComponent(PhyzixAudioProcessor& p) : processor(p) {}

    void paint(juce::Graphics& g) override {
        auto bounds = getLocalBounds().toFloat();
        g.setColour(juce::Colour(0x0a000000));
        g.fillRoundedRectangle(bounds, 4.0f);

        int ch = processor.selectedCard.load();
        int steps = processor.stepsCount.load();
        float stepW = bounds.getWidth() / (float)steps;
        float h = bounds.getHeight();

        g.setColour(juce::Colour(0x40e67e22));
        for (int s = 0; s < steps; ++s) {
            float vel = processor.velocityGrid[ch][s];
            float velH = vel * h;
            g.fillRect(s * stepW + 2.0f, h - velH, stepW - 4.0f, velH);
        }
    }

    void mouseDown(const juce::MouseEvent& event) override {
        mouseDrag(event);
    }

    void mouseDrag(const juce::MouseEvent& event) override {
        int steps = processor.stepsCount.load();
        float stepW = getWidth() / (float)steps;
        int step = (int)(event.position.x / stepW);
        step = std::max(0, std::min(steps - 1, step));

        float val = 1.0f - (event.position.y / getHeight());
        val = std::max(0.0f, std::min(1.0f, val));

        int ch = processor.selectedCard.load();
        processor.velocityGrid[ch][step] = val;
        repaint();
    }

private:
    PhyzixAudioProcessor& processor;
};

// =============================================================================
// 8. PIANO ROLL PITCH BEND COMPONENT
// =============================================================================

class NoteControlComponent : public juce::Component {
public:
    NoteControlComponent(PhyzixAudioProcessor& p) : processor(p) {
        std::vector<juce::String> names = { "KICK", "SNARE", "CLOSED HAT", "OPEN HAT", "RIDE", "CLAP", "TOM", "BEEP", "BLIP", "BLOOP", "CRUNCH", "SAMPLE" };
        for (int i = 0; i < 12; ++i) {
            instSelector.addItem(names[i], i + 1);
        }
        instSelector.setSelectedItemIndex(6, juce::dontSendNotification); // Default to Tom
        instSelector.onChange = [this]() {
            int idx = instSelector.getSelectedItemIndex();
            processor.selectedCard = idx;
            if (!processor.isPlaying.load()) {
                processor.triggerVoice(idx, 0.8f);
            }
            if (auto* parent = getParentComponent()) {
                parent->repaint();
            }
            repaint();
        };
        addAndMakeVisible(instSelector);

        label.setText("NOTE BEND", juce::dontSendNotification);
        label.setFont(juce::FontOptions(11.0f, juce::Font::bold));
        label.setColour(juce::Label::textColourId, juce::Colour(0xff2b2927));
        addAndMakeVisible(label);

        // Key and Scale selectors
        std::vector<juce::String> keys = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
        for (int i = 0; i < keys.size(); ++i) {
            keySelector.addItem(keys[i], i + 1);
        }
        keySelector.setSelectedItemIndex(0, juce::dontSendNotification); // Default C
        keySelector.onChange = [this]() { repaint(); };
        addAndMakeVisible(keySelector);

        std::vector<juce::String> scales = { "Chromatic", "Major", "Minor", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Locrian", "Pentatonic Maj", "Pentatonic Min" };
        for (int i = 0; i < scales.size(); ++i) {
            scaleSelector.addItem(scales[i], i + 1);
        }
        scaleSelector.setSelectedItemIndex(0, juce::dontSendNotification); // Default Chromatic
        scaleSelector.onChange = [this]() { repaint(); };
        addAndMakeVisible(scaleSelector);
    }

    void updateSelection() {
        int ch = processor.selectedCard.load();
        if (instSelector.getSelectedItemIndex() != ch) {
            instSelector.setSelectedItemIndex(ch, juce::dontSendNotification);
            repaint();
        }
    }

    bool isSemitoneInScale(int semitone, int keyRoot, int scaleIdx) {
        if (scaleIdx == 0) return true; // Chromatic
        
        static const std::vector<std::vector<int>> scaleIntervals = {
            {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}, // Chromatic
            {0, 2, 4, 5, 7, 9, 11},                 // Major
            {0, 2, 3, 5, 7, 8, 10},                 // Minor
            {0, 2, 3, 5, 7, 9, 10},                 // Dorian
            {0, 1, 3, 5, 7, 8, 10},                 // Phrygian
            {0, 2, 4, 6, 7, 9, 11},                 // Lydian
            {0, 2, 4, 5, 7, 9, 10},                 // Mixolydian
            {0, 1, 3, 5, 6, 8, 10},                 // Locrian
            {0, 2, 4, 7, 9},                        // Pentatonic Maj
            {0, 3, 5, 7, 10}                        // Pentatonic Min
        };
        
        int noteInOctave = (60 + semitone - keyRoot) % 12;
        if (noteInOctave < 0) noteInOctave += 12;
        
        if (scaleIdx >= 0 && scaleIdx < (int)scaleIntervals.size()) {
            const auto& intervals = scaleIntervals[scaleIdx];
            return std::find(intervals.begin(), intervals.end(), noteInOctave) != intervals.end();
        }
        return true;
    }

    int snapSemitoneToScale(int semitone, int keyRoot, int scaleIdx) {
        int bestSemitone = semitone;
        int minDistance = 100;
        for (int candidate = -24; candidate <= 24; ++candidate) {
            if (isSemitoneInScale(candidate, keyRoot, scaleIdx)) {
                int dist = std::abs(candidate - semitone);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestSemitone = candidate;
                }
            }
        }
        return bestSemitone;
    }

    juce::String getNoteName(int midiNote) {
        std::vector<juce::String> noteNames = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
        int octave = (midiNote / 12) - 1;
        int noteIdx = midiNote % 12;
        if (noteIdx < 0) noteIdx += 12;
        return noteNames[noteIdx] + juce::String(octave);
    }

    void paint(juce::Graphics& g) override {
        auto bounds = getLocalBounds();
        bounds.removeFromTop(30); 
        auto gridBounds = bounds.toFloat();

        g.setColour(juce::Colour(0xffffffff));
        g.fillRoundedRectangle(gridBounds, 8.0f);
        g.setColour(juce::Colour(0x0a000000));
        g.drawRoundedRectangle(gridBounds, 8.0f, 1.5f);

        int steps = processor.stepsCount.load();
        float stepW = gridBounds.getWidth() / (float)steps;
        float h = gridBounds.getHeight();
        float yOffset = gridBounds.getY();

        // Draw scale note markers (horizontal lines for valid scale notes)
        int keyRoot = keySelector.getSelectedItemIndex();
        int scaleIdx = scaleSelector.getSelectedItemIndex();

        for (int s = -24; s <= 24; ++s) {
            if (isSemitoneInScale(s, keyRoot, scaleIdx)) {
                float val = 0.5f + (float)s / 48.0f;
                float y = yOffset + h - (val * h);
                
                if (s % 12 == 0) { // Octave lines are darker
                    g.setColour(juce::Colour(0x22000000));
                    g.drawHorizontalLine((int)y, gridBounds.getX(), gridBounds.getRight());
                    
                    // Draw octave note name
                    juce::String noteName = getNoteName(s + 60);
                    g.setFont(juce::FontOptions(10.0f));
                    g.setColour(juce::Colour(0x80000000));
                    g.drawText(noteName, gridBounds.getX() + 5, (int)(y - 6), 40, 12, juce::Justification::left);
                } else { // Normal scale lines are very light
                    g.setColour(juce::Colour(0x0a000000));
                    g.drawHorizontalLine((int)y, gridBounds.getX(), gridBounds.getRight());
                }
            }
        }

        // Draw vertical step lines
        g.setColour(juce::Colour(0x05000000));
        for (int s = 1; s < steps; ++s) {
            float x = gridBounds.getX() + s * stepW;
            g.drawVerticalLine((int)x, gridBounds.getY(), gridBounds.getBottom());
        }

        int selectIdx = instSelector.getSelectedItemIndex();
        g.setColour(getTrackColour(selectIdx));
        float* activeGrid = getActiveGridPtr(selectIdx);

        for (int s = 0; s < steps; ++s) {
            float val = activeGrid[s];
            float dotX = gridBounds.getX() + s * stepW + stepW * 0.5f;
            float dotY = yOffset + h - (val * h);
            
            g.fillEllipse(dotX - 4.0f, dotY - 4.0f, 8.0f, 8.0f);
            if (s > 0) {
                float prevVal = activeGrid[s - 1];
                float prevX = gridBounds.getX() + (s - 1) * stepW + stepW * 0.5f;
                float prevY = yOffset + h - (prevVal * h);
                g.drawLine(prevX, prevY, dotX, dotY, 1.5f);
            }
        }
    }

    void mouseDown(const juce::MouseEvent& event) override {
        mouseDrag(event);
    }

    void mouseDrag(const juce::MouseEvent& event) override {
        auto bounds = getLocalBounds();
        bounds.removeFromTop(30); 
        auto gridBounds = bounds.toFloat();

        if (!gridBounds.contains(event.position)) return;

        int steps = processor.stepsCount.load();
        float stepW = gridBounds.getWidth() / (float)steps;
        int step = (int)((event.position.x - gridBounds.getX()) / stepW);
        step = std::max(0, std::min(steps - 1, step));

        float val = 1.0f - ((event.position.y - gridBounds.getY()) / gridBounds.getHeight());
        val = std::max(0.0f, std::min(1.0f, val));

        // Snap to selected key & scale
        int keyRoot = keySelector.getSelectedItemIndex();
        int scaleIdx = scaleSelector.getSelectedItemIndex();
        int semitone = std::round((val - 0.5f) * 48.0f);
        int snappedSemitone = snapSemitoneToScale(semitone, keyRoot, scaleIdx);
        float snappedVal = 0.5f + (float)snappedSemitone / 48.0f;

        int selectIdx = instSelector.getSelectedItemIndex();
        float* activeGrid = getActiveGridPtr(selectIdx);
        activeGrid[step] = snappedVal;
        
        repaint();
    }

    void resized() override {
        auto bounds = getLocalBounds();
        auto header = bounds.removeFromTop(30);
        label.setBounds(header.removeFromLeft(120).reduced(2));
        instSelector.setBounds(header.removeFromLeft(100).reduced(2));
        
        keySelector.setBounds(header.removeFromLeft(80).reduced(2));
        scaleSelector.setBounds(header.removeFromLeft(120).reduced(2));
    }

private:
    PhyzixAudioProcessor& processor;
    juce::ComboBox instSelector;
    juce::ComboBox keySelector;
    juce::ComboBox scaleSelector;
    juce::Label label;

    float* getActiveGridPtr(int idx) {
        if (idx >= 0 && idx < 12) {
            return processor.pitchAutomationGrid[idx];
        }
        return processor.pitchAutomationGrid[0];
    }
};

// =============================================================================
// 9. MODULAR EFFECTS ROUTING CHAIN COMPONENT
// =============================================================================

class ModularFXCard : public juce::Component, public juce::Timer {
public:
    ModularFXCard(int typeIdx, PhyzixAudioProcessor& p) : fxType(typeIdx), processor(p) {
        setName(getFXName());
        titleLabel.setText(getFXName().toUpperCase(), juce::dontSendNotification);
        titleLabel.setFont(juce::FontOptions(14.0f, juce::Font::bold));
        titleLabel.setColour(juce::Label::textColourId, juce::Colour(0xff2c3e50));
        titleLabel.setJustificationType(juce::Justification::centred);
        titleLabel.setBorderSize(juce::BorderSize<int>(0));
        addAndMakeVisible(titleLabel);

        activeCheck.setButtonText("ACTIVE");
        activeCheck.setClickingTogglesState(true);
        activeCheck.onClick = [this]() {
            processor.fxEnabled[fxType] = activeCheck.getToggleState();
        };
        addAndMakeVisible(activeCheck);

        leftArrow.setButtonText("<");
        leftArrow.onClick = [this]() {
            shiftOrder(-1);
        };
        addAndMakeVisible(leftArrow);

        rightArrow.setButtonText(">");
        rightArrow.onClick = [this]() {
            shiftOrder(1);
        };
        addAndMakeVisible(rightArrow);

        setupControls();

        if (fxType == 5) {
            startTimerHz(10);
        }
    }

    ~ModularFXCard() override {
        if (fxType == 5) {
            stopTimer();
        }
    }

    void updateControlsFromProcessor() {
        activeCheck.setToggleState(processor.fxEnabled[fxType], juce::dontSendNotification);
        
        if (fxType == 0) { 
            k1->slider.setValue(processor.distDrive, juce::dontSendNotification);
        } else if (fxType == 1) { 
            k1->slider.setValue(processor.filterCutoff, juce::dontSendNotification);
            k2->slider.setValue(processor.filterResonance, juce::dontSendNotification);
            typeCombo.setText(processor.filterType, juce::dontSendNotification);
        } else if (fxType == 2) { 
            k1->slider.setValue(processor.delayTime, juce::dontSendNotification);
            k2->slider.setValue(processor.delayFeedback, juce::dontSendNotification);
            k3->slider.setValue(processor.delayMix, juce::dontSendNotification);
        } else if (fxType == 3) { 
            k1->slider.setValue(processor.reverbDecay, juce::dontSendNotification);
            k2->slider.setValue(processor.reverbMix, juce::dontSendNotification);
        } else if (fxType == 4) { 
            k1->slider.setValue(processor.sidechainRatio, juce::dontSendNotification);
            k2->slider.setValue(processor.sidechainAttack, juce::dontSendNotification);
            k3->slider.setValue(processor.sidechainRelease, juce::dontSendNotification);
        } else if (fxType == 5) {
            updatePluginListCombo();
        }
    }

    void paint(juce::Graphics& g) override {
        auto bounds = getLocalBounds().toFloat();
        
        // Soft drop shadow
        g.setColour(juce::Colour(0x0a000000));
        g.fillRoundedRectangle(bounds.translated(3.0f, 4.0f), 12.0f);
        g.setColour(juce::Colour(0x08000000));
        g.fillRoundedRectangle(bounds.translated(1.5f, 2.0f), 12.0f);
        g.setColour(juce::Colour(0x04000000));
        g.fillRoundedRectangle(bounds.translated(0.5f, 1.0f), 12.0f);
        
        // Card body gradient
        juce::ColourGradient grad(juce::Colour(0xffffffff), 0.0f, 0.0f,
                                   juce::Colour(0xfff5f4ef), 0.0f, bounds.getHeight(), false);
        g.setFillType(grad);
        g.fillRoundedRectangle(bounds, 12.0f);
        
        g.setColour(juce::Colour(0x222b2927));
        g.drawRoundedRectangle(bounds, 12.0f, 1.2f);
    }

    void resized() override {
        auto bounds = getLocalBounds();
        titleLabel.setBounds(bounds.removeFromTop(24));
        
        auto arrowRow = bounds.removeFromTop(20);
        leftArrow.setBounds(arrowRow.removeFromLeft(30).reduced(2, 1));
        rightArrow.setBounds(arrowRow.removeFromRight(30).reduced(2, 1));
        activeCheck.setBounds(arrowRow.reduced(2, 1));

        int w = bounds.getWidth();
        int h = bounds.getHeight() / 3;
        
        if (k1) k1->setBounds(bounds.removeFromTop(h).reduced(6, 2));
        if (k2) k2->setBounds(bounds.removeFromTop(h).reduced(6, 2));
        
        if (fxType == 1) { 
            typeCombo.setBounds(bounds.reduced(6, 4));
        } else if (fxType == 5) {
            auto client = bounds.reduced(8);
            pluginCombo.setBounds(client.removeFromTop(30));
            client.removeFromTop(8);
            if (showUIButton != nullptr) showUIButton->setBounds(client.removeFromTop(35));
            client.removeFromTop(8);
            if (scanButton != nullptr) scanButton->setBounds(client.removeFromTop(35));
            client.removeFromTop(8);
            if (addFolderButton != nullptr) addFolderButton->setBounds(client.removeFromTop(35));
            client.removeFromTop(8);
            folderDisplay.setBounds(client);
        } else {
            if (k3) k3->setBounds(bounds.reduced(6, 2));
        }
    }

private:
    int fxType;
    PhyzixAudioProcessor& processor;

    juce::Label titleLabel;
    juce::TextButton leftArrow;
    juce::TextButton rightArrow;
    juce::TextButton activeCheck;

    std::unique_ptr<CustomKnob> k1;
    std::unique_ptr<CustomKnob> k2;
    std::unique_ptr<CustomKnob> k3;
    juce::ComboBox typeCombo;

    juce::ComboBox pluginCombo;
    std::unique_ptr<juce::TextButton> showUIButton;
    std::unique_ptr<juce::TextButton> scanButton;
    std::unique_ptr<juce::TextButton> addFolderButton;
    std::unique_ptr<juce::FileChooser> chooser;
    juce::Label folderDisplay;
    bool wasScanning = false;

    void timerCallback() override {
        if (fxType == 5) {
            bool scanning = processor.isScanning();
            if (wasScanning && !scanning) {
                processor.saveKnownPluginsList();
                updatePluginListCombo();
                juce::AlertWindow::showMessageBoxAsync(
                    juce::AlertWindow::InfoIcon,
                    "Scan Complete",
                    "VST scan completed successfully! " + juce::String(processor.knownPluginList.getNumTypes()) + " plugins found.",
                    "OK"
                );
            }
            wasScanning = scanning;
            
            if (showUIButton != nullptr) {
                bool isWindowVisible = (processor.pluginWindow != nullptr && processor.pluginWindow->isVisible());
                showUIButton->setButtonText(isWindowVisible ? "HIDE INTERFACE" : "SHOW INTERFACE");
            }
            updateFolderDisplay();
        }
    }

    void updateFolderDisplay() {
        if (fxType != 5) return;
        juce::String text = "Scan Folders:\n- Common Files\\VST3\n";
        for (auto& p : processor.userFoldersToScan) {
            juce::File f(p);
            text += "- " + f.getFileName() + "\n";
        }
        folderDisplay.setText(text, juce::dontSendNotification);
    }

    void updatePluginListCombo() {
        if (fxType != 5) return;
        pluginCombo.clear(juce::dontSendNotification);
        pluginCombo.addItem("None", 1);
        
        auto& list = processor.knownPluginList;
        int id = 2;
        for (auto& desc : list.getTypes()) {
            pluginCombo.addItem(desc.name + " (" + desc.pluginFormatName + ")", id++);
        }
        
        if (processor.hostedPlugin != nullptr) {
            auto currentDesc = processor.hostedPlugin->getPluginDescription();
            int selectId = 1;
            id = 2;
            for (auto& desc : list.getTypes()) {
                if (desc.fileOrIdentifier == currentDesc.fileOrIdentifier) {
                    selectId = id;
                    break;
                }
                id++;
            }
            pluginCombo.setSelectedId(selectId, juce::dontSendNotification);
        } else {
            pluginCombo.setSelectedId(1, juce::dontSendNotification);
        }
    }

    void openFolderChooser() {
        chooser = std::make_unique<juce::FileChooser>(
            "Select VST Plugin Folder...",
            juce::File::getSpecialLocation(juce::File::userHomeDirectory),
            "*"
        );
        
        chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories,
            [this](const juce::FileChooser& fc) {
                auto result = fc.getResult();
                if (result.isDirectory()) {
                    processor.addUserFolder(result.getFullPathName());
                }
            }
        );
    }

    juce::String getFXName() const {
        std::vector<juce::String> names = { "SATURATOR", "FILTER", "DELAY", "REVERB", "SIDECHAIN", "VST HOST" };
        return names[fxType];
    }

    void setupControls() {
        if (fxType == 0) { // Distortion
            k1 = std::make_unique<CustomKnob>("DRIVE", 0.0f, 1.0f, 0.3f);
            k1->slider.onValueChange = [this]() {
                processor.distDrive = (float)k1->slider.getValue();
            };
            addAndMakeVisible(k1.get());
        } else if (fxType == 1) { // Filter
            k1 = std::make_unique<CustomKnob>("FREQ", 60.0f, 18000.0f, 1200.0f);
            k1->slider.onValueChange = [this]() {
                processor.filterCutoff = (float)k1->slider.getValue();
            };
            addAndMakeVisible(k1.get());

            k2 = std::make_unique<CustomKnob>("RESONANCE", 0.1f, 10.0f, 2.0f);
            k2->slider.onValueChange = [this]() {
                processor.filterResonance = (float)k2->slider.getValue();
            };
            addAndMakeVisible(k2.get());

            typeCombo.addItem("Lowpass", 1);
            typeCombo.addItem("Highpass", 2);
            typeCombo.addItem("Bandpass", 3);
            typeCombo.setSelectedItemIndex(0, juce::dontSendNotification);
            typeCombo.onChange = [this]() {
                int idx = typeCombo.getSelectedItemIndex();
                if (idx == 0) processor.filterType = "lowpass";
                else if (idx == 1) processor.filterType = "highpass";
                else if (idx == 2) processor.filterType = "bandpass";
            };
            addAndMakeVisible(typeCombo);
        } else if (fxType == 2) { // Delay
            k1 = std::make_unique<CustomKnob>("TIME", 0.05f, 2.0f, 0.3f);
            k1->slider.onValueChange = [this]() {
                processor.delayTime = (float)k1->slider.getValue();
            };
            addAndMakeVisible(k1.get());

            k2 = std::make_unique<CustomKnob>("FEEDBACK", 0.0f, 0.95f, 0.4f);
            k2->slider.onValueChange = [this]() {
                processor.delayFeedback = (float)k2->slider.getValue();
            };
            addAndMakeVisible(k2.get());

            k3 = std::make_unique<CustomKnob>("MIX", 0.0f, 1.0f, 0.3f);
            k3->slider.onValueChange = [this]() {
                processor.delayMix = (float)k3->slider.getValue();
            };
            addAndMakeVisible(k3.get());
        } else if (fxType == 3) { // Reverb
            k1 = std::make_unique<CustomKnob>("DECAY", 0.1f, 5.0f, 1.2f);
            k1->slider.onValueChange = [this]() {
                processor.reverbDecay = (float)k1->slider.getValue();
            };
            addAndMakeVisible(k1.get());

            k2 = std::make_unique<CustomKnob>("MIX", 0.0f, 1.0f, 0.2f);
            k2->slider.onValueChange = [this]() {
                processor.reverbMix = (float)k2->slider.getValue();
            };
            addAndMakeVisible(k2.get());
        } else if (fxType == 4) { // Sidechain
            k1 = std::make_unique<CustomKnob>("RATIO", 0.0f, 1.0f, 0.8f);
            k1->slider.onValueChange = [this]() {
                processor.sidechainRatio = (float)k1->slider.getValue();
            };
            addAndMakeVisible(k1.get());

            k2 = std::make_unique<CustomKnob>("ATTACK", 0.001f, 0.1f, 0.01f);
            k2->slider.onValueChange = [this]() {
                processor.sidechainAttack = (float)k2->slider.getValue();
            };
            addAndMakeVisible(k2.get());

            k3 = std::make_unique<CustomKnob>("RELEASE", 0.01f, 1.0f, 0.15f);
            k3->slider.onValueChange = [this]() {
                processor.sidechainRelease = (float)k3->slider.getValue();
            };
            addAndMakeVisible(k3.get());
        } else if (fxType == 5) { // VST Host
            addAndMakeVisible(pluginCombo);
            pluginCombo.setTextWhenNoChoicesAvailable("No plugins found");
            pluginCombo.setTextWhenNothingSelected("Select VST...");
            
            updatePluginListCombo();
            pluginCombo.onChange = [this]() {
                int selectedId = pluginCombo.getSelectedId();
                if (selectedId <= 1) {
                    processor.unloadPlugin();
                } else {
                    auto& list = processor.knownPluginList;
                    int idx = selectedId - 2;
                    if (idx >= 0 && idx < list.getNumTypes()) {
                        auto desc = list.getTypes()[idx];
                        processor.loadPluginByDescription(desc);
                    }
                }
            };

            showUIButton = std::make_unique<juce::TextButton>("SHOW INTERFACE");
            showUIButton->onClick = [this]() {
                if (processor.pluginWindow != nullptr && processor.pluginWindow->isVisible()) {
                    processor.pluginWindow->setVisible(false);
                } else {
                    if (processor.hostedPlugin != nullptr) {
                        if (processor.pluginWindow == nullptr) {
                            processor.pluginWindow = std::make_unique<PluginWindow>(processor.hostedPlugin.get(), processor.hostedPlugin->getName());
                        }
                        processor.pluginWindow->setVisible(true);
                        processor.pluginWindow->toFront(true);
                    }
                }
            };
            addAndMakeVisible(showUIButton.get());

            scanButton = std::make_unique<juce::TextButton>("SCAN VST");
            scanButton->onClick = [this]() {
                processor.runScanner();
                wasScanning = true;
            };
            addAndMakeVisible(scanButton.get());

            addFolderButton = std::make_unique<juce::TextButton>("ADD FOLDER");
            addFolderButton->onClick = [this]() {
                openFolderChooser();
            };
            addAndMakeVisible(addFolderButton.get());

            addAndMakeVisible(folderDisplay);
            folderDisplay.setColour(juce::Label::textColourId, juce::Colour(0xff555555));
            folderDisplay.setFont(juce::FontOptions("sans-serif", 10.0f, juce::Font::plain));
            folderDisplay.setJustificationType(juce::Justification::topLeft);
            updateFolderDisplay();
        }
    }

    void shiftOrder(int dir) {
        auto& order = processor.fxChainOrder;
        auto it = std::find(order.begin(), order.end(), fxType);
        if (it != order.end()) {
            int idx = (int)std::distance(order.begin(), it);
            int nextIdx = idx + dir;
            if (nextIdx >= 0 && nextIdx < 6) {
                std::swap(order[idx], order[nextIdx]);
                if (auto* parent = getParentComponent()) {
                    parent->resized();
                }
            }
        }
    }
};

class UniversalEffectsComponent : public juce::Component {
public:
    UniversalEffectsComponent(PhyzixAudioProcessor& p)
        : processor(p),
          crunchActive("BITCRUSHER"),
          crunchBits("BITS", 1.0f, 16.0f, 8.0f),
          crunchDS("DOWNSAMPLE", 1.0f, 32.0f, 1.0f)
    {
        crunchActive.setClickingTogglesState(true);
        crunchActive.onClick = [this]() {
            processor.bitcrusherEnabled = crunchActive.getToggleState();
        };
        addAndMakeVisible(crunchActive);

        crunchBits.slider.onValueChange = [this]() {
            processor.bitcrusherBits = (int)crunchBits.slider.getValue();
        };
        addAndMakeVisible(crunchBits);

        crunchDS.slider.onValueChange = [this]() {
            processor.bitcrusherDownsample = (int)crunchDS.slider.getValue();
        };
        addAndMakeVisible(crunchDS);

        for (int i = 0; i < 6; ++i) {
            auto* card = new ModularFXCard(i, processor);
            fxCards.add(card);
            addAndMakeVisible(card);
        }
    }

    void updateControlsFromProcessor() {
        crunchActive.setToggleState(processor.bitcrusherEnabled.load(), juce::dontSendNotification);
        crunchBits.slider.setValue(processor.bitcrusherBits.load(), juce::dontSendNotification);
        crunchDS.slider.setValue(processor.bitcrusherDownsample.load(), juce::dontSendNotification);

        for (int i = 0; i < 6; ++i) {
            fxCards[i]->updateControlsFromProcessor();
        }
    }

    void paint(juce::Graphics& g) override {
        auto bounds = getLocalBounds().toFloat();
        auto crBounds = bounds.removeFromLeft(200.0f).reduced(4.0f);
        
        // Bitcrusher outer soft shadow
        g.setColour(juce::Colour(0x0a000000));
        g.fillRoundedRectangle(crBounds.translated(3.0f, 4.0f), 12.0f);
        g.setColour(juce::Colour(0x08000000));
        g.fillRoundedRectangle(crBounds.translated(1.5f, 2.0f), 12.0f);
        
        // Body gradient
        juce::ColourGradient grad(juce::Colour(0xffffffff), 0.0f, 0.0f,
                                   juce::Colour(0xfff5f4ef), 0.0f, crBounds.getHeight(), false);
        g.setFillType(grad);
        g.fillRoundedRectangle(crBounds, 12.0f);
        
        g.setColour(juce::Colour(0x222b2927));
        g.drawRoundedRectangle(crBounds, 12.0f, 1.2f);
    }

    void resized() override {
        auto bounds = getLocalBounds();
        auto crBounds = bounds.removeFromLeft(200).reduced(8);
        
        crunchActive.setBounds(crBounds.removeFromTop(24).reduced(6, 2));
        int h = crBounds.getHeight() / 2;
        crunchBits.setBounds(crBounds.removeFromTop(h).reduced(8, 2));
        crunchDS.setBounds(crBounds.reduced(8, 2));

        auto order = processor.fxChainOrder;
        int cardW = bounds.getWidth() / 6;
        for (int i = 0; i < 6; ++i) {
            int fxType = order[i];
            
            for (int c = 0; c < 6; ++c) {
                if (fxCards[c]->getName() == getFXName(fxType)) {
                    fxCards[c]->setBounds(bounds.getX() + i * cardW + 4, bounds.getY() + 4, cardW - 8, bounds.getHeight() - 8);
                    break;
                }
            }
        }
    }

private:
    PhyzixAudioProcessor& processor;
    juce::TextButton crunchActive;
    CustomKnob crunchBits;
    CustomKnob crunchDS;
    juce::OwnedArray<ModularFXCard> fxCards;

    juce::String getFXName(int fxType) const {
        std::vector<juce::String> names = { "SATURATOR", "FILTER", "DELAY", "REVERB", "SIDECHAIN", "VST HOST" };
        return names[fxType];
    }
};

// =============================================================================
// 10. MAIN CONTENT WINDOW CONTAINER COMPONENT
// =============================================================================

class SequencerCellButton : public juce::TextButton {
public:
    SequencerCellButton(int track, int step, PhyzixAudioProcessor& p)
        : trackIdx(track), stepIdx(step), processor(p)
    {
        setClickingTogglesState(true);
        setColour(juce::TextButton::buttonOnColourId, getTrackColour(track));
        setColour(juce::TextButton::buttonColourId, juce::Colour(0xffffffff));
        setColour(juce::TextButton::textColourOnId, juce::Colours::white);
    }
    
    void mouseDown(const juce::MouseEvent& event) override {
        if (event.mods.isRightButtonDown()) {
            processor.selectedCard = trackIdx;
            
            if (auto* parent = getParentComponent()) {
                if (auto* grandparent = parent->getParentComponent()) {
                    grandparent->repaint();
                }
                parent->repaint();
            }
            
            juce::PopupMenu menu;
            
            juce::PopupMenu stutterMenu;
            stutterMenu.addItem(1, "1 Hit (Normal)", true, processor.rollGrid[trackIdx][stepIdx] == 1);
            stutterMenu.addItem(2, "2 Hits (Stutter)", true, processor.rollGrid[trackIdx][stepIdx] == 2);
            stutterMenu.addItem(3, "3 Hits (Roll)", true, processor.rollGrid[trackIdx][stepIdx] == 3);
            stutterMenu.addItem(4, "4 Hits (Fast)", true, processor.rollGrid[trackIdx][stepIdx] == 4);
            menu.addSubMenu("Stutter Step Count", stutterMenu);
            
            juce::PopupMenu velocityMenu;
            velocityMenu.addItem(11, "25% (Soft)", true, std::abs(processor.velocityGrid[trackIdx][stepIdx] - 0.25f) < 0.1f);
            velocityMenu.addItem(12, "50% (Medium)", true, std::abs(processor.velocityGrid[trackIdx][stepIdx] - 0.5f) < 0.1f);
            velocityMenu.addItem(13, "75% (Accent)", true, std::abs(processor.velocityGrid[trackIdx][stepIdx] - 0.75f) < 0.1f);
            velocityMenu.addItem(14, "100% (Full)", true, std::abs(processor.velocityGrid[trackIdx][stepIdx] - 1.0f) < 0.1f);
            menu.addSubMenu("Velocity / Accent", velocityMenu);
            
            juce::PopupMenu pitchMenu;
            pitchMenu.addItem(21, "Low (-12ST)", true, std::abs(processor.pitchAutomationGrid[trackIdx][stepIdx] - 0.25f) < 0.1f);
            pitchMenu.addItem(22, "Normal (0ST)", true, std::abs(processor.pitchAutomationGrid[trackIdx][stepIdx] - 0.5f) < 0.1f);
            pitchMenu.addItem(23, "High (+12ST)", true, std::abs(processor.pitchAutomationGrid[trackIdx][stepIdx] - 0.75f) < 0.1f);
            menu.addSubMenu("Pitch Tuning Offset", pitchMenu);
            
            menu.showMenuAsync(juce::PopupMenu::Options{}, [this](int result) {
                if (result == 0) return;
                
                processor.patternGrid[trackIdx][stepIdx] = true;
                setToggleState(true, juce::dontSendNotification);
                
                if (result >= 1 && result <= 4) {
                    processor.rollGrid[trackIdx][stepIdx] = result;
                } else if (result >= 11 && result <= 14) {
                    float vels[] = { 0.25f, 0.5f, 0.75f, 1.0f };
                    processor.velocityGrid[trackIdx][stepIdx] = vels[result - 11];
                } else if (result >= 21 && result <= 23) {
                    float pitches[] = { 0.25f, 0.5f, 0.75f };
                    processor.pitchAutomationGrid[trackIdx][stepIdx] = pitches[result - 21];
                }
                
                if (auto* parent = getParentComponent()) {
                    parent->repaint();
                }
                repaint();
            });
        } else {
            juce::TextButton::mouseDown(event);
        }
    }

    void paintButton(juce::Graphics& g, bool shouldDrawButtonAsHighlighted, bool shouldDrawButtonAsDown) override {
        juce::TextButton::paintButton(g, shouldDrawButtonAsHighlighted, shouldDrawButtonAsDown);
        
        if (getToggleState()) {
            int rolls = processor.rollGrid[trackIdx][stepIdx];
            if (rolls > 1) {
                g.setColour(juce::Colour(0xffffffff));
                float w = (float)getWidth();
                float h = (float)getHeight();
                float stepW = w / (float)rolls;
                for (int i = 1; i < rolls; ++i) {
                    float x = (float)i * stepW;
                    g.drawVerticalLine((int)x, 0.0f, h);
                }
            }
        }
    }
private:
    int trackIdx;
    int stepIdx;
    PhyzixAudioProcessor& processor;
};

class UserManualOverlay : public juce::Component {
public:
    UserManualOverlay() {
        closeButton.setButtonText("CLOSE");
        closeButton.onClick = [this]() {
            setVisible(false);
        };
        closeButton.setColour(juce::TextButton::buttonColourId, juce::Colour(0xffe74c3c));
        closeButton.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
        addAndMakeVisible(closeButton);

        // Page selector buttons
        juce::StringArray pageNames = { "Top Bar", "Drum Cards", "Sequencer", "Automation", "FX & VST", "Signal Flow" };
        for (int i = 0; i < pageNames.size(); ++i) {
            auto* btn = new juce::TextButton(pageNames[i]);
            btn->setClickingTogglesState(true);
            btn->setRadioGroupId(1001);
            btn->onClick = [this, i]() {
                setPage(i);
            };
            btn->setColour(juce::TextButton::buttonColourId, juce::Colour(0xff222227));
            btn->setColour(juce::TextButton::buttonOnColourId, juce::Colour(0xffff6b00)); // active orange
            btn->setColour(juce::TextButton::textColourOffId, juce::Colour(0xfffdfdfd));
            btn->setColour(juce::TextButton::textColourOnId, juce::Colours::white);
            pageButtons.add(btn);
            addAndMakeVisible(btn);
        }

        manualText.setReadOnly(true);
        manualText.setMultiLine(true);
        manualText.setScrollBarThickness(12);
        manualText.setFont(juce::FontOptions(juce::Font::getDefaultMonospacedFontName(), 13.0f, juce::Font::plain));
        manualText.setColour(juce::TextEditor::backgroundColourId, juce::Colour(0xff121214)); // dark background
        manualText.setColour(juce::TextEditor::textColourId, juce::Colour(0xfffdfdfd)); // off-white text
        manualText.setColour(juce::TextEditor::outlineColourId, juce::Colour(0xff0984e3)); // contrasting blue outline
        addAndMakeVisible(manualText);

        // Select first page
        pageButtons[0]->setToggleState(true, juce::sendNotification);
    }

    void setPage(int idx) {
        currentPageIdx = idx;
        for (int i = 0; i < pageButtons.size(); ++i) {
            pageButtons[i]->setToggleState(i == idx, juce::dontSendNotification);
        }
        manualText.setText(getPageText(idx), false);
    }

    void paint(juce::Graphics& g) override {
        // App color theme manual: dark slate matching the app look
        g.fillAll(juce::Colour(0xf01e1e24)); 
        
        // Contrasting blue and orange borders
        auto bounds = getLocalBounds().toFloat();
        g.setColour(juce::Colour(0xffff6b00)); // Orange border line
        g.drawRect(bounds, 2.5f);
    }

    void resized() override {
        auto bounds = getLocalBounds();
        auto topBar = bounds.removeFromTop(45).reduced(5);
        
        closeButton.setBounds(topBar.removeFromRight(100).reduced(2));
        
        int numPages = pageButtons.size();
        int tabWidth = topBar.getWidth() / numPages;
        for (int i = 0; i < numPages; ++i) {
            pageButtons[i]->setBounds(topBar.removeFromLeft(tabWidth).reduced(2));
        }
        
        manualText.setBounds(bounds.reduced(15));
    }

private:
    juce::TextButton closeButton;
    juce::TextEditor manualText;
    juce::OwnedArray<juce::TextButton> pageButtons;
    int currentPageIdx = 0;

    juce::String getPageText(int idx) {
        switch (idx) {
            case 0:
                return 
"================================================================================\n"
"          PHYZIX SERIES - SLAMS & BAMS - MANUAL: TOP BAR SECTION                \n"
"================================================================================\n"
"\n"
"The Top Bar manages the master transport, tempo clock, and preset state.\n"
"\n"
"+-----------------------------------------------------------------------------+\n"
"|                                                                             |\n"
"|  [PLAY]  [ BPM ]  [ SWING ]  [ MASTER ]  [ TIME SIG ]  [ STEPS ]  [PRESETS] |\n"
"|  +----+  +-----+  +-------+  +--------+  +----------+  +-------+  +-------+ |\n"
"|  | >  |  | 120 |  |  0.0  |  |  0.80  |  |   4 / 4  |  |   16  |  |Factory| |\n"
"|  +----+  +-----+  +-------+  +--------+  +----------+  +-------+  +-------+ |\n"
"|                                                                             |\n"
"+-----------------------------------------------------------------------------+\n"
"\n"
"1. TRANSPORT & CLOCK CONTROLS\n"
"-----------------------------\n"
" - PLAY/STOP: Toggles the sequencer. Changes color to warning orange when playing.\n"
" - BPM SLIDER: Controls the tempo clock (40 to 240 BPM).\n"
" - SWING SLIDER: Adds delay shuffle to even steps (0.0 to 1.0) for groove control.\n"
" - MASTER VOL SLIDER: Attenuates the final summed output (0.0 to 1.5).\n"
" - TIME SIGNATURE: Changes grid meter (4/4, 3/4, 6/8) for vertical dividers.\n"
" - STEPS COUNT: Sets sequencer length to 16, 32, 48, or 64 steps.\n"
"\n"
"2. PRESET MANAGER\n"
"-----------------\n"
" - FACTORY PRESETS DROPDOWN: Load patterns and modular effects combinations.\n"
" - USER PRESETS DROPDOWN: Load custom user presets from application folder.\n"
" - NAME EDITOR: Type a text name for a custom configuration.\n"
" - [SAVE] BUTTON: Writes a preset JSON file to disk under UserPresets.\n"
"\n"
"3. SLAM THE DOOR CONTROL\n"
"------------------------\n"
" - SLAM THE DOOR BUTTON: Routes master bus through heavy 320Hz lowpass filter\n"
"   and triggers a deep sub-bass sweep (30-55Hz) with sidechained compression.\n"
" - LATCH CHECKBOX: Sets button behavior:\n"
"    * LATCH CHECKED: SLAM acts as a toggle switch (remains active when clicked).\n"
"    * LATCH UNCHECKED: SLAM is momentary (only active while mouse is held down).\n"
"\n"
"4. PANEL COLLAPSE BUTTONS\n"
"-------------------------\n"
" - COLLAPSE EDITOR: Toggles visibility of the sequencer grid/editor tabs.\n"
" - COLLAPSE DRUMS: Toggles visibility of the 12 bottom drum sound cards.\n"
"================================================================================";

            case 1:
                return
"================================================================================\n"
"          PHYZIX SERIES - SLAMS & BAMS - MANUAL: DRUM VOICE CARDS                \n"
"================================================================================\n"
"\n"
"Phyzix has 12 simultaneous drum tracks. Channels 1-11 are dual-mode synthesis\n"
"models, and Channel 12 is a sample player.\n"
"\n"
"+-----------------------------------------------------------------------------+\n"
"|                                DRUM VOICE CARD                              |\n"
"|  +--------------------+                                                     |\n"
"|  | [ KICK ]     [A/B] |  --> SELECTOR: A = Analog, B = 808/Digital          |\n"
"|  | (Vol)   (Dec)      |  --> VOLUME: Set the track's output level           |\n"
"|  | (Tone)  (Sweep)    |  --> DECAY: Set amplitude envelope decay length     |\n"
"|  |         (Snappy)   |  --> TONE: Pitch center / filter cutoff frequency   |\n"
"|  | [M] [S]            |  --> SWEEP: Pitch envelope mod sweep depth          |\n"
"|  +--------------------+  --> SNAPPY: Transient level / noise ratio          |\n"
"|                          --> MUTE [M] / SOLO [S]: Isolate or mute channel   |\n"
"+-----------------------------------------------------------------------------+\n"
"\n"
"1. VOICE ENGINES DEFINITION (A / B SELECTOR)\n"
"--------------------------------------------\n"
" - KICK:   A = Saturated analog punch kick, B = Tunable 808 sub kick (5x decay).\n"
" - SNARE:  A = Gritty metal shell with noise sweep, B = 808 style dual-sine shell.\n"
" - CL. HAT:A = HPF white noise, B = BPF metallic noise. (Choked by Closed Hat)\n"
" - OP. HAT:A = HPF white noise, B = Reverse envelope gated noise.\n"
" - RIDE:   A = FM metal ride, B = Carrier-modulator FM pair.\n"
" - CLAP:   A = Hand clap multi-burst generator, B = Wood-block snap.\n"
" - TOM:    A = Standard tom pitch sweep, B = Resonant skin drum tom.\n"
" - BEEP:   A = Saturated square synth beep, B = Metallic ring-mod FM beep.\n"
" - BLIP:   A = Exponential pitch blip, B = Pitch ramp-up glitch.\n"
" - BLOOP:  A = Sweep-up bloop sound, B = Double-slope frequency bloop.\n"
" - CRUNCH: A = Saturated lowpass crunch, B = Wah-envelope crunch.\n"
"\n"
"2. SAMPLER CARD (CHANNEL 12)\n"
"----------------------------\n"
" - LOAD BUTTON: Opens system dialog to import WAV, MP3, or AIFF audio samples.\n"
" - REC BUTTON: Records live stereo/mono audio from host input (up to 5 seconds).\n"
" - START / END KNOBS: Adjust crop range markers for sample playback.\n"
"================================================================================";

            case 2:
                return
"================================================================================\n"
"          PHYZIX SERIES - SLAMS & BAMS - MANUAL: SEQUENCER GRID                  \n"
"================================================================================\n"
"\n"
"The Grid Sequencer edits triggers, stutter rolls, velocity, and pitch offsets.\n"
"\n"
"+-----------------------------------------------------------------------------+\n"
"|                                                                             |\n"
"|   Step Sequencer Cells (Up to 64 Steps)                                     |\n"
"|   +-------------------------------------------------------------+           |\n"
"|   | [X] | [ ] | [X] | [ ] | [X] | [ ] | [X] | [ ] | ...           |           |\n"
"|   +-------------------------------------------------------------+           |\n"
"|      ^                                                                      |\n"
"|      +-- Left-Click: Toggle Step On/Off                                     |\n"
"|      +-- Right-Click: Opens Property Menu                                   |\n"
"|            |                                                                |\n"
"|            +---> VELOCITY ACCENT: Choose 25%, 50%, 75%, or 100% volume level|\n"
"|            +---> STUTTER ROLL: Divide step into 1x, 2x, 3x, or 4x rolls     |\n"
"|            +---> NOTE PITCH: Select step-specific pitch (Low/Normal/High)   |\n"
"|                                                                             |\n"
"+-----------------------------------------------------------------------------+\n"
"\n"
"1. STEP PROGRAMMING & MOUSE SHORTCUTS\n"
"-------------------------------------\n"
" - LEFT-CLICK: Directly add or clear a step trigger on the selected track.\n"
" - RIGHT-CLICK: Opens step context properties menu to set accents and rolls:\n"
"    * Accent: Scales trigger volume (25%, 50%, 75%, 100%).\n"
"    * Stutter: Subdivides the clock step (1x = no roll, 2x, 3x, 4x re-triggers).\n"
"    * Pitch: Per-step pitch bend offsets (Low: -12ST, Normal: 0, High: +12ST).\n"
"\n"
"2. UTILITY BUTTONS\n"
"------------------\n"
" - RANDOMIZE TRACK: Generates a random sequence for the active channel card.\n"
" - RANDOMIZE PATTERN: Generates randomized patterns on all 12 tracks.\n"
" - CLEAR GRID: Instantly removes all triggers from the sequencer grid.\n"
" - CLEAR MOTION: Clears all custom drawn velocity and note automation envelopes.\n"
" - EXPORT MIDI: Drag and drop this button into DAW to export sequence as MIDI.\n"
"================================================================================";

            case 3:
                return
"================================================================================\n"
"          PHYZIX SERIES - SLAMS & BAMS - MANUAL: AUTOMATION CURVES               \n"
"================================================================================\n"
"\n"
"Velocity and Note Control editors allow you to draw precise automation curves.\n"
"\n"
"1. VELOCITY EDITOR\n"
"------------------\n"
" Draw velocity levels (0.0 to 1.0) for each step on the selected track. This\n"
" scales the trigger volume dynamically on playback, allowing humanized dynamics.\n"
"\n"
"2. NOTE CONTROL (PITCH BEND) EDITOR\n"
"-----------------------------------\n"
" Draws the pitch bend envelope curve for each sequencer step. All 12 drum\n"
" channels are fully tunable using this control.\n"
"\n"
" 1.0 |      *                                                                 \n"
"     |     / \\                                                                \n"
" 0.5 |    *   *       * <--- Click-and-drag to draw curves                    \n"
"     |  /       \\    /                                                        \n"
" 0.0 | *          *                                                           \n"
"     +-----------------------------------------                               \n"
"       Step 1   2   3   4                                                     \n"
"\n"
"3. AUTOMATED PITCH SCALING & SCALE SNAPPING\n"
"-------------------------------------------\n"
" - Normal pitch center is 0.5 (maps to 0ST pitch offset multiplier 1.0f).\n"
" - Drawing above 0.5 pitches up (up to +12ST / 1 octave at 0.75, +24ST / 2 octaves at 1.0).\n"
" - Drawing below 0.5 pitches down (down to -12ST / 1 octave at 0.25, -24ST / 2 octaves at 0.0).\n"
" - KEY & SCALE SELECTORS: Snaps the drawn pitch bend curve to notes in the selected\n"
"   key and musical scale (e.g. Major, Minor, Pentatonic, Dorian, etc.) in real time.\n"
" - The pitch bend graph displays note grid lines and names (e.g., C3, C4, C5) matching\n"
"   the selected scale layout.\n"
" - Select the active track using the dropdown box next to the label. This selection\n"
"   syncs automatically when you select different drum cards at the bottom.\n"
"================================================================================";

            case 4:
                return
"================================================================================\n"
"          PHYZIX SERIES - SLAMS & BAMS - MANUAL: MODULAR FX & VST                \n"
"================================================================================\n"
"\n"
"The Universal Effects section provides a reorderable modular processor chain.\n"
"\n"
"1. MODULAR EFFECT CARDS\n"
"-----------------------\n"
" - ORDER SHIFTING: Click '<' or '>' on any card to move it. Signal flows left to right.\n"
" - ACTIVE TOGGLE: Click the checkbox inside each card to bypass or enable it.\n"
" - DISTORTION: Wavefolding saturator with Drive and Tone dials.\n"
" - FILTER: Resonant biquad filter supporting Lowpass, Highpass, and Bandpass.\n"
" - DELAY: Stereo delay with Time, Feedback, and Mix controls.\n"
" - REVERB: Stereo algorithmic room simulator with width, size, and damp controls.\n"
" - SIDECHAIN: Compressor triggered by Kick (Ch 0). Adjust Threshold and Ratio.\n"
"\n"
"2. MASTER BITCRUSHER (PRE-FX BUS)\n"
"---------------------------------\n"
" - The Master Bitcrusher applies global sample reduction to the Crunch Bus.\n"
" - BYP ON BUTTON: Toggle on a drum voice card to bypass the Bitcrusher for that voice.\n"
" - CRUNCH ACTIVE: Enable/bypass the global bitcrusher in the effects bank.\n"
" - CRUNCH BITS: Adjust bit depth reduction (1 to 16 bits) for classic digital grit.\n"
" - CRUNCH DOWNSAMPLE: Adjust frequency downsampling (1 to 32x downsample rate).\n"
"\n"
"3. VST HOST INSERT CARD (CARD 6)\n"
"--------------------------------\n"
" Host external VST/VST3 plugins in the Phyzix effects chain. This card displays:\n"
" - SCAN FOLDERS LIST: Displays directories set up to scan.\n"
" - [ADD FOLDER] BUTTON: Adds a standard/user system directory to the scan paths.\n"
" - [SCAN VST] BUTTON: Performs a background thread scan of DLL/VST3 binaries,\n"
"   building a cache file (scans will not freeze the user interface).\n"
" - PLUGIN SELECTOR COMBOBOX: Select and load any successfully scanned plugin.\n"
" - [SHOW INTERFACE] BUTTON: Opens a popup window containing the VST's native UI.\n"
"================================================================================";

            case 5:
                return
"================================================================================\n"
"          PHYZIX SERIES - SLAMS & BAMS - MANUAL: ROUTING FLOW                    \n"
"================================================================================\n"
"\n"
"1. SIGNAL ROUTING FLOW CHART\n"
"----------------------------\n"
"      [12 Instrument Channels]                              [Master Bus]\n"
"    +--------------------------+                         +----------------+\n"
"    | Kick   (Ch 0)  - Synth   |--+                      |                |\n"
"    | Snare  (Ch 1)  - Synth   |  |  +----------------+  | [Slam Filter]  |\n"
"    | Hats   (Ch 2-3)- Synth   |  |  +----------------+  |     (320Hz)    |\n"
"    | Ride   (Ch 4)  - Synth   |  |  +----------------+  |       |        |\n"
"    | Clap   (Ch 5)  - Synth   |  |          |           | [Sub Bass Osc] |\n"
"    | Toms   (Ch 6)  - Synth   |  |  +----------------+  |     (30-55Hz)  |\n"
"    | Beep   (Ch 7)  - Synth   |  +->| FX Routing     |  |       |        |\n"
"    | Blip   (Ch 8)  - Synth   |     |   Chain:       |->| [Slam Comp]    |\n"
"    | Bloop  (Ch 9)  - Synth   |     |  1. Saturator  |  |  (-42dB Ratio) |\n"
"    | Crunch (Ch 10) - Synth   |     |  2. Biquad FLT |  +----------------+\n"
"    | Sampler(Ch 11) - Samples |--+  |  3. Delay      |          |       \n"
"    +--------------------------+  |  |  4. Reverb     |   [Master Volume]\n"
"                                  |  |  5. Sidechain  |          |\n"
"                                  |  |  6. VST Host   |    Stereo Out (L/R)\n"
"                                  +->+----------------+    \n"
"\n"
"2. ENGINE SUMMING DETAILS\n"
"-------------------------\n"
" - Voices summation is performed block-by-block to guarantee plugin host safety.\n"
" - Each voice outputs audio buffer frames at current sample rate.\n"
" - Outputs of all 12 channels are summed into the stereo master bus buffer.\n"
" - Summed master buffer is passed through active modular FX in sequence.\n"
" - Closed Hat choke trap: Triggering Closed Hat (Ch 2) immediately kills Open Hat (Ch 3).\n"
" - Slam compressor is sidechained by a master sub bass sine wave running at 30-55Hz.\n"
"================================================================================";
            default:
                return "";
        }
    }
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(UserManualOverlay)
};

class MainContentComponent : public juce::Component, public juce::ChangeListener {
public:
    MainContentComponent(PhyzixAudioProcessor& p)
        : processor(p),
          oscilloscope(p),
          velocityGrid(p),
          pianoRoll(p),
          effectsPanel(p)
    {
        // Title logo handled by custom paint()

        // Help manual button and overlay
        helpButton.setButtonText("HELP");
        helpButton.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff34495e));
        helpButton.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
        helpButton.onClick = [this]() {
            manualOverlay.setVisible(true);
            manualOverlay.toFront(true);
        };
        addAndMakeVisible(helpButton);
        addChildComponent(manualOverlay);
        manualOverlay.setVisible(false);

        // Session Record Button
        sessionRecordButton.setButtonText("REC SESSION");
        sessionRecordButton.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff2c3e50)); // Dark blue-grey
        sessionRecordButton.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
        sessionRecordButton.onClick = [this]() {
            toggleSessionRecording();
        };
        addAndMakeVisible(sessionRecordButton);

        // Master Volume
        masterVolSlider = std::make_unique<CustomKnob>("MASTER VOL", 0.0f, 1.0f, 0.8f);
        masterVolSlider->slider.onValueChange = [this]() {
            processor.masterVolume = (float)masterVolSlider->slider.getValue();
        };
        addAndMakeVisible(masterVolSlider.get());
        // A. Header Elements
        playButton.setButtonText("PLAY");
        playButton.onClick = [this]() {
            processor.togglePlay();
            updatePlayButtonText();
        };
        playButton.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff2b2927));
        playButton.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
        addAndMakeVisible(playButton);

        presetCombo.addItem("Factory: Classic Techno", 1);
        presetCombo.addItem("Factory: Dusty Boom-Bap", 2);
        presetCombo.addItem("Factory: Liquid Drum & Bass", 3);
        presetCombo.addItem("Factory: Neon Synthwave", 4);
        presetCombo.addItem("Factory: Rattling Trap", 5);
        presetCombo.addItem("Factory: Sleek Deep House", 6);
        presetCombo.addItem("Factory: Industrial EBM", 7);
        presetCombo.addItem("Factory: Ambient Dub Space", 8);
        presetCombo.addItem("Factory: Latin Samba", 9);
        presetCombo.addItem("Factory: Minimal Glitch", 10);
        presetCombo.addItem("Factory: Organic Funk Break", 11);
        presetCombo.addItem("Factory: Future Bass Half-Time", 12);
        presetCombo.addItem("Factory: Melodic Hip-Hop", 13);
        presetCombo.addItem("Factory: Ethnic Drill", 14);
        presetCombo.setSelectedItemIndex(0, juce::dontSendNotification);
        presetCombo.onChange = [this]() {
            processor.loadPreset(presetCombo.getSelectedItemIndex());
            updateSequencerGridUI();
            updateAllDrumCardSliders();
            effectsPanel.updateControlsFromProcessor();
            bpmSlider->slider.setValue(processor.bpm.load(), juce::dontSendNotification);
            swingSlider->slider.setValue(processor.swing.load(), juce::dontSendNotification);
            stepsCombo.setText(juce::String(processor.stepsCount.load()) + " Steps", juce::dontSendNotification);
        };
        addAndMakeVisible(presetCombo);

        // User Presets
        presetNameEditor.setTextToShowWhenEmpty("New Preset...", juce::Colour(0x80808080));
        addAndMakeVisible(presetNameEditor);

        savePresetButton.setButtonText("SAVE");
        savePresetButton.onClick = [this]() {
            juce::String name = presetNameEditor.getText().trim();
            if (name.isNotEmpty()) {
                processor.saveUserPreset(name);
                refreshUserPresetsList();
                userPresetCombo.setText(name, juce::dontSendNotification);
            }
        };
        addAndMakeVisible(savePresetButton);

        addAndMakeVisible(userPresetCombo);
        refreshUserPresetsList();
        userPresetCombo.onChange = [this]() {
            int idx = userPresetCombo.getSelectedItemIndex();
            if (idx > 0) {
                juce::String name = userPresetCombo.getItemText(idx);
                if (processor.loadUserPreset(name)) {
                    updateSequencerGridUI();
                    updateAllDrumCardSliders();
                    effectsPanel.updateControlsFromProcessor();
                    bpmSlider->slider.setValue(processor.bpm.load(), juce::dontSendNotification);
                    swingSlider->slider.setValue(processor.swing.load(), juce::dontSendNotification);
                    stepsCombo.setText(juce::String(processor.stepsCount.load()) + " Steps", juce::dontSendNotification);
                    timeSigCombo.setText(processor.timeSignature, juce::dontSendNotification);
                }
            }
        };

        timeSigCombo.addItem("4/4", 1);
        timeSigCombo.addItem("3/4", 2);
        timeSigCombo.addItem("5/4", 3);
        timeSigCombo.addItem("6/8", 4);
        timeSigCombo.setSelectedItemIndex(0, juce::dontSendNotification);
        timeSigCombo.onChange = [this]() {
            int idx = timeSigCombo.getSelectedItemIndex();
            if (idx == 0) { processor.timeSignature = "4/4"; processor.stepsCount = 16; }
            else if (idx == 1) { processor.timeSignature = "3/4"; processor.stepsCount = 12; }
            else if (idx == 2) { processor.timeSignature = "5/4"; processor.stepsCount = 20; }
            else if (idx == 3) { processor.timeSignature = "6/8"; processor.stepsCount = 12; }
            stepsCombo.setText(juce::String(processor.stepsCount.load()) + " Steps", juce::dontSendNotification);
            activeTabChanged();
        };
        addAndMakeVisible(timeSigCombo);

        stepsCombo.addItem("16 Steps", 1);
        stepsCombo.addItem("32 Steps", 2);
        stepsCombo.addItem("48 Steps", 3);
        stepsCombo.addItem("64 Steps", 4);
        stepsCombo.setSelectedItemIndex(0, juce::dontSendNotification);
        stepsCombo.onChange = [this]() {
            int idx = stepsCombo.getSelectedItemIndex();
            if (idx == 0) processor.stepsCount = 16;
            else if (idx == 1) processor.stepsCount = 32;
            else if (idx == 2) processor.stepsCount = 48;
            else if (idx == 3) processor.stepsCount = 64;
            activeTabChanged();
        };
        addAndMakeVisible(stepsCombo);

        bpmSlider = std::make_unique<CustomKnob>("BPM", 20.0f, 240.0f, 120.0f);
        bpmSlider->slider.onValueChange = [this]() {
            processor.bpm = (int)bpmSlider->slider.getValue();
        };
        addAndMakeVisible(bpmSlider.get());

        swingSlider = std::make_unique<CustomKnob>("SWING", 0.0f, 1.0f, 0.0f);
        swingSlider->slider.onValueChange = [this]() {
            processor.swing = (float)swingSlider->slider.getValue();
        };
        addAndMakeVisible(swingSlider.get());

        slamButton.setButtonText("SLAM THE DOOR");
        slamButton.setColour(juce::TextButton::buttonColourId, juce::Colour(0xffe67e22));
        slamButton.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
        slamButton.onClick = [this]() {
            if (latchCheck.getToggleState()) {
                processor.setSlamTheDoor(slamButton.getToggleState());
            }
        };
        slamButton.onStateChange = [this]() {
            if (!latchCheck.getToggleState()) {
                processor.setSlamTheDoor(slamButton.isDown());
            }
        };
        addAndMakeVisible(slamButton);

        latchCheck.setButtonText("LATCH");
        latchCheck.setClickingTogglesState(true);
        latchCheck.setColour(juce::ToggleButton::textColourId, juce::Colour(0xff2c3e50));
        latchCheck.setColour(juce::ToggleButton::tickColourId, juce::Colour(0xffd35400));
        latchCheck.setLookAndFeel(&lnf);
        latchCheck.onClick = [this]() {
            bool isLatch = latchCheck.getToggleState();
            slamButton.setClickingTogglesState(isLatch);
            if (!isLatch) {
                slamButton.setToggleState(false, juce::dontSendNotification);
                processor.setSlamTheDoor(false);
            }
        };
        addAndMakeVisible(latchCheck);

        // B. Momentary Fills Override
        fillPanel.setText("MOMENTARY DRUM FILL OVERRIDE", juce::dontSendNotification);
        fillPanel.setFont(juce::FontOptions(10.0f, juce::Font::bold));
        fillPanel.setColour(juce::Label::textColourId, juce::Colour(0xff2b2927));
        addAndMakeVisible(fillPanel);

        fillButton.setButtonText("FILL");
        fillButton.onStateChange = [this]() {
            processor.fillActive = fillButton.isDown();
        };
        fillButton.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff4b9b94));
        fillButton.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
        addAndMakeVisible(fillButton);

        fillPatternCombo.addItem("Traditional Snare", 1);
        fillPatternCombo.addItem("Traditional Toms", 2);
        fillPatternCombo.addItem("Glitch 32nd Note", 3);
        fillPatternCombo.addItem("focused Stutter", 4);
        fillPatternCombo.setSelectedItemIndex(0, juce::dontSendNotification);
        fillPatternCombo.onChange = [this]() {
            int idx = fillPatternCombo.getSelectedItemIndex();
            if (idx == 0) processor.fillPattern = "traditional_a";
            else if (idx == 1) processor.fillPattern = "traditional_b";
            else if (idx == 2) processor.fillPattern = "glitch";
            else if (idx == 3) processor.fillPattern = "stutter";
        };
        addAndMakeVisible(fillPatternCombo);

        midiCCButton.setButtonText("LEARN MIDI CC");
        addAndMakeVisible(midiCCButton);

        // C. Crossover Oscilloscope
        addAndMakeVisible(oscilloscope);

        // D. Preset / Random controls row
        randomizeTrackBtn.setButtonText("RANDOMIZE TRACK");
        randomizeTrackBtn.onClick = [this]() {
            int ch = processor.selectedCard.load();
            for (int s = 0; s < 64; ++s) {
                processor.patternGrid[ch][s] = (std::rand() % 100 < 35);
            }
            updateSequencerGridUI();
        };
        addAndMakeVisible(randomizeTrackBtn);

        randomizePatternBtn.setButtonText("RANDOMIZE PATTERN");
        randomizePatternBtn.onClick = [this]() {
            for (int c = 0; c < 12; ++c) {
                for (int s = 0; s < 64; ++s) {
                    processor.patternGrid[c][s] = (std::rand() % 100 < 30);
                }
            }
            updateSequencerGridUI();
        };
        addAndMakeVisible(randomizePatternBtn);

        clearGridBtn.setButtonText("CLEAR GRID");
        clearGridBtn.onClick = [this]() {
            memset(processor.patternGrid, 0, sizeof(processor.patternGrid));
            updateSequencerGridUI();
        };
        addAndMakeVisible(clearGridBtn);

        clearMotionBtn.setButtonText("CLEAR ALL MOTION");
        clearMotionBtn.onClick = [this]() {
            for (int c = 0; c < 12; ++c) {
                for (int s = 0; s < 64; ++s) {
                    processor.pitchAutomationGrid[c][s] = 0.5f;
                    processor.velocityGrid[c][s] = 0.5f;
                    processor.automationGrid[c][s].clear();
                }
            }
            updateSequencerGridUI();
            pianoRoll.repaint();
        };
        addAndMakeVisible(clearMotionBtn);

        exportMidiBtn.setButtonText("EXPORT MIDI (.midi)");
        addAndMakeVisible(exportMidiBtn);

        // E. Middle Editor Tabs setup
        tabBar.addTab("GRID SEQUENCER", juce::Colours::lightgrey, 0);
        tabBar.addTab("NOTE CONTROL", juce::Colours::lightgrey, 1);
        tabBar.addTab("UNIVERSAL EFFECTS", juce::Colours::lightgrey, 2);
        tabBar.addChangeListener (this);
        addAndMakeVisible(tabBar);

        // Collapse
        collapseEditorBtn.setButtonText("COLLAPSE EDITOR");
        collapseEditorBtn.setClickingTogglesState(true);
        collapseEditorBtn.onClick = [this]() {
            editorCollapsed = collapseEditorBtn.getToggleState();
            updatePanelCollapseState();
        };
        addAndMakeVisible(collapseEditorBtn);

        collapseDrumsBtn.setButtonText("COLLAPSE DRUMS");
        collapseDrumsBtn.setClickingTogglesState(true);
        collapseDrumsBtn.onClick = [this]() {
            drumsCollapsed = collapseDrumsBtn.getToggleState();
            updatePanelCollapseState();
        };
        addAndMakeVisible(collapseDrumsBtn);

        // F. Grid Sequencer Panel Components
        instNames = { "KICK", "SNARE", "CH HAT", "OP HAT", "RIDE", "CLAP", "TOM", "BEEP", "BLIP", "BLOOP", "CRUNCH", "SAMPLE" };
        for (int c = 0; c < 12; ++c) {
            auto* lbl = new juce::Label();
            lbl->setText(instNames[c], juce::dontSendNotification);
            lbl->setFont(juce::FontOptions(10.0f, juce::Font::bold));
            lbl->setColour(juce::Label::textColourId, juce::Colour(0xff2b2927));
            lbl->addMouseListener(this, false); // Listen to clicks on track label
            trackLabels.add(lbl);
            addAndMakeVisible(lbl);
        }

        for (int track = 0; track < 12; ++track) {
            for (int step = 0; step < 64; ++step) {
                auto* cell = new SequencerCellButton(track, step, processor);
                cell->setButtonText("");
                cell->onClick = [this, track, step, cell]() {
                    processor.patternGrid[track][step] = cell->getToggleState();
                    if (cell->getToggleState()) {
                        processor.rollGrid[track][step] = rollSelectCombo.getSelectedItemIndex() + 1;
                    }
                    processor.selectedCard = track;
                    pianoRoll.updateSelection();
                    repaint();
                    for (auto* card : drumCards) {
                        card->repaint();
                    }
                    cell->repaint();
                };
                stepGridCells.add(cell);
                addAndMakeVisible(cell);
            }
        }

        rollSelectCombo.addItem("1 Hit (Normal)", 1);
        rollSelectCombo.addItem("2 Hits (Stutter)", 2);
        rollSelectCombo.addItem("3 Hits (Roll)", 3);
        rollSelectCombo.addItem("4 Hits (Fast)", 4);
        rollSelectCombo.setSelectedItemIndex(0, juce::dontSendNotification);
        addAndMakeVisible(rollSelectCombo);

        rollSelectLabel.setText("STEP STUTTER:", juce::dontSendNotification);
        rollSelectLabel.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        rollSelectLabel.setColour(juce::Label::textColourId, juce::Colour(0xff6e6d6c));
        addAndMakeVisible(rollSelectLabel);

        addAndMakeVisible(velocityGrid);
        
        velocityLabel.setText("STEP VELOCITIES (FOCUS TRK)", juce::dontSendNotification);
        velocityLabel.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        velocityLabel.setColour(juce::Label::textColourId, juce::Colour(0xff6e6d6c));
        addAndMakeVisible(velocityLabel);

        motionRecordBtn.setButtonText("RECORD MOTION");
        motionRecordBtn.setClickingTogglesState(true);
        motionRecordBtn.onClick = [this]() {
            processor.recordMotion = motionRecordBtn.getToggleState();
        };
        addAndMakeVisible(motionRecordBtn);

        // G. Piano Roll Editor
        addAndMakeVisible(pianoRoll);

        // H. Universal Effects chain
        addAndMakeVisible(effectsPanel);

        // I. Bottom Drums Control cards setup (All 12 visible simultaneously)
        for (int c = 0; c < 12; ++c) {
            auto* card = new DrumCardComponent(c, processor);
            drumCards.add(card);
            addAndMakeVisible(card);
        }

        processor.loadPreset(0);
        updateSequencerGridUI();
        updateAllDrumCardSliders();
        effectsPanel.updateControlsFromProcessor();

        activeTabChanged();
    }

    ~MainContentComponent() override {
        latchCheck.setLookAndFeel(nullptr);
        tabBar.removeChangeListener(this);
    }

    void paint(juce::Graphics& g) override {
        // Futuristic modern logo styling
        g.setFont(juce::FontOptions("sans-serif", 18.0f, juce::Font::bold));
        
        // strong orange for PHYZIX
        g.setColour(juce::Colour(0xffff6b00));
        g.drawText("PHYZIX", 20, 5, 80, 30, juce::Justification::left);
        
        // contrasting blue for : SLAMS & BAMS
        g.setColour(juce::Colour(0xff0984e3));
        g.drawText(": SLAMS & BAMS", 85, 5, 200, 30, juce::Justification::left);
    }

    void refreshUserPresetsList() {
        userPresetCombo.clear();
        userPresetCombo.addItem("Load User Pres...", 1);
        
        juce::File presetDir = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                                 .getChildFile("PhyzixSnB")
                                 .getChildFile("UserPresets");
        if (presetDir.exists()) {
            juce::Array<juce::File> files;
            presetDir.findChildFiles(files, juce::File::findFiles, false, "*.json");
            int id = 2;
            for (auto& file : files) {
                userPresetCombo.addItem(file.getFileNameWithoutExtension(), id++);
            }
        }
        userPresetCombo.setSelectedItemIndex(0, juce::dontSendNotification);
    }

    void updatePlayButtonText() {
        playButton.setButtonText(processor.isPlaying.load() ? "STOP" : "PLAY");
        playButton.setColour(juce::TextButton::buttonColourId, processor.isPlaying.load() ? juce::Colour(0xffd35400) : juce::Colour(0xff2b2927));
    }

    void updateSequencerGridUI() {
        for (int track = 0; track < 12; ++track) {
            for (int step = 0; step < 64; ++step) {
                auto* cell = stepGridCells[track * 64 + step];
                cell->setToggleState(processor.patternGrid[track][step], juce::dontSendNotification);
                cell->repaint();
            }
        }
        velocityGrid.repaint();
    }

    void updateAllDrumCardSliders() {
        for (int c = 0; c < 12; ++c) {
            drumCards[c]->updateSlidersFromProcessor();
        }
    }

    void updateNoteControlSelection() {
        pianoRoll.updateSelection();
    }

    void mouseDown(const juce::MouseEvent& event) override {
        for (int c = 0; c < 12; ++c) {
            if (event.originalComponent == trackLabels[c]) {
                processor.selectedCard = c;
                if (!processor.isPlaying.load()) {
                    processor.triggerVoice(c, 0.8f);
                }
                pianoRoll.updateSelection();
                repaint();
                for (auto* card : drumCards) {
                    card->repaint();
                }
                break;
            }
        }
    }

    void flashDrumCard(int channel) {
        if (channel >= 0 && channel < 12) {
            drumCards[channel]->flash();
        }
    }

    void changeListenerCallback (juce::ChangeBroadcaster* source) override {
        if (source == &tabBar) {
            activeTabChanged();
        }
    }

    void updatePanelCollapseState() {
        int tabIdx = tabBar.getCurrentTabIndex();
        bool editorVisible = !editorCollapsed;
        bool drumsVisible = !drumsCollapsed;
        
        tabBar.setVisible(editorVisible);
        
        int currentSteps = processor.stepsCount.load();
        for (int track = 0; track < 12; ++track) {
            trackLabels[track]->setVisible(editorVisible && tabIdx == 0);
            for (int step = 0; step < 64; ++step) {
                stepGridCells[track * 64 + step]->setVisible(editorVisible && tabIdx == 0 && step < currentSteps);
            }
        }
        rollSelectLabel.setVisible(editorVisible && tabIdx == 0);
        rollSelectCombo.setVisible(editorVisible && tabIdx == 0);
        velocityGrid.setVisible(editorVisible && tabIdx == 0);
        velocityLabel.setVisible(editorVisible && tabIdx == 0);
        motionRecordBtn.setVisible(editorVisible && tabIdx == 0);
        pianoRoll.setVisible(editorVisible && tabIdx == 1);
        effectsPanel.setVisible(editorVisible && tabIdx == 2);
        
        for (int c = 0; c < 12; ++c) {
            drumCards[c]->setVisible(drumsVisible);
        }
        
        if (auto* editor = getParentComponent()) {
            float targetHeight = getTargetHeight();
            editor->setSize(editor->getWidth(), (int)targetHeight);
        }
        
        resized();
    }

    void activeTabChanged() {
        if (editorCollapsed) {
            updatePanelCollapseState();
            return;
        }
        int tabIdx = tabBar.getCurrentTabIndex();
        int currentSteps = processor.stepsCount.load();
        
        for (int track = 0; track < 12; ++track) {
            trackLabels[track]->setVisible(tabIdx == 0);
            for (int step = 0; step < 64; ++step) {
                auto* cell = stepGridCells[track * 64 + step];
                cell->setVisible(tabIdx == 0 && step < currentSteps);
            }
        }
        rollSelectLabel.setVisible(tabIdx == 0);
        rollSelectCombo.setVisible(tabIdx == 0);
        velocityGrid.setVisible(tabIdx == 0);
        velocityLabel.setVisible(tabIdx == 0);
        motionRecordBtn.setVisible(tabIdx == 0);

        pianoRoll.setVisible(tabIdx == 1);
        effectsPanel.setVisible(tabIdx == 2);
        
        resized();
    }

    void resized() override {
        // Title Bar
        helpButton.setBounds(1170, 5, 80, 26);
        sessionRecordButton.setBounds(1050, 5, 110, 26);
        
        // Row 1 (Y=40)
        playButton.setBounds(20, 40, 70, 30);
        bpmSlider->setBounds(105, 30, 55, 50);
        swingSlider->setBounds(170, 30, 55, 50);
        masterVolSlider->setBounds(235, 30, 55, 50);
        timeSigCombo.setBounds(300, 40, 65, 30);
        stepsCombo.setBounds(375, 40, 95, 30);
        
        presetCombo.setBounds(485, 40, 170, 30);
        userPresetCombo.setBounds(665, 40, 160, 30);
        presetNameEditor.setBounds(835, 40, 120, 30);
        savePresetButton.setBounds(965, 40, 60, 30);
        
        slamButton.setBounds(1035, 40, 130, 30);
        latchCheck.setBounds(1175, 45, 85, 20);

        // Row 2 (Y=85)
        fillPanel.setBounds(20, 87, 200, 20);
        fillButton.setBounds(230, 85, 60, 28);
        fillPatternCombo.setBounds(300, 85, 150, 28);
        midiCCButton.setBounds(460, 85, 130, 28);
        
        collapseEditorBtn.setBounds(890, 85, 170, 28);
        collapseDrumsBtn.setBounds(1070, 85, 180, 28);

        // Oscilloscope (Y=125)
        oscilloscope.setBounds(20, 125, 1240, 50);

        // Randomizers, Clears, and TabBar (Y=185)
        randomizeTrackBtn.setBounds(20, 185, 120, 25);
        randomizePatternBtn.setBounds(145, 185, 135, 25);
        clearGridBtn.setBounds(285, 185, 95, 25);
        clearMotionBtn.setBounds(385, 185, 135, 25);
        exportMidiBtn.setBounds(525, 185, 140, 25);

        tabBar.setBounds(715, 180, 545, 30);

        // Tab Content
        int tabIdx = tabBar.getCurrentTabIndex();
        int currentSteps = processor.stepsCount.load();

        if (!editorCollapsed) {
            if (tabIdx == 0) { // Sequencer Grid
                int gridY = 235;
                int cellW = 1120 / currentSteps;
                int cellH = 16;
                
                for (int track = 0; track < 12; ++track) {
                    trackLabels[track]->setBounds(20, gridY + track * (cellH + 4), 90, cellH);
                    for (int step = 0; step < 64; ++step) {
                        auto* cell = stepGridCells[track * 64 + step];
                        if (step < currentSteps) {
                            cell->setBounds(120 + step * cellW, gridY + track * (cellH + 4), cellW - 2, cellH);
                        }
                    }
                }

                velocityLabel.setBounds(20, 480, 95, 20);
                velocityGrid.setBounds(120, 475, 1120, 30);
                
                rollSelectLabel.setBounds(120, 515, 100, 20);
                rollSelectCombo.setBounds(220, 510, 130, 25);
                motionRecordBtn.setBounds(365, 510, 150, 25);
            } else if (tabIdx == 1) { // Piano Roll
                pianoRoll.setBounds(20, 235, 1240, 300);
            } else if (tabIdx == 2) { // Modular FX
                effectsPanel.setBounds(20, 235, 1240, 300);
            }
        }

        // Drums Control Cards
        if (!drumsCollapsed) {
            int cardW = 195;
            int cardH = 160;
            int hGap = 14;
            int vGap = 12;
            int startY = editorCollapsed ? 220 : 575;

            for (int c = 0; c < 12; ++c) {
                int row = c / 6;
                int col = c % 6;
                drumCards[c]->setBounds(20 + col * (cardW + hGap), startY + row * (cardH + vGap), cardW, cardH);
            }
        }

        manualOverlay.setBounds(getLocalBounds());
    }

public:
    float getTargetHeight() const {
        float height = 930.0f;
        if (editorCollapsed) height -= 315.0f;
        if (drumsCollapsed) height -= 350.0f;
        return height;
    }
    
    bool isEditorCollapsed() const { return editorCollapsed; }
    bool isDrumsCollapsed() const { return drumsCollapsed; }

    void toggleSessionRecording() {
        if (!processor.sessionRecording.load()) {
            processor.sessionBufferL.clear();
            processor.sessionBufferR.clear();
            processor.sessionBufferL.reserve(15000000); // 5.2 mins @ 48kHz
            processor.sessionBufferR.reserve(15000000);
            
            processor.sessionRecording.store(true);
            sessionRecordButton.setButtonText("STOP REC");
            sessionRecordButton.setColour(juce::TextButton::buttonColourId, juce::Colour(0xffe74c3c)); // Red
        } else {
            processor.sessionRecording.store(false);
            sessionRecordButton.setButtonText("REC SESSION");
            sessionRecordButton.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff2c3e50)); // Dark blue-grey
            
            saveSessionToFile();
        }
    }

    void saveSessionToFile() {
        if (processor.sessionBufferL.empty()) {
            juce::AlertWindow::showMessageBoxAsync(juce::AlertWindow::WarningIcon, "Record Session", 
                "No audio recorded. Play some patterns to record!");
            return;
        }
        
        fileChooser = std::make_unique<juce::FileChooser>("Save Session WAV",
            juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("phyzix-session.wav"),
            "*.wav");
            
        fileChooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles,
            [this](const juce::FileChooser& fc) {
                auto file = fc.getResult();
                if (file != juce::File{}) {
                    processor.exportSessionWav(file);
                }
            });
    }

private:
    PhyzixAudioProcessor& processor;

    // juce::Label logoLabel;
    juce::TextButton helpButton;
    juce::TextButton sessionRecordButton;
    std::unique_ptr<juce::FileChooser> fileChooser;
    std::unique_ptr<CustomKnob> masterVolSlider;
    UserManualOverlay manualOverlay;

    juce::TextButton playButton;
    juce::ComboBox presetCombo;
    
    // User Presets
    juce::TextEditor presetNameEditor;
    juce::TextButton savePresetButton;
    juce::ComboBox userPresetCombo;
    
    juce::ComboBox timeSigCombo;
    juce::ComboBox stepsCombo;
    
    std::unique_ptr<CustomKnob> bpmSlider;
    std::unique_ptr<CustomKnob> swingSlider;
    
    juce::TextButton slamButton;
    juce::ToggleButton latchCheck;

    juce::Label fillPanel;
    juce::TextButton fillButton;
    juce::ComboBox fillPatternCombo;
    juce::TextButton midiCCButton;

    OscilloscopeComponent oscilloscope;

    juce::TextButton randomizeTrackBtn;
    juce::TextButton randomizePatternBtn;
    juce::TextButton clearGridBtn;
    juce::TextButton clearMotionBtn;
    juce::TextButton exportMidiBtn;

    juce::TabbedButtonBar tabBar{juce::TabbedButtonBar::TabsAtTop};

    // Collapse
    juce::TextButton collapseEditorBtn;
    juce::TextButton collapseDrumsBtn;
    bool editorCollapsed = false;
    bool drumsCollapsed = false;

    // Sequencer
    std::vector<juce::String> instNames;
    juce::OwnedArray<juce::Label> trackLabels;
    juce::OwnedArray<SequencerCellButton> stepGridCells;

    juce::Label rollSelectLabel;
    juce::ComboBox rollSelectCombo;
    juce::TextButton motionRecordBtn;
    
    juce::Label velocityLabel;
    VelocityEditorComponent velocityGrid;

    // Note Control
    NoteControlComponent pianoRoll;

    // Universal FX
    UniversalEffectsComponent effectsPanel;

    // Bottom cards
    juce::OwnedArray<DrumCardComponent> drumCards;

    GlassmorphicLookAndFeel lnf;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainContentComponent)
};

// =============================================================================
// 11. JUCE EDITOR USER INTERFACE (THE WINDOW SCALER)
// =============================================================================

class PhyzixEditor : public juce::AudioProcessorEditor,
                     public juce::Timer {
public:
    PhyzixEditor(PhyzixAudioProcessor& p)
        : AudioProcessorEditor(&p),
          processor(p),
          mainContent(p)
    {
        addAndMakeVisible(mainContent);

        setResizable(true, true);
        setResizeLimits(1280, 180, 3840, 2160);

        setSize(1280, 900);
        startTimerHz(30); 
    }

    ~PhyzixEditor() override {
        stopTimer();
    }

    void timerCallback() override {
        // Check for visual trigger flashes
        for (int c = 0; c < 12; ++c) {
            if (processor.padTrigger[c].exchange(false)) {
                mainContent.flashDrumCard(c);
            }
        }
        
        // Sync note control selection from selectedCard
        mainContent.updateNoteControlSelection();
        
        // Handle transport dot sweeps during playback
        if (processor.isPlaying.load()) {
            mainContent.updatePlayButtonText();
            mainContent.updateSequencerGridUI();
            repaint();
        }
    }

    void paint(juce::Graphics& g) override {
        g.fillAll(juce::Colour(0xfff7f6f0));
        
        // Very light diagonal stripes texture
        g.setColour(juce::Colour(0x04000000));
        for (int i = 0; i < getWidth() + getHeight(); i += 12) {
            g.drawLine((float)i, 0.0f, 0.0f, (float)i, 0.6f);
        }
        
        // Draw transport dot playhead on active sequencer grid cell
        if (processor.isPlaying.load() && mainContent.isShowing() && !mainContent.isEditorCollapsed()) {
            // Find active cell step coordinate
            int step = processor.currentStep.load();
            int steps = processor.stepsCount.load();
            float cellW = 1120.0f / (float)steps;
            
            float dotSize = 12.0f;
            float startX = 120.0f + (float)step * cellW + cellW * 0.5f - dotSize * 0.5f;
            
            // Map playhead coordinates relative to centered bounds
            float targetHeight = mainContent.getTargetHeight();
            int x = std::max(0, (getWidth() - 1280) / 2);
            int y = std::max(0, (int)(getHeight() - targetHeight) / 2);
            
            float dotX = (float)x + startX;
            float dotY = (float)y + 218.0f; // centered in the new 25px gap (Y=210 to Y=235)
            
            // Draw drop shadow for visibility
            g.setColour(juce::Colour(0x40000000));
            g.fillEllipse(dotX + 1.0f, dotY + 1.0f, dotSize, dotSize);
            
            g.setColour(juce::Colour(0xffe67e22)); // bright orange
            g.fillEllipse(dotX, dotY, dotSize, dotSize);
            
            g.setColour(juce::Colours::white.withAlpha(0.6f));
            g.drawEllipse(dotX, dotY, dotSize, dotSize, 1.5f); // white outline
        }
    }

    void resized() override {
        float targetHeight = mainContent.getTargetHeight();
        int x = std::max(0, (getWidth() - 1280) / 2);
        int y = std::max(0, (int)(getHeight() - targetHeight) / 2);
        
        mainContent.setBounds(x, y, 1280, (int)targetHeight);
    }

private:
    PhyzixAudioProcessor& processor;
    MainContentComponent mainContent;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PhyzixEditor)
};

juce::AudioProcessorEditor* PhyzixAudioProcessor::createEditor() {
    return new PhyzixEditor(*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new PhyzixAudioProcessor();
}
