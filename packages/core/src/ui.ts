// The UI port. core drives flows (onboarding, the session loop) against this
// interface; a front-end implements it. The CLI backs it with Clack today; a
// desktop GUI would back it differently — same core logic, no rewrite.

export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface TextPromptOptions {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
}

export interface Spinner {
  start(message?: string): void;
  stop(message?: string): void;
  message(message: string): void;
}

export interface UI {
  intro(title: string): void;
  outro(message: string): void;
  note(message: string, title?: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  step(message: string): void;
  // Prompts return null when the user cancels (e.g. Ctrl-C / Escape).
  text(options: TextPromptOptions): Promise<string | null>;
  confirm(options: { message: string; initialValue?: boolean }): Promise<boolean>;
  select<T>(options: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
  }): Promise<T | null>;
  spinner(): Spinner;
}
