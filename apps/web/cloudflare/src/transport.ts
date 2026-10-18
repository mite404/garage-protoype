import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

/** The provider transport behind spending admission. Test builds substitute a local provider. */
export const transport: typeof streamSimple = streamSimple;
