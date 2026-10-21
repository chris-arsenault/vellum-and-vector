import { useState, type ReactNode } from "react";

/** Closed setup disclosures do not mount their editable or diagnostic subtree. */
export function SetupDisclosure({
  title,
  className,
  children,
  initiallyOpen = false,
}: {
  title: string;
  className?: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      open={open}
      className={className}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      {open && children}
    </details>
  );
}
