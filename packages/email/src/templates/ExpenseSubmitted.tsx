// organize-imports-ignore — React must stay: tsx/esbuild uses classic JSX transform for workspace deps
import React, { type FC } from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from "react-email";
import { email } from "../email.ts";
import * as styles from "../styles.ts";

interface Props {
  imageBaseUrl: string;
  claimantName: string;
  amountPence: number;
  description: string;
  secondApproval: boolean;
  reviewUrl: string;
}

const formatGbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const Component: FC<Props> = ({
  imageBaseUrl,
  claimantName,
  amountPence,
  description,
  secondApproval,
  reviewUrl,
}) => (
  <Html>
    <Head />
    <Preview>An expense claim needs your review</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Img
          src={`${imageBaseUrl}/club_logo.png`}
          width="100"
          height="100"
          alt="Percy Main Club Logo"
          style={styles.logo}
        />
        <Text style={styles.paragraph}>Hi,</Text>
        {secondApproval ? (
          <Text style={styles.paragraph}>
            An expense claim of {formatGbp(amountPence)} from {claimantName} has
            its first approval and needs a second approver before it can be paid.
          </Text>
        ) : (
          <Text style={styles.paragraph}>
            {claimantName} has submitted an expense claim of{" "}
            {formatGbp(amountPence)} for review.
          </Text>
        )}
        {description ? (
          <Text style={styles.paragraph}>&ldquo;{description}&rdquo;</Text>
        ) : null}
        <Text style={styles.paragraph}>
          <Link href={reviewUrl}>Review it in the admin area</Link>.
        </Text>
        <Text style={styles.paragraph}>
          Thanks,
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

export const ExpenseSubmitted = email<Props>(
  "An expense claim needs your review",
  {
    preview: {
      imageBaseUrl: "http://localhost:5173/images",
      claimantName: "Jane Smith",
      amountPence: 2350,
      description: "Petrol to the away fixture at Tynemouth",
      secondApproval: false,
      reviewUrl: "http://localhost:5173/admin?section=finance&tab=expenses",
    },
  },
)(Component);

export default Component;
