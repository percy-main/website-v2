import { ACMClient, ExportCertificateCommand } from "@aws-sdk/client-acm";
import { connect } from "node:net";
import { createServer, type Server } from "node:tls";

interface Logger {
  info(values: object, message: string): void;
  error(values: object, message: string): void;
}

export interface TlsProxyOptions {
  certificateArn: string;
  passphrase: string;
  port: number;
  upstreamPort: number;
  logger: Logger;
  refreshIntervalMs?: number;
  exportCertificate?: () => Promise<{
    certificate: string;
    chain: string;
    privateKey: string;
  }>;
}

async function exportFromAcm(certificateArn: string, passphrase: string) {
  const response = await new ACMClient({}).send(
    new ExportCertificateCommand({
      CertificateArn: certificateArn,
      Passphrase: Buffer.from(passphrase),
    }),
  );
  if (
    !response.Certificate ||
    !response.CertificateChain ||
    !response.PrivateKey
  ) {
    throw new Error("ACM returned an incomplete TLS certificate bundle");
  }
  return {
    certificate: response.Certificate,
    chain: response.CertificateChain,
    privateKey: response.PrivateKey,
  };
}

export async function startTlsProxy(options: TlsProxyOptions): Promise<Server> {
  const load =
    options.exportCertificate ??
    (() => exportFromAcm(options.certificateArn, options.passphrase));
  const initial = await load();
  const context = {
    cert: `${initial.certificate}\n${initial.chain}`,
    key: initial.privateKey,
    passphrase: options.passphrase,
  };
  const server = createServer(context, (downstream) => {
    const upstream = connect(options.upstreamPort, "127.0.0.1");
    downstream.pipe(upstream);
    upstream.pipe(downstream);
    upstream.on("error", () => downstream.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const timer = setInterval(
    () => {
      void (async () => {
        try {
          const renewed = await load();
          server.setSecureContext({
            cert: `${renewed.certificate}\n${renewed.chain}`,
            key: renewed.privateKey,
            passphrase: options.passphrase,
          });
          options.logger.info(
            { port: options.port },
            "tls_certificate_refreshed",
          );
        } catch (err) {
          // Keep serving with the last valid context. Never log certificate material.
          options.logger.error({ err }, "tls_certificate_refresh_failed");
        }
      })();
    },
    options.refreshIntervalMs ?? 24 * 60 * 60 * 1000,
  );
  timer.unref();
  server.once("close", () => clearInterval(timer));
  options.logger.info({ port: options.port }, "tls_proxy_listening");
  return server;
}
