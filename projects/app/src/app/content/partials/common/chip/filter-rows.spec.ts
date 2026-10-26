import { toFilterRows } from './filter-rows';

describe('filter rows', () => {
  it('derives filter row state from entries + options', () => {
    const options = {
      case: [
        { value: 'id', text: 'ID' },
        { value: 'name', text: 'Name' },
      ],
    };

    const [row] = toFilterRows([{ index: 'case', attributes: ['id'] }], options);

    expect(row.allSelected).toBe(false);
    expect(row.someSelected).toBe(true);
    expect(row.chips).toEqual([
      { value: 'id', labelKey: 'UTILS.WORDS.ID', selected: true },
      { value: 'name', labelKey: 'UTILS.WORDS.NAME', selected: false },
    ]);
  });
});
