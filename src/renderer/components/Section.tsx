import React, { ReactNode } from "react";
import { sectionStyles, sectionTitleStyles } from "../styles";

interface SectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export default function Section({ title, children, className }: SectionProps) {
  return (
    <section className={`${sectionStyles} ${className || ""}`}>
      <h2 className={sectionTitleStyles}>{title}</h2>
      {children}
    </section>
  );
}
