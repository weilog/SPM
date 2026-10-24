// Automatic tests never inherit a developer's live vendor credentials/config.
// Provider tests may opt into a LOCAL fixture or replace fetch explicitly.
process.env.AI_EXTERNAL_ENABLED = "false";
const actualFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error(
      "External model/network access is forbidden in automatic API tests",
    );
  return actualFetch(input, options);
};
