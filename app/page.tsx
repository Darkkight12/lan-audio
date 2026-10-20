"use client";

import dynamic from "next/dynamic";

// Lazy-load the client-only Low-Latency Audio Suite to ensure zero SSR compilation errors
const AudioSuite = dynamic(() => import("@/components/audio-suite"), {
  ssr: false,
});

export default function Home() {
  return <AudioSuite />;
}
