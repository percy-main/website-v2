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
import { format } from "date-fns";
import { email } from "../email.ts";
import * as styles from "../styles.ts";

interface Props {
  imageBaseUrl: string;
  name: string | null;
  type: string | undefined;
  paid_until: string;
  isNew: boolean;
}

const membershipTypeLabels: Record<string, string> = {
  senior_player: "Senior Player",
  social: "Social",
  junior: "Junior",
  concessionary: "Student / Concessionary",
  senior_women_player: "Senior Women Player",
};

const Component: FC<Props> = ({
  type,
  name,
  imageBaseUrl,
  paid_until,
  isNew,
}) => (
  <Html>
    <Head />
    <Preview>
      Percy Main Community Sports Club - Membership Confirmation
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
          Thanks for {isNew ? "starting" : "extending"} your membership to Percy
          Main Cricket and Sports Club.
        </Text>
        <ul>
          <li>
            <em>Type: </em>
            {type ? (membershipTypeLabels[type] ?? "Unknown") : "Unknown"}
          </li>
          <li>
            <em>Valid Until: </em>
            {format(new Date(paid_until), "dd/MM/yyyy")}
          </li>
        </ul>
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

export const MembershipUpdated = email<Props>("Welcome to The Main", {
  preview: {
    imageBaseUrl: "http://localhost:5173/images",
    name: "Alex",
    type: "senior_player",
    paid_until: "2026-03-01T15:59:39.000Z",
    isNew: true,
  },
})(Component);

export default Component;
