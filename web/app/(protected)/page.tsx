import { redirect } from "next/navigation";
import { getStory } from "@/lib/lumenweld";

export const revalidate = false;

export default async function OverviewPage() {
  const story = await getStory();
  redirect(`/chapter/${story.sections[0]?.slug ?? ""}`);
}
