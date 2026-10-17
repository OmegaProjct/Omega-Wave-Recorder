#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

// Target Windows 10 FE (build 20348) or later so audioclientactivationparams.h definitions are enabled
#ifdef NTDDI_VERSION
#undef NTDDI_VERSION
#endif
#define NTDDI_VERSION 0x0A00000A // NTDDI_WIN10_FE

#ifdef _WIN32_WINNT
#undef _WIN32_WINNT
#endif
#define _WIN32_WINNT 0x0A00

#pragma warning(push)
#pragma warning(disable: 4100 4201)
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <ksmedia.h>
#include <avrt.h>
#pragma warning(pop)

#include <io.h>
#include <fcntl.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cassert>
#include <string>
#include <vector>
#include <atomic>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "avrt.lib")

namespace {

// Constants
constexpr uint32_t SAMPLE_RATE = 48000;
constexpr uint16_t NUM_CHANNELS = 2;
constexpr uint32_t MAX_FRAMES_PER_PACKET = 48000;
constexpr DWORD MIN_REQUIRED_WINDOWS_BUILD = 20348;

// Global stop event and running flag
HANDLE g_hStopEvent = nullptr;
std::atomic<bool> g_bStopRequested(false);

// Query true Windows build number from ntdll (bypasses app-compat manifest shims)
typedef LONG(NTAPI* RtlGetVersionFn)(PRTL_OSVERSIONINFOW);

DWORD GetWindowsBuildNumber() {
    HMODULE hNtdll = GetModuleHandleW(L"ntdll.dll");
    if (hNtdll) {
        RtlGetVersionFn pRtlGetVersion = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(hNtdll, "RtlGetVersion"));
        if (pRtlGetVersion) {
            RTL_OSVERSIONINFOW rovi = { sizeof(rovi), 0, 0, 0, 0, { 0 } };
            if (pRtlGetVersion(&rovi) == 0) {
                return rovi.dwBuildNumber;
            }
        }
    }
    return 0;
}

// Check if a process ID is currently running
bool IsProcessAlive(DWORD pid, HANDLE* outProcessHandle = nullptr) {
    if (pid == 0) return false;
    HANDLE hProcess = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!hProcess) {
        DWORD err = GetLastError();
        // If access denied, the process exists and is active
        if (err == ERROR_ACCESS_DENIED) {
            if (outProcessHandle) *outProcessHandle = nullptr;
            return true;
        }
        if (outProcessHandle) *outProcessHandle = nullptr;
        return false;
    }
    DWORD waitRes = WaitForSingleObject(hProcess, 0);
    if (waitRes == WAIT_OBJECT_0) {
        // Already terminated
        CloseHandle(hProcess);
        if (outProcessHandle) *outProcessHandle = nullptr;
        return false;
    }
    if (outProcessHandle) {
        *outProcessHandle = hProcess;
    } else {
        CloseHandle(hProcess);
    }
    return true;
}

// Strict argument parsing helpers
bool ParsePositivePid(const char* str, DWORD* outPid) {
    if (!str || *str < '0' || *str > '9') return false;
    char* endPtr = nullptr;
    errno = 0;
    unsigned long long val = strtoull(str, &endPtr, 10);
    if (errno != 0 || *endPtr != '\0' || val == 0 || val > 0xFFFFFFFFULL) {
        return false;
    }
    if (outPid) *outPid = static_cast<DWORD>(val);
    return true;
}

bool ParseNonZeroHwnd(const char* str, HWND* outHwnd, unsigned long long* outRaw = nullptr) {
    if (!str || *str < '0' || *str > '9') return false;
    char* endPtr = nullptr;
    errno = 0;
    unsigned long long val = strtoull(str, &endPtr, 10);
    if (errno != 0 || *endPtr != '\0' || val == 0) {
        return false;
    }
    if (outRaw) *outRaw = val;
    if (outHwnd) *outHwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(val));
    return true;
}

