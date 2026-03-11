import StoryChapterShell from "@/components/story-chapter-shell";
import { getStory } from "@/lib/lumenweld";

export const dynamic = "force-static";

export default async function HomePage() {
  const story = await getStory();
  const section = story.sections[0];

  if (!section) {
    return null;
  }

  return <StoryChapterShell section={section} story={story} />;
}
