import StoryNavigation from "@/components/story-navigation";
import { getStory, renderInline } from "@/lib/lumenweld";

export const revalidate = false;

export default async function OverviewPage() {
  const story = await getStory();
  const section = story.sections[0];

  if (!section) {
    return null;
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
