import { Button } from "@/components/ui/button.js";
import { api, callApi } from "@/lib/api-client.js";
import {
  generateTeamImage,
  type ShareTeamData,
} from "@/lib/fantasy/generate-team-image.js";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

type ApiShareData = Awaited<ReturnType<typeof fetchShareData>>;
type ApiSharePlayer = ApiShareData["players"][number];

function fetchShareData() {
  return callApi(api.GET("/api/fantasy/team/share"));
}

/**
 * Look up a player's photo URL from the people MDX data by fuzzy name match.
 * People MDX is loaded eagerly at build time, so we can import it synchronously.
 */
async function resolvePlayerPhotos(
  players: ApiSharePlayer[],
): Promise<Array<string | null>> {
  // Dynamic import to avoid pulling people data into the main bundle
  // for users who never click share. Both imports are independent — race them.
  const [{ getPersonBySlug }, peopleModule] = await Promise.all([
    import("@/lib/people.js"),
    import("../../lib/people.js"),
  ]);

  // Try to match each player by slugifying their name
  return players.map((player) => {
    const slug = player.playerName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .trim();

    const person = getPersonBySlug(slug);
    if (person?.photo) return person.photo;

    // Try without middle names / initials — just first + last
    const parts = player.playerName.split(" ");
    if (parts.length > 2) {
      const simpleSlug = `${parts[0]}-${parts[parts.length - 1]}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "");
      const simplePerson = peopleModule.getPersonBySlug(simpleSlug);
      if (simplePerson?.photo) return simplePerson.photo;
    }

    return null;
  });
}

export function ShareMyTeamButton() {
  const [shared, setShared] = useState(false);

  // Fire-and-forget: client-side image generation + share/download. No server
  // state changes, so there's nothing to invalidate.
  // eslint-disable-next-line react-doctor/query-mutation-missing-invalidation -- pure client-side image generation; no server state to invalidate
  const shareMutation = useMutation({
    mutationFn: async () => {
      const data = await fetchShareData();
      const photoUrls = await resolvePlayerPhotos(data.players);

      const shareData: ShareTeamData = {
        ...data,
        players: data.players.map((p, i) => ({
          ...p,
          photoUrl: photoUrls[i],
        })),
      };

      return generateTeamImage(shareData);
    },
    onSuccess: async (blob: Blob) => {
      const file = new File([blob], "my-fantasy-team.png", {
        type: "image/png",
      });

      // Try Web Share API (mobile)
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "My Fantasy Cricket Team",
          });
          setShared(true);
          setTimeout(() => setShared(false), 2000);
          return;
        } catch {
          // User cancelled or share failed — fall through to download
        }
      }

      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-fantasy-team.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => shareMutation.mutate()}
      disabled={shareMutation.isPending}
    >
      {shareMutation.isPending
        ? "Generating…"
        : shared
          ? "Done!"
          : "Share My Team"}
    </Button>
  );
}
