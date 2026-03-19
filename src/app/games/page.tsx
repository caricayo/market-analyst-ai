import { GameLibrary } from "@/components/games/game-library";
import { ArforFrame } from "@/components/arfor-frame";

export default function GamesPage() {
  return (
    <ArforFrame
      activePath="/games"
      eyebrow="Arcade"
      title="Quick games, full-screen and ready to play."
      description="A compact library of browser-safe picks with clear controls, local progress, and focused play views that still fit the rest of the product."
    >
      <GameLibrary />
    </ArforFrame>
  );
}
