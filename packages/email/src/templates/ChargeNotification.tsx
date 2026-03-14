import type { FC } from "react";
import { Body, Container, Html, Text } from "@react-email/components";
import { email } from "../email.js";
import * as styles from "../styles.js";

interface Props {
  // TODO: port props from v1
  name?: string;
}

const Component: FC<Props> = ({ name }) => (
  <Html>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Text style={styles.paragraph}>
          {/* TODO: port content from v1 */}
          Hello {name ?? "there"}
        </Text>
      </Container>
    </Body>
  </Html>
);

export const ChargeNotification = email<Props>("Charge Notification", {
  preview: { name: "Alex" },
})(Component);
