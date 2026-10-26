/**
 * Pure view transform for a grouped multi-select filter: one row per group with
 * a tri-state "all/some/none" toggle and an `chipSet` of the group's values.
 *
 * Shared by the global-search filter pane (attribute catalogue from the
 * backend) and the case export's standard-fields picker (static catalogue).
 * Lives next to `chipSet` because that is the primitive its rows feed —
 * neither consumer may import from the other's folder.
 */

export interface FilterEntry {
  index: string;
  attributes: string[];
}

export type AttributeOptions = Record<string, { value: string; text: string }[]>;

export interface FilterRowView {
  index: string;
  titleKey: string;
  allSelected: boolean;
  someSelected: boolean;
  chips: { value: string; labelKey: string; selected: boolean }[];
  /** The on values, for `chipSet`'s `selected` input. */
  selectedValues: string[];
}

const INDEX_TITLE_KEYS: Record<string, string> = {
  case: 'CRM.CASES.VIEW.TITLE',
  customer: 'CRM.CUSTOMERS.VIEW.TITLE',
};

/** Untranslated attribute names fall through to the backend's formatted text. */
const FIELD_LABEL_KEYS: Record<string, string> = {
  id: 'UTILS.WORDS.ID',
  name: 'UTILS.WORDS.NAME',
  number: 'CRM.CASES.LIST.NUMBER',
  title: 'CRM.CONTACT.TITLE',
  gender: 'CRM.CONTACT.GENDER',
  entity: 'CRM.CONTACT.ENTITY',
  surname: 'CRM.CONTACT.SURNAME',
  company: 'CRM.CONTACT.COMPANY',
  dateOfBirth: 'CRM.CONTACT.DATEOFBIRTH',
  streetAddress: 'CRM.CONTACT.STREETADDRESS',
  streetNumber: 'CRM.CONTACT.STREETNUMBER',
  zipCode: 'CRM.CONTACT.ZIPCODE',
  city: 'CRM.CONTACT.CITY',
  addressAdditional1: 'CRM.CONTACT.ADDRESS_ADDITIONAL_1',
  addressAdditional2: 'CRM.CONTACT.ADDRESS_ADDITIONAL_2',
  addressAdditional3: 'CRM.CONTACT.ADDRESS_ADDITIONAL_3',
  country: 'CRM.CONTACT.COUNTRY',
  phoneNumber: 'CRM.CONTACT.PHONE_NUMBER',
  mobileNumber: 'CRM.CONTACT.MOBILE_NUMBER',
  email: 'CRM.CONTACT.EMAIL',
  fax: 'CRM.CONTACT.FAX',
  iban: 'CRM.CONTACT.IBAN',
  bic: 'CRM.CONTACT.BIC',
};

export function toFilterRows(entries: FilterEntry[], options: AttributeOptions): FilterRowView[] {
  return entries.map((entry) => {
    const entryOptions = options[entry.index] ?? [];
    const selectedCount = entryOptions.filter((x) => entry.attributes.includes(x.value)).length;
    const allSelected = entryOptions.length > 0 && selectedCount === entryOptions.length;
    const chips = entryOptions.map((x) => ({
      value: x.value,
      labelKey: FIELD_LABEL_KEYS[x.value] ?? x.text,
      selected: entry.attributes.includes(x.value),
    }));
    return {
      index: entry.index,
      titleKey: INDEX_TITLE_KEYS[entry.index] ?? entry.index,
      allSelected,
      someSelected: !allSelected && selectedCount > 0,
      chips,
      selectedValues: chips.filter((x) => x.selected).map((x) => x.value),
    };
  });
}