// Binary packet writer:
// Protocol: little-endian uint32 frameCount, followed by frameCount * 2 float32 samples.
// Packets are bounded to MAX_FRAMES_PER_PACKET (48000 frames).
bool WriteFramedPacketChunks(FILE* outStream, const float* samples, uint32_t totalFrames, bool isSilent) {
    static const std::vector<float> silenceBuffer(MAX_FRAMES_PER_PACKET * NUM_CHANNELS, 0.0f);

    uint32_t remaining = totalFrames;
    const float* src = samples;

    while (remaining > 0) {
        uint32_t chunkFrames = (remaining > MAX_FRAMES_PER_PACKET) ? MAX_FRAMES_PER_PACKET : remaining;

        // Little-endian uint32 frameCount header
        uint8_t header[4];
        header[0] = static_cast<uint8_t>(chunkFrames & 0xFF);
        header[1] = static_cast<uint8_t>((chunkFrames >> 8) & 0xFF);
        header[2] = static_cast<uint8_t>((chunkFrames >> 16) & 0xFF);
        header[3] = static_cast<uint8_t>((chunkFrames >> 24) & 0xFF);

        if (fwrite(header, 1, sizeof(header), outStream) != sizeof(header)) {
            return false;
        }

        size_t samplesInChunk = static_cast<size_t>(chunkFrames) * NUM_CHANNELS;
        const float* chunkData = isSilent ? silenceBuffer.data() : src;

        if (fwrite(chunkData, sizeof(float), samplesInChunk, outStream) != samplesInChunk) {
            return false;
        }

        if (!isSilent && src) {
            src += samplesInChunk;
        }
        remaining -= chunkFrames;
    }

    if (fflush(outStream) != 0) {
        return false;
    }
    return true;
}

// Exercise the production writer without opening an audio device.
bool WriteFramedPacketToVector(std::vector<uint8_t>& dest, const float* samples, uint32_t totalFrames, bool isSilent) {
    FILE* file = nullptr;
    if (tmpfile_s(&file) != 0 || !file) return false;
    bool ok = WriteFramedPacketChunks(file, samples, totalFrames, isSilent);
    long size = ftell(file);
    if (ok && size >= 0 && fseek(file, 0, SEEK_SET) == 0) {
        dest.resize(static_cast<size_t>(size));
        ok = fread(dest.data(), 1, dest.size(), file) == dest.size();
    } else {
        ok = false;
    }
    fclose(file);
    return ok;
}

// Stdin monitor background thread
DWORD WINAPI StdinMonitorThreadProc(LPVOID lpParam) {
    (void)lpParam;
    HANDLE hStdin = GetStdHandle(STD_INPUT_HANDLE);
    if (hStdin == INVALID_HANDLE_VALUE || hStdin == NULL) {
        return 0;
    }

    char buffer[128];
    std::string line;
    DWORD bytesRead = 0;

    while (!g_bStopRequested.load()) {
        if (!ReadFile(hStdin, buffer, sizeof(buffer), &bytesRead, nullptr) || bytesRead == 0) {
            // Stdin EOF or pipe disconnected
            g_bStopRequested.store(true);
            if (g_hStopEvent) SetEvent(g_hStopEvent);
            break;
        }

        for (DWORD i = 0; i < bytesRead; ++i) {
            char c = buffer[i];
            if (c == '\n' || c == '\r') {
                if (!line.empty()) {
                    // Check if line equals "stop" (case-insensitive)
                    size_t start = line.find_first_not_of(" \t");
                    size_t end = line.find_last_not_of(" \t");
                    if (start != std::string::npos && end != std::string::npos) {
                        std::string trimmed = line.substr(start, end - start + 1);
                        if (_stricmp(trimmed.c_str(), "stop") == 0) {
                            g_bStopRequested.store(true);
                            if (g_hStopEvent) SetEvent(g_hStopEvent);
                            return 0;
                        }
                    }
                    line.clear();
                }
            } else {
                line.push_back(c);
            }
        }
    }
    return 0;
}

