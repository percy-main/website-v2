import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock the AWS SDK modules so the detector can be exercised without
// real AWS. `vi.mock` calls are hoisted; the inner factories run before the
// import below.
const sendRekognition = vi.fn();
const sendS3 = vi.fn();

vi.mock("@aws-sdk/client-rekognition", () => {
  class DetectFacesCommand {
    constructor(public input: unknown) {}
  }
  class RekognitionClient {
    send = sendRekognition;
  }
  return { DetectFacesCommand, RekognitionClient };
});

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    constructor(public input: unknown) {}
  }
  class GetObjectCommand {
    constructor(public input: unknown) {}
  }
  class S3Client {
    send = sendS3;
  }
  return { PutObjectCommand, GetObjectCommand, S3Client };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  // eslint-disable-next-line @typescript-eslint/require-await
  getSignedUrl: async () => "https://signed.example/crop.jpg",
}));

vi.mock("sharp", () => {
  // Minimal stub: metadata returns dims, extract().resize().jpeg().toBuffer
  // returns a fake buffer + info.
  const sharpInstance = {
    // eslint-disable-next-line @typescript-eslint/require-await
    metadata: async () => ({ width: 1024, height: 768 }),
    extract() {
      return this;
    },
    resize() {
      return this;
    },
    jpeg() {
      return this;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    toBuffer: async () => ({
      data: Buffer.from("fake-jpeg"),
      info: { width: 320, height: 240 },
    }),
  };
  // sharp() is callable; default export is a function returning the chain.
  const sharp = vi.fn(() => sharpInstance);
  return { default: sharp };
});

// Import AFTER the mocks so the detector picks up the stubbed clients.
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { S3Client } from "@aws-sdk/client-s3";
import { createFaceDetector } from "./face-detection.ts";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function fetchOk(): typeof fetch {
  // eslint-disable-next-line @typescript-eslint/require-await
  const fn = async () =>
    new Response(ONE_PIXEL_PNG, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(ONE_PIXEL_PNG.byteLength),
      },
    });
  return fn;
}

function makeDetector() {
  return createFaceDetector({
    rekognition: new RekognitionClient({}),
    s3: new S3Client({}),
    bucket: "test-bucket",
    prefix: "faces",
  });
}

beforeEach(() => {
  sendRekognition.mockReset();
  sendS3.mockReset();
  globalThis.fetch = fetchOk();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createFaceDetector", () => {
  it("returns crops when Rekognition + S3 succeed", async () => {
    sendRekognition.mockResolvedValueOnce({
      FaceDetails: [
        { BoundingBox: { Left: 0.1, Top: 0.1, Width: 0.2, Height: 0.2 } },
      ],
    });
    sendS3.mockResolvedValueOnce({});

    const detector = makeDetector();
    const crops = await detector.detectAndCrop("https://example/img.png");
    expect(crops).toHaveLength(1);
    expect(crops?.[0].url).toBe("https://signed.example/crop.jpg");
  });

  it("returns [] (definitive zero) when Rekognition runs but finds no faces", async () => {
    sendRekognition.mockResolvedValueOnce({ FaceDetails: [] });
    const detector = makeDetector();
    const crops = await detector.detectAndCrop("https://example/img.png");
    // Empty array means "we ran it, there really aren't faces" — caller drops.
    expect(crops).toEqual([]);
  });

  it("returns null (couldn't tell) when Rekognition errors transiently", async () => {
    sendRekognition.mockRejectedValueOnce(
      Object.assign(new Error("InternalServerError"), {
        name: "InternalServerError",
      }),
    );
    const detector = makeDetector();
    const crops = await detector.detectAndCrop("https://example/img.png");
    expect(crops).toBeNull();
  });

  it("latches off after a credentials error and short-circuits subsequent calls", async () => {
    sendRekognition.mockRejectedValueOnce(
      Object.assign(
        new Error("The security token included in the request is invalid."),
        {
          name: "UnrecognizedClientException",
        },
      ),
    );

    const detector = makeDetector();
    const first = await detector.detectAndCrop("https://example/img1.png");
    expect(first).toBeNull();
    // Rekognition was called once
    expect(sendRekognition).toHaveBeenCalledTimes(1);

    // Second call short-circuits — no further Rekognition / fetch / S3 calls.
    const second = await detector.detectAndCrop("https://example/img2.png");
    expect(second).toBeNull();
    expect(sendRekognition).toHaveBeenCalledTimes(1);
  });

  it("latches off on an S3 credentials error too", async () => {
    sendRekognition.mockResolvedValue({
      FaceDetails: [
        { BoundingBox: { Left: 0.1, Top: 0.1, Width: 0.2, Height: 0.2 } },
      ],
    });
    sendS3.mockRejectedValueOnce(
      Object.assign(new Error("token bad"), {
        name: "ExpiredTokenException",
      }),
    );

    const detector = makeDetector();
    const first = await detector.detectAndCrop("https://example/img1.png");
    // null (not []) — Rekognition saw a face but the upload failed, so we
    // can't surface it. Caller should not treat this as "definitively no
    // faces".
    expect(first).toBeNull();

    const second = await detector.detectAndCrop("https://example/img2.png");
    expect(second).toBeNull();
    // Short-circuited — Rekognition was NOT called the second time.
    expect(sendRekognition).toHaveBeenCalledTimes(1);
  });
});
