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
  recipientName: string;
  outcome: "approved" | "declined";
  memberFacingNote: string | null;
}

const Component: FC<Props> = ({
  imageBaseUrl,
  recipientName,
  outcome,
  memberFacingNote,
}) => (
  <Html>
    <Head />
    <Preview>An update on your request to Percy Main CC</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Img
          src={`${imageBaseUrl}/club_logo.png`}
          width="100"
          height="100"
          alt="Percy Main Club Logo"
          style={styles.logo}
        />
        <Text style={styles.paragraph}>Hi {recipientName},</Text>
        {outcome === "approved" ? (
          <Text style={styles.paragraph}>
            We&rsquo;ve reviewed your request and the committee is glad to offer
            support. The relevant fees will be taken care of by the club from
            our end &mdash; you don&rsquo;t need to do anything.
          </Text>
        ) : (
          <Text style={styles.paragraph}>
            Thank you for getting in touch. After review, the committee
            isn&rsquo;t able to support this request right now.
          </Text>
        )}
        {memberFacingNote ? (
          <Text style={styles.paragraph}>{memberFacingNote}</Text>
        ) : null}
        <Text style={styles.paragraph}>
          If your circumstances change, please get in touch &mdash; you can
          always reply to this email or contact the club directly.
        </Text>
        <Text style={styles.paragraph}>
          Best,
          <br />
          Percy Main CC
        </Text>
        <Hr style={styles.hr} />
        <Text style={styles.footer}>
          Percy Main Cricket Club, St. Johns Terrace, North Shields, NE29 6HS
        </Text>
      </Container>
    </Body>
  </Html>
);

export const FinancialReliefDecision = email<Props>(
  "An update on your request to Percy Main CC",
  {
    preview: {
      imageBaseUrl: "http://localhost:5173/images",
      recipientName: "Jane Smith",
      outcome: "approved",
      memberFacingNote: "Match donations for the 2026 season are waived.",
    },
  },
)(Component);
