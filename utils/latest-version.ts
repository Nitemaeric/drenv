const VERSION_URL = "https://docs.dragonruby.org/version.txt";

export const getLatestAvailableVersion = async (): Promise<
  string | undefined
> => {
  try {
    const res = await fetch(VERSION_URL);

    if (!res.ok) return undefined;

    const version = (await res.text()).trim();

    return /^\d+\.\d+/.test(version) ? version : undefined;
  } catch {
    return undefined;
  }
};
