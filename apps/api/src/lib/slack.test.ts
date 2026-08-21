import { afterEach, describe, expect, it, vi } from "vitest";
import { createSlackNotifier, SlackWebhookError } from "./slack.ts";

describe("createSlackNotifier", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(response: Response) {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts the text as a JSON webhook payload", async () => {
    const fetchMock = stubFetch(new Response("ok", { status: 200 }));

    const sent = await createSlackNotifier("https://hooks.slack.test/XYZ")(
      "hello",
    );

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.test/XYZ");
    expect(init?.method).toBe("POST");
    const body = init?.body;
    if (typeof body !== "string") throw new Error("expected a string body");
    const parsed: unknown = JSON.parse(body);
    expect(parsed).toEqual({ text: "hello" });
  });

  it("reports false without calling fetch when no webhook is configured", async () => {
    const fetchMock = stubFetch(new Response("ok", { status: 200 }));

    const sent = await createSlackNotifier()("hello");

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a rejected webhook rather than reporting success", async () => {
    // A revoked webhook or deleted channel answers 404, which fetch resolves
    // happily. Silently accepting that would defeat the point of alerting.
    stubFetch(new Response("no_service", { status: 404 }));

    await expect(
      createSlackNotifier("https://hooks.slack.test/XYZ")("hello"),
    ).rejects.toThrow(SlackWebhookError);
  });

  it("carries the status and body on the thrown error", async () => {
    stubFetch(new Response("channel_not_found", { status: 400 }));

    const err = await createSlackNotifier("https://hooks.slack.test/XYZ")(
      "hello",
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SlackWebhookError);
    expect((err as SlackWebhookError).status).toBe(400);
    expect((err as SlackWebhookError).bodyPreview).toBe("channel_not_found");
  });
});
