"use client";

import { useEffect, useState } from "react";

export default function StoryParallax() {
  const [offset, setOffset] = useState({ x: 0, y: 0, scroll: 0 });

  useEffect(() => {
    const handlePointer = (event: PointerEvent) => {
      const x = (event.clientX / window.innerWidth - 0.5) * 24;
      const y = (event.clientY / window.innerHeight - 0.5) * 24;
      setOffset((current) => ({ ...current, x, y }));
    };

    const handleScroll = () => {
      setOffset((current) => ({ ...current, scroll: window.scrollY }));
    };

    handleScroll();
    window.addEventListener("pointermove", handlePointer);
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("pointermove", handlePointer);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div aria-hidden="true" className="parallax-scene">
      <div
        className="parallax-orb orb-a"
        style={{
          transform: `translate3d(${offset.x * -0.6}px, ${offset.scroll * 0.06 + offset.y * -0.3}px, 0)`,
        }}
      />
      <div
        className="parallax-orb orb-b"
        style={{
          transform: `translate3d(${offset.x * 0.45}px, ${offset.scroll * 0.1 + offset.y * 0.35}px, 0)`,
        }}
      />
      <div
        className="parallax-orb orb-c"
        style={{
          transform: `translate3d(${offset.x * -0.25}px, ${offset.scroll * 0.13 + offset.y * 0.2}px, 0)`,
        }}
      />
      <div
        className="parallax-grid"
        style={{
          transform: `translate3d(${offset.x * 0.15}px, ${offset.scroll * 0.04}px, 0)`,
        }}
      />
      <div
        className="parallax-stars"
        style={{
          transform: `translate3d(${offset.x * -0.12}px, ${offset.scroll * 0.02}px, 0)`,
        }}
      />
    </div>
  );
}
