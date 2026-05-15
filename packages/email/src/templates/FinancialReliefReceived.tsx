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
} from "react-email";
import { email } from "../email.ts";
import * as styles from "../styles.ts";

interface Props {
  imageBaseUrl: string;
  recipientName: string;
}

const Component: FC<Props> = ({ imageBaseUrl, recipientName }) => (
  <Html>
    <Head />
    <Preview>We&rsquo;ve received your request to Percy Main CC</Preview>
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
        <Text style={styles.paragraph}>
          Thank you for getting in touch. We&rsquo;ve received your request and
          a committee member will review it shortly. We&rsquo;ll be in touch
          when there&rsquo;s news.
        </Text>
        <Text style={styles.paragraph}>
          If anything changes in the meantime, just reply to this email or
          contact the club.
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

// Email subject is intentionally vague — "financial relief" never appears
// in the subject line so an inbox preview never outs the member.
export const FinancialReliefReceived = email<Props>(
  "Your request to Percy Main CC",
  {
    preview: {
      imageBaseUrl: "http://localhost:5173/images",
      recipientName: "Jane Smith",
    },
  },
)(Component);

export default Component;
