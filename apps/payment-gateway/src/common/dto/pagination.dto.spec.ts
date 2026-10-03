import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaginationDto, toPaged } from './pagination.dto';

/** Query strings always arrive as strings, so parse the way the pipe does. */
function parse(query: Record<string, unknown>): { dto: PaginationDto; errors: string[] } {
  const dto = plainToInstance(PaginationDto, query as object);
  const errors = validateSync(dto).map((e) => e.property);
  return { dto, errors };
}

describe('PaginationDto', () => {
  it('defaults to page 1 / pageSize 20 when nothing is supplied', () => {
    const { dto, errors } = parse({});
    expect(errors).toEqual([]);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
  });

  it('coerces numeric strings from the query string', () => {
    const { dto, errors } = parse({ page: '3', pageSize: '50' });
    expect(errors).toEqual([]);
    expect(dto.page).toBe(3);
    expect(dto.pageSize).toBe(50);
  });

  describe('accepts the edges of the allowed range', () => {
    it.each([
      ['the first page', { page: '1' }],
      ['the smallest page size', { pageSize: '1' }],
      ['the largest page size', { pageSize: '200' }],
      ['a very high page number', { page: '999999' }],
    ])('accepts %s', (_label, query) => {
      expect(parse(query).errors).toEqual([]);
    });
  });

  describe('rejects out-of-range values', () => {
    it.each([
      ['page 0', { page: '0' }, 'page'],
      ['a negative page', { page: '-1' }, 'page'],
      ['pageSize 0', { pageSize: '0' }, 'pageSize'],
      ['a negative pageSize', { pageSize: '-20' }, 'pageSize'],
      // The cap is what stops a caller from asking for the whole table at once.
      ['a pageSize over the 200 cap', { pageSize: '201' }, 'pageSize'],
      ['an absurd pageSize', { pageSize: '100000' }, 'pageSize'],
    ])('rejects %s', (_label, query, field) => {
      expect(parse(query).errors).toContain(field);
    });

    it.each([
      ['a fractional page', { page: '1.5' }, 'page'],
      ['a fractional pageSize', { pageSize: '20.5' }, 'pageSize'],
      ['a non-numeric page', { page: 'abc' }, 'page'],
      ['a non-numeric pageSize', { pageSize: 'all' }, 'pageSize'],
      ['an empty page string', { page: '' }, 'page'],
      ['an array page', { page: ['1', '2'] }, 'page'],
      ['Infinity', { pageSize: 'Infinity' }, 'pageSize'],
    ])('rejects %s', (_label, query, field) => {
      expect(parse(query).errors).toContain(field);
    });
  });

  it('validates page and pageSize independently', () => {
    const { errors } = parse({ page: '0', pageSize: '999' });
    expect(errors).toEqual(expect.arrayContaining(['page', 'pageSize']));
  });

  it('coerces a boolean-ish value rather than rejecting it', () => {
    // Number(true) === 1, which is a legal page. Not reachable over HTTP (query
    // params are strings), but worth pinning so the coercion is not mistaken
    // for validation.
    const { dto, errors } = parse({ page: true });
    expect(errors).toEqual([]);
    expect(dto.page).toBe(1);
  });

  // @IsOptional() skips validation for null/undefined, and an explicit nullish
  // value in the plain object overwrites the property initializer — so the DTO
  // alone does NOT guarantee a number here. Every list service therefore
  // defends with `filters.pageSize ?? 20`, which is the layer that supplies the
  // default in this case. Both layers are load-bearing; don't drop either.
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('passes validation for an explicit %s without producing a number', (_label, value) => {
    const { dto, errors } = parse({ page: value, pageSize: value });
    expect(errors).toEqual([]);
    expect(dto.pageSize ?? 20).toBe(20);
    expect(dto.page ?? 1).toBe(1);
  });
});

describe('toPaged', () => {
  it('wraps rows with the paging metadata the caller asked for', () => {
    expect(toPaged([{ id: 'a' }], 57, 2, 20)).toEqual({
      data: [{ id: 'a' }],
      total: 57,
      page: 2,
      pageSize: 20,
    });
  });

  it('reports an empty page without losing the total', () => {
    // Asking past the end is not an error — the total still tells the client
    // how many rows exist.
    expect(toPaged([], 57, 99, 20)).toEqual({ data: [], total: 57, page: 99, pageSize: 20 });
  });

  it('handles a completely empty result set', () => {
    expect(toPaged([], 0, 1, 20)).toEqual({ data: [], total: 0, page: 1, pageSize: 20 });
  });

  it('does not copy the rows array', () => {
    const rows = [{ id: 'a' }];
    expect(toPaged(rows, 1, 1, 20).data).toBe(rows);
  });
});
