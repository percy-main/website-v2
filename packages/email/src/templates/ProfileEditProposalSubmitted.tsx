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
  reviewUrl: string;
}

const Component: FC<Props> = ({
  imageBaseUrl,
  recipientName,
  profileName,
  reviewUrl,
}) => (
  <Html>
    <Head />
    <Preview>A profile edit is waiting for your review</Preview>
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
          {profileName} has proposed an edit to their own profile. It will not
          go live until a content editor approves it.
        </Text>
        <Text style={styles.paragraph}>
          Open the admin panel and go to Content, then Profile Requests, to
          review and approve or reject the change.
        </Text>
        <Section style={styles.btnContainer}>
          <Button style={styles.button} href={reviewUrl}>
            Review profile edits
          </Button>
        </Section>
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

export const ProfileEditProposalSubmitted = email<Props>(
  "A profile edit is waiting for your review",
  {
    preview: {
      imageBaseUrl: "http://localhost:5173/images",
      recipientName: "Jane Smith",
      profileName: "John Doe",
      reviewUrl: "http://localhost:5173/admin",
    },
  },
)(Component);

export default Component;
