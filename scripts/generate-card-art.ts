import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import OpenAI from "openai";
import { PNG } from "pngjs";

dotenv.config();

type Card = { id: string; title: string; flavor: string; tags: string[] };

const root = process.cwd();
const cardsPath = path.join(root, "src", "content", "packs", "cards.json");
const outDir = path.join(root, "public", "assets", "cards");

const promptTemplate =
  "pixel art oil-painting fantasy environment card, tarot framing, moody lighting, heavy shadows, painterly texture but pixelated, cinematic composition, 1:1 square, no text, no watermark";

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writePlaceholder(card: Card): void {
  const filePath = path.join(outDir, `${card.id}.png`);
  const size = 512;
  const png = new PNG({ width: size, height: size });

  const hash = Array.from(card.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const hue = hash % 255;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (size * y + x) << 2;
      const gradient = Math.floor((x + y) / 4) % 80;
      png.data[idx] = Math.max(0, Math.min(255, hue + gradient - 20));
      png.data[idx + 1] = Math.max(0, Math.min(255, 90 + gradient));
      png.data[idx + 2] = Math.max(0, Math.min(255, 120 + gradient));
      png.data[idx + 3] = 255;

      if (x < 16 || y < 16 || x > size - 17 || y > size - 17) {
        png.data[idx] = 24;
        png.data[idx + 1] = 18;
        png.data[idx + 2] = 16;
      }
    }
  }

  fs.writeFileSync(filePath, PNG.sync.write(png));
}

async function writeWithOpenAI(client: OpenAI, card: Card): Promise<void> {
  const prompt = `${promptTemplate}. Scene: ${card.title}. Flavor: ${card.flavor}. Tags: ${card.tags.join(", ")}.`;

  const response = await client.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(`No image data returned for ${card.id}`);
  }

  const filePath = path.join(outDir, `${card.id}.png`);
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
}

async function main(): Promise<void> {
  ensureDir(outDir);
  const cards = JSON.parse(fs.readFileSync(cardsPath, "utf8")) as Card[];
  const key = process.env.OPENAI_API_KEY;

  const client = key ? new OpenAI({ apiKey: key }) : null;

  for (const card of cards) {
    const filePath = path.join(outDir, `${card.id}.png`);
    if (fs.existsSync(filePath)) {
      continue;
    }

    if (!client) {
      writePlaceholder(card);
      console.log(`placeholder generated: ${card.id}`);
      continue;
    }

    try {
      await writeWithOpenAI(client, card);
      console.log(`openai generated: ${card.id}`);
    } catch (error) {
      console.warn(`openai generation failed for ${card.id}, using placeholder`, error);
      writePlaceholder(card);
    }
  }

  const placeholderPath = path.join(outDir, "placeholder.png");
  if (!fs.existsSync(placeholderPath)) {
    writePlaceholder({ id: "placeholder", title: "Unknown Site", flavor: "Fallback image", tags: ["fallback"] });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

