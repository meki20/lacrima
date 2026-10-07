import { currentProfile } from "./profile.ts";
import { profileSettings } from "./settings.ts";
import { visibleKinds } from "./kinds.ts";
import type { MediaKind } from "./media.ts";

/** Server only (reads the db): what a profile's category settings leave on screen. Never empty. */
export const visibleFor = (profileId: number): MediaKind[] =>
  visibleKinds(profileSettings(profileId).hidden_kinds);

export async function currentVisibleKinds(): Promise<MediaKind[]> {
  return visibleFor((await currentProfile()).id);
}
