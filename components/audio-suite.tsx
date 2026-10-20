"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  Music,
  Radio,
  Wifi,
  Sliders,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Sun,
  Moon,
  QrCode,
  Copy,
  Check,
  RefreshCw,
  Info,
  PhoneCall,
  Activity,
  AlertCircle,
  HelpCircle,
  Hash,
  Monitor
} from "lucide-react";
import QRCode from "qrcode";

const LOW_LATENCY_SIGNALING_POLL_MS = 250;
type BufferPreset = "small" | "medium" | "large";

function isBufferPreset(value: unknown): value is BufferPreset {
  return value === "small" || value === "medium" || value === "large";
}

function createLowLatencyPeerConnection() {
  return new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 8,
  });
}

async function applyLowLatencySenderParameters(sender: RTCRtpSender, bitrateKbps: number) {
  const parameters = sender.getParameters() as any;
  parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
  parameters.encodings[0].maxBitrate = bitrateKbps * 1000;
  parameters.encodings[0].priority = "high";
  parameters.encodings[0].networkPriority = "high";
  await sender.setParameters(parameters);
}

// Utility function to inject Opus high-fidelity configurations strictly into SDP
function setHighFidelityOpusSDP(sdp: string, bitrateKbps: number, stereo: boolean): string {
  const lines = sdp.split("\r\n");
  const audioLineIndex = lines.findIndex((line) => line.startsWith("m=audio"));
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("a=fmtp:")) {
      // Find the payload type of opus
      const parts = lines[i].split(" ");
      const pt = parts[0].split(":")[1];
      // Check if this payload type corresponds to opus in previous lines
      const isOpus = lines.some((l) => l.includes(`a=rtpmap:${pt} opus/48000/2`));
      if (isOpus) {
        // Build optimal parameters for the opus audio track
        const stereoVal = stereo ? "1" : "0";
        lines[i] = `a=fmtp:${pt} minptime=5;useinbandfec=0;stereo=${stereoVal};sprop-stereo=${stereoVal};maxaveragebitrate=${bitrateKbps * 1000};audiobandwidth=20000`;
      }
    }
  }

  if (audioLineIndex !== -1) {
    const nextMediaLineIndex = lines.findIndex((line, index) => index > audioLineIndex && line.startsWith("m="));
    const audioSectionEndIndex = nextMediaLineIndex === -1 ? lines.length : nextMediaLineIndex;
    const hasPtime = lines.slice(audioLineIndex, audioSectionEndIndex).some((line) => line.startsWith("a=ptime:"));
    const hasMaxPtime = lines.slice(audioLineIndex, audioSectionEndIndex).some((line) => line.startsWith("a=maxptime:"));
    const insertIndex = audioLineIndex + 1;

    if (!hasMaxPtime) {
      lines.splice(insertIndex, 0, "a=maxptime:10");
    }
    if (!hasPtime) {
      lines.splice(insertIndex, 0, "a=ptime:10");
    }
  }

  return lines.join("\r\n");
}

