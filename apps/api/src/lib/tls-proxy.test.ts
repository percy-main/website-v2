import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as connectTls } from "node:tls";
import { describe, expect, it, vi } from "vitest";
import { startTlsProxy } from "./tls-proxy.ts";

describe("startTlsProxy", () => {
  it("fails startup when ACM cannot provide a certificate", async () => {
    const failure = new Error("certificate unavailable");
    const logger = {
      info: vi.fn<(values: object, message: string) => void>(),
      error: vi.fn<(values: object, message: string) => void>(),
    };

    await expect(
      startTlsProxy({
        certificateArn: "arn:aws:acm:eu-west-2:123456789012:certificate/test",
        passphrase: "not-logged",
        port: 0,
        upstreamPort: 3000,
        logger,
        exportCertificate: vi.fn().mockRejectedValue(failure),
      }),
    ).rejects.toBe(failure);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("forwards TLS traffic and retains the valid context when refresh fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tls-proxy-"));
    const keyPath = join(directory, "key.pem");
    const certPath = join(directory, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-passout",
        "pass:test-passphrase",
      ],
      { stdio: "ignore" },
    );
    const bundle = {
      certificate: readFileSync(certPath, "utf8"),
      chain: readFileSync(certPath, "utf8"),
      privateKey: readFileSync(keyPath, "utf8"),
    };
    const upstream = createTcpServer((socket) => {
      socket.once("data", () =>
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"),
      );
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const upstreamPort = (upstream.address() as { port: number }).port;
    const logger = {
      info: vi.fn<(values: object, message: string) => void>(),
      error: vi.fn<(values: object, message: string) => void>(),
    };
    const load = vi
      .fn()
      .mockResolvedValueOnce(bundle)
      .mockRejectedValue(new Error("renewal unavailable"));
    const proxy = await startTlsProxy({
      certificateArn: "test",
      passphrase: "test-passphrase",
      port: 0,
      upstreamPort,
      logger,
      refreshIntervalMs: 10,
      exportCertificate: load,
    });
    const proxyPort = (proxy.address() as { port: number }).port;

    const request = () =>
      new Promise<string>((resolve, reject) => {
        const socket = connectTls(
          {
            host: "127.0.0.1",
            port: proxyPort,
            servername: "localhost",
            ca: bundle.certificate,
          },
          () => {
            socket.write(
              "GET /health/ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            );
          },
        );
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString();
        });
        socket.on("end", () => resolve(data));
        socket.on("error", reject);
      });
    expect(await request()).toContain("200 OK\r\nContent-Length: 2\r\n\r\nOK");
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    const [values, message] = logger.error.mock.calls[0] ?? [];
    expect(message).toBe("tls_certificate_refresh_failed");
    expect(values).toHaveProperty("err");
    expect(await request()).toContain("200 OK\r\nContent-Length: 2\r\n\r\nOK");

    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    rmSync(directory, { recursive: true });
  });
});
