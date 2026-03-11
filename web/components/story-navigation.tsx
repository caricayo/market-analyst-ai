import Link from "next/link";
import { getStoryHref, type StorySection } from "@/lib/lumenweld";

type StoryNavigationProps = {
  current: StorySection;
  sections: StorySection[];
  position: "top" | "bottom";
};

export default function StoryNavigation({
  current,
  sections,
  position,
}: StoryNavigationProps) {
  const previous = sections[current.index - 1] ?? null;
  const next = sections[current.index + 1] ?? null;

  return (
    <nav
      aria-label={`${position} story navigation`}
      className={`story-redirects ${position === "top" ? "story-redirects-top" : "story-redirects-bottom"}`}
    >
      <div className="story-redirects-rail">
        {sections.map((section) => {
          const isActive = section.slug === current.slug;

          return (
            <Link
              key={section.slug}
              href={getStoryHref(section)}
              className={`story-chip ${isActive ? "story-chip-active" : ""}`}
            >
              {section.kicker ?? section.title}
            </Link>
          );
        })}
      </div>

      <div className="story-pagination">
        {previous ? (
          <Link href={getStoryHref(previous)} className="story-page-link">
            Previous: {previous.kicker ?? previous.title}
          </Link>
        ) : (
          <span className="story-page-link story-page-link-muted">Beginning</span>
        )}

        {next ? (
          <Link href={getStoryHref(next)} className="story-page-link">
            Next: {next.kicker ?? next.title}
          </Link>
        ) : (
          <span className="story-page-link story-page-link-muted">End</span>
        )}
      </div>
    </nav>
  );
}
