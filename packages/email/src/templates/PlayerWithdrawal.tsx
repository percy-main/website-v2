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
  // The recipient's name (a team official or the captain).
  recipientName: string;
  // The dropped-out player's display name (the dependent's name when a
  // parent withdraws on their behalf).
  playerName: string;
  teamName: string;
  opposition: string;
  matchDate: string;
  teamSheetUrl: string;
}

const Component: FC<Props> = ({
  imageBaseUrl,
  recipientName,
  playerName,
  teamName,
  opposition,
  matchDate,
  teamSheetUrl,
}) => (
  <Html>
    <Head />
    <Preview>
      Percy Main Community Sports Club - {playerName} has dropped out of{" "}
      {teamName} vs {opposition}
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
        <Text style={styles.paragraph}>Hi {recipientName},</Text>
        <Text style={styles.paragraph}>
          {playerName} has dropped out of the following game:
        </Text>
        <ul>
          <li>
            <em>Team: </em>
            {teamName}
          </li>
          <li>
            <em>Opposition: </em>
            {opposition}
          </li>
          <li>
            <em>Date: </em>
            {matchDate}
          </li>
        </ul>
        <Text style={styles.paragraph}>
          You may want to find a replacement and update your team sheet.
        </Text>
        <Section style={styles.btnContainer}>
          <Button style={styles.button} href={teamSheetUrl}>
            View Team Sheet
          </Button>
        </Section>
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

export const PlayerWithdrawal = email<Props>("Player Dropout", {
  preview: {
    imageBaseUrl: "http://localhost:5173/images",
    recipientName: "Alex",
    playerName: "Jordan Smith",
    teamName: "Senior XI",
    opposition: "Benwell Hill",
    matchDate: "25/05/2026",
    teamSheetUrl: "http://localhost:5173/matchday/abc123",
  },
})(Component);

export default Component;
