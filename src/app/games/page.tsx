import { GameLibrary } from "@/components/games/game-library";
import { ArforFrame } from "@/components/arfor-frame";

export default function GamesPage() {
  return (
    <ArforFrame
      activePath="/games"
      eyebrow="Game Room"
      title="A real launcher, not a decorative games tab."
      description="The shelf is now narrowed to MIT-safe browser games that can actually be played across devices, with a clean launch flow and on-screen controls."
    >
      <GameLibrary />
    </ArforFrame>
  );
}
