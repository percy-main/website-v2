// organize-imports-ignore — React must stay: tsx/esbuild uses classic JSX transform for workspace deps
import React, { type FC } from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Text,
} from "@react-email/components";
import { email } from "../email.ts";
import * as styles from "../styles.ts";

interface Props {
  imageBaseUrl: string;
  reporterName: string;
  occurredAt: string;
  location: string;
  reportId: string;
}

const Component: FC<Props> = ({
  imageBaseUrl,
  reporterName,
  occurredAt,
  location,
  reportId,
}) => (
  <Html>
    <Head />
    <Preview>
      We&rsquo;ve received your accident / incident report at Percy Main
    </Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Img
          src={`${imageBaseUrl}/club_logo.png`}
          width="100"
          height="100"
          alt="Percy Main Club Logo"
          style={styles.logo}
        />
        <Text style={styles.paragraph}>Hi {reporterName},</Text>
        <Text style={styles.paragraph}>
          Thank you for letting us know. This email confirms that we&rsquo;ve
          received your report about an incident on {occurredAt} at {location}.
        </Text>
        <Text style={styles.paragraph}>
          Your report has been logged and will be reviewed by the club&rsquo;s
          trustees. If we need to follow up with you, we&rsquo;ll be in touch
          using the contact details you provided.
        </Text>
        <Text style={styles.paragraph}>
          If this was a medical emergency and you haven&rsquo;t already, please
          call 999.
        </Text>
        <Text style={styles.paragraph}>
          Your reference: <strong>{reportId}</strong>
        </Text>
        <Text style={styles.paragraph}>
          Best,
          <br />
          The Trustees
        </Text>
        <Hr style={styles.hr} />
        <Text style={styles.footer}>
          Percy Main Cricket Club, St. Johns Terrace, North Shields, NE29 6HS
        </Text>
      </Container>
    </Body>
  </Html>
);

export const IncidentReportConfirmation = email<Props>(
  "We've received your accident / incident report",
  {
    preview: {
      imageBaseUrl: "http://localhost:5173/images",
      reporterName: "Jane Smith",
      occurredAt: "24 April 2026 at 18:30",
      location: "Main pitch, Percy Main CSC",
      reportId: "abc-123",
    },
  },
)(Component);
