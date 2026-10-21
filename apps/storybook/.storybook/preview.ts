import type { Preview } from "@storybook/react-vite";
import "./storybook.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    throwPlayFunctionExceptions: true,
  },
  globalTypes: {
    theme: {
      description: "Signal Desk color theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    // Same switch the web app's appearance menu uses, so every story follows one toolbar toggle.
    (Story, { globals }) => {
      document.documentElement.dataset.theme = globals.theme;
      return Story();
    },
  ],
};

export default preview;
