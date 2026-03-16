export interface Email {
  to: string;
  subject: string;
  html: string;
}

export interface EmailConfig {
  provider: "dev" | "ses";
  sesRegion: string;
  fromAddress: string;
}
