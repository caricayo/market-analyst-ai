import type { ReactNode } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { cache } from "react";

export type StorySection = {
  index: number;
  kicker: string | null;
  title: string;
  slug: string;
  paragraphs: string[];
};

function repairText(value: string) {
  let repaired = value;

  for (let pass = 0; pass < 2; pass += 1) {
    if (!/[\u00c3\u00e2\u00c2]/.test(repaired)) {
      break;
    }

    repaired = Buffer.from(repaired, "latin1").toString("utf8");
  }

  return repaired;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitHeading(value: string) {
  const match = value.match(/^(Prologue|Epilogue|Chapter\s+\d+):\s*(.+)$/i);
  if (!match) {
    return {
      kicker: null,
      title: value.trim(),
    };
  }

  return {
    kicker: match[1].trim(),
    title: match[2].trim(),
  };
}

export function parseStory(raw: string) {
  const normalized = repairText(raw).replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  let title = "The Last Lumenweaver";
  let subtitle = "A Novel of Lumenweld";
  let currentHeading: string | null = null;
  let currentParagraph: string[] = [];
  let currentParagraphs: string[] = [];
  const sections: StorySection[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length === 0) {
      return;
    }

    currentParagraphs.push(currentParagraph.join(" ").trim());
    currentParagraph = [];
  };

  const flushSection = () => {
    if (!currentHeading || currentParagraphs.length === 0) {
      currentParagraphs = [];
      return;
    }

    const heading = splitHeading(currentHeading);
    sections.push({
      index: sections.length,
      ...heading,
      slug: slugify(currentHeading),
      paragraphs: currentParagraphs,
    });
    currentParagraphs = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("# ") && title === "The Last Lumenweaver") {
      title = trimmed.slice(2).trim();
      continue;
    }

    if (trimmed.startsWith("### ") && subtitle === "A Novel of Lumenweld") {
      subtitle = trimmed.slice(4).trim();
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushSection();
      currentHeading = trimmed.slice(3).trim();
      continue;
    }

    if (trimmed === "---") {
      flushParagraph();
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    currentParagraph.push(trimmed);
  }

  flushParagraph();
  flushSection();

  return {
    title,
    subtitle,
    sections,
    wordCount: normalized.split(/\s+/).filter(Boolean).length,
  };
}

export const getStory = cache(async () => {
  const sourcePath = path.join(process.cwd(), "content", "lumenweld-novel-expanded.md");
  const raw = await fs.readFile(sourcePath, "utf8");
  return parseStory(raw);
});

export async function getStorySection(slug: string) {
  const story = await getStory();
  return story.sections.find((section) => section.slug === slug) ?? null;
}

export function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);

  return parts.map((part, index): ReactNode => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={`${part}-${index}`}>{part.slice(1, -1)}</em>;
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}
