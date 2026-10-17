import type { Preview } from "@storybook/react-vite";
import "./storybook.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: { default: "light" },
    throwPlayFunctionExceptions: true,
  },
};

export default preview;
