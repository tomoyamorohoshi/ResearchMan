"use client";

import { useState } from "react";
import Image from "next/image";

type Props = {
  videoId: string;
  title: string;
};

export default function VideoPlayer({ videoId, title }: Props) {
  const [playing, setPlaying] = useState(false);
  const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return (
    <div className="relative aspect-video rounded-xl overflow-hidden mb-8 bg-black">
      {playing ? (
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
        />
      ) : (
        <>
          <Image
            src={thumb}
            alt={title}
            fill
            className="object-cover"
            priority
          />
          {/* 再生ボタン */}
          <button
            onClick={() => setPlaying(true)}
            aria-label="動画を再生"
            className="absolute inset-0 flex items-center justify-center group"
          >
            <div className="bg-black/60 group-hover:bg-red-600 transition-colors duration-200 rounded-full w-16 h-16 flex items-center justify-center shadow-lg">
              <svg
                className="w-7 h-7 text-white translate-x-0.5"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </button>
        </>
      )}
    </div>
  );
}
