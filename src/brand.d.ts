// SPDX-License-Identifier: Apache-2.0
// The brand the window is built for, from brands/<brand> (vite.config.ts makes these modules).

declare module "virtual:brand" {
  export const brand: {
    productName: string;
    shortName: string;
    colors: { brand: string; navy: string; accentLight: string; accentDark: string };
    sibling: { label: string; url: string };
  };
  /** The address of the brand's icon, shown in the window's header. */
  export const markUrl: string;
}

declare module "virtual:brand-apps" {
  /** The brand's apps.json, each icon a data: address. Only the preview page (tests/ui-preview.html) uses it. */
  export const apps: {
    hub: { repository: string };
    apps: {
      id: string;
      name: string;
      description?: string;
      mark: { letters: string; color: string; icon?: string };
      extras?: { name: string; description?: string }[];
      comingSoonUntilReleased?: boolean;
      listedBeforeRelease?: boolean;
      hiddenUntilRepositoryExists?: boolean;
    }[];
    web: { id: string; name: string; description: string; url: string }[];
    comingSoon: { id: string; name: string; description: string; mark?: { letters: string; color: string } }[];
  };
}
