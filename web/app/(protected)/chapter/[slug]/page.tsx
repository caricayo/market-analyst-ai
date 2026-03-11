import type { Metadata } from "next";
import { notFound } from "next/navigation";
import StoryNavigation from "@/components/story-navigation";
import { getStory, getStorySection, renderInline } from "@/lib/lumenweld";

export const revalidate = false;

type PageProps = {
  params: { slug: string };
};

export async function generateStaticParams() {
  const story = await getStory();
  return story.sections.map((section) => ({ slug: section.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const story = await getStory();
  const section = story.sections.find((entry) => entry.slug === params.slug);

  if (!section) {
    return {};
  }

  return {
    title: `${section.kicker ?? "Story"} | ${section.title}`,
    description: `${story.title} chapter page for ${section.title}.`,
  };
}

export default async function StoryChapterPage({ params }: PageProps) {
  const story = await getStory();
  const section = await getStorySection(params.slug);

  if (!section) {
    notFound();
  }

  return (
    <main className="story-page">
      <div className="story-shell story-shell-chapter">
        <StoryNavigation current={section} sections={story.sections} position="top" />

        <section className="story-section story-section-chapter">
          <header className="chapter-marker">
            {section.kicker ? (
              <span className="chapter-kicker">{section.kicker}</span>
            ) : null}
            <h1 className="chapter-title">{section.title}</h1>
            <div className="chapter-rule" aria-hidden="true">
              <span />
              <i>*</i>
              <span />
            </div>
          </header>

          <div className="story-copy">
            {section.paragraphs.map((paragraph, index) => (
              <p className="story-paragraph" key={`${section.slug}-${index}`}>
                {renderInline(paragraph)}
              </p>
            ))}
          </div>
        </section>

        <StoryNavigation current={section} sections={story.sections} position="bottom" />
      </div>
    </main>
  );
}
