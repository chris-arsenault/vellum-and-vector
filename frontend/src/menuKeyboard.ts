import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** Arrow, Home and End navigation between a popover menu's enabled buttons. */
export function menuKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled")];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const keys: Record<string, number> = {
    ArrowDown: (index + 1) % buttons.length,
    ArrowUp: (index + buttons.length - 1) % buttons.length,
    Home: 0,
    End: buttons.length - 1,
  };
  if (event.key in keys) {
    event.preventDefault();
    buttons[keys[event.key]]?.focus();
  }
}