export default function AudioSuite() {
  // Theme and role setup
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [role, setRole] = useState<"none" | "broadcaster" | "receiver">("none");

  // Device discovery and configuration states
  const [deviceName, setDeviceName] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const ua = window.navigator.userAgent;
      let detectedName = "Web Browser";
      if (/android/i.test(ua)) {
        detectedName = "Android Device";
      } else if (/iPad|iPhone|iPod/.test(ua)) {
        detectedName = "iOS Device";
      } else if (/Macintosh/.test(ua)) {
        detectedName = "Mac PC";
      } else if (/Windows/.test(ua)) {
        detectedName = "Windows PC";
      } else if (/Linux/.test(ua)) {
        detectedName = "Linux PC";
      }
      const randSuffix = Math.floor(100 + Math.random() * 900);
      return `${detectedName} - ${randSuffix}`;
    }
    return "Broadcaster Device";
  });
  const [discoveredSessions, setDiscoveredSessions] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [bufferPreset, setBufferPreset] = useState<BufferPreset>("small");
  const [receiverDeviceName, setReceiverDeviceName] = useState<string>("");
  const [receiverCount, setReceiverCount] = useState<number>(0);
  const [pairingOrigin, setPairingOrigin] = useState<string>("");

  // Signaling & pairing state
  const [sessionId, setSessionId] = useState<string>("");
  const [inputCode, setInputCode] = useState<string>("");
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [autoJoinCode, setAutoJoinCode] = useState<string>("");
  const [receiverClientId] = useState<string>(() => {
    if (typeof window === "undefined") return "receiver-ssr";

    const storageKey = "castlink_receiver_client_id";
    const storedId = window.localStorage.getItem(storageKey);
    if (storedId) return storedId;

    const nextId = window.crypto?.randomUUID?.() || `receiver-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(storageKey, nextId);
    return nextId;
  });
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [statusText, setStatusText] = useState<string>("Ready");

  // Audio parameters state
  const [audioSource, setAudioSource] = useState<"microphone" | "file" | "system">("system");
  const [isStereo, setIsStereo] = useState<boolean>(true);
  const [targetBitrate, setTargetBitrate] = useState<number>(96);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(85); // 0-100
  const [isLocalMonitor, setIsLocalMonitor] = useState<boolean>(false);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [filePlaying, setFilePlaying] = useState<boolean>(false);
  const [isStreamActive, setIsStreamActive] = useState<boolean>(false);

  // Connection diagnostics state
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [iceState, setIceState] = useState<string>("new");
  const [peerState, setPeerState] = useState<string>("new");
  const [signalStrength, setSignalStrength] = useState<"none" | "poor" | "fair" | "good" | "excellent">("none");
  const [connectedRole, setConnectedRole] = useState<string>("");
  const [diagnosticsLogs, setDiagnosticsLogs] = useState<string[]>([]);

  // User gesture interaction state (browser blocking rules)
  const [hasInteracted, setHasInteracted] = useState<boolean>(false);

  // References
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const broadcasterPeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const displayCaptureStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const fileAudioElRef = useRef<HTMLAudioElement | null>(null);
  const fileObjectUrlRef = useRef<string | null>(null);
  const receiverAudioElRef = useRef<HTMLAudioElement | null>(null);
  const receiverGainRef = useRef<GainNode | null>(null);
  const receiverOutputConnectedRef = useRef<boolean>(false);
  const visualizerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const appliedRemoteCandidatesRef = useRef<Set<string>>(new Set());
  const broadcasterAppliedRemoteCandidatesRef = useRef<Map<string, Set<string>>>(new Map());
  const broadcasterStartingReceiverIdsRef = useRef<Set<string>>(new Set());
  const autoJoinStartedRef = useRef<boolean>(false);
  const hasInteractedRef = useRef<boolean>(false);
  const bufferPresetRef = useRef<BufferPreset>(bufferPreset);
  const isMutedRef = useRef<boolean>(isMuted);
  const volumeRef = useRef<number>(volume);

  // Keep references for polling
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const dataChannelPingIntervalsRef = useRef<Map<RTCDataChannel, ReturnType<typeof setInterval>>>(new Map());

  // Theme application
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  // Read URL query parameters on component load to enable instant pairing
  useEffect(() => {
    let autoJoinTimer: ReturnType<typeof setTimeout> | undefined;
    const searchParams = new URLSearchParams(window.location.search);
    const urlRole = searchParams.get("role");
    const urlCode = searchParams.get("code");

    if (urlRole === "receiver" && urlCode) {
      autoJoinTimer = setTimeout(() => {
        setRole("receiver");
        setInputCode(urlCode);
        setAutoJoinCode(urlCode);
        setDiagnosticsLogs((prev) => [`Autoloaded code ${urlCode} from pairing link`, ...prev]);
      }, 0);
    }

    return () => {
      if (autoJoinTimer) clearTimeout(autoJoinTimer);
    };
  }, []);

  // Scan actively for broadcasters on the network
  const scanForBroadcasters = async () => {
    try {
      setIsScanning(true);
      const res = await fetch("/api/session");
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      if (data.success) {
        setDiscoveredSessions(data.sessions || []);
      }
    } catch (e) {
      // Fail silently for background scanner
    } finally {
      setIsScanning(false);
    }
  };

  // Trigger continuous background discovery search when receiver is active and unattached
  useEffect(() => {
    if (role === "receiver" && !sessionActive) {
      const delayTimer = setTimeout(() => {
        scanForBroadcasters();
      }, 100);
      const interval = setInterval(() => {
        scanForBroadcasters();
      }, 1000);
      return () => {
        clearTimeout(delayTimer);
        clearInterval(interval);
      };
    }
  }, [role, sessionActive]);

  // Diagnostics logging helper
  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setDiagnosticsLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 19)]);
  };

  const updateBufferPreset = async (preset: BufferPreset) => {
    bufferPresetRef.current = preset;
    setBufferPreset(preset);
    addLog(`Buffer preset set to ${preset}`);

    if (!sessionActive || !sessionId) {
      return;
    }

    try {
      const res = await fetch(`/api/session/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "buffer",
          bufferSize: preset,
        }),
      });

      if (!res.ok) {
        throw new Error("Room buffer sync failed");
      }

      addLog(`Synced ${preset} buffer preset across the room`);
    } catch (err: any) {
      addLog(`Buffer sync warning: ${err.message || "could not update room"}`);
    }
  };

  const getPairingUrl = (code: string = sessionId) => {
    if (typeof window === "undefined" || !code) return "";
    const origin = pairingOrigin || window.location.origin;
    return `${origin}?role=receiver&code=${code}`;
  };

  useEffect(() => {
    let cancelled = false;

    const loadPairingOrigin = async () => {
      if (typeof window === "undefined") return;

      try {
        const res = await fetch("/api/network");
        if (!res.ok) throw new Error("Network metadata unavailable");
        const data = await res.json();
        const nextOrigin = typeof data.preferredOrigin === "string" && data.preferredOrigin
          ? data.preferredOrigin
          : window.location.origin;

        if (!cancelled) {
          setPairingOrigin(nextOrigin);
        }
      } catch (err) {
        if (!cancelled) {
          setPairingOrigin(window.location.origin);
        }
      }
    };

    loadPairingOrigin();

    return () => {
      cancelled = true;
    };
  }, []);

  // Setup visualizer observer for container resizing
  const canvasWidthRef = useRef<number>(400);
  const canvasHeightRef = useRef<number>(120);

  useEffect(() => {
    if (!canvasContainerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        canvasWidthRef.current = width;
        canvasHeightRef.current = height || 120;
        if (visualizerCanvasRef.current) {
          visualizerCanvasRef.current.width = width;
          visualizerCanvasRef.current.height = height || 120;
        }
      }
    });

    resizeObserver.observe(canvasContainerRef.current);
    return () => {
      resizeObserver.disconnect();
    };
  }, [role, sessionActive]);

  // Generate QR Code dynamically
  useEffect(() => {
    let cancelled = false;

    if (!sessionId) {
      return;
    }

    const origin = pairingOrigin || window.location.origin;
    const url = `${origin}?role=receiver&code=${sessionId}`;
    void QRCode.toDataURL(url, {
      margin: 1,
      width: 320,
      color: {
        dark: theme === "dark" ? "#10b981" : "#1e293b",
        light: theme === "dark" ? "#09090b" : "#ffffff",
      },
    }).then((dataUrl) => {
      if (!cancelled) setQrCodeUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) addLog("QR Code generation error");
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId, theme, pairingOrigin]);

  // Audio frequency looping drawing loop on Canvas
  const runVisualizer = (analyser: AnalyserNode) => {
    const canvas = visualizerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    analyser.fftSize = 128;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      const width = canvasWidthRef.current;
      const height = canvasHeightRef.current;

      ctx.clearRect(0, 0, width, height);

      // Draw modern audio visualizer bars
      const barWidth = (width / bufferLength) * 1.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * height * 0.95;

        // Visual design alignment: theme coloring
        if (theme === "dark") {
          // Neon blue/indigo gradient colors for sleek tech feel
          const percent = i / bufferLength;
          ctx.fillStyle = `rgba(${Math.floor(29 + percent * 30)}, ${Math.floor(78 + percent * 100)}, ${Math.floor(216 + percent * 39)}, ${0.4 + (dataArray[i]/255) * 0.6})`;
          ctx.shadowBlur = 4;
          ctx.shadowColor = "rgba(59, 130, 246, 0.4)";
        } else {
          // Dark charcoal styling
          ctx.fillStyle = `rgba(24, 24, 27, ${0.3 + (dataArray[i]/255) * 0.7})`;
          ctx.shadowBlur = 0;
        }

        ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
        x += barWidth;
      }
    };
    draw();
  };

  // Master Stop Function to revert state cleanly
  const stopAllStreaming = () => {
    // Clear intervals
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    pollingIntervalRef.current = null;
    statsIntervalRef.current = null;
    dataChannelPingIntervalsRef.current.forEach((interval) => clearInterval(interval));
    dataChannelPingIntervalsRef.current.clear();

    // Stop request animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Stop live track capture
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (displayCaptureStreamRef.current) {
      displayCaptureStreamRef.current.getTracks().forEach((track) => track.stop());
      displayCaptureStreamRef.current = null;
    }
    setIsStreamActive(false);

    // Terminate audio elements
    if (fileAudioElRef.current) {
      fileAudioElRef.current.pause();
      fileAudioElRef.current = null;
    }
    if (fileObjectUrlRef.current) {
      URL.revokeObjectURL(fileObjectUrlRef.current);
      fileObjectUrlRef.current = null;
    }
    if (receiverAudioElRef.current) {
      receiverAudioElRef.current.pause();
      receiverAudioElRef.current.srcObject = null;
      receiverAudioElRef.current = null;
    }
    setFilePlaying(false);

    if (receiverGainRef.current) {
      receiverGainRef.current.disconnect();
      receiverGainRef.current = null;
    }
    receiverOutputConnectedRef.current = false;

    // Close WebRTC Connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    broadcasterPeerConnectionsRef.current.forEach((pc) => pc.close());
    broadcasterPeerConnectionsRef.current.clear();
    broadcasterStartingReceiverIdsRef.current.clear();

    // Close Data Channel
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    // Revert context elements
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {
        // Ignore close races on already-closed browser audio contexts
      });
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    appliedRemoteCandidatesRef.current = new Set();
    broadcasterAppliedRemoteCandidatesRef.current = new Map();

    // Reset status fields
    setSessionActive(false);
    setLatencyMs(null);
    setIceState("new");
    setPeerState("new");
    setSignalStrength("none");
    setStatusText("Disconnected");
    setConnectedRole("");
    setReceiverCount(0);
    setReceiverDeviceName("");
  };

  // Cleanup WebRTC connections/state on change of role or unmount
  useEffect(() => {
    return () => {
      stopAllStreaming();
    };
  }, []);

  // Helper to copy session ID info
  const copySessionLink = () => {
    const url = getPairingUrl(sessionId);
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      addLog("Pairing link copied to clipboard");
    }).catch(() => {
      setErrorMsg("Could not copy the pairing link. Please copy it from the text field.");
    });
  };

  // Setup WebRTC stats and diagnostic intervals
  const setupDiagnosticsFetcher = (pc: RTCPeerConnection) => {
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);

    let isFetching = false;

    statsIntervalRef.current = setInterval(async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        if (!pc || pc.signalingState === "closed") return;
        const stats = await pc.getStats();
        let activePairs: any = null;

        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            activePairs = report;
          }
        });

        // Track stats and calculate connection strengths
        if (activePairs) {
          const rtt = activePairs.currentRoundTripTime * 1000; // convert to ms
          setLatencyMs(Math.round(rtt * 10) / 10);

          if (rtt < 15) {
            setSignalStrength("excellent");
          } else if (rtt < 40) {
            setSignalStrength("good");
          } else if (rtt < 90) {
            setSignalStrength("fair");
          } else {
            setSignalStrength("poor");
          }
        } else if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
          // If connection is open but no RTT stat returned, use default high strength placeholder
          if (latencyMs === null) {
            setSignalStrength("good");
          }
        }
      } catch (err) {
        // Fallback catch silently to prevent error bubbling
      } finally {
        isFetching = false;
      }
    }, 1500);
  };

  // Set up Data Channel listeners for both broadcaster and receiver
  const configureDataChannel = (dc: RTCDataChannel) => {
    dc.onopen = () => {
      addLog("Data Channel active (micro-latency metadata stream connected)");
      setStatusText("Connected & Streaming");
      setSignalStrength("excellent");

      // Set up periodic manual network ping to measure absolute latency independently
      const interval = setInterval(() => {
        if (dc.readyState === "open") {
          dc.send(`ping:${Date.now()}`);
        } else {
          clearInterval(interval);
          dataChannelPingIntervalsRef.current.delete(dc);
        }
      }, 1000);
      dataChannelPingIntervalsRef.current.set(dc, interval);
    };

    dc.onclose = () => {
      const interval = dataChannelPingIntervalsRef.current.get(dc);
      if (interval) clearInterval(interval);
      dataChannelPingIntervalsRef.current.delete(dc);
      addLog("Data Channel closed");
    };

    dc.onmessage = (event) => {
      const dataStr = event.data as string;
      if (dataStr.startsWith("ping:")) {
        const timestamp = dataStr.split(":")[1];
        if (dc.readyState === "open") {
          dc.send(`pong:${timestamp}`);
        }
      } else if (dataStr.startsWith("pong:")) {
        const timestamp = parseInt(dataStr.split(":")[1], 10);
        const rtt = Date.now() - timestamp;
        setLatencyMs(rtt);
        if (rtt < 12) {
          setSignalStrength("excellent");
        } else if (rtt < 35) {
          setSignalStrength("good");
        } else if (rtt < 75) {
          setSignalStrength("fair");
        } else {
          setSignalStrength("poor");
        }
      }
    };
  };

  const requestDesktopAudioCapture = async () => {
    const existingStream = displayCaptureStreamRef.current;
    const existingAudioTrack = existingStream
      ?.getAudioTracks()
      .find((track) => track.readyState === "live");

    if (existingAudioTrack) {
      return new MediaStream([existingAudioTrack]);
    }

    if (existingStream) {
      existingStream.getTracks().forEach((track) => track.stop());
      displayCaptureStreamRef.current = null;
    }

    addLog("Opening desktop picker. Select Entire Screen and enable Share system audio.");

    const desktopAudioOptions = {
      video: {
        width: 320,
        height: 240,
        frameRate: 1,
        displaySurface: "monitor",
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
        channelCount: isStereo ? 2 : 1,
      } as any,
      systemAudio: "include",
      monitorTypeSurfaces: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    } as any;

    const sysStream = await navigator.mediaDevices.getDisplayMedia(desktopAudioOptions);
    displayCaptureStreamRef.current = sysStream;

    const audioTracks = sysStream.getAudioTracks();
    if (audioTracks.length === 0) {
      sysStream.getTracks().forEach((track) => track.stop());
      displayCaptureStreamRef.current = null;
      throw new Error("No desktop audio track captured. Pick Entire Screen and enable the 'Share system audio' checkbox in the browser sharing popup.");
    }

    const videoTrack = sysStream.getVideoTracks()[0];
    const displaySurface = videoTrack?.getSettings?.().displaySurface;
    if (displaySurface && displaySurface !== "monitor") {
      addLog(`Capture source is ${displaySurface}; use Entire Screen for full desktop audio.`);
    }

    audioTracks[0].onended = () => {
      addLog("Desktop audio capture stopped by user.");
      stopAllStreaming();
    };
    sysStream.getVideoTracks().forEach((track) => {
      track.onended = () => {
        addLog("Desktop capture permission ended by user.");
        stopAllStreaming();
      };
    });

    setIsStreamActive(true);
    addLog(`Desktop audio capture armed (${audioTracks[0].label || "system output"}).`);

    return new MediaStream([audioTracks[0]]);
  };

  // BROADCASTER INIT FLOW
  const initializeBroadcaster = async () => {
    setErrorMsg("");
    stopAllStreaming();
    addLog(`Configuring Live Broadcaster Room with friendly name "${deviceName}"...`);
    setStatusText("Initializing room...");

    try {
      if (audioSource === "system") {
        setStatusText("Requesting desktop audio...");
        const preparedDesktopStream = await requestDesktopAudioCapture();
        localStreamRef.current = preparedDesktopStream;
        setStatusText("Desktop audio armed");
      }

      // 1. Ask Server to Allocate Session ID
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          broadcasterName: deviceName || "Unknown Broadcaster",
          bufferSize: bufferPreset
        })
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Allocation failed");
      }

      const activeId = data.sessionId;
      setSessionId(activeId);
      setSessionActive(true);
      setStatusText("Awaiting pairing...");
      addLog(`Session ${activeId} provisioned on ${bufferPreset} buffer mode.`);

      let isPolling = false;
      pollingIntervalRef.current = setInterval(async () => {
        if (isPolling) return;
        isPolling = true;
        try {
          const sRes = await fetch(`/api/session/${activeId}`);
          if (!sRes.ok) return;
          const sData = await sRes.json();
          if (!sData.success) return;

          const session = sData.session;
          if (isBufferPreset(session.bufferSize) && bufferPresetRef.current !== session.bufferSize) {
            bufferPresetRef.current = session.bufferSize;
            setBufferPreset(session.bufferSize);
            addLog(`Room buffer preset updated to ${session.bufferSize}`);
          }
          const activeReceivers = Object.values(session.receivers || {})
            .filter((receiver: any) => receiver.active);

          setReceiverCount(activeReceivers.length);
          const receiverNames = activeReceivers
            .map((receiver: any) => receiver.receiverName || "Receiver")
            .join(", ");
          setReceiverDeviceName(receiverNames);

          const activeReceiverIds = new Set(activeReceivers.map((receiver: any) => receiver.id));
          for (const [receiverId, pc] of broadcasterPeerConnectionsRef.current.entries()) {
            if (!activeReceiverIds.has(receiverId)) {
              pc.close();
              broadcasterPeerConnectionsRef.current.delete(receiverId);
              broadcasterAppliedRemoteCandidatesRef.current.delete(receiverId);
              addLog(`Receiver ${receiverId.slice(0, 8)} left. Closed peer connection.`);
            }
          }

          for (const receiver of activeReceivers as any[]) {
            if (!broadcasterPeerConnectionsRef.current.has(receiver.id)) {
              addLog(`Receiver "${receiver.receiverName || "remote device"}" detected. Creating dedicated WebRTC peer...`);
              await startBroadcasterWebRTC(activeId, receiver.id);
            }

            const pc = broadcasterPeerConnectionsRef.current.get(receiver.id);
            if (!pc) continue;

            if (receiver.answer) {
              if (pc.remoteDescription?.type === "answer") {
              } else if (pc.signalingState === "have-local-offer") {
                await pc.setRemoteDescription(new RTCSessionDescription(receiver.answer));
                addLog(`Receiver "${receiver.receiverName || receiver.id.slice(0, 8)}" SDP answer applied.`);
                setStatusText("Connecting media...");
              }
            }

            const rxIce = receiver.receiverIce || [];
            if (pc.remoteDescription) {
              const appliedCandidates = broadcasterAppliedRemoteCandidatesRef.current.get(receiver.id) || new Set<string>();
              broadcasterAppliedRemoteCandidatesRef.current.set(receiver.id, appliedCandidates);

              for (const cand of rxIce) {
                const candidateKey = JSON.stringify(cand);
                if (appliedCandidates.has(candidateKey)) continue;

                try {
                  await pc.addIceCandidate(new RTCIceCandidate(cand));
                  appliedCandidates.add(candidateKey);
                  addLog(`Applied ICE candidate from ${receiver.receiverName || receiver.id.slice(0, 8)}`);
                } catch (pe) {
                  // Ignore minor ICE candidate matching noise
                }
              }
            }
          }
        } catch (pollErr) {
          // Poll error silently handled
        } finally {
          isPolling = false;
        }
      }, LOW_LATENCY_SIGNALING_POLL_MS);

    } catch (err: any) {
      setErrorMsg(err.message || "Failed to initialize broadcaster");
      setStatusText("Configuration failed");
      addLog(`Setup failed: ${err.message}`);
    }
  };

  // Launch WebRTC as a Broadcaster (sdp Offer generation)
  const startBroadcasterWebRTC = async (targetId: string, receiverId: string) => {
    if (
      broadcasterPeerConnectionsRef.current.has(receiverId) ||
      broadcasterStartingReceiverIdsRef.current.has(receiverId)
    ) {
      return;
    }

    broadcasterStartingReceiverIdsRef.current.add(receiverId);
    setStatusText("Configuring pipeline...");

    try {
      let captureStream: MediaStream;
      let audioCtx = audioContextRef.current;
      let analyser = analyserRef.current;

      // Prepare one capture and Web Audio pipeline per broadcast room. The same
      // MediaStream tracks can be safely attached to every receiver peer.
      if (!audioCtx || !analyser || !localStreamRef.current) {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        const latencyHint = bufferPreset === "small" ? "interactive" : bufferPreset === "large" ? "playback" : "balanced";
        audioCtx = new AudioCtxClass({ latencyHint });
        analyser = audioCtx.createAnalyser();
        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;

        if (audioSource === "system") {
          addLog("Using armed full desktop audio capture.");
          try {
            captureStream = await requestDesktopAudioCapture();
          } catch (mediaErr: any) {
            if (mediaErr.name === "NotAllowedError" || mediaErr.message?.includes("Permission denied")) {
              throw new Error("Desktop audio capture denied. Browser permission is required, and the picker must include Share system audio.");
            }
            throw mediaErr;
          }
        } else if (audioSource === "microphone") {
          captureStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              latency: 0.005,
            } as any,
          });
          addLog("Microphone access approved");
        } else {
          if (!localFile) {
            throw new Error("No audio file selected for streaming");
          }

          const audioEl = document.createElement("audio");
          const fileObjectUrl = URL.createObjectURL(localFile);
          fileObjectUrlRef.current = fileObjectUrl;
          audioEl.src = fileObjectUrl;
          audioEl.loop = true;
          fileAudioElRef.current = audioEl;

          const destination = audioCtx.createMediaStreamDestination();
          const source = audioCtx.createMediaElementSource(audioEl);
          source.connect(destination);
          source.connect(analyser);
          if (isLocalMonitor) analyser.connect(audioCtx.destination);

          await audioEl.play();
          setFilePlaying(true);
          captureStream = destination.stream;
          addLog(`Streaming audio file: ${localFile.name}`);
        }

        if (audioSource !== "file") {
          const source = audioCtx.createMediaStreamSource(captureStream!);
          source.connect(analyser);
        }

        localStreamRef.current = captureStream!;
        setIsStreamActive(true);
        runVisualizer(analyser);
      }

      const preparedStream = localStreamRef.current;
      if (!preparedStream) {
        throw new Error("Audio capture stream is not available");
      }
      captureStream = preparedStream;

      // WebRTC Setup Node
      const pc = createLowLatencyPeerConnection();
      broadcasterPeerConnectionsRef.current.set(receiverId, pc);

      // Track ICE state
      pc.oniceconnectionstatechange = () => {
        setIceState(pc.iceConnectionState);
        addLog(`ICE Connection status updated to: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          setStatusText("Interrupted / Retrying");
        }
      };

      pc.onconnectionstatechange = () => {
        setPeerState(pc.connectionState);
        if (pc.connectionState === "connected") {
          setStatusText("Connected & Streaming");
          setConnectedRole("Receiver Ready");
          addLog("P2P connection established successfully!");
        }
      };

      // Add tracked layouts
      for (const track of captureStream.getTracks()) {
        const sender = pc.addTrack(track, captureStream);
        if (track.kind === "audio") {
          try {
            await applyLowLatencySenderParameters(sender, targetBitrate);
            addLog(`Applied low-latency audio sender priority at ${targetBitrate} kbps`);
          } catch (senderErr: any) {
            addLog(`Audio sender tuning skipped: ${senderErr.message}`);
          }
        }
      }

      // Data channel setups for live messaging and latency measuring pings
      const dc = pc.createDataChannel("latency-metadata", { negotiated: true, id: 0 });
      dataChannelRef.current = dc;
      configureDataChannel(dc);

      // Handle custom local ICE elements by posting them to session signaling endpoint
      pc.onicecandidate = async (ev) => {
        if (ev.candidate) {
          try {
            await fetch(`/api/session/${targetId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "candidate",
                role: "broadcaster",
                receiverId,
                candidate: ev.candidate,
              }),
            });
          } catch (icePostErr) {
            // ICE Post fails handled
          }
        }
      };

      // Create WebRTC Offer
      let offer = await pc.createOffer();
      // Configure high fidelity OPUS customization
      if (offer.sdp) {
        offer.sdp = setHighFidelityOpusSDP(offer.sdp, targetBitrate, isStereo);
      }

      await pc.setLocalDescription(offer);

      // POST to signaling room
      const offerRes = await fetch(`/api/session/${targetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "offer",
          receiverId,
          offer: offer,
        }),
      });

      if (!offerRes.ok) {
        throw new Error("Failed to post connection SDP offer");
      }

      addLog(`Dispatched High-fidelity custom SDP offer to receiver ${receiverId.slice(0, 8)}`);
      setStatusText("Generating handshakes...");

      // Poll monitoring stats and latency
      setupDiagnosticsFetcher(pc);

    } catch (webRtcErr: any) {
      setErrorMsg(webRtcErr.message || "Failed to initialize WebRTC engine");
      addLog(`WebRTC setup error: ${webRtcErr.message}`);
      setStatusText("Connection failed");
    } finally {
      broadcasterStartingReceiverIdsRef.current.delete(receiverId);
    }
  };

  // RECEIVER JOIN FLOW
  const initializeReceiver = async (overrideCode?: string) => {
    setErrorMsg("");
    stopAllStreaming();

    const code = (overrideCode || inputCode).trim();
    if (!code || code.length < 6) {
      setErrorMsg("Please enter a valid 6-digit session pairing code");
      return;
    }

    addLog(`Initiating joining handshake for room code: ${code}...`);
    setStatusText("Pairing with broadcaster...");

    try {
      // 1. Mark receiver active on session signaling room
      const res = await fetch(`/api/session/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          action: "join",
          receiverId: receiverClientId,
          receiverName: deviceName || "Unknown Receiver"
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Room pairing validation failed");
      }

      setSessionActive(true);
      setSessionId(code);
      addLog("Paired successfully! Initializing connection pipeline...");

      // 2. Start WebRTC receiver elements
      const pc = createLowLatencyPeerConnection();
      peerConnectionRef.current = pc;

      pc.oniceconnectionstatechange = () => {
        setIceState(pc.iceConnectionState);
        addLog(`ICE state changed to: ${pc.iceConnectionState}`);
      };

      pc.onconnectionstatechange = () => {
        setPeerState(pc.connectionState);
        if (pc.connectionState === "connected") {
          setStatusText("Connected. Tap below to start listening!");
          setConnectedRole("Broadcaster Active");
          addLog("Stream established! Audio stream received.");
          applyPlayoutDelayHint(pc, bufferPreset);
        }
      };

      // Set up incoming Media Stream tracking
      const incomingStream = new MediaStream();
      pc.ontrack = (ev) => {
        addLog(`Received active audio track: ${ev.track.kind}`);
        incomingStream.addTrack(ev.track);
        applyPlayoutDelayHint(pc, bufferPreset);

        // Bind incoming stream to a hidden receiver sound module
        // We will enable this when the user clicks/interacts (browser autoplay restrictions compliance)
        setupReceiverAudioPlayback(incomingStream);
      };

      // Set up ping-pong data channel
      const dc = pc.createDataChannel("latency-metadata", { negotiated: true, id: 0 });
      dataChannelRef.current = dc;
      configureDataChannel(dc);

      // Post Receiver generated local ICE candidates
      pc.onicecandidate = async (ev) => {
        if (ev.candidate) {
          try {
            await fetch(`/api/session/${code}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "candidate",
                role: "receiver",
                receiverId: receiverClientId,
                candidate: ev.candidate,
              }),
            });
          } catch (icePostErr) {
            // Handled
          }
        }
      };

      // Local signal polling variables
      let offerApplied = false;
      let isPolling = false;

      // Polling Loop looking for SDP offer and candidates from Broadcaster
      pollingIntervalRef.current = setInterval(async () => {
        if (isPolling) return;
        isPolling = true;
        try {
          const sRes = await fetch(`/api/session/${code}`);
          if (!sRes.ok) return;
          const sData = await sRes.json();
          if (!sData.success) return;

          const session = sData.session;
          if (isBufferPreset(session.bufferSize) && bufferPresetRef.current !== session.bufferSize) {
            bufferPresetRef.current = session.bufferSize;
            setBufferPreset(session.bufferSize);
            applyPlayoutDelayHint(pc, session.bufferSize);
            addLog(`Synced receiver buffer preset from broadcaster: ${session.bufferSize}`);
          }
          const receiverSession = session.receivers?.[receiverClientId];
          if (!receiverSession) {
            addLog("Receiver lane not ready yet. Waiting for broadcaster room update...");
            return;
          }

          // Process SDP offer from broadcaster
          if (receiverSession.offer && !offerApplied) {
            addLog("Discovered broadcaster offer. Synthesizing answer...");

            await pc.setRemoteDescription(new RTCSessionDescription(receiverSession.offer));
            offerApplied = true;
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            // POST answered SDP to signaling node
            await fetch(`/api/session/${code}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "answer",
                receiverId: receiverClientId,
                answer: answer,
              }),
            });

            addLog("SDP Answer configured and sent back.");
            setStatusText("Connecting...");
          }

          // Fetch broadcaster candidates
          const txIce = receiverSession.broadcasterIce || [];
          if (offerApplied && pc.remoteDescription) {
            for (const cand of txIce) {
              const candidateKey = JSON.stringify(cand);
              if (appliedRemoteCandidatesRef.current.has(candidateKey)) continue;

              try {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
                appliedRemoteCandidatesRef.current.add(candidateKey);
                addLog("Applied Broadcaster ICE candidate");
              } catch (pe) {
                // Ignore matching candidate configuration warnings
              }
            }
          }
        } catch (pollErr) {
          // Silent catch
        } finally {
          isPolling = false;
        }
      }, LOW_LATENCY_SIGNALING_POLL_MS);

      setupDiagnosticsFetcher(pc);

    } catch (rxErr: any) {
      setErrorMsg(rxErr.message || "Failed to pair with broadcaster stream");
      addLog(`Pairing failed: ${rxErr.message}`);
      setStatusText("Connection failed");
    }
  };

  useEffect(() => {
    if (role !== "receiver" || !autoJoinCode || sessionActive || autoJoinStartedRef.current) {
      return;
    }

    autoJoinStartedRef.current = true;
    addLog(`Auto-joining receiver room ${autoJoinCode} from pairing link...`);
    initializeReceiver(autoJoinCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, autoJoinCode, sessionActive]);

  // Apply WebRTC playoutDelayHint to all existing audio receivers
  function applyPlayoutDelayHint(pc: RTCPeerConnection, preset: "small" | "medium" | "large") {
    let delay = 0.05;
    if (preset === "small") delay = 0;
    if (preset === "large") delay = 0.15;

    try {
      pc.getReceivers().forEach((receiver) => {
        if (receiver.track && receiver.track.kind === "audio") {
          if ("playoutDelayHint" in receiver) {
            (receiver as any).playoutDelayHint = delay;
            if ("jitterBufferTarget" in receiver) {
              (receiver as any).jitterBufferTarget = delay;
            }
            addLog(`Updated WebRTC receiver buffer delay to ${delay}s (${preset} preset)`);
          }
        }
      });
    } catch (e) {
      // playoutDelayHint is not supported in this browser
    }
  }

  // Dynamically update playout buffer settings on active peer connection on adjustment
  useEffect(() => {
    bufferPresetRef.current = bufferPreset;
    if (peerConnectionRef.current && role === "receiver") {
      applyPlayoutDelayHint(peerConnectionRef.current, bufferPreset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferPreset, role]);

  useEffect(() => {
    hasInteractedRef.current = hasInteracted;
  }, [hasInteracted]);

  function syncReceiverGain(gainNode = receiverGainRef.current) {
    if (receiverAudioElRef.current) {
      Reflect.set(receiverAudioElRef.current, "muted", isMutedRef.current);
      Reflect.set(receiverAudioElRef.current, "volume", isMutedRef.current ? 0 : volumeRef.current / 100);
    }

    if (!gainNode) return;
    const nextVolume = isMutedRef.current ? 0 : volumeRef.current / 100;
    gainNode.gain.setValueAtTime(nextVolume, gainNode.context.currentTime);
  }

  async function connectReceiverOutput(ctx: AudioContext, analyser: AnalyserNode) {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (receiverAudioElRef.current) {
      syncReceiverGain();
      await receiverAudioElRef.current.play();
      receiverOutputConnectedRef.current = true;
      return;
    }

    if (receiverOutputConnectedRef.current && receiverGainRef.current) {
      syncReceiverGain();
      return;
    }

    const gainNode = ctx.createGain();
    syncReceiverGain(gainNode);
    analyser.connect(gainNode);
    gainNode.connect(ctx.destination);
    receiverGainRef.current = gainNode;
    receiverOutputConnectedRef.current = true;
  }

  // Configure Web Audio pipeline for Receiver layout
  function setupReceiverAudioPlayback(stream: MediaStream) {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const latencyHint = bufferPreset === "small" ? "interactive" : bufferPreset === "large" ? "playback" : "balanced";
      const audioCtx = new AudioCtxClass({ latencyHint });
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyserRef.current = analyser;

      // Pipe WebRTC track into audio analytics node
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      let audioEl = receiverAudioElRef.current;
      if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.setAttribute("playsinline", "true");
        receiverAudioElRef.current = audioEl;
      }
      Reflect.set(audioEl, "srcObject", stream);
      syncReceiverGain();

      // If user has already clicked play, connect target immediately
      if (hasInteractedRef.current) {
        connectReceiverOutput(audioCtx, analyser).catch((err: any) => {
          addLog(`Audio playback start blocked: ${err.message}`);
        });
      }

      runVisualizer(analyser);
      addLog(`Receiver visualization & audio node initialized (${bufferPreset} latency mode: ${latencyHint}).`);
    } catch (playbackErr: any) {
      addLog(`Audio node configuration caution: ${playbackErr.message}`);
    }
  }

  // Activate playback after user hits the primary interaction gesture trigger
  const handleInteractionPlay = async () => {
    setHasInteracted(true);
    hasInteractedRef.current = true;
    if (!audioContextRef.current || !analyserRef.current) {
      addLog("Pipeline is connecting, await audio source...");
      return;
    }

    try {
      const ctx = audioContextRef.current;
      const analyser = analyserRef.current;

      await connectReceiverOutput(ctx, analyser);

      addLog("Audio Output activated! Tuning in live.");
    } catch (err: any) {
      addLog(`Failed to start speaker node: ${err.message}`);
    }
  };

  // Adjust volume dynamically in connected Nodes
  useEffect(() => {
    volumeRef.current = volume;
    isMutedRef.current = isMuted;

    if (receiverGainRef.current) {
      syncReceiverGain();
    }

    if (audioContextRef.current && hasInteracted) {
      addLog(`Volume slide adjusted: ${volume}%`);
    }
  }, [volume, isMuted, hasInteracted]);

  // Handle drag and drop files
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith("audio/")) {
        setLocalFile(file);
        addLog(`File imported via drag-and-drop: ${file.name}`);
      } else {
        setErrorMsg("Selected file must be an audio format");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setLocalFile(file);
      addLog(`Selected audio file: ${file.name}`);
    }
  };

  // Keep Session Alive API check helper
  const disconnectSession = async () => {
    if (sessionId) {
      try {
        await fetch(`/api/session/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: role === "receiver" ? "leave" : "close", receiverId: receiverClientId }),
        });
      } catch (err) {
        // Silently swallow session close connection errors
      }
    }
    stopAllStreaming();
    setRole("none");
    setSessionId("");
    setInputCode("");
    setAutoJoinCode("");
    autoJoinStartedRef.current = false;
    setHasInteracted(false);
  };

  const activePairingOrigin = pairingOrigin || (typeof window !== "undefined" ? window.location.origin : "");

  return (
    <div className={`min-h-screen py-6 px-4 md:px-8 transition-colors duration-300 ${
      theme === "dark" 
        ? "bg-[#0B0F19] text-[#E2E8F0] selection:bg-blue-500 selection:text-black" 
        : "bg-slate-50 text-slate-900 selection:bg-slate-800 selection:text-white"
    }`}>
      {/* Container wrapper */}
      <div className="max-w-4xl mx-auto flex flex-col min-h-[calc(100vh-3rem)]">
        
        {/* Elegant top menu bar */}
        <header className={`flex items-center justify-between pb-6 mb-6 border-b transition-colors ${
          theme === "dark" ? "border-slate-800/80" : "border-slate-200"
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl transition-colors ${
              theme === "dark" ? "bg-[#161D2F] text-blue-400 border border-slate-700/60" : "bg-slate-200 text-slate-800"
            }`}>
              <Radio className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                CastLink <span className="text-xs uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 ml-1.5 font-bold">Wi-Fi Suite</span>
              </h1>
              <p className={`text-xs ${theme === "dark" ? "text-slate-400" : "text-slate-500"} hidden sm:block`}>
                Low-Latency WebRTC High-Fidelity Audio Broadcasting
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Theme Toggle */}
            <button
              id="theme-toggler"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className={`p-2.5 rounded-xl hover:scale-105 transition active:scale-95 ${
                theme === "dark" ? "bg-[#161D2F] hover:bg-slate-800 text-yellow-500 border border-slate-700/40" : "bg-slate-200 hover:bg-slate-300 text-indigo-700"
              }`}
              title="Toggle Theme"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Back button visible when active inside roles */}
            {role !== "none" && (
              <button
                id="disconnect-action"
                onClick={disconnectSession}
                className={`py-2 px-3.5 text-xs font-semibold rounded-xl hover:scale-103 transition active:scale-95 flex items-center gap-1.5 uppercase tracking-wider ${
                  theme === "dark" 
                    ? "bg-[#161D2F] hover:bg-slate-800 text-slate-200 border border-slate-700/60" 
                    : "bg-slate-200 hover:bg-slate-300 text-slate-700"
                }`}
              >
                Reset Connection
              </button>
            )}
          </div>
        </header>

        {/* Global Error Banner */}
        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl border flex items-start gap-3 bg-red-500/10 border-red-500/20 text-red-500">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold text-sm">Operation Alert</span>
              <p className="text-xs opacity-90">{errorMsg}</p>
            </div>
            <button 
              onClick={() => setErrorMsg("")} 
              className="text-xs font-mono font-bold px-2 py-1 rounded hover:bg-red-500/10"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Dynamic Workspace Switch */}
        <main className="flex-1 flex flex-col justify-center">
          
          {/* STEP 1: SELECT ROLE VIEW */}
          {role === "none" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-6 font-sans">
              
              {/* Card Broadcaster option */}
              <div 
                onClick={() => setRole("broadcaster")}
                className={`group cursor-pointer rounded-2xl p-6 border transition-all duration-300 hover:-translate-y-1 flex flex-col justify-between ${
                  theme === "dark" 
                    ? "bg-[#0E1321]/80 border-slate-800/80 hover:border-blue-500/30 hover:bg-[#161D2F]" 
                    : "bg-white border-slate-200 hover:border-slate-400 hover:shadow-sm"
                }`}
              >
                <div>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 transition-colors ${
                    theme === "dark" ? "bg-blue-950/50 text-blue-400 border border-slate-800" : "bg-slate-100 text-slate-950"
                  }`}>
                    <Mic className="w-6 h-6" />
                  </div>
                  <h2 className="text-xl font-bold mb-2 group-hover:text-blue-400 transition-colors tracking-tight text-[#E2E8F0]">
                    Broadcaster Suite
                  </h2>
                  <p className={`text-sm ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
                    Capture physical micro-microphone inputs or inject rich generic audio files directly into local Wi-Fi networks in high fidelity.
                  </p>
                </div>
                <div className="mt-8 flex items-center gap-2 text-xs font-mono font-bold tracking-wider">
                  <span className={theme === "dark" ? "text-blue-400" : "text-slate-900"}>
                    SETUP STREAM &gt;
                  </span>
                </div>
              </div>

              {/* Card Receiver Option */}
              <div 
                onClick={() => setRole("receiver")}
                className={`group cursor-pointer rounded-2xl p-6 border transition-all duration-300 hover:-translate-y-1 flex flex-col justify-between ${
                  theme === "dark" 
                    ? "bg-[#0E1321]/80 border-slate-800/80 hover:border-blue-500/30 hover:bg-[#161D2F]" 
                    : "bg-white border-slate-200 hover:border-slate-400 hover:shadow-sm"
                }`}
              >
                <div>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 transition-colors ${
                    theme === "dark" ? "bg-blue-950/50 text-blue-400 border border-slate-800" : "bg-slate-100 text-slate-950"
                  }`}>
                    <Wifi className="w-6 h-6" />
                  </div>
                  <h2 className="text-xl font-bold mb-2 group-hover:text-blue-400 transition-colors tracking-tight text-[#E2E8F0]">
                    Receiver Suite
                  </h2>
                  <p className={`text-sm ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
                    Synchronize from secondary laptops, PC screens, or tablet modules instantly up to 48kHz Opus streams with zero buffer lag.
                  </p>
                </div>
                <div className="mt-8 flex items-center gap-2 text-xs font-mono font-bold tracking-wider">
                  <span className={theme === "dark" ? "text-blue-400" : "text-slate-900"}>
                    TUNE IN ROOM &gt;
                  </span>
                </div>
              </div>

              {/* Informative footer helper */}
              <div className={`md:col-span-2 mt-4 p-4 rounded-xl border text-xs leading-relaxed flex items-start gap-2.5 ${
                theme === "dark" ? "bg-[#0E1321]/50 border-slate-800/80 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-500"
              }`}>
                <Info size={16} className="shrink-0 mt-0.5 text-blue-400" />
                <p>
                  <strong>How CastLink works:</strong> Connections utilize advanced local WebRTC routing (UDP). Audio avoids high server-routing latency and hops natively peer-to-peer (P2P) between your receiver screen and the broadcasting device instantly. For optimal high fidelity, keep devices on the same Wi-Fi router.
                </p>
              </div>

            </div>
          )}

          {/* STEP 2A: BROADCASTER PANEL */}
          {role === "broadcaster" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 py-4">
              
              {/* Controls Column */}
              <div className="lg:col-span-7 flex flex-col gap-6">
                
                 {/* Session Creation Widget */}
                 <div className="p-5 rounded-2xl border bg-[#0E1321]/80 border-slate-800/80 shadow-lg shadow-[#010308]/10 animate-fade-in">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs uppercase font-mono tracking-wider text-blue-400 font-bold">1. Broadcast Persona & Connection</span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                      sessionActive ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-slate-500/10 text-slate-400 border border-slate-800"
                    }`}>
                      {statusText}
                    </span>
                  </div>

                  {!sessionActive ? (
                    <div className="space-y-4">
                      {/* Name input */}
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400 block font-medium">Broadcaster Friendly Name:</label>
                        <input
                          id="device-name-input"
                          type="text"
                          value={deviceName}
                          onChange={(e) => setDeviceName(e.target.value)}
                          placeholder="e.g. My PC Station"
                          className="w-full p-2.5 rounded-xl border font-sans text-xs border-slate-800 text-[#E2E8F0] bg-slate-950/60 focus:border-blue-500/50 outline-none transition"
                        />
                      </div>

                      {/* Buffer Settings Selector */}
                      <div className="space-y-2">
                        <label className="text-xs text-slate-400 block font-medium">Transmission Buffer size:</label>
                        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-950/50 border border-slate-800/50">
                          <button
                            id="preset-small"
                            type="button"
                            onClick={() => updateBufferPreset("small")}
                            className={`py-1.5 px-2 rounded-lg text-[10px] font-bold transition flex flex-col items-center justify-center hover:cursor-pointer ${
                              bufferPreset === "small"
                                ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <span>SMALL</span>
                            <span className="opacity-70 font-sans text-[8px] font-normal">Lowest Delay</span>
                          </button>
                          <button
                            id="preset-medium"
                            type="button"
                            onClick={() => updateBufferPreset("medium")}
                            className={`py-1.5 px-2 rounded-lg text-[10px] font-bold transition flex flex-col items-center justify-center hover:cursor-pointer ${
                              bufferPreset === "medium"
                                ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <span>MEDIUM</span>
                            <span className="opacity-70 font-sans text-[8px] font-normal">Low Delay</span>
                          </button>
                          <button
                            id="preset-large"
                            type="button"
                            onClick={() => updateBufferPreset("large")}
                            className={`py-1.5 px-2 rounded-lg text-[10px] font-bold transition flex flex-col items-center justify-center hover:cursor-pointer ${
                              bufferPreset === "large"
                                ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <span>LARGE</span>
                            <span className="opacity-70 font-sans text-[8px] font-normal">Stable</span>
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-normal">
                          {bufferPreset === "small" && "⚡ Small (0ms): Lowest possible receiver buffer. Requires pristine Wi-Fi."}
                          {bufferPreset === "medium" && "⚖️ Medium (50ms): Low delay with some packet jitter tolerance."}
                          {bufferPreset === "large" && "🛡️ Large (150ms): More stable on busy Wi-Fi while still responsive."}
                        </p>
                      </div>

                      <button
                        id="create-stream-btn"
                        onClick={initializeBroadcaster}
                        className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition duration-150 flex items-center justify-center gap-2 shadow-blue-500/10 shadow-lg active:scale-[0.99] uppercase tracking-wider"
                      >
                        <Radio className="w-5 h-5 animate-pulse" />
                        Initialize Broadcast Canal
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4 animate-fade-in">
                      {/* Interactive metadata display */}
                      <div className="grid grid-cols-2 gap-2 text-xs font-mono p-3 rounded-xl bg-slate-950 border border-slate-800 font-bold">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-slate-505 uppercase text-[9px]">Broadcaster ID</span>
                          <span className="text-blue-400 truncate">{deviceName}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-slate-505 uppercase text-[9px]">Buffer Preset</span>
                          <span className="text-slate-205 capitalize">{bufferPreset}</span>
                        </div>
                      </div>

                      {receiverDeviceName && (
                        <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-xs flex items-center gap-2 animate-pulse font-mono font-bold">
                          <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                          <span>Connected Receivers ({receiverCount}): <span>{receiverDeviceName}</span></span>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <div className="flex-1 p-3 rounded-xl flex items-center justify-between border font-mono bg-slate-950 border-slate-800">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-505 uppercase tracking-wide">Pair Key:</span>
                            <span className="text-lg font-bold text-blue-400 tracking-widest">{sessionId}</span>
                          </div>
                          <button
                            id="copy-session-btn"
                            onClick={copySessionLink}
                            className="p-1.5 rounded-lg transition hover:bg-slate-900 text-slate-400 hover:text-white"
                            title="Copy Pairing Link"
                          >
                            {isCopied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-normal">
                        Scan the QR code below on your mobile device Native Camera or enter the 6-digit key manually on the Receiver tab.
                      </p>
                      {activePairingOrigin && (
                        <p className="text-[10px] font-mono text-slate-500 break-all">
                          Receiver URL: <span className="text-blue-400">{activePairingOrigin}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Broadcast Audio Source Card */}
                <div className="p-5 rounded-2xl border bg-[#0E1321]/80 border-slate-800/80 shadow-lg shadow-[#010308]/10">
                  <span className="text-xs uppercase font-mono tracking-wider text-blue-400 font-bold block mb-4">2. Sound Input Configuration</span>
                  
                  {/* Selector Tabs */}
                  <div className="grid grid-cols-3 gap-2 mb-4 p-1 rounded-xl bg-slate-950/50 border border-slate-800/50">
                    <button
                      id="source-mic-btn"
                      onClick={() => {
                        setAudioSource("microphone");
                        if (sessionActive) addLog("Switched inputs. Re-broadcast necessary to adopt live hardware inputs.");
                      }}
                      className={`py-2 px-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition ${
                        audioSource === "microphone"
                          ? "bg-[#161D2F] border border-slate-700 text-white"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <Mic size={14} /> Live Mic
                    </button>
                    <button
                      id="source-system-btn"
                      onClick={() => {
                        setAudioSource("system");
                        if (sessionActive) addLog("Switched inputs. Re-broadcast necessary to start system capture.");
                      }}
                      className={`py-2 px-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition ${
                        audioSource === "system"
                          ? "bg-[#161D2F] border border-slate-700 text-white"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <Monitor size={14} /> Desktop Audio
                    </button>
                    <button
                      id="source-file-btn"
                      onClick={() => {
                        setAudioSource("file");
                        if (sessionActive) addLog("Switched inputs. Ready for local generic file configuration.");
                      }}
                      className={`py-2 px-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition ${
                        audioSource === "file"
                          ? "bg-[#161D2F] border border-slate-700 text-white"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <Music size={14} /> Local File
                    </button>
                  </div>

                  {audioSource === "microphone" ? (
                    <div className="p-4 rounded-xl text-xs space-y-2 border bg-slate-950/50 border-slate-900/60 text-slate-400">
                      <p>
                        Streaming system microphone input directly. Broadcaster does not record your transmissions, offering private high-speed transit.
                      </p>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                        <span className="font-mono text-[10px] text-blue-400">Low-latency physical device echo-cancellation disabled for pure feed</span>
                      </div>
                    </div>
                  ) : audioSource === "system" ? (
                    <div className="p-4 rounded-xl text-xs space-y-2 border bg-slate-950/50 border-slate-900/60 text-slate-400">
                      <p>
                        Streams full desktop output when the browser supports monitor/system-audio capture.
                      </p>
                      <ul className="list-disc pl-3 space-y-1 font-sans text-slate-400">
                        <li>Choose <strong className="text-cyan-400">Entire Screen</strong>, not a browser tab or app window.</li>
                        <li>Enable the <strong className="text-cyan-400">&quot;Share system audio&quot;</strong> checkbox in the browser popup.</li>
                      </ul>
                      <div className="flex items-center gap-2 pt-1 border-t border-slate-900">
                        <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                        <span className="font-mono text-[10px] text-cyan-400">Captures software output directly without room acoustic echo</span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Drag & Drop zone */}
                      <div
                        id="drop-zone-broadcaster"
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        className={`pointer border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition ${
                          localFile
                            ? "border-blue-500/40 bg-blue-500/5"
                            : "border-slate-800 hover:border-slate-700 bg-slate-950/20"
                        }`}
                        onClick={() => document.getElementById("file-picker")?.click()}
                      >
                        <Music className={`w-8 h-8 mx-auto mb-2 opacity-60 ${localFile ? "text-blue-400" : ""}`} />
                        <span className="text-xs font-medium block">
                          {localFile ? localFile.name : "Drag & drop audio track here"}
                        </span>
                        <span className="text-[10px] block mt-1 text-slate-500">
                          Supports MP3, WAV, FLAC, M4A or click to browse
                        </span>
                        <input
                          id="file-picker"
                          type="file"
                          accept="audio/*"
                          onChange={handleFileChange}
                          className="hidden"
                        />
                      </div>

                      {localFile && (
                        <div className="flex items-center justify-between text-xs font-mono p-2 px-3 rounded-lg bg-slate-950/40 border border-slate-800">
                          <span className="truncate max-w-[180px]">{localFile.name}</span>
                          <span className="text-slate-500">{(localFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                        </div>
                      )}

                      {/* Local Monitor Checkbox */}
                      <div className="flex items-center justify-between p-1.5 px-3 rounded-xl border border-dashed text-xs border-slate-800 bg-slate-900/5">
                        <div className="flex flex-col">
                          <span className="font-medium">Local Monitor Feedback</span>
                          <span className="text-[10px] text-slate-500">
                            Hear the music stream playing locally on this broadcaster device
                          </span>
                        </div>
                        <input
                          id="local-monitor-checkbox"
                          type="checkbox"
                          checked={isLocalMonitor}
                          onChange={(e) => {
                            setIsLocalMonitor(e.target.checked);
                            addLog(`Local Monitor: ${e.target.checked ? "Enabled" : "Disabled"}`);
                          }}
                          className="h-4 w-4 accent-blue-500 bg-slate-900 border-slate-800"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Ultra High Fidelity Stream Parameters */}
                <div className="p-5 rounded-2xl border bg-[#0E1321]/80 border-slate-800/80 shadow-lg shadow-[#010308]/10">
                  <span className="text-xs uppercase font-mono tracking-wider text-blue-400 font-bold block mb-4">3. Opus Codec Optimization</span>
                  
                  <div className="space-y-4">
                    {/* Bitrate slider */}
                    <div>
                      <div className="flex justify-between text-xs font-mono mb-2">
                        <span className="text-slate-400">Audio Bitrate:</span>
                        <span className="text-blue-400 font-bold">{targetBitrate} kbps</span>
                      </div>
                        <input
                          id="bitrate-slider"
                          type="range"
                          min="48"
                          max="192"
                          step="16"
                        value={targetBitrate}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setTargetBitrate(val);
                          addLog(`Opus Target Bitrate: ${val} kbps`);
                        }}
                        className="w-full accent-blue-500 rounded-lg cursor-pointer h-1.5"
                      />
                    </div>

                    {/* Mode configurations toggles */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Channel Encoding:</span>
                      <div className="flex gap-2">
                        <button
                          id="mono-selector-btn"
                          onClick={() => {
                            setIsStereo(false);
                            addLog("Bitrate mapped to Mono audio stream");
                          }}
                          className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono font-medium transition ${
                            !isStereo 
                              ? "bg-[#161D2F] border-slate-600 text-white"
                              : "border-transparent opacity-60 hover:opacity-100"
                          }`}
                        >
                          Mono (voice optimized)
                        </button>
                        <button
                          id="stereo-selector-btn"
                          onClick={() => {
                            setIsStereo(true);
                            addLog("Bitrate mapped to Stereo audio stream");
                          }}
                          className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono font-medium transition ${
                            isStereo 
                              ? "bg-[#161D2F] border-slate-600 text-white"
                              : "border-transparent opacity-60 hover:opacity-100"
                          }`}
                        >
                          Stereo (48kHz High-Fidelity)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* Status and QR Code Column */}
              <div className="lg:col-span-5 flex flex-col gap-6">
                
                {/* Visual Connection Card / QR Scan */}
                {sessionActive && (
                  <div className="p-5 rounded-2xl border flex flex-col items-center justify-center text-center bg-[#0E1321]/80 border-slate-800/80 shadow-[#010308]/10 shadow-lg">
                    <span className="text-xs uppercase font-mono tracking-wider text-blue-400 font-bold block mb-4 self-start">4. Instant QR Pairing Node</span>
                    
                    {qrCodeUrl ? (
                      <div className="p-3 rounded-2xl border bg-slate-950 border-slate-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img 
                          id="qr-code-img"
                          src={qrCodeUrl} 
                          alt="Pairing QR Code" 
                          className="w-48 h-48 rounded"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : (
                      <div className="w-48 h-48 bg-slate-950 animate-pulse rounded-2xl border border-slate-800 flex items-center justify-center">
                        <QrCode className="w-8 h-8 text-slate-700 animate-spin" />
                      </div>
                    )}
                    
                    <p className="text-[11px] mt-4 leading-relaxed max-w-[240px] text-slate-400">
                      Aim tablet/phone camera at this frame. The URL will parse parameters and trigger stream play immediately.
                    </p>
                  </div>
                )}

                {/* Real-time diagnostics meter */}
                <div className="p-5 rounded-2xl border flex-1 mt-auto flex flex-col bg-[#0E1321]/80 border-slate-800/80 shadow-lg shadow-[#010308]/10">
                  <span className="text-xs uppercase font-mono tracking-wider text-blue-400 font-bold block mb-4">Diagnostics Console</span>
                  
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {/* Gauge 1: RTT latency */}
                    <div className="p-3 rounded-xl border flex flex-col justify-center font-mono bg-slate-955 border-slate-800/60 bg-slate-950">
                      <span className="text-[9px] text-slate-500 uppercase">RTT Network Delay</span>
                      <span className={`text-lg font-bold ${
                        latencyMs === null ? "text-slate-600" : latencyMs < 25 ? "text-blue-400" : "text-amber-400"
                      }`}>
                        {latencyMs === null ? "-- ms" : `${latencyMs} ms`}
                      </span>
                    </div>

                    {/* Gauge 2: Signal Bar indicators */}
                    <div className="p-3 rounded-xl border flex flex-col justify-center font-mono bg-slate-955 border-slate-800/60 bg-slate-950">
                      <span className="text-[9px] text-slate-500 uppercase">Connection Strength</span>
                      <span className="text-[12px] font-bold text-blue-400 flex items-center gap-1">
                        <Activity size={12} className="shrink-0" />
                        {signalStrength === "none" ? "Awaiting..." : signalStrength.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Visualizer Canvas box */}
                  <div className="mb-4">
                    <span className="text-[10px] text-slate-500 font-mono block mb-2">Live Waveform Monitor:</span>
                    <div 
                      id="wave-container-broadcaster"
                      ref={canvasContainerRef}
                      className="h-24 rounded-xl border flex items-center justify-center relative overflow-hidden bg-slate-950 border-slate-800"
                    >
                      <canvas 
                        id="canvas-visualizer-broadcaster"
                        ref={visualizerCanvasRef} 
                        className="absolute inset-0 w-full h-full"
                      />
                      {(!sessionActive || !isStreamActive) && (
                        <span className="text-[11px] text-slate-500 font-mono uppercase z-10">Stream Offline</span>
                      )}
                    </div>
                  </div>

                  {/* Scrollable logger output */}
                  <div className="flex-1 min-h-[100px] flex flex-col">
                    <span className="text-[10px] text-slate-500 font-mono block mb-1">Status logs:</span>
                    <div className="p-2.5 rounded-xl border text-[10px] font-mono leading-relaxed h-[110px] overflow-y-auto bg-slate-950 border-slate-800 text-slate-400">
                      {diagnosticsLogs.length === 0 ? (
                        <span className="opacity-50">Console idle... ready for pipeline parameters</span>
                      ) : (
                        diagnosticsLogs.map((logStr, i) => (
                          <div key={i} className="mb-1 truncate last:mb-0">
                            {logStr}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>

              </div>

            </div>
          )}

          {/* STEP 2B: RECEIVER VIEW PANEL */}
          {role === "receiver" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 py-4">
              
              {/* Connect interface */}
              <div className="lg:col-span-7 flex flex-col gap-6">
                
                {/* Pairing Connection Panel */}
                <div className={`p-5 rounded-2xl border transition-colors ${
                  theme === "dark" ? "bg-zinc-900/40 border-zinc-800" : "bg-white border-stone-200"
                }`}>
                  <span className="text-xs uppercase font-mono tracking-wider text-cyan-400 font-bold block mb-4">Pairing Identification</span>

                  {!sessionActive ? (
                    <div className="space-y-4">
                      {/* Name input */}
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400 block font-medium">Your Device Name:</label>
                        <input
                          id="receiver-name-input"
                          type="text"
                          value={deviceName}
                          onChange={(e) => setDeviceName(e.target.value)}
                          placeholder="e.g. My Phone"
                          className="w-full p-2.5 rounded-xl border font-sans text-xs border-slate-800 text-[#E2E8F0] bg-slate-950/60 focus:border-blue-500/50 outline-none transition"
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <label htmlFor="code-input" className="text-xs text-slate-400">
                          Enter the 6-digit Broadcaster code:
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="code-input"
                            type="text"
                            maxLength={6}
                            placeholder="e.g. 194825"
                            value={inputCode}
                            onChange={(e) => setInputCode(e.target.value.replace(/\D/g, ""))}
                            className="flex-1 p-3.5 px-4 rounded-xl font-mono text-center tracking-widest text-lg font-bold border transition duration-150 outline-none bg-slate-950 hover:bg-slate-900 focus:bg-slate-950 border-slate-800 focus:border-blue-500/50 text-[#E2E8F0]"
                          />
                        </div>
                      </div>

                      <button
                        id="tune-room-inner-btn"
                        onClick={() => initializeReceiver()}
                        className="w-full py-4 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition duration-150 flex items-center justify-center gap-2 shadow-blue-500/10 shadow-lg active:scale-[0.99] uppercase tracking-wider"
                      >
                        <Wifi className="w-5 h-5 animate-pulse" />
                        Tune into Feed Room
                      </button>

                      {/* WiFi Device Discovery lists */}
                      <div className="pt-4 border-t border-slate-800/60">
                        <div className="flex items-center justify-between mb-3 text-xs">
                          <span className="font-mono text-cyan-400 tracking-wide block font-bold">📡 DISCOVERED WI-FI BROADCASTERS</span>
                          <span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                            <RefreshCw className={`w-3 h-3 ${isScanning ? "animate-spin text-blue-400" : ""}`} />
                            {isScanning ? "Scanning..." : "Auto"}
                          </span>
                        </div>

                        <div className="space-y-2.5">
                          {discoveredSessions.filter(s => s.broadcasterActive).length === 0 ? (
                            <div className="p-4 rounded-xl border border-dashed border-slate-800/80 bg-slate-950/40 text-center space-y-1">
                              <span className="text-[11px] block text-slate-400 font-semibold">Searching same Wi-Fi network...</span>
                              <span className="text-[9px] block text-slate-500 leading-relaxed font-sans max-w-[280px] mx-auto font-sans">
                                Enable a &quot;Broadcaster Room&quot; on another browser or device sharing this network to connect instantly.
                              </span>
                            </div>
                          ) : (
                            discoveredSessions
                              .filter(s => s.broadcasterActive)
                              .sort((a, b) => (b.sameNetwork ? 1 : 0) - (a.sameNetwork ? 1 : 0))
                              .map((session) => (
                                <div
                                  key={session.id}
                                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs transition duration-150 ${
                                    session.sameNetwork
                                      ? "bg-blue-500/5 hover:bg-blue-500/10 border-blue-500/20"
                                      : "bg-slate-950/40 hover:bg-slate-950/60 border-slate-800/80"
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-semibold text-slate-200 truncate block text-[13px]">{session.broadcasterName}</span>
                                      {session.sameNetwork ? (
                                        <span className="px-1.5 py-0.5 rounded-full text-[8px] bg-green-500/10 border border-green-500/20 text-green-400 font-bold uppercase tracking-wider font-mono">
                                          Wi-Fi Subnet Match
                                        </span>
                                      ) : (
                                        <span className="px-1.5 py-0.5 rounded-full text-[8px] bg-slate-500/10 border border-slate-800 text-slate-400 font-bold uppercase tracking-wider font-mono">
                                          Global Network
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-slate-400">
                                      <span>Code: <strong className="text-blue-400 font-bold">{session.id}</strong></span>
                                      <span className="w-1 h-1 rounded-full bg-slate-700" />
                                      <span>Preset: <strong className="capitalize">{session.bufferSize}</strong></span>
                                      <span className="w-1 h-1 rounded-full bg-slate-700" />
                                      <span>Clients: <strong>{session.receiverCount || 0}</strong></span>
                                    </div>
                                  </div>

                                  <button
                                    id={`connect-discovery-${session.id}`}
                                    type="button"
                                    onClick={() => {
                                      setInputCode(session.id);
                                      initializeReceiver(session.id);
                                    }}
                                    className="py-1.5 px-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-[10px] uppercase rounded-lg transition hover:cursor-pointer"
                                  >
                                    Pair Stream
                                  </button>
                                </div>
                              ))
                          )}
                        </div>
                      </div>

                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="p-4 rounded-xl border flex items-center justify-between font-mono bg-slate-950 border-slate-800">
                        <span className="text-xs opacity-70">Room Pairing Standard:</span>
                        <span className="text-sm font-bold text-blue-400">{sessionId}</span>
                      </div>
                      <div className="p-3.5 rounded-xl border text-[11px] leading-relaxed bg-blue-950/10 border-blue-500/10 text-blue-400 font-mono">
                        P2P Signal Handshaking Handed Off. Monitoring diagnostics updates dynamically.
                      </div>
                      <button
                        id="receiver-disconnect-btn"
                        type="button"
                        onClick={disconnectSession}
                        className="w-full py-3 px-4 bg-red-500/10 hover:bg-red-500/15 text-red-300 border border-red-500/25 font-bold text-xs rounded-xl transition duration-150 flex items-center justify-center gap-2 active:scale-[0.99] uppercase tracking-wider"
                      >
                        <VolumeX className="w-4 h-4" />
                        Disconnect Receiver
                      </button>
                    </div>
                  )}
                </div>

                {/* Receiver Sound output controls */}
                <div className="p-5 rounded-2xl border bg-[#0E1321]/80 border-slate-800/80 shadow-lg shadow-[#010308]/10">
                  <span className="text-xs uppercase font-mono tracking-wider text-blue-400 font-bold block mb-4">Playback Parameters</span>
                  
                  <div className="space-y-5">
                    {/* Autoplay play click card */}
                    {sessionActive && !hasInteracted && (
                      <div className="p-3.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl space-y-3">
                        <div className="flex items-start gap-2 text-xs">
                          <AlertCircle className="w-4.5 h-4.5 mt-0.5 shrink-0" />
                          <p>
                            <strong>Autoplay compliance:</strong> To start playing incoming WebRTC live stereo streams, click the primary listen button.
                          </p>
                        </div>
                        <button
                          id="play-interaction-btn"
                          onClick={handleInteractionPlay}
                          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition duration-75 flex items-center justify-center gap-2"
                        >
                          <Play size={14} className="fill-white" /> Enable Audio Playback
                        </button>
                      </div>
                    )}

                    {/* Master Volume */}
                    <div>
                      <div className="flex justify-between items-center text-xs font-mono mb-2">
                        <span className="flex items-center gap-1">
                          {isMuted ? <VolumeX size={14} className="text-red-400" /> : <Volume2 size={14} />}
                          Volume level:
                        </span>
                        <span className="text-blue-400 font-semibold">{isMuted ? "0" : volume}%</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <input
                          id="volume-slider"
                          type="range"
                          min="0"
                          max="100"
                          value={volume}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            setVolume(val);
                            if (val > 0) setIsMuted(false);
                          }}
                          className="flex-1 accent-blue-500 rounded-lg cursor-pointer h-1.5"
                        />
                        <button
                          id="mute-action"
                          onClick={() => setIsMuted(!isMuted)}
                          className={`p-2.5 rounded-xl border text-[11px] font-mono font-medium transition shrink-0 ${
                            isMuted 
                              ? "bg-red-500/15 border-red-500/30 text-red-500 hover:bg-red-500/25" 
                              : "border-slate-800 opacity-60 hover:opacity-100 text-slate-300"
                          }`}
                        >
                          {isMuted ? "Muted" : "Mute Output"}
                        </button>
                      </div>
                    </div>

                    {/* Dynamic Buffer Selection */}
                    <div className="pt-4 border-t border-slate-800/60 font-sans">
                      <div className="flex justify-between items-center text-[11px] font-mono mb-2">
                        <span className="text-slate-400">Local Jitter Buffer tuning:</span>
                        <span className="text-cyan-400 font-bold capitalize">{bufferPreset}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-950/50 border border-slate-800/50 font-bold font-mono">
                        <button
                          id="rx-preset-small"
                          type="button"
                          onClick={() => updateBufferPreset("small")}
                          className={`py-1.5 px-2 rounded-lg text-[10px] font-bold transition flex flex-col items-center justify-center hover:cursor-pointer ${
                            bufferPreset === "small"
                              ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                              : "text-slate-400 hover:text-slate-205"
                          }`}
                        >
                          <span>SMALL</span>
                          <span className="opacity-70 font-sans text-[8px] font-normal">0ms target</span>
                        </button>
                        <button
                          id="rx-preset-medium"
                          type="button"
                          onClick={() => updateBufferPreset("medium")}
                          className={`py-1.5 px-2 rounded-lg text-[10px] font-bold transition flex flex-col items-center justify-center hover:cursor-pointer ${
                            bufferPreset === "medium"
                              ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                              : "text-slate-400 hover:text-slate-205"
                          }`}
                        >
                          <span>MEDIUM</span>
                          <span className="opacity-70 font-sans text-[8px] font-normal">50ms target</span>
                        </button>
                        <button
                          id="rx-preset-large"
                          type="button"
                          onClick={() => updateBufferPreset("large")}
                          className={`py-1.5 px-2 rounded-lg text-[10px] font-bold transition flex flex-col items-center justify-center hover:cursor-pointer ${
                            bufferPreset === "large"
                              ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                              : "text-slate-400 hover:text-slate-205"
                          }`}
                        >
                          <span>LARGE</span>
                          <span className="opacity-70 font-sans text-[8px] font-normal">150ms safe</span>
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2 leading-normal font-sans">
                        Preset changes sync live through the room, so broadcaster and receivers stay matched.
                      </p>
                    </div>
                  </div>
                </div>

              </div>

              {/* Status and visualizer receiver column */}
              <div className="lg:col-span-5 flex flex-col gap-6">
                
                {/* Diagnostics summary receiver */}
                <div className="p-5 rounded-2xl border flex-1 flex flex-col bg-[#0E1321]/80 border-slate-800/80 shadow-lg shadow-[#010308]/10">
                  <span className="text-xs uppercase font-mono tracking-wider text-blue-400 font-bold block mb-4">Diagnostics Terminal</span>
                  
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {/* Gauge 1: RTT latency */}
                    <div className="p-3 rounded-xl border flex flex-col justify-center font-mono bg-slate-950 border-slate-800">
                      <span className="text-[9px] text-slate-500 uppercase">Live Latency</span>
                      <span className={`text-lg font-bold ${
                        latencyMs === null ? "text-slate-600" : latencyMs < 25 ? "text-blue-400" : "text-amber-400"
                      }`}>
                        {latencyMs === null ? "-- ms" : `${latencyMs} ms`}
                      </span>
                    </div>

                    {/* Gauge 2: Signal bar elements */}
                    <div className="p-3 rounded-xl border flex flex-col justify-center font-mono bg-slate-950 border-slate-800">
                      <span className="text-[9px] text-slate-500 uppercase">Stream Connection</span>
                      <span className="text-[12px] font-bold text-blue-400 flex items-center gap-1 truncate">
                        <Sliders size={12} className="shrink-0 animate-pulse" />
                        {signalStrength === "none" ? "Scanning..." : signalStrength.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Wave Visualizer Box */}
                  <div className="mb-4">
                    <span className="text-[10px] text-slate-500 font-mono block mb-2">Incoming Frequency:</span>
                    <div 
                      id="wave-container-receiver"
                      ref={canvasContainerRef}
                      className="h-24 rounded-xl border flex items-center justify-center relative overflow-hidden bg-slate-950 border-slate-800"
                    >
                      <canvas 
                        id="canvas-visualizer-receiver"
                        ref={visualizerCanvasRef} 
                        className="absolute inset-0 w-full h-full"
                      />
                      {(!sessionActive || !hasInteracted) && (
                        <span className="text-[11px] text-slate-500 font-mono uppercase z-10">Stream Muted</span>
                      )}
                    </div>
                  </div>

                  {/* Status scrolling logger */}
                  <div className="flex-1 min-h-[100px] flex flex-col">
                    <span className="text-[10px] text-slate-500 font-mono block mb-1">Status logbook:</span>
                    <div className="p-2.5 rounded-xl border text-[10px] font-mono leading-relaxed h-[110px] overflow-y-auto bg-slate-950 border-slate-800 text-slate-400">
                      {diagnosticsLogs.length === 0 ? (
                        <span className="opacity-50">Console idle... awaiting handshakes</span>
                      ) : (
                        diagnosticsLogs.map((logStr, i) => (
                          <div key={i} className="mb-1 truncate last:mb-0">
                            {logStr}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>

              </div>

            </div>
          )}

        </main>

        {/* Dynamic decorative margin grid element to act as a sleek footer */}
        <footer className="mt-auto pt-6 text-center text-[10px] font-mono border-t border-slate-800 text-slate-500">
          <span>CastLink Live Audio Transit Protocols • Low Latency P2P WebRTC v3.2</span>
        </footer>

      </div>
    </div>
  );
}
