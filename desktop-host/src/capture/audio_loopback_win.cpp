// WASAPI loopback -> AudioChunk. The Windows counterpart of the audio output
// added to the ScreenCaptureKit stream in screen_capturer_mac.mm.

#include "audio_loopback_win.h"

#include <windows.h>

#include <audioclient.h>
#include <mmdeviceapi.h>
#include <objbase.h>
#include <wrl/client.h>

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace desktophost::win {
namespace {

using Microsoft::WRL::ComPtr;

constexpr int kSampleRate = 48'000;
constexpr int kChannels = 2;
/// 100 ns units. 50 ms of buffer against a 10 ms poll: generous enough that
/// a scheduling hiccup drops nothing, short enough to add no latency — the
/// poll takes whatever is there, it never waits for the buffer to fill.
constexpr REFERENCE_TIME kBufferDuration = 50 * 10'000;
constexpr auto kPollInterval = std::chrono::milliseconds(10);
constexpr auto kReopenDelay = std::chrono::milliseconds(500);

/// KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, spelled out so this file needs neither
/// ksmedia.h nor a GUID library to link against.
constexpr GUID kIeeeFloatSubtype = {
    0x00000003, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};
/// SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT.
constexpr DWORD kStereoMask = 0x1 | 0x2;

std::string hresultText(const char* what, HRESULT hr) {
    char buffer[128];
    std::snprintf(buffer, sizeof(buffer), "%s failed (0x%08lX)", what,
                  static_cast<unsigned long>(hr));
    return buffer;
}

/// Float stereo 48 kHz, as WAVEFORMATEXTENSIBLE — the mixer converts to it.
WAVEFORMATEXTENSIBLE wantedFormat() {
    WAVEFORMATEXTENSIBLE format{};
    format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
    format.Format.nChannels = kChannels;
    format.Format.nSamplesPerSec = kSampleRate;
    format.Format.wBitsPerSample = 32;
    format.Format.nBlockAlign = static_cast<WORD>(kChannels * sizeof(float));
    format.Format.nAvgBytesPerSec = kSampleRate * format.Format.nBlockAlign;
    format.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
    format.Samples.wValidBitsPerSample = 32;
    format.dwChannelMask = kStereoMask;
    format.SubFormat = kIeeeFloatSubtype;
    return format;
}

/// One open loopback stream on the current default output.
class LoopbackStream {
public:
    Status open() {
        ComPtr<IMMDeviceEnumerator> enumerator;
        HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                      IID_PPV_ARGS(&enumerator));
        if (FAILED(hr)) {
            return Status::error(hresultText("CoCreateInstance(MMDeviceEnumerator)", hr));
        }
        ComPtr<IMMDevice> device;
        hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
        if (FAILED(hr)) {
            return Status::error(hresultText("GetDefaultAudioEndpoint(eRender)", hr) +
                                 " — no output device?");
        }
        hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                              reinterpret_cast<void**>(client_.ReleaseAndGetAddressOf()));
        if (FAILED(hr)) {
            return Status::error(hresultText("IMMDevice::Activate(IAudioClient)", hr));
        }

        const WAVEFORMATEXTENSIBLE format = wantedFormat();
        // AUTOCONVERTPCM: the mixer resamples and remaps to the format asked
        // for, so a 44.1 kHz or 7.1 device still yields 48 kHz stereo here.
        hr = client_->Initialize(AUDCLNT_SHAREMODE_SHARED,
                                 AUDCLNT_STREAMFLAGS_LOOPBACK |
                                     AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                                     AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                                 kBufferDuration, 0,
                                 reinterpret_cast<const WAVEFORMATEX*>(&format), nullptr);
        if (FAILED(hr)) {
            return Status::error(hresultText("IAudioClient::Initialize(loopback)", hr));
        }
        hr = client_->GetService(IID_PPV_ARGS(&capture_));
        if (FAILED(hr)) {
            return Status::error(hresultText("IAudioClient::GetService(IAudioCaptureClient)", hr));
        }
        hr = client_->Start();
        if (FAILED(hr)) {
            return Status::error(hresultText("IAudioClient::Start", hr));
        }
        return Status::ok();
    }

    /// Drains every packet currently buffered. Returns false when the device
    /// is gone and the stream must be reopened.
    bool drain(const AudioCallback& onAudio) {
        for (;;) {
            UINT32 packetFrames = 0;
            HRESULT hr = capture_->GetNextPacketSize(&packetFrames);
            if (FAILED(hr)) {
                return hr != AUDCLNT_E_DEVICE_INVALIDATED;
            }
            if (packetFrames == 0) {
                return true;
            }

            BYTE* data = nullptr;
            UINT32 frames = 0;
            DWORD flags = 0;
            UINT64 devicePosition = 0;
            UINT64 qpcPosition = 0;  // 100 ns units, QueryPerformanceCounter clock
            hr = capture_->GetBuffer(&data, &frames, &flags, &devicePosition, &qpcPosition);
            if (FAILED(hr)) {
                return hr != AUDCLNT_E_DEVICE_INVALIDATED;
            }

            AudioChunk chunk;
            chunk.sampleRate = kSampleRate;
            chunk.channels = kChannels;
            // SystemRelativeTime on the frames is the same QPC clock in the
            // same units, so the two tracks share a timeline.
            chunk.ptsUs = static_cast<int64_t>(qpcPosition / 10);
            chunk.samples.resize(static_cast<size_t>(frames) * kChannels);
            if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == nullptr) {
                // Nothing playing: the buffer contents are undefined and the
                // flag says "treat as zeros". Zeros are what Opus's DTX wants.
                std::fill(chunk.samples.begin(), chunk.samples.end(), 0.0F);
            } else {
                std::memcpy(chunk.samples.data(), data, chunk.samples.size() * sizeof(float));
            }
            capture_->ReleaseBuffer(frames);

            if (onAudio) {
                onAudio(std::move(chunk));
            }
        }
    }

    void close() {
        if (client_) {
            client_->Stop();
        }
        capture_.Reset();
        client_.Reset();
    }

