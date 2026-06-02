import * as p from "@clack/prompts";

import type { SelectOption, Spinner, TextPromptOptions, UI } from "@sidestage/core";

// Clack-backed implementation of core's UI port. This is the only place that
// knows we are in a terminal — a desktop GUI would provide its own UI.
export function createClackUI(): UI {
  return {
    intro(title) {
      p.intro(title);
    },
    outro(message) {
      p.outro(message);
    },
    note(message, title) {
      p.note(message, title);
    },
    info(message) {
      p.log.info(message);
    },
    success(message) {
      p.log.success(message);
    },
    warn(message) {
      p.log.warn(message);
    },
    error(message) {
      p.log.error(message);
    },
    step(message) {
      p.log.step(message);
    },

    async text(options: TextPromptOptions): Promise<string | null> {
      const result = await p.text({
        message: options.message,
        placeholder: options.placeholder,
        defaultValue: options.defaultValue,
        initialValue: options.defaultValue,
        validate: options.validate,
      });
      return p.isCancel(result) ? null : result;
    },

    async confirm(options): Promise<boolean> {
      const result = await p.confirm({
        message: options.message,
        initialValue: options.initialValue ?? false,
      });
      return p.isCancel(result) ? false : result;
    },

    async select<T>(options: {
      message: string;
      options: SelectOption<T>[];
      initialValue?: T;
    }): Promise<T | null> {
      // Clack's Option<Value> is a deferred conditional type that won't unify
      // with a generic T, so we key the prompt on indices and map back to the
      // real (possibly non-primitive) values ourselves.
      const items = options.options;
      const initialIndex = items.findIndex((item) => item.value === options.initialValue);
      const result = await p.select({
        message: options.message,
        options: items.map((item, index) => ({
          value: String(index),
          label: item.label,
          hint: item.hint,
        })),
        initialValue: initialIndex >= 0 ? String(initialIndex) : undefined,
      });
      if (p.isCancel(result)) return null;
      const chosen = items[Number(result)];
      return chosen ? chosen.value : null;
    },

    spinner(): Spinner {
      const instance = p.spinner();
      return {
        start: (message) => instance.start(message),
        stop: (message) => instance.stop(message),
        message: (message) => instance.message(message),
      };
    },
  };
}
