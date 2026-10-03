import { BadRequestException } from '@nestjs/common';
import { App } from '../../database/entities';
import { MetadataValidatorService } from './metadata-validator.service';

function app(requiredMetadata: string[] | undefined, name = 'Savi'): App {
  return { name, requiredMetadata } as App;
}

describe('MetadataValidatorService', () => {
  const service = new MetadataValidatorService();

  describe('when the app requires nothing', () => {
    it('accepts undefined metadata and normalizes it to an empty object', () => {
      expect(service.validate(app([]), undefined)).toEqual({});
    });

    it('passes arbitrary metadata straight through', () => {
      const md = { userId: 'u1', nested: { a: 1 }, list: [1, 2] };
      expect(service.validate(app([]), md)).toBe(md);
    });

    // requiredMetadata is NOT NULL in the schema, but an entity built in memory
    // (or a partial select) can still arrive without it.
    it('treats a missing requiredMetadata array as "requires nothing"', () => {
      expect(service.validate(app(undefined), { any: 'thing' })).toEqual({ any: 'thing' });
      expect(service.validate(app(undefined), undefined)).toEqual({});
    });
  });

  describe('when a required key is absent or blank', () => {
    it('rejects metadata missing the key entirely', () => {
      expect(() => service.validate(app(['userId']), {})).toThrow(BadRequestException);
    });

    it('rejects undefined metadata when a key is required', () => {
      expect(() => service.validate(app(['userId']), undefined)).toThrow(BadRequestException);
    });

    it.each([
      ['null', null],
      ['undefined as an explicit value', undefined],
      ['an empty string', ''],
    ])('rejects a key present but set to %s', (_label, value) => {
      expect(() => service.validate(app(['userId']), { userId: value })).toThrow(BadRequestException);
    });

    it('reports every missing key, not just the first', () => {
      try {
        service.validate(app(['userId', 'email', 'plan']), { email: 'a@b.c' });
        throw new Error('expected a BadRequestException');
      } catch (e) {
        const body = (e as BadRequestException).getResponse() as {
          error: string; missing: string[]; message: string;
        };
        expect(body.error).toBe('missing_required_metadata');
        expect(body.missing).toEqual(['userId', 'plan']);
        // The message names the app and the full requirement list, so an app
        // developer can fix it without reading the gateway source.
        expect(body.message).toBe('Savi requires: userId, email, plan');
      }
    });
  });

  describe('falsy-but-legitimate values', () => {
    // These are the values a naive `if (!md[k])` check would wrongly reject.
    it.each([
      ['the number zero', 0],
      ['false', false],
      ['NaN', Number.NaN],
      ['an empty array', []],
      ['an empty object', {}],
      ['the string "0"', '0'],
      ['the string "false"', 'false'],
    ])('accepts %s as a satisfied requirement', (_label, value) => {
      expect(() => service.validate(app(['flag']), { flag: value })).not.toThrow();
    });

    // Documents current behavior: the check is exact-empty-string, not trimmed,
    // so "   " counts as provided. Tightening this would be a deliberate change.
    it('accepts a whitespace-only string (no trimming)', () => {
      expect(() => service.validate(app(['userId']), { userId: '   ' })).not.toThrow();
    });
  });

  describe('key matching', () => {
    it('is case-sensitive — userid does not satisfy userId', () => {
      expect(() => service.validate(app(['userId']), { userid: 'u1' })).toThrow(BadRequestException);
    });

    it('accepts extra keys beyond the requirements', () => {
      const md = { userId: 'u1', extra: 'kept' };
      expect(service.validate(app(['userId']), md)).toEqual(md);
    });

    it('does not mutate the caller metadata', () => {
      const md = { userId: 'u1' };
      service.validate(app(['userId']), md);
      expect(md).toEqual({ userId: 'u1' });
    });

    it('satisfies a duplicated requirement once', () => {
      expect(() => service.validate(app(['userId', 'userId']), { userId: 'u1' })).not.toThrow();
    });

    // An inherited property is not an own key, but `in` walks the prototype
    // chain — this documents that a prototype value is accepted.
    it('sees a key inherited through the prototype chain', () => {
      const md = Object.create({ userId: 'from-proto' }) as Record<string, unknown>;
      expect(() => service.validate(app(['userId']), md)).not.toThrow();
    });
  });
});