private:
    ComPtr<IAudioClient> client_;
    ComPtr<IAudioCaptureClient> capture_;
};

}  // namespace

Status AudioLoopback::start(AudioCallback onAudio) {
    if (running_.exchange(true)) {
        return Status::error("audio loopback already started");
    }

    // The first open happens on the worker so COM is initialised on the
    // thread that uses it; start() waits for the result so a missing output
    // device is reported here, synchronously, like a capture refusal.
    std::mutex mutex;
    std::condition_variable opened;
    bool done = false;
    Status result;

    worker_ = std::thread([this, onAudio = std::move(onAudio), &mutex, &opened, &done, &result] {
        const HRESULT coInit = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        LoopbackStream stream;
        const Status status = stream.open();
        // Nothing captured by reference is touched after the notify: start()
        // returns on it and those locals are gone.
        {
            std::lock_guard<std::mutex> lock(mutex);
            result = status;
            done = true;
        }
        opened.notify_all();
        if (status.failed()) {
            if (SUCCEEDED(coInit)) {
                CoUninitialize();
            }
            return;
        }

        bool healthy = true;
        while (running_.load()) {
            if (!healthy) {
                // Device went away. Wait a moment for the new default to
                // settle, then follow it.
                stream.close();
                std::this_thread::sleep_for(kReopenDelay);
                if (!running_.load()) {
                    break;
                }
                const Status reopened = stream.open();
                if (reopened.failed()) {
                    continue;  // try again next round
                }
                std::fprintf(stderr, "[audio] output device changed, following it\n");
                healthy = true;
            }
            healthy = stream.drain(onAudio);
            if (healthy) {
                std::this_thread::sleep_for(kPollInterval);
            }
        }
        stream.close();
        if (SUCCEEDED(coInit)) {
            CoUninitialize();
        }
    });

    {
        std::unique_lock<std::mutex> lock(mutex);
        opened.wait(lock, [&] { return done; });
    }
    if (result.failed()) {
        running_.store(false);
        if (worker_.joinable()) {
            worker_.join();
        }
    }
    return result;
}

void AudioLoopback::stop() {
    running_.store(false);
    if (worker_.joinable()) {
        worker_.join();
    }
}

}  // namespace desktophost::win
