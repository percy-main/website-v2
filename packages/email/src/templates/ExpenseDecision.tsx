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
  outcome: "approved" | "denied" | "paid";
  note: string | null;
  amountPence: number;
}

const formatGbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const Component: FC<Props> = ({
  imageBaseUrl,
  recipientName,
  outcome,
  note,
  amountPence,
}) => (
  <Html>
    <Head />
    <Preview>An update on your expense claim</Preview>
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
            Your expense claim for {formatGbp(amountPence)} has been approved.
            We will arrange your reimbursement shortly.
          </Text>
        ) : outcome === "paid" ? (
          <Text style={styles.paragraph}>
            Your expense claim for {formatGbp(amountPence)} has been paid. The
            money is on its way to your bank account.
          </Text>
        ) : (
          <Text style={styles.paragraph}>
            Thank you for submitting your expense claim for{" "}
            {formatGbp(amountPence)}. After review it has not been approved on
            this occasion.
          </Text>
        )}
        {note ? <Text style={styles.paragraph}>{note}</Text> : null}
        <Text style={styles.paragraph}>
          If you have any questions, please reply to this email or contact the
          club directly.
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

export const ExpenseDecision = email<Props>(
  "An update on your expense claim",
  {
    preview: {
      imageBaseUrl: "http://localhost:5173/images",
      recipientName: "Jane Smith",
      outcome: "approved",
      note: "Approved under the travel budget.",
      amountPence: 2350,
    },
  },
)(Component);

export default Component;
