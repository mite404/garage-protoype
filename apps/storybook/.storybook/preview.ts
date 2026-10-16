import type { Preview } from "@storybook/react-vite";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./storybook.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: { default: "light" },
  },
};

export default preview;
