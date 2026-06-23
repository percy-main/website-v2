// organize-imports-ignore — React must stay: tsx/esbuild uses classic JSX transform for workspace deps
import React, { type FC } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "react-email";
import { email } from "../email.ts";
import * as styles from "../styles.ts";

interface Props {
  imageBaseUrl: string;
  recipientName: string;
  profileName: string;
  outcome: "approved" | "rejected";
  decisionNote: string | null;
  profileUrl: string;
}

const Component: FC<Props> = ({
  imageBaseUrl,
  recipientName,
  profileName,
  outcome,
  decisionNote,
  profileUrl,
}) => (
  <Html>
    <Head />
    <Preview>An update on your profile edit</Preview>
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
          <>
            <Text style={styles.paragraph}>
              Good news: the edit you proposed to your profile has been approved
              and is now live.
            </Text>
            <Section style={styles.btnContainer}>
              <Button style={styles.button} href={profileUrl}>
                View your profile
              </Button>
            </Section>
          </>
        ) : (
          <Text style={styles.paragraph}>
            Thank you for proposing an edit to your profile. After review, a
            content editor was not able to publish this change.
          </Text>
        )}
        {decisionNote ? (
          <Text style={styles.paragraph}>
            <strong>Note from the reviewer:</strong> {decisionNote}
          </Text>
        ) : null}
        {outcome === "rejected" ? (
          <Text style={styles.paragraph}>
            You can make further changes and submit your profile {profileName}{" "}
            for review again at any time.
          </Text>
        ) : null}
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

export const ProfileEditDecision = email<Props>(
  "An update on your profile edit",
  {
    preview: {
      imageBaseUrl: "http://localhost:5173/images",
      recipientName: "John Doe",
      profileName: "John Doe",
      outcome: "approved",
      decisionNote: null,
      profileUrl: "http://localhost:5173/person/john-doe",
    },
  },
)(Component);

export default Component;
