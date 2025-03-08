import React from "react";
import {
  statusGridStyles,
  statusItemStyles,
  statusLabelStyles,
  statusIndicatorStyles,
} from "../styles";
import Section from "./Section";

interface StatusSectionProps {
  isConnected: boolean;
}

export default function StatusSection({ isConnected }: StatusSectionProps) {
  return (
    <Section title="System Status">
      <div className={statusGridStyles}>
        <div className={statusItemStyles}>
          <div className={statusLabelStyles}>React App</div>
          <div className={statusIndicatorStyles(true)}>Running</div>
        </div>

        <div className={statusItemStyles}>
          <div className={statusLabelStyles}>Electron API</div>
          <div className={statusIndicatorStyles(isConnected)}>
            {isConnected ? "Connected" : "Disconnected"}
          </div>
        </div>

        <div className={statusItemStyles}>
          <div className={statusLabelStyles}>IPC Connection</div>
          <div className={statusIndicatorStyles(isConnected)}>
            {isConnected ? "Working" : "Not working"}
          </div>
        </div>
      </div>
    </Section>
  );
}
