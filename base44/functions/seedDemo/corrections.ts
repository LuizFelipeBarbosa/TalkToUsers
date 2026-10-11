// Deals that lookups saved the wrong way round: the provider as the payer. Each one hides
// money loops, since loops follow the money. seedDemo flips each one to buyer -> seller, or
// deletes it when the right way round is already saved. Checked by hand against the quote
// saved as the edge's evidence.

export const REVERSED_EDGES = [
  { key: "google|cloud|anthropic", reason: "Anthropic buys access to up to 1M Google TPUs" },
  { key: "alphabet|cloud|anthropic", reason: "Anthropic buys Google Cloud compute" },
  { key: "broadcom|hardware|anthropic", reason: "Anthropic buys TPU capacity from Google and Broadcom" },
  { key: "spacex|cloud|anthropic", reason: "Anthropic rents GPU capacity in SpaceX's Colossus 1 and 2" },
  { key: "microsoft|cloud|perplexity", reason: "Perplexity pays Microsoft $750M for Azure" },
  { key: "oracle|cloud|bytedance", reason: "TikTok's US data is hosted on Oracle's cloud" },
  { key: "oracle|cloud|openai", reason: "OpenAI buys compute from Oracle" },
  { key: "vastdata|software|nscale", reason: "Nscale runs Vast Data's software" },
  { key: "nscale|cloud|openai", reason: "OpenAI buys the Stargate Norway capacity Nscale builds" },
];
