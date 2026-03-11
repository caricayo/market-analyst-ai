import type { Metadata } from "next";
import { notFound } from "next/navigation";
import StoryChapterShell from "@/components/story-chapter-shell";
import { getStory, getStorySection } from "@/lib/lumenweld";

export const dynamic = "force-static";
export const dynamicParams = false;

type PageProps = {
  params: {
    slug: string;
  };
};

export async function generateStaticParams() {
  const story = await getStory();
  return story.sections.slice(1).map((section) => ({ slug: section.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const story = await getStory();
  const section = story.sections.find((entry) => entry.slug === params.slug);

  if (!section) {
    return {};
  }

  return {
    title: `${section.kicker ?? "Chapter"} | ${section.title}`,
    description: `${story.title} chapter page for ${section.title}.`,
  };
}

export default async function ChapterPage({ params }: PageProps) {
  const story = await getStory();
  const section = await getStorySection(params.slug);

  if (!section || section.index === 0) {
    notFound();
  }

  return <StoryChapterShell section={section} story={story} />;
}
