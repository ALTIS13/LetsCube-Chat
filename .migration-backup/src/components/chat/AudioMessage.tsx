"use client";

import { useState, useRef } from "react";
import { Play, Pause } from "lucide-react";

interface AudioMessageProps {
  url: string;
  duration?: number;
  isMe: boolean;
}

export function AudioMessage({ url, duration = 0, isMe }: AudioMessageProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play(); setPlaying(true); }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    setProgress((audio.currentTime / audio.duration) * 100);
    setCurrentTime(Math.floor(audio.currentTime));
  };

  const handleEnded = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2.5 min-w-[180px]">
      <audio ref={audioRef} src={url} onTimeUpdate={handleTimeUpdate} onEnded={handleEnded} />

      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:brightness-110"
        style={{ background: isMe ? "rgba(255,255,255,0.2)" : "var(--tg-accent)" }}
      >
        {playing
          ? <Pause size={16} style={{ color: "#fff" }} />
          : <Play size={16} style={{ color: "#fff" }} className="ml-0.5" />
        }
      </button>

      <div className="flex-1 flex flex-col gap-1">
        {/* Progress bar */}
        <div
          className="h-1 rounded-full cursor-pointer overflow-hidden"
          style={{ background: "rgba(255,255,255,0.2)" }}
          onClick={handleSeek}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${progress}%`, background: isMe ? "rgba(255,255,255,0.8)" : "var(--tg-accent)" }}
          />
        </div>
        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>
          {playing ? fmt(currentTime) : fmt(duration)}
        </span>
      </div>
    </div>
  );
}
