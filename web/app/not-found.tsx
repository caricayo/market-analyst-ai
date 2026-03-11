import Link from "next/link";

export default function NotFound() {
  return (
    <main className="story-page">
      <div className="story-shell story-shell-chapter">
        <section className="story-section story-section-chapter story-empty-state">
          <span className="chapter-kicker">Lost Thread</span>
          <h1 className="chapter-title">This page does not exist.</h1>
          <div className="chapter-rule" aria-hidden="true">
            <span />
            <i>*</i>
            <span />
          </div>
          <p className="story-paragraph">
            Return to the opening chapter to continue the story.
          </p>
          <div className="story-empty-actions">
            <Link href="/" className="story-page-link">
              Back to the Prologue
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
