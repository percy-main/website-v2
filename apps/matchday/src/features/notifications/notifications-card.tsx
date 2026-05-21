import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  usePushState,
} from "./use-push.js";

type Prefs = ApiResponse<"/api/me/notification-preferences">;
type Channel = Prefs["matchdayChannel"];

const CHANNELS: Array<{ value: Channel; label: string; hint: string }> = [
  { value: "email", label: "Email", hint: "Default — what you've always had." },
  {
    value: "push",
    label: "Push",
    hint: "Phone or desktop alert via this app.",
  },
  { value: "both", label: "Both", hint: "Send by email and push." },
];

export function NotificationsCard() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: prefs, isLoading } = useQuery({
    queryKey: ["me", "notification-preferences"],
    queryFn: () => callApi(api.GET("/api/me/notification-preferences")),
  });

  const updatePrefs = useMutation({
    mutationFn: (matchdayChannel: Channel) =>
      callApi(
        api.PUT("/api/me/notification-preferences", {
          body: { matchdayChannel },
        }),
      ),
    onSuccess: (next) => {
      qc.setQueryData(["me", "notification-preferences"], next);
    },
  });

  const { state: pushState, refresh: refreshPushState } = usePushState();

  const enablePush = useMutation({
    mutationFn: enablePushOnThisDevice,
    onSuccess: () => {
      setError(null);
      void refreshPushState();
    },
    onError: (err: Error) => setError(err.message),
  });

  const disablePush = useMutation({
    mutationFn: disablePushOnThisDevice,
    onSuccess: () => {
      setError(null);
      void refreshPushState();
    },
    onError: (err: Error) => setError(err.message),
  });

  const channel = prefs?.matchdayChannel ?? "email";

  return (
    <Card>
      <CardHeader>
        <CardEyebrow>Notifications</CardEyebrow>
        <CardTitle>Matchday alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-text-secondary text-sm">
          How would you like to be told about new availability requests and
          other matchday updates?
        </p>

        <fieldset
          className="space-y-2"
          disabled={isLoading || updatePrefs.isPending}
        >
          {CHANNELS.map((opt) => {
            const selected = channel === opt.value;
            return (
              <label
                key={opt.value}
                className={
                  "border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors " +
                  (selected
                    ? "bg-navy/5 border-navy"
                    : "hover:bg-surface-raised")
                }
              >
                <input
                  type="radio"
                  name="matchday-channel"
                  value={opt.value}
                  checked={selected}
                  onChange={() => updatePrefs.mutate(opt.value)}
                  className="mt-0.5"
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{opt.label}</span>
                  <span className="text-text-secondary block text-xs">
                    {opt.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="border-border space-y-2 border-t pt-4">
          <div className="text-sm font-medium">Push on this device</div>
          <PushStatus
            pushState={pushState}
            onEnable={() => enablePush.mutate()}
            onDisable={() => disablePush.mutate()}
            busy={enablePush.isPending || disablePush.isPending}
          />
          {error && <p className="text-danger text-xs">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function PushStatus({
  pushState,
  onEnable,
  onDisable,
  busy,
}: {
  pushState: ReturnType<typeof usePushState>["state"];
  onEnable: () => void;
  onDisable: () => void;
  busy: boolean;
}) {
  if (!pushState.support.supported) {
    return (
      <p className="text-text-secondary text-xs">
        Push isn't supported on this browser. On iOS, add Matchday to your home
        screen first.
      </p>
    );
  }
  if (pushState.support.permission === "denied") {
    return (
      <p className="text-text-secondary text-xs">
        Notifications are blocked for this site. Re-enable them in the browser
        site settings, then come back here to subscribe.
      </p>
    );
  }
  if (pushState.subscribed === null) {
    return <p className="text-text-secondary text-xs">Checking…</p>;
  }
  if (pushState.subscribed) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-text-secondary text-xs">
          This device will receive matchday push.
        </p>
        <Button size="sm" tone="outline" onClick={onDisable} disabled={busy}>
          Disable
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-text-secondary text-xs">
        Not subscribed on this device yet.
      </p>
      <Button size="sm" onClick={onEnable} disabled={busy}>
        Enable
      </Button>
    </div>
  );
}
