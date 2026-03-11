import fs from "node:fs/promises";
import path from "node:path";
import { parseStory, renderInline } from "@/lib/lumenweld";

export const revalidate = false;

export default async function OverviewPage() {
  const sourcePath = path.join(process.cwd(), "content", "lumenweld-novel-expanded.md");
  const raw = await fs.readFile(sourcePath, "utf8");
  const story = parseStory(raw);

  return (
    <main className="story-page">
      <div className="story-shell">
        <section className="story-hero">
          <div className="story-hero-grid">
            <div>
              <p className="story-kicker">Lumenweld Chronicle</p>
              <h1 className="story-title">{story.title}</h1>
              <p className="story-subtitle">{story.subtitle}</p>
              <p className="story-dek">
                The current site has been replaced with the full Lumenweld story,
                restyled around the visual language of the source HTML: gold-lit
                typography, aurora gradients, and a long-form reading layout.
              </p>
              <nav className="story-nav" aria-label="Story sections">
                {story.sections.map((section) => (
                  <a key={section.slug} href={`#${section.slug}`}>
                    {section.kicker ?? section.title}
                  </a>
                ))}
              </nav>
            </div>

            <aside className="story-panel">
              <p className="story-panel-label">Reading Ledger</p>
              <div className="story-panel-stat">
                <span>Sections</span>
                <strong>{story.sections.length}</strong>
              </div>
              <div className="story-panel-stat">
                <span>Word Count</span>
                <strong>{story.wordCount.toLocaleString("en-US")}</strong>
              </div>
              <div className="story-panel-stat">
                <span>Source</span>
                <strong>Expanded manuscript</strong>
              </div>
            </aside>
          </div>
        </section>

        <div className="story-sections">
          {story.sections.map((section) => (
            <section className="story-section" id={section.slug} key={section.slug}>
              <header className="chapter-marker">
                {section.kicker ? (
                  <span className="chapter-kicker">{section.kicker}</span>
                ) : null}
                <h2 className="chapter-title">{section.title}</h2>
                <div className="chapter-rule" aria-hidden="true">
                  <span />
                  <i>{"\u2726"}</i>
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
          ))}
        </div>

        <footer className="story-footer">
          <p>arfor.app now serves the Lumenweld story experience.</p>
          <p>
            The previous trading dashboard state is preserved in git archive tag{" "}
            <code>archive/pre-lumenweld-story-20260311</code>.
          </p>
        </footer>
      </div>
    </main>
  );
}
