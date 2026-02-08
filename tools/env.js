export const isCloud =
  process.env.RENDER === "true" || process.env.CLOUD_ENV === "true";