// Console control handler for graceful kill / Ctrl+C
BOOL WINAPI ConsoleCtrlHandler(DWORD dwCtrlType) {
    switch (dwCtrlType) {
    case CTRL_C_EVENT:
    case CTRL_BREAK_EVENT:
    case CTRL_CLOSE_EVENT:
    case CTRL_LOGOFF_EVENT:
    case CTRL_SHUTDOWN_EVENT:
        g_bStopRequested.store(true);
        if (g_hStopEvent) SetEvent(g_hStopEvent);
        return TRUE;
    default:
        return FALSE;
    }
}

// COM Completion Handler for ActivateAudioInterfaceAsync
class AudioInterfaceCompletionHandler : public IActivateAudioInterfaceCompletionHandler {
public:
    AudioInterfaceCompletionHandler(HANDLE hCompletedEvent)
        : m_refCount(1),
          m_hCompletedEvent(hCompletedEvent),
          m_activateResult(E_FAIL),
          m_audioClient(nullptr)
    {
    }

    virtual ~AudioInterfaceCompletionHandler() {
        CloseHandle(m_hCompletedEvent);
        if (m_audioClient) {
            m_audioClient->Release();
            m_audioClient = nullptr;
        }
    }

    // IUnknown methods
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == __uuidof(IUnknown) ||
            riid == __uuidof(IActivateAudioInterfaceCompletionHandler) ||
            riid == __uuidof(IAgileObject)) {
            *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }

    STDMETHODIMP_(ULONG) AddRef() override {
        return InterlockedIncrement(&m_refCount);
    }

    STDMETHODIMP_(ULONG) Release() override {
        ULONG count = InterlockedDecrement(&m_refCount);
        if (count == 0) {
            delete this;
        }
        return count;
    }

    // IActivateAudioInterfaceCompletionHandler method
    STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* activateOperation) override {
        if (!activateOperation) {
            m_activateResult = E_POINTER;
            if (m_hCompletedEvent) SetEvent(m_hCompletedEvent);
            return S_OK;
        }

        HRESULT hrActivateResult = E_FAIL;
        IUnknown* pUnknown = nullptr;
        HRESULT hr = activateOperation->GetActivateResult(&hrActivateResult, &pUnknown);
        if (SUCCEEDED(hr) && SUCCEEDED(hrActivateResult) && pUnknown) {
            hr = pUnknown->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(&m_audioClient));
            pUnknown->Release();
            m_activateResult = hr;
        } else {
            m_activateResult = FAILED(hr) ? hr : hrActivateResult;
        }

        if (m_hCompletedEvent) {
            SetEvent(m_hCompletedEvent);
        }
        return S_OK;
    }

    HRESULT GetActivateResult() const { return m_activateResult; }

    IAudioClient* DetachAudioClient() {
        IAudioClient* client = m_audioClient;
        m_audioClient = nullptr;
        return client;
    }

private:
    LONG m_refCount;
    HANDLE m_hCompletedEvent;
    HRESULT m_activateResult;
    IAudioClient* m_audioClient;
};

} // anonymous namespace

