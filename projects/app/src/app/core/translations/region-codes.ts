/** The regions the app knows the calendars of, as ISO 3166 codes:
    Germany, the United Kingdom, Japan. */
export const REGIONS = ['DE', 'GB', 'JP'] as const;
export type RegionCode = (typeof REGIONS)[number];

/** A region as chosen: one of its own, or the system's. */
export type RegionPreference = RegionCode | 'system';

/** Where the system is not one of {@link REGIONS}, or cannot say: Germany. */
export const FALLBACK_REGION: RegionCode = 'DE';
