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
  name: string | null;
  dateFrom: string;
  dateTo: string;
  fixtureCount: number;
  url: string;
}

const Component: FC<Props> = ({
  name,
  imageBaseUrl,
  dateFrom,
  dateTo,
  fixtureCount,
  url,
}) => (
  <Html>
    <Head />
    <Preview>
      New availability request: {dateFrom} to {dateTo}
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
        <Text style={styles.paragraph}>Hi {name ?? "there"},</Text>
        <Text style={styles.paragraph}>
          A new availability request has been created for{" "}
          <strong>
            {dateFrom} to {dateTo}
          </strong>{" "}
          covering <strong>{fixtureCount}</strong> fixture
          {fixtureCount === 1 ? "" : "s"}. Please let us know whether
          you&apos;re available.
        </Text>
        <Section style={styles.btnContainer}>
          <Button style={styles.button} href={url}>
            View &amp; Respond
          </Button>
        </Section>
        <Text style={styles.paragraph}>
          Best,
          <br />
          Percy Main Cricket Club
        </Text>
        <Hr style={styles.hr} />
        <Text style={styles.footer}>
          Percy Main Cricket Club, St. Johns Terrace, North Shields, NE29 6HS
        </Text>
      </Container>
    </Body>
  </Html>
);

export const AvailabilityRequest = email<Props>("Availability Request", {
  preview: {
    imageBaseUrl: "http://localhost:5173/images",
    name: "Alex",
    dateFrom: "2026-05-10",
    dateTo: "2026-05-17",
    fixtureCount: 4,
    url: "http://localhost:5173/availability/abc-123",
  },
})(Component);

export default Component;
