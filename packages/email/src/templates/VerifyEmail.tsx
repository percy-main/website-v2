import type { FC } from "react";
import { Body, Container, Html, Text } from "@react-email/components";
import { email } from "../email.js";
import * as styles from "../styles.js";

interface Props {
  url: string;
  imageBaseUrl: string;
  name: string;
}

const Component: FC<Props> = ({ url, name }) => (
  <Html>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Text style={styles.paragraph}>
          Hi {name}, please verify your email by clicking the link below.
        </Text>
        <Text style={styles.paragraph}>
          <a href={url} style={styles.button}>
            Verify Email
          </a>
        </Text>
      </Container>
    </Body>
  </Html>
);

export const VerifyEmail = email<Props>("Verify your email address", {
  preview: { url: "https://example.com/verify", imageBaseUrl: "/images", name: "Alex" },
})(Component);