// Implementation of CLI --self-test
int RunSelfTest() {
    fprintf(stderr, "[SELF-TEST] Starting deterministic self-tests...\n");

    // 1. Check PID argument parsing
    {
        DWORD pid = 0;
        assert(ParsePositivePid("1", &pid) && pid == 1);
        assert(ParsePositivePid("12345", &pid) && pid == 12345);
        assert(ParsePositivePid("4294967295", &pid) && pid == 0xFFFFFFFF);
        assert(!ParsePositivePid("0", &pid));
        assert(!ParsePositivePid("-1", &pid));
        assert(!ParsePositivePid("-100", &pid));
        assert(!ParsePositivePid("abc", &pid));
        assert(!ParsePositivePid(" 1", &pid));
        assert(!ParsePositivePid("+1", &pid));
        assert(!ParsePositivePid("123a", &pid));
        assert(!ParsePositivePid("4294967296", &pid)); // overflow
        assert(!ParsePositivePid("", &pid));
        assert(!ParsePositivePid(nullptr, &pid));
        fprintf(stderr, "[SELF-TEST] [PASS] PID argument parsing.\n");
    }

    // 2. Check HWND argument parsing & validation
    {
        HWND hwnd = nullptr;
        unsigned long long raw = 0;
        assert(ParseNonZeroHwnd("65536", &hwnd, &raw) && raw == 65536 && hwnd == reinterpret_cast<HWND>(static_cast<uintptr_t>(65536ULL)));
        assert(ParseNonZeroHwnd("1", &hwnd, &raw) && raw == 1);
        assert(!ParseNonZeroHwnd("0", &hwnd, &raw));
        assert(!ParseNonZeroHwnd("-1", &hwnd, &raw));
        assert(!ParseNonZeroHwnd("abc", &hwnd, &raw));
        assert(!ParseNonZeroHwnd(" 1", &hwnd, &raw));
        assert(!ParseNonZeroHwnd("+1", &hwnd, &raw));
        assert(!ParseNonZeroHwnd("", &hwnd, &raw));
        assert(!ParseNonZeroHwnd(nullptr, &hwnd, &raw));

        // HWND 0 must fail IsWindow
        assert(IsWindow(nullptr) == FALSE);
        assert(IsWindow(reinterpret_cast<HWND>(static_cast<uintptr_t>(0xDEADBEEFULL))) == FALSE);
        fprintf(stderr, "[SELF-TEST] [PASS] HWND argument parsing and nonzero validation.\n");
    }

    // 3. Check binary framing with known float values
    {
        std::vector<uint8_t> out;
        std::vector<float> samples(200); // 100 frames, 2 channels
        for (size_t i = 0; i < samples.size(); ++i) {
            samples[i] = static_cast<float>(i) * 0.01f;
        }

        bool ok = WriteFramedPacketToVector(out, samples.data(), 100, false);
        assert(ok);
        // Header (4 bytes) + 100 * 2 * 4 bytes = 4 + 800 = 804 bytes
        assert(out.size() == 804);

        // Verify little-endian frameCount header
        uint32_t frameCountHeader = static_cast<uint32_t>(out[0]) |
                                    (static_cast<uint32_t>(out[1]) << 8) |
                                    (static_cast<uint32_t>(out[2]) << 16) |
                                    (static_cast<uint32_t>(out[3]) << 24);
        assert(frameCountHeader == 100);

        // Verify payload floats
        const float* outFloats = reinterpret_cast<const float*>(out.data() + 4);
        for (size_t i = 0; i < samples.size(); ++i) {
            assert(outFloats[i] == samples[i]);
        }
        fprintf(stderr, "[SELF-TEST] [PASS] Binary packet framing & little-endian header encoding.\n");
    }

    // 4. Check silent buffer framing
    {
        std::vector<uint8_t> out;
        bool ok = WriteFramedPacketToVector(out, nullptr, 50, true);
        assert(ok);
        // Header (4 bytes) + 50 * 2 * 4 bytes = 4 + 400 = 404 bytes
        assert(out.size() == 404);

        uint32_t frameCountHeader = static_cast<uint32_t>(out[0]) |
                                    (static_cast<uint32_t>(out[1]) << 8) |
                                    (static_cast<uint32_t>(out[2]) << 16) |
                                    (static_cast<uint32_t>(out[3]) << 24);
        assert(frameCountHeader == 50);

        const float* outFloats = reinterpret_cast<const float*>(out.data() + 4);
        for (size_t i = 0; i < 100; ++i) {
            assert(outFloats[i] == 0.0f);
        }
        fprintf(stderr, "[SELF-TEST] [PASS] Silent buffer zero-fill generation.\n");
    }

    // 5. Check packet bounding (packets > 48000 frames chunked to <= 48000)
    {
        std::vector<uint8_t> out;
        uint32_t largeFrameCount = 50000;
        bool ok = WriteFramedPacketToVector(out, nullptr, largeFrameCount, true);
        assert(ok);

        // Chunk 1: 48000 frames -> 4 + 48000 * 2 * 4 = 384004 bytes
        size_t chunk1Size = 4 + 48000 * 2 * sizeof(float);
        // Chunk 2: 2000 frames -> 4 + 2000 * 2 * 4 = 16004 bytes
        size_t chunk2Size = 4 + 2000 * 2 * sizeof(float);
        assert(out.size() == chunk1Size + chunk2Size);

        uint32_t header1 = static_cast<uint32_t>(out[0]) |
                           (static_cast<uint32_t>(out[1]) << 8) |
                           (static_cast<uint32_t>(out[2]) << 16) |
                           (static_cast<uint32_t>(out[3]) << 24);
        assert(header1 == 48000);

        const uint8_t* pChunk2 = out.data() + chunk1Size;
        uint32_t header2 = static_cast<uint32_t>(pChunk2[0]) |
                           (static_cast<uint32_t>(pChunk2[1]) << 8) |
                           (static_cast<uint32_t>(pChunk2[2]) << 16) |
                           (static_cast<uint32_t>(pChunk2[3]) << 24);
        assert(header2 == 2000);
        fprintf(stderr, "[SELF-TEST] [PASS] Packet bounding and chunking at 48000 frames.\n");
    }

    // 6. Check OS build detection
    {
        DWORD build = GetWindowsBuildNumber();
        assert(build > 0);
        fprintf(stderr, "[SELF-TEST] [PASS] Windows OS build detection (detected build: %lu).\n", build);
    }

    fprintf(stderr, "[SELF-TEST] ALL SELF-TESTS PASSED DETERMINISTICALLY.\n");
    return 0;
}

