import { Body, Container, Html, Text } from "@react-email/components";
import type { FC } from "react";
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
          Hi {name}, click the link below to reset your password.
        </Text>
        <Text style={styles.paragraph}>
          <a href={url} style={styles.button}>
            Reset Password
          </a>
        </Text>
      </Container>
    </Body>
  </Html>
);

export const ResetPassword = email<Props>("Reset your password", {
  preview: {
    url: "https://example.com/reset",
    imageBaseUrl: "/images",
    name: "Alex",
  },
})(Component);