// Implementation of CLI --resolve-window <HWND>
int RunResolveWindow(const char* hwndArg) {
    if (!hwndArg || *hwndArg == '\0') {
        fprintf(stderr, "Error: Missing HWND argument for --resolve-window.\n");
        return 1;
    }

    HWND hwnd = nullptr;
    unsigned long long rawHwnd = 0;
    if (!ParseNonZeroHwnd(hwndArg, &hwnd, &rawHwnd)) {
        fprintf(stderr, "Error: Invalid HWND '%s'. Must be a non-zero decimal integer.\n", hwndArg);
        return 1;
    }

    if (!IsWindow(hwnd)) {
        fprintf(stderr, "Error: HWND %llu is not an existing window.\n", rawHwnd);
        return 1;
    }

    DWORD pid = 0;
    DWORD tid = GetWindowThreadProcessId(hwnd, &pid);
    if (tid == 0 || pid == 0) {
        fprintf(stderr, "Error: Failed to obtain owning PID for HWND %llu.\n", rawHwnd);
        return 1;
    }

    // Output only the decimal PID to stdout
    printf("%lu\n", pid);
    fflush(stdout);
    return 0;
}

// Implementation of CLI --pid <PID> audio capture
int RunCapture(DWORD pid) {
    // 1. Verify target process is alive and obtain synchronization handle
    HANDLE hTargetProcess = nullptr;
    if (!IsProcessAlive(pid, &hTargetProcess)) {
        fprintf(stderr, "Error: Target process PID %lu does not exist or has terminated.\n", pid);
        return 1;
    }

    // 2. Verify OS version
    DWORD buildNumber = GetWindowsBuildNumber();
    if (buildNumber < MIN_REQUIRED_WINDOWS_BUILD) {
        fprintf(stderr, "Error: Windows build %lu or higher required for WASAPI process loopback (current build is %lu).\n",
                MIN_REQUIRED_WINDOWS_BUILD, buildNumber);
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 2;
    }

    // 3. Switch stdout to binary mode for binary packet streaming
    if (_setmode(_fileno(stdout), _O_BINARY) == -1) {
        fprintf(stderr, "Error: Failed to set stdout to binary mode.\n");
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    // 4. Initialize COM MTA
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) {
        fprintf(stderr, "Error: CoInitializeEx failed with HRESULT 0x%08lX\n", hr);
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    // 5. Create completion handler and events
    HANDLE hCompletedEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!hCompletedEvent) {
        fprintf(stderr, "Error: Failed to create completion event.\n");
        CoUninitialize();
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    AudioInterfaceCompletionHandler* pCompletionHandler = new AudioInterfaceCompletionHandler(hCompletedEvent);
    // The callback owns the event until asynchronous activation has also released it.

    AUDIOCLIENT_ACTIVATION_PARAMS activationParams = {};
    activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    activationParams.ProcessLoopbackParams.TargetProcessId = pid;
    activationParams.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT propVariant = {};
    propVariant.vt = VT_BLOB;
    propVariant.blob.cbSize = sizeof(activationParams);
    propVariant.blob.pBlobData = reinterpret_cast<BYTE*>(&activationParams);

    IActivateAudioInterfaceAsyncOperation* pAsyncOp = nullptr;
    hr = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        __uuidof(IAudioClient),
        &propVariant,
        pCompletionHandler,
        &pAsyncOp
    );

    if (FAILED(hr)) {
        fprintf(stderr, "Error: ActivateAudioInterfaceAsync failed with HRESULT 0x%08lX\n", hr);
        pCompletionHandler->Release();
        CoUninitialize();
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    // Wait for activation to complete
    DWORD waitCompletion = WaitForSingleObject(hCompletedEvent, 5000);
    if (waitCompletion != WAIT_OBJECT_0) {
        fprintf(stderr, "Error: Timeout waiting for ActivateAudioInterfaceAsync completion.\n");
        if (pAsyncOp) pAsyncOp->Release();
        pCompletionHandler->Release();
        CoUninitialize();
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    HRESULT activateResult = pCompletionHandler->GetActivateResult();
    IAudioClient* pAudioClient = pCompletionHandler->DetachAudioClient();
    pCompletionHandler->Release();
    if (pAsyncOp) {
        pAsyncOp->Release();
        pAsyncOp = nullptr;
    }

    if (FAILED(activateResult) || !pAudioClient) {
        fprintf(stderr, "Error: Audio interface activation completed with error 0x%08lX\n", activateResult);
        CoUninitialize();
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    // 6. Set up desired 48000Hz stereo Float32 audio format
    WAVEFORMATEXTENSIBLE wfx = {};
    wfx.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
    wfx.Format.nChannels = NUM_CHANNELS;
    wfx.Format.nSamplesPerSec = SAMPLE_RATE;
    wfx.Format.wBitsPerSample = sizeof(float) * 8;
    wfx.Format.nBlockAlign = (wfx.Format.nChannels * wfx.Format.wBitsPerSample) / 8;
    wfx.Format.nAvgBytesPerSec = wfx.Format.nSamplesPerSec * wfx.Format.nBlockAlign;
    wfx.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
    wfx.Samples.wValidBitsPerSample = sizeof(float) * 8;
    wfx.dwChannelMask = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
    wfx.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;

    REFERENCE_TIME hnsBufferDuration = 1000000; // 100 ms buffer
    DWORD streamFlags = AUDCLNT_STREAMFLAGS_LOOPBACK |
                        AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                        AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                        AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;

    hr = pAudioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        streamFlags,
        hnsBufferDuration,
        0,
        reinterpret_cast<WAVEFORMATEX*>(&wfx),
        nullptr
    );

    if (FAILED(hr)) {
        // Fallback without SRC_DEFAULT_QUALITY
        streamFlags = AUDCLNT_STREAMFLAGS_LOOPBACK |
                      AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM;
        hr = pAudioClient->Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            streamFlags,
            hnsBufferDuration,
            0,
            reinterpret_cast<WAVEFORMATEX*>(&wfx),
            nullptr
        );
    }

    if (FAILED(hr)) {
        fprintf(stderr, "Error: IAudioClient::Initialize failed with HRESULT 0x%08lX\n", hr);
        pAudioClient->Release();
        CoUninitialize();
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    // 7. Set event handle for audio buffer notification
    HANDLE hAudioEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!hAudioEvent) {
        fprintf(stderr, "Error: Failed to create audio buffer event.\n");
        pAudioClient->Release();
        CoUninitialize();
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    hr = pAudioClient->SetEventHandle(hAudioEvent);
    if (FAILED(hr)) {
        fprintf(stderr, "Error: SetEventHandle failed with HRESULT 0x%08lX\n", hr);
        CloseHandle(hAudioEvent);
        pAudioClient->Release();
        CoUninitialize();
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    // 8. Obtain IAudioCaptureClient
    IAudioCaptureClient* pCaptureClient = nullptr;
    hr = pAudioClient->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&pCaptureClient));
    if (FAILED(hr) || !pCaptureClient) {
        fprintf(stderr, "Error: GetService(IAudioCaptureClient) failed with HRESULT 0x%08lX\n", hr);
        CloseHandle(hAudioEvent);
        pAudioClient->Release();
        CoUninitialize();
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    // 9. Start audio capture client
    hr = pAudioClient->Start();
    if (FAILED(hr)) {
        fprintf(stderr, "Error: IAudioClient::Start failed with HRESULT 0x%08lX\n", hr);
        pCaptureClient->Release();
        CloseHandle(hAudioEvent);
        pAudioClient->Release();
        CoUninitialize();
        if (hTargetProcess) CloseHandle(hTargetProcess);
        return 1;
    }

    // 10. Emit READY handshake strictly to stderr
    fprintf(stderr, "READY 48000 2\n");
    fflush(stderr);

    // 11. Set up stop event, console ctrl handler, and stdin monitor thread
    g_hStopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    SetConsoleCtrlHandler(ConsoleCtrlHandler, TRUE);

    HANDLE hStdinThread = CreateThread(nullptr, 0, StdinMonitorThreadProc, nullptr, 0, nullptr);

    // 12. Main capture loop
    HANDLE waitHandles[3];
    DWORD waitCount = 0;
    waitHandles[waitCount++] = g_hStopEvent;     // Index 0: Stop event
    waitHandles[waitCount++] = hAudioEvent;      // Index 1: Audio buffer ready
    DWORD targetProcIndex = 0;
    if (hTargetProcess) {
        targetProcIndex = waitCount;
        waitHandles[waitCount++] = hTargetProcess; // Index 2: Target process termination
    }

    bool loopRunning = true;
    int captureResult = 0;
    while (loopRunning && !g_bStopRequested.load()) {
        DWORD waitRes = WaitForMultipleObjects(waitCount, waitHandles, FALSE, 250);
        if (waitRes == WAIT_FAILED) {
            fprintf(stderr, "Error: Audio event wait failed: %lu\n", GetLastError());
            captureResult = 1;
            break;
        }

        if (waitRes == WAIT_OBJECT_0) {
            // Stop event signaled
            break;
        }

        if (hTargetProcess && waitRes == (WAIT_OBJECT_0 + targetProcIndex)) {
            // Target process exited
            fprintf(stderr, "Info: Target process PID %lu has terminated.\n", pid);
            break;
        }

        // Drain available audio buffers
        UINT32 nextPacketSize = 0;
        HRESULT hrPkt = pCaptureClient->GetNextPacketSize(&nextPacketSize);
        while (SUCCEEDED(hrPkt) && nextPacketSize > 0) {
            BYTE* pData = nullptr;
            UINT32 numFramesRead = 0;
            DWORD dwFlags = 0;
            UINT64 u64DevicePosition = 0;
            UINT64 u64QPCPosition = 0;

            HRESULT hrBuf = pCaptureClient->GetBuffer(
                &pData,
                &numFramesRead,
                &dwFlags,
                &u64DevicePosition,
                &u64QPCPosition
            );

            if (hrBuf == AUDCLNT_S_BUFFER_EMPTY) {
                break;
            }
            if (FAILED(hrBuf)) {
                fprintf(stderr, "Error: GetBuffer failed: 0x%08lX\n", hrBuf);
                captureResult = 1;
                loopRunning = false;
                break;
            }

            if (dwFlags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) {
                fprintf(stderr, "Diagnostic: Discontinuity detected at device pos %llu\n",
                        static_cast<unsigned long long>(u64DevicePosition));
            }

            bool isSilent = (dwFlags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
            const float* samples = reinterpret_cast<const float*>(pData);

            if (numFramesRead > 0) {
                if (!WriteFramedPacketChunks(stdout, samples, numFramesRead, isSilent)) {
                    // Stdout closed or broken pipe
                    fprintf(stderr, "Info: Stdout pipe closed by consumer.\n");
                    loopRunning = false;
                    pCaptureClient->ReleaseBuffer(numFramesRead);
                    break;
                }
            }

            pCaptureClient->ReleaseBuffer(numFramesRead);
            hrPkt = pCaptureClient->GetNextPacketSize(&nextPacketSize);
        }
        if (FAILED(hrPkt)) {
            fprintf(stderr, "Error: GetNextPacketSize failed: 0x%08lX\n", hrPkt);
            captureResult = 1;
            break;
        }

        // Periodic liveness check if target process handle was not available
        if (!hTargetProcess && !IsProcessAlive(pid)) {
            fprintf(stderr, "Info: Target process PID %lu is no longer running.\n", pid);
            break;
        }
    }

    // 13. Graceful shutdown and resource cleanup
    g_bStopRequested.store(true);
    if (g_hStopEvent) SetEvent(g_hStopEvent);

    pAudioClient->Stop();
    pCaptureClient->Release();
    pAudioClient->Release();

    CloseHandle(hAudioEvent);
    if (hTargetProcess) {
        CloseHandle(hTargetProcess);
        hTargetProcess = nullptr;
    }

    if (hStdinThread) {
        CancelSynchronousIo(hStdinThread);
        WaitForSingleObject(hStdinThread, 200);
        CloseHandle(hStdinThread);
    }

    if (g_hStopEvent) {
        CloseHandle(g_hStopEvent);
        g_hStopEvent = nullptr;
    }

    CoUninitialize();
    return captureResult;
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage:\n");
        fprintf(stderr, "  process-loopback.exe --self-test\n");
        fprintf(stderr, "  process-loopback.exe --resolve-window <HWND>\n");
        fprintf(stderr, "  process-loopback.exe --pid <PID>\n");
        return 1;
    }

    const char* mode = argv[1];

    if (strcmp(mode, "--self-test") == 0) {
        if (argc != 2) return 1;
        return RunSelfTest();
    }

    if (strcmp(mode, "--resolve-window") == 0) {
        if (argc != 3) {
            fprintf(stderr, "Error: Missing HWND argument for --resolve-window.\n");
            return 1;
        }
        return RunResolveWindow(argv[2]);
    }

    if (strcmp(mode, "--pid") == 0) {
        if (argc != 3) {
            fprintf(stderr, "Error: Missing PID argument for --pid.\n");
            return 1;
        }
        DWORD pid = 0;
        if (!ParsePositivePid(argv[2], &pid)) {
            fprintf(stderr, "Error: Invalid PID '%s'. Must be a positive integer.\n", argv[2]);
            return 1;
        }
        return RunCapture(pid);
    }

    fprintf(stderr, "Error: Unknown argument '%s'.\n", mode);
    return 1;
}
